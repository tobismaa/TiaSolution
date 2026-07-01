import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname);
const port = Number(process.env.PORT || 8003);
const supabaseUrl = process.env.SUPABASE_URL || "https://clfwijtkiblpmgentbho.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "sb_publishable_zMwE89HnJVeb6tUI3QXlhQ_GB2iZrUN";
const supabaseServerKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
const resendApiKey = process.env.RESEND_API_KEY || "";
const resendFromEmail = process.env.RESEND_FROM_EMAIL || "Tia Security <onboarding@resend.dev>";
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const supabaseAdmin = createClient(supabaseUrl, supabaseServerKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
const recentNotifications = new Map();

const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf"
};

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type, x-tia-auth"
    });
    response.end(JSON.stringify(payload));
}

function getSenderDomain() {
    const match = /<[^@<>]+@([^<>]+)>/.exec(resendFromEmail);
    if (match?.[1]) {
        return match[1];
    }

    const plainMatch = /@([^\s>]+)/.exec(resendFromEmail);
    return plainMatch?.[1] || "";
}

function handleHealthCheck(response) {
    sendJson(response, 200, {
        ok: true,
        resendConfigured: Boolean(resend),
        resendFromDomain: getSenderDomain() || null,
        supabaseHost: (() => {
            try {
                return new URL(supabaseUrl).host;
            } catch {
                return null;
            }
        })(),
        supabaseKeyPrefix: supabaseAnonKey ? supabaseAnonKey.slice(0, 13) : null,
        supabaseKeyLength: supabaseAnonKey.length,
        supabaseServerKeyConfigured: supabaseServerKey !== supabaseAnonKey,
        supabaseServerKeyPrefix: supabaseServerKey ? supabaseServerKey.slice(0, 10) : null
    });
}

async function readRequestJson(request) {
    let body = "";
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 16_384) {
            throw new Error("Request body is too large.");
        }
    }
    return body ? JSON.parse(body) : {};
}

function getBearerToken(request) {
    const header = request.headers.authorization || "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match?.[1]) {
        return match[1];
    }

    const backupHeader = request.headers["x-tia-auth"] || "";
    const backupValue = Array.isArray(backupHeader) ? backupHeader[0] : backupHeader;
    const backupMatch = /^Bearer\s+(.+)$/i.exec(backupValue);
    return backupMatch?.[1] || backupValue || "";
}

function decodeJwtPayload(token) {
    try {
        const payload = String(token || "").split(".")[1];
        if (!payload) {
            return null;
        }

        const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
        return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    } catch {
        return null;
    }
}

async function getAuthenticatedUserFromRls(token) {
    const claims = decodeJwtPayload(token);
    const userId = String(claims?.sub || "").trim();
    if (!userId) {
        return null;
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email`, {
        headers: {
            apikey: supabaseAnonKey,
            authorization: `Bearer ${token}`,
            accept: "application/json"
        }
    });

    if (!response.ok) {
        console.warn("[security-notification] Supabase RLS token verification failed.", {
            status: response.status
        });
        return null;
    }

    const rows = await response.json();
    const profile = Array.isArray(rows) ? rows[0] : null;
    if (!profile?.id) {
        return null;
    }

    return {
        id: profile.id,
        email: profile.email || claims.email || ""
    };
}

async function getAuthenticatedUser(token) {
    if (!token) {
        return null;
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
        console.warn("[security-notification] Supabase token verification failed.", {
            message: error?.message || "No user returned"
        });
        return getAuthenticatedUserFromRls(token);
    }

    return data.user;
}

function canNotify(key) {
    const now = Date.now();
    const previous = recentNotifications.get(key) || 0;
    if (now - previous < 60_000) {
        return false;
    }
    recentNotifications.set(key, now);
    return true;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function handleSecurityNotification(request, response) {
    if (request.method === "OPTIONS") {
        sendJson(response, 204, {});
        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
    }

    if (!resend) {
        console.warn("[security-notification] Resend is not configured.");
        sendJson(response, 503, { error: "Resend is not configured. Set RESEND_API_KEY." });
        return;
    }

    let payload;
    try {
        payload = await readRequestJson(request);
    } catch {
        sendJson(response, 400, { error: "Invalid request payload." });
        return;
    }

    if (payload?.type !== "blocked_login_attempt") {
        sendJson(response, 400, { error: "Unsupported notification type." });
        return;
    }

    const authToken = getBearerToken(request);
    if (!authToken) {
        console.warn("[security-notification] Missing Supabase bearer token.");
        sendJson(response, 401, { error: "Authentication is required.", reason: "missing_token" });
        return;
    }

    const user = await getAuthenticatedUser(authToken);
    if (!user?.id || !user?.email) {
        console.warn("[security-notification] Rejected unauthenticated request.");
        sendJson(response, 401, { error: "Authentication is required.", reason: "token_rejected" });
        return;
    }

    const rateKey = `${user.id}:${payload.type}`;
    if (!canNotify(rateKey)) {
        console.log(`[security-notification] Skipped duplicate notification for ${user.email}.`);
        sendJson(response, 202, { ok: true, skipped: "rate_limited" });
        return;
    }

    const occurredAt = payload.occurredAt
        ? new Date(payload.occurredAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })
        : new Date().toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
    const safeEmail = escapeHtml(user.email);
    const safeTime = escapeHtml(occurredAt);

    const subject = "Security alert: login attempt blocked";
    const text = [
        "Tia blocked another login attempt on your account.",
        "",
        `Account: ${user.email}`,
        `Time: ${occurredAt}`,
        "",
        "If this was you, log out from the active device before signing in elsewhere.",
        "If this was not you, change your password and contact your administrator."
    ].join("\n");

    const html = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <title>Login attempt blocked</title>
        </head>
        <body style="margin:0;padding:0;background:#f3f7f5;font-family:Arial,Helvetica,sans-serif;color:#17313e;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7f5;margin:0;padding:28px 12px;">
                <tr>
                    <td align="center">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dce8e1;border-radius:16px;overflow:hidden;box-shadow:0 18px 45px rgba(23,49,62,0.10);">
                            <tr>
                                <td style="background:#0f5f3f;padding:28px 30px;color:#ffffff;">
                                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                                        <tr>
                                            <td>
                                                <div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#bcebd2;">Tia Security</div>
                                                <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;font-weight:800;color:#ffffff;">Login attempt blocked</h1>
                                            </td>
                                            <td align="right" style="width:58px;">
                                                <div style="width:46px;height:46px;border-radius:999px;background:#e6f6ee;color:#0f5f3f;text-align:center;line-height:46px;font-size:24px;font-weight:800;">!</div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:30px;">
                                    <p style="margin:0 0 18px;font-size:16px;line-height:1.55;color:#294653;">Tia blocked another login attempt on your account while an active session was already open.</p>
                                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border:1px solid #dce8e1;border-radius:12px;background:#f8fbf9;">
                                        <tr>
                                            <td style="padding:16px 18px;border-bottom:1px solid #dce8e1;">
                                                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:800;color:#5c7468;">Account</div>
                                                <div style="margin-top:5px;font-size:15px;font-weight:700;color:#17313e;">${safeEmail}</div>
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style="padding:16px 18px;">
                                                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;font-weight:800;color:#5c7468;">Time</div>
                                                <div style="margin-top:5px;font-size:15px;font-weight:700;color:#17313e;">${safeTime}</div>
                                            </td>
                                        </tr>
                                    </table>
                                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0 0;">
                                        <tr>
                                            <td style="padding:16px 18px;border-left:4px solid #0f8a5f;background:#edf8f2;border-radius:10px;">
                                                <p style="margin:0;font-size:14px;line-height:1.55;color:#254b3a;"><strong>If this was you:</strong> log out from the active device before signing in elsewhere.</p>
                                            </td>
                                        </tr>
                                    </table>
                                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:12px 0 0;">
                                        <tr>
                                            <td style="padding:16px 18px;border-left:4px solid #b45309;background:#fff7ed;border-radius:10px;">
                                                <p style="margin:0;font-size:14px;line-height:1.55;color:#5a3512;"><strong>If this was not you:</strong> change your password and contact your administrator immediately.</p>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:18px 30px;background:#f8fbf9;border-top:1px solid #dce8e1;">
                                    <p style="margin:0;font-size:12px;line-height:1.5;color:#6b7f76;">This is an automated security notification from Tia. Do not reply to this email.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
    `;

    const { data, error } = await resend.emails.send({
        from: resendFromEmail,
        to: [user.email],
        subject,
        text,
        html
    });

    if (error) {
        console.error(`[security-notification] Resend failed for ${user.email}:`, error);
        sendJson(response, 502, { error: error.message || "Unable to send email." });
        return;
    }

    console.log(`[security-notification] Sent blocked-login alert to ${user.email}.`);
    sendJson(response, 200, { ok: true, id: data?.id || null });
}

async function serveStatic(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    const filePath = normalize(join(rootDir, relativePath));

    if (!filePath.startsWith(rootDir) || !existsSync(filePath)) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
    }

    const content = await readFile(filePath);
    response.writeHead(200, {
        "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    response.end(content);
}

const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
        if (url.pathname === "/api/health") {
            handleHealthCheck(response);
            return;
        }

        if (url.pathname === "/api/security-notification") {
            await handleSecurityNotification(request, response);
            return;
        }

        await serveStatic(request, response);
    } catch (error) {
        sendJson(response, 500, { error: error?.message || "Server error." });
    }
});

server.listen(port, "0.0.0.0", () => {
    console.log(`Tia server running at http://localhost:${port}/`);
});
