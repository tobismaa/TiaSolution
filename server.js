import "dotenv/config";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomInt } from "node:crypto";
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
const USER_INVITE_ROLES = new Set(["business_admin", "manager", "staff", "account", "auditor"]);
const PLATFORM_USER_ROLES = new Set(["super_admin", "business_admin", "manager", "staff", "account", "auditor"]);

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

function getRequestOrigin(request) {
    const origin = request.headers.origin || "";
    if (origin) {
        return origin.replace(/\/$/, "");
    }

    const referer = request.headers.referer || "";
    if (referer) {
        try {
            return new URL(referer).origin;
        } catch {
            return "";
        }
    }

    return "";
}

function getInviteRedirectUrl(request) {
    const configuredAppUrl = String(process.env.APP_URL || process.env.PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
    const baseUrl = configuredAppUrl || getRequestOrigin(request) || `http://localhost:${port}`;
    return `${baseUrl}/set-password.html`;
}

function buildDirectInviteLink(redirectTo, tokenHash, email) {
    const url = new URL(redirectTo);
    url.searchParams.set("type", "invite");
    url.searchParams.set("token_hash", tokenHash);
    if (email) {
        url.searchParams.set("email", email);
    }
    return url.toString();
}

function hashSecurityCode(code) {
    return createHash("sha256").update(String(code || "")).digest("hex");
}

function generateTwoFactorCode() {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

async function getEmailTwoFactorThreshold() {
    const { data } = await supabaseAdmin
        .from("platform_settings")
        .select("value")
        .eq("key", "email_2fa_after_logins")
        .maybeSingle();

    const threshold = Number(data?.value || 10);
    if (!Number.isFinite(threshold) || threshold < 1) {
        return 10;
    }

    return Math.min(Math.round(threshold), 1000);
}

function renderTwoFactorEmail({ fullName, code }) {
    const safeName = escapeHtml(fullName || "there");
    const safeCode = escapeHtml(code);
    return `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <title>Tia verification code</title>
        </head>
        <body style="margin:0;padding:0;background:#f3f7f5;font-family:Arial,Helvetica,sans-serif;color:#17313e;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7f5;margin:0;padding:28px 12px;">
                <tr>
                    <td align="center">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce8e1;border-radius:16px;overflow:hidden;box-shadow:0 18px 45px rgba(23,49,62,0.10);">
                            <tr>
                                <td style="background:#0f5f3f;padding:26px 30px;color:#ffffff;">
                                    <div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#bcebd2;">Tia Security</div>
                                    <h1 style="margin:8px 0 0;font-size:25px;line-height:1.2;font-weight:800;color:#ffffff;">Verification required</h1>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:30px;">
                                    <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#294653;">Hello ${safeName},</p>
                                    <p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:#294653;">Use this code to complete your Tia login.</p>
                                    <div style="font-size:34px;letter-spacing:0.18em;font-weight:900;color:#0f5f3f;background:#edf8f2;border:1px solid #ccebdd;border-radius:14px;padding:18px 20px;text-align:center;">${safeCode}</div>
                                    <p style="margin:18px 0 0;font-size:13px;line-height:1.55;color:#6b7f76;">This code expires in 10 minutes. If you did not try to sign in, contact your administrator.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
    `;
}

async function sendTwoFactorCode(user) {
    if (!resend) {
        throw new Error("Email 2FA requires Resend. Set RESEND_API_KEY.");
    }

    const code = generateTwoFactorCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabaseAdmin
        .from("user_two_factor_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("consumed_at", null);

    const { error: insertError } = await supabaseAdmin
        .from("user_two_factor_challenges")
        .insert({
            user_id: user.id,
            code_hash: hashSecurityCode(code),
            expires_at: expiresAt
        });

    if (insertError) {
        throw insertError;
    }

    const { error: emailError } = await resend.emails.send({
        from: resendFromEmail,
        to: [user.email],
        subject: "Your Tia verification code",
        text: `Your Tia verification code is ${code}. It expires in 10 minutes.`,
        html: renderTwoFactorEmail({
            fullName: user.user_metadata?.full_name || user.email,
            code
        })
    });

    if (emailError) {
        throw new Error(emailError.message || "Unable to send 2FA email.");
    }
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

async function getActorAccess(userId) {
    const [{ data: platformAdmin }, { data: memberships }] = await Promise.all([
        supabaseAdmin
            .from("platform_admins")
            .select("user_id, role, is_active")
            .eq("user_id", userId)
            .eq("is_active", true)
            .maybeSingle(),
        supabaseAdmin
            .from("business_members")
            .select(`
                business_id,
                role,
                is_active,
                businesses (
                    name
                )
            `)
            .eq("user_id", userId)
            .eq("is_active", true)
    ]);

    return {
        isPlatformAdmin: Boolean(platformAdmin?.user_id),
        memberships: memberships || []
    };
}

function toBranchSequence(code) {
    const text = String(code || "").trim().toUpperCase();
    const match = text.match(/(\d+)$/);
    if (!match) {
        return 0;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatBranchCode(sequence) {
    return `BR-${String(sequence).padStart(3, "0")}`;
}

async function ensureHeadOfficeBranch(businessId) {
    const { data: branches, error } = await supabaseAdmin
        .from("branches")
        .select("id, name, code, is_head_office")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true });

    if (error) {
        throw error;
    }

    const rows = branches || [];
    const existingHeadOffice = rows.find((branch) => Boolean(branch.is_head_office));
    if (existingHeadOffice?.id) {
        return existingHeadOffice.id;
    }

    const namedHeadOffice = rows.find((branch) => String(branch.name || "").trim().toLowerCase() === "head office");
    if (namedHeadOffice?.id) {
        await supabaseAdmin
            .from("branches")
            .update({ is_head_office: true })
            .eq("business_id", businessId)
            .eq("id", namedHeadOffice.id);
        return namedHeadOffice.id;
    }

    const maxSequence = rows.reduce((max, row) => Math.max(max, toBranchSequence(row.code)), 0);
    const { data: inserted, error: insertError } = await supabaseAdmin
        .from("branches")
        .insert({
            business_id: businessId,
            name: "Head Office",
            code: formatBranchCode(maxSequence + 1),
            is_head_office: true,
            is_active: true
        })
        .select("id")
        .single();

    if (insertError) {
        throw insertError;
    }

    return inserted?.id || null;
}

async function getBusinessName(businessId) {
    if (!businessId) {
        return "";
    }

    const { data } = await supabaseAdmin
        .from("businesses")
        .select("name")
        .eq("id", businessId)
        .maybeSingle();

    return String(data?.name || "").trim();
}

function renderInviteEmail({ fullName, organizationName, inviteLink }) {
    const safeName = escapeHtml(fullName || "there");
    const safeOrganization = escapeHtml(organizationName || "Tia");
    const safeInviteLink = escapeHtml(inviteLink);

    return `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <title>Create your Tia password</title>
        </head>
        <body style="margin:0;padding:0;background:#f3f7f5;font-family:Arial,Helvetica,sans-serif;color:#17313e;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7f5;margin:0;padding:28px 12px;">
                <tr>
                    <td align="center">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dce8e1;border-radius:16px;overflow:hidden;box-shadow:0 18px 45px rgba(23,49,62,0.10);">
                            <tr>
                                <td style="background:#0f5f3f;padding:28px 30px;color:#ffffff;">
                                    <div style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#bcebd2;">Tia Invitation</div>
                                    <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;font-weight:800;color:#ffffff;">Create your password</h1>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:30px;">
                                    <p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#294653;">Hello ${safeName},</p>
                                    <p style="margin:0 0 22px;font-size:16px;line-height:1.55;color:#294653;">An administrator invited you to ${safeOrganization} on Tia. Use the button below to create your password and activate your login.</p>
                                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0;">
                                        <tr>
                                            <td style="border-radius:10px;background:#0f5f3f;">
                                                <a href="${safeInviteLink}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;">Create Password</a>
                                            </td>
                                        </tr>
                                    </table>
                                    <p style="margin:0;font-size:13px;line-height:1.55;color:#6b7f76;">If the button does not work, copy and paste this link into your browser:</p>
                                    <p style="margin:8px 0 0;font-size:12px;line-height:1.55;color:#294653;word-break:break-all;">${safeInviteLink}</p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:18px 30px;background:#f8fbf9;border-top:1px solid #dce8e1;">
                                    <p style="margin:0;font-size:12px;line-height:1.5;color:#6b7f76;">This invitation was sent by Tia. Do not share this email with anyone.</p>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
    `;
}

async function inviteAuthUser({ email, fullName, metadata, redirectTo, organizationName }) {
    if (resend) {
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: "invite",
            email,
            options: {
                data: metadata,
                redirectTo
            }
        });

        if (error) {
            throw error;
        }

        const user = data?.user || data?.properties?.user;
        const tokenHash = data?.properties?.hashed_token || data?.hashed_token || "";
        const fallbackActionLink = data?.properties?.action_link || data?.action_link || "";
        const inviteLink = tokenHash
            ? buildDirectInviteLink(redirectTo, tokenHash, email)
            : fallbackActionLink;
        if (!user?.id || !inviteLink) {
            throw new Error("Unable to generate the user invitation link.");
        }

        const { error: emailError } = await resend.emails.send({
            from: resendFromEmail,
            to: [email],
            subject: "Create your Tia password",
            text: [
                `Hello ${fullName || "there"},`,
                "",
                `An administrator invited you to ${organizationName || "Tia"} on Tia.`,
                "Create your password using this link:",
                inviteLink
            ].join("\n"),
            html: renderInviteEmail({ fullName, organizationName, inviteLink })
        });

        if (emailError) {
            throw new Error(emailError.message || "Unable to send the invitation email.");
        }

        return user;
    }

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: metadata,
        redirectTo
    });

    if (error) {
        throw error;
    }

    if (!data?.user?.id) {
        throw new Error("Unable to create the invited user.");
    }

    return data.user;
}

async function saveInvitedUserAccess({ userId, fullName, email, username, type, role, businessId, branchId, isActive }) {
    const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert({
            id: userId,
            full_name: fullName,
            email,
            username
        }, { onConflict: "id" });

    if (profileError) {
        throw profileError;
    }

    if (type === "platform" && role === "super_admin") {
        const { error } = await supabaseAdmin
            .from("platform_admins")
            .upsert({
                user_id: userId,
                role: "super_admin",
                is_active: isActive
            }, { onConflict: "user_id" });
        if (error) {
            throw error;
        }
        return;
    }

    if (type === "platform") {
        await supabaseAdmin
            .from("platform_admins")
            .upsert({
                user_id: userId,
                role: "super_admin",
                is_active: false
            }, { onConflict: "user_id" });
    }

    const { error: memberError } = await supabaseAdmin
        .from("business_members")
        .upsert({
            business_id: businessId,
            user_id: userId,
            role,
            branch_id: branchId || null,
            is_active: isActive
        }, { onConflict: "business_id,user_id" });

    if (memberError) {
        throw memberError;
    }
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

async function handleUserInvite(request, response) {
    if (request.method === "OPTIONS") {
        sendJson(response, 204, {});
        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
    }

    const authToken = getBearerToken(request);
    const actor = await getAuthenticatedUser(authToken);
    if (!actor?.id) {
        sendJson(response, 401, { error: "Authentication is required." });
        return;
    }

    let payload;
    try {
        payload = await readRequestJson(request);
    } catch {
        sendJson(response, 400, { error: "Invalid request payload." });
        return;
    }

    const type = String(payload.type || "").trim().toLowerCase();
    const fullName = String(payload.full_name || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    const username = String(payload.username || "").trim().toLowerCase();
    const role = String(payload.role || "").trim().toLowerCase();
    const isActive = payload.is_active !== false;
    let businessId = String(payload.business_id || "").trim();
    let branchId = String(payload.branch_id || "").trim();

    if (!["platform", "organization"].includes(type)) {
        sendJson(response, 400, { error: "Unsupported invite type." });
        return;
    }

    if (!fullName || !email || !username || !role) {
        sendJson(response, 400, { error: "Full name, email, username, and role are required." });
        return;
    }

    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
        sendJson(response, 400, { error: "Username must be 3-40 characters using letters, numbers, dot, dash, or underscore." });
        return;
    }

    const { data: existingUsername } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("username", username)
        .maybeSingle();

    if (existingUsername?.id) {
        sendJson(response, 409, { error: "Username is already taken." });
        return;
    }

    if (type === "platform" && !PLATFORM_USER_ROLES.has(role)) {
        sendJson(response, 400, { error: "Select a valid platform role." });
        return;
    }

    if (type === "organization" && !USER_INVITE_ROLES.has(role)) {
        sendJson(response, 400, { error: "Select a valid organization role." });
        return;
    }

    const access = await getActorAccess(actor.id);
    if (type === "platform" && !access.isPlatformAdmin) {
        sendJson(response, 403, { error: "Only Super Admin can create platform users." });
        return;
    }

    if (type === "organization") {
        const adminMembership = access.memberships.find((membership) =>
            String(membership.role || "").toLowerCase() === "business_admin"
                && (!businessId || String(membership.business_id) === businessId)
        );

        if (!adminMembership?.business_id) {
            sendJson(response, 403, { error: "Only Admin can create organization users." });
            return;
        }

        businessId = String(adminMembership.business_id);
    }

    if (type === "platform" && role !== "super_admin" && !businessId) {
        sendJson(response, 400, { error: "Select an organization for this role." });
        return;
    }

    if (role === "business_admin" && businessId) {
        branchId = await ensureHeadOfficeBranch(businessId);
    }

    const organizationName = role === "super_admin"
        ? "Tia Platform Workspace"
        : await getBusinessName(businessId);
    const redirectTo = getInviteRedirectUrl(request);
    const metadata = {
        full_name: fullName,
        role,
        platform_role: type === "platform" && role === "super_admin" ? "super_admin" : "",
        business_id: businessId || "",
        business_name: organizationName || "Tia Business Workspace",
        username,
        subscription: "Live"
    };

    try {
        const invitedUser = await inviteAuthUser({
            email,
            fullName,
            metadata,
            redirectTo,
            organizationName
        });

        await saveInvitedUserAccess({
            userId: invitedUser.id,
            fullName,
            email,
            username,
            type,
            role,
            businessId,
            branchId,
            isActive
        });

        sendJson(response, 200, {
            ok: true,
            userId: invitedUser.id,
            emailSent: true
        });
    } catch (error) {
        console.error("[user-invite] Failed to invite user.", {
            email,
            message: error?.message || "Unknown error"
        });
        sendJson(response, 400, { error: error?.message || "Unable to invite user." });
    }
}

async function handleResolveLogin(request, response) {
    if (request.method === "OPTIONS") {
        sendJson(response, 204, {});
        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
    }

    let payload;
    try {
        payload = await readRequestJson(request);
    } catch {
        sendJson(response, 400, { error: "Invalid request payload." });
        return;
    }

    const login = String(payload.login || "").trim().toLowerCase();
    if (!login) {
        sendJson(response, 400, { error: "Username is required." });
        return;
    }

    if (login.includes("@")) {
        sendJson(response, 200, { email: login });
        return;
    }

    const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .ilike("username", login)
        .maybeSingle();

    if (error || !data?.email) {
        sendJson(response, 404, { error: "Username was not found." });
        return;
    }

    sendJson(response, 200, { email: data.email });
}

async function handlePostLogin(request, response) {
    if (request.method === "OPTIONS") {
        sendJson(response, 204, {});
        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
    }

    const user = await getAuthenticatedUser(getBearerToken(request));
    if (!user?.id || !user?.email) {
        sendJson(response, 401, { error: "Authentication is required." });
        return;
    }

    try {
        const threshold = await getEmailTwoFactorThreshold();
        const { data: currentState } = await supabaseAdmin
            .from("user_security_states")
            .select("successful_login_count")
            .eq("user_id", user.id)
            .maybeSingle();

        const nextCount = Number(currentState?.successful_login_count || 0) + 1;
        const requiresTwoFactor = nextCount >= threshold;

        const { error: stateError } = await supabaseAdmin
            .from("user_security_states")
            .upsert({
                user_id: user.id,
                successful_login_count: nextCount,
                updated_at: new Date().toISOString()
            }, { onConflict: "user_id" });

        if (stateError) {
            throw stateError;
        }

        if (requiresTwoFactor) {
            await sendTwoFactorCode(user);
        }

        sendJson(response, 200, {
            ok: true,
            requiresTwoFactor,
            threshold,
            loginCount: nextCount
        });
    } catch (error) {
        console.error("[auth-post-login] Failed.", { message: error?.message || "Unknown error" });
        sendJson(response, 400, { error: error?.message || "Unable to complete login security check." });
    }
}

async function handleVerifyTwoFactor(request, response) {
    if (request.method === "OPTIONS") {
        sendJson(response, 204, {});
        return;
    }

    if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
    }

    const user = await getAuthenticatedUser(getBearerToken(request));
    if (!user?.id) {
        sendJson(response, 401, { error: "Authentication is required." });
        return;
    }

    let payload;
    try {
        payload = await readRequestJson(request);
    } catch {
        sendJson(response, 400, { error: "Invalid request payload." });
        return;
    }

    const code = String(payload.code || "").replace(/\D/g, "");
    if (code.length !== 6) {
        sendJson(response, 400, { error: "Enter the 6-digit verification code." });
        return;
    }

    const { data: challenge, error } = await supabaseAdmin
        .from("user_two_factor_challenges")
        .select("id, code_hash, expires_at, consumed_at")
        .eq("user_id", user.id)
        .is("consumed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !challenge?.id) {
        sendJson(response, 400, { error: "No active verification code found." });
        return;
    }

    if (new Date(challenge.expires_at).getTime() < Date.now()) {
        sendJson(response, 400, { error: "Verification code has expired. Sign in again." });
        return;
    }

    if (challenge.code_hash !== hashSecurityCode(code)) {
        sendJson(response, 400, { error: "Verification code is incorrect." });
        return;
    }

    const nowIso = new Date().toISOString();
    await supabaseAdmin
        .from("user_two_factor_challenges")
        .update({ consumed_at: nowIso })
        .eq("id", challenge.id);

    await supabaseAdmin
        .from("user_security_states")
        .upsert({
            user_id: user.id,
            successful_login_count: 0,
            last_2fa_verified_at: nowIso,
            updated_at: nowIso
        }, { onConflict: "user_id" });

    sendJson(response, 200, { ok: true });
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

        if (url.pathname === "/api/users/invite") {
            await handleUserInvite(request, response);
            return;
        }

        if (url.pathname === "/api/auth/resolve-login") {
            await handleResolveLogin(request, response);
            return;
        }

        if (url.pathname === "/api/auth/post-login") {
            await handlePostLogin(request, response);
            return;
        }

        if (url.pathname === "/api/auth/verify-2fa") {
            await handleVerifyTwoFactor(request, response);
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
