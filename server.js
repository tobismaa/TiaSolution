import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resend } from "resend";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname);
const port = Number(process.env.PORT || 8003);
const supabaseUrl = process.env.SUPABASE_URL || "https://clfwijtkiblpmgentbho.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "sb_publishable_zMwE89HnJVeb6tUI3QXlhQ_GB2iZrUN";
const resendApiKey = process.env.RESEND_API_KEY || "";
const resendFromEmail = process.env.RESEND_FROM_EMAIL || "Tia Security <onboarding@resend.dev>";
const resend = resendApiKey ? new Resend(resendApiKey) : null;
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
        "access-control-allow-headers": "authorization, content-type"
    });
    response.end(JSON.stringify(payload));
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
    return match?.[1] || "";
}

async function getAuthenticatedUser(token) {
    if (!token) {
        return null;
    }

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
            apikey: supabaseAnonKey,
            authorization: `Bearer ${token}`
        }
    });

    if (!response.ok) {
        return null;
    }

    return response.json();
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

    const user = await getAuthenticatedUser(getBearerToken(request));
    if (!user?.id || !user?.email) {
        sendJson(response, 401, { error: "Authentication is required." });
        return;
    }

    const rateKey = `${user.id}:${payload.type}`;
    if (!canNotify(rateKey)) {
        sendJson(response, 202, { ok: true, skipped: "rate_limited" });
        return;
    }

    const occurredAt = payload.occurredAt
        ? new Date(payload.occurredAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })
        : new Date().toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
    const safeEmail = escapeHtml(user.email);
    const safeTime = escapeHtml(occurredAt);

    const subject = "Tia security alert: login attempt blocked";
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
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#17313e">
            <h2 style="margin:0 0 12px">Login attempt blocked</h2>
            <p>Tia blocked another login attempt on your account.</p>
            <p><strong>Account:</strong> ${safeEmail}<br><strong>Time:</strong> ${safeTime}</p>
            <p>If this was you, log out from the active device before signing in elsewhere.</p>
            <p>If this was not you, change your password and contact your administrator.</p>
        </div>
    `;

    const { data, error } = await resend.emails.send({
        from: resendFromEmail,
        to: [user.email],
        subject,
        text,
        html
    });

    if (error) {
        sendJson(response, 502, { error: error.message || "Unable to send email." });
        return;
    }

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
