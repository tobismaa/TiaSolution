import { getSupabaseClient } from "../core/supabase-client.js";
import { saveDemoSession } from "../core/session.js";
import { ROLES } from "../core/roles.js";

async function sha256Hex(value) {
    const encoded = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyDemoLink(token) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const tokenHash = await sha256Hex(token);
    const { data, error } = await supabase
        .from("demo_access_links")
        .select("id, role, expires_at, used_at, revoked_at")
        .eq("token_hash", tokenHash)
        .single();

    if (error || !data) {
        throw new Error("This demo link is invalid.");
    }

    if (data.revoked_at) {
        throw new Error("This demo link has been revoked.");
    }

    if (data.used_at) {
        throw new Error("This demo link has already been used.");
    }

    if (new Date(data.expires_at) < new Date()) {
        throw new Error("This demo link has expired.");
    }

    const { error: updateError } = await supabase
        .from("demo_access_links")
        .update({ used_at: new Date().toISOString() })
        .eq("id", data.id);

    if (updateError) {
        throw updateError;
    }

    return data.role;
}

function getTokenRolePrefix(token) {
    const index = token.indexOf(":");
    if (index <= 0) {
        return null;
    }

    const prefix = token.slice(0, index);
    return prefix === "all_roles" ? prefix : null;
}

async function initDemoAccessPage() {
    const status = document.getElementById("demoAccessStatus");
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
        status.textContent = "Missing demo token.";
        return;
    }

    try {
        const role = await verifyDemoLink(token);
        const allRoles = [ROLES.BUSINESS_ADMIN, ROLES.MANAGER, ROLES.STAFF, ROLES.AUDITOR, ROLES.ACCOUNT];
        const tokenRole = getTokenRolePrefix(token);
        if (tokenRole === "all_roles") {
            saveDemoSession(ROLES.BUSINESS_ADMIN, "demo", {
                allowedRoles: allRoles,
                grantedRole: "all_roles"
            });
        } else {
            saveDemoSession(role, "demo", {
                allowedRoles: [role],
                grantedRole: role
            });
        }
        status.textContent = "Access granted. Redirecting to your demo dashboard...";
        window.location.href = `./demo-dashboard.html${window.location.search}`;
    } catch (error) {
        status.textContent = error.message || "Unable to validate link.";
    }
}

initDemoAccessPage();
