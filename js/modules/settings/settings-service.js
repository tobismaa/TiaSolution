import { getCurrentSessionContext } from "../../core/session.js";
import { getOrganizationBranding, saveOrganizationBranding } from "../../core/branding.js";
import { getSupabaseClient } from "../../core/supabase-client.js";

const MAX_LOGO_BYTES = 300 * 1024;

export async function getCurrentOrganizationBranding(options = {}) {
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        return { branding: null, session };
    }

    const branding = await getOrganizationBranding(session.businessId, options);
    return { branding, session };
}

export async function saveCurrentOrganizationBranding(payload) {
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }

    return saveOrganizationBranding(session.businessId, payload);
}

export function readLogoFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            resolve("");
            return;
        }

        if (!String(file.type || "").startsWith("image/")) {
            reject(new Error("Upload an image file for the logo."));
            return;
        }

        if (file.size > MAX_LOGO_BYTES) {
            reject(new Error("Logo must be 300KB or smaller."));
            return;
        }

        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Unable to read the logo file."));
        reader.readAsDataURL(file);
    });
}

export async function getSessionTimeoutMinutes() {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return 30;
    }

    const { data, error } = await supabase.rpc("get_session_timeout_minutes");
    if (error) {
        return 30;
    }

    const minutes = Number(data || 30);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
}

export async function saveSessionTimeoutMinutes(minutes) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const normalized = Number(minutes || 0);
    if (!Number.isFinite(normalized) || normalized < 5 || normalized > 720) {
        throw new Error("Session timeout must be between 5 and 720 minutes.");
    }

    const { error } = await supabase.rpc("set_session_timeout_minutes", {
        p_minutes: Math.round(normalized)
    });

    if (error) {
        throw new Error("Session settings are missing. Run sql/add-super-admin-branding-and-sessions.sql.");
    }

    return Math.round(normalized);
}

export async function getActiveLoginSessions() {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return [];
    }

    const { data, error } = await supabase
        .from("user_login_sessions")
        .select("id, user_id, session_key, signed_in_at, login_attempt_count, last_login_attempt_at")
        .eq("is_active", true)
        .order("signed_in_at", { ascending: false });

    if (error) {
        return [];
    }

    const rows = data || [];
    const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
    let profiles = [];
    if (userIds.length) {
        const profileResult = await supabase
            .from("profiles")
            .select("id, full_name, email, role")
            .in("id", userIds);
        profiles = profileResult.error ? [] : (profileResult.data || []);
    }

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    return rows.map((row) => {
        const profile = profileById.get(row.user_id) || {};
        return {
            id: row.id,
            userId: row.user_id,
            userName: profile.full_name || profile.email || "User",
            email: profile.email || "",
            role: profile.role || "",
            signedInAt: row.signed_in_at || "",
            loginAttemptCount: Number(row.login_attempt_count || 0),
            lastLoginAttemptAt: row.last_login_attempt_at || ""
        };
    });
}

export async function forceLogoutSession(sessionId) {
    const supabase = getSupabaseClient();
    if (!supabase || !sessionId) {
        throw new Error("Login session is unavailable.");
    }

    const { error } = await supabase.rpc("force_end_login_session", {
        p_session_id: sessionId
    });

    if (error) {
        throw new Error("Force logout is not available. Run sql/add-super-admin-branding-and-sessions.sql.");
    }

    return true;
}
