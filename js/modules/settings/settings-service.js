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
            const selectedKb = Math.ceil(file.size / 1024);
            reject(new Error(`Logo is too large (${selectedKb}KB). Maximum allowed is 300KB.`));
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

export async function getEmailTwoFactorLoginThreshold() {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return 10;
    }

    const { data, error } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "email_2fa_after_logins")
        .maybeSingle();

    if (error) {
        return 10;
    }

    const value = Number(data?.value || 10);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 10;
}

export async function saveEmailTwoFactorLoginThreshold(threshold) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const normalized = Number(threshold || 0);
    if (!Number.isFinite(normalized) || normalized < 1 || normalized > 1000) {
        throw new Error("2FA login threshold must be between 1 and 1000.");
    }

    const { error } = await supabase
        .from("platform_settings")
        .upsert({
            key: "email_2fa_after_logins",
            value: String(Math.round(normalized)),
            updated_at: new Date().toISOString()
        }, { onConflict: "key" });

    if (error) {
        throw new Error("Unable to save 2FA policy. Run sql/add-username-and-email-2fa.sql.");
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
            .select("id, full_name, email")
            .in("id", userIds);
        profiles = profileResult.error ? [] : (profileResult.data || []);
    }

    let platformAdmins = [];
    let businessMembers = [];
    if (userIds.length) {
        const [platformResult, memberResult] = await Promise.all([
            supabase
                .from("platform_admins")
                .select("user_id, role, is_active")
                .in("user_id", userIds),
            supabase
                .from("business_members")
                .select("user_id, role, is_active")
                .in("user_id", userIds)
        ]);
        platformAdmins = platformResult.error ? [] : (platformResult.data || []);
        businessMembers = memberResult.error ? [] : (memberResult.data || []);
    }

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const platformRoleByUserId = new Map(
        platformAdmins
            .filter((item) => item.is_active !== false)
            .map((item) => [item.user_id, item.role || "super_admin"])
    );
    const businessRoleByUserId = new Map();
    businessMembers.forEach((member) => {
        const existing = businessRoleByUserId.get(member.user_id);
        if (!existing || (existing.is_active !== true && member.is_active === true)) {
            businessRoleByUserId.set(member.user_id, member);
        }
    });

    return rows.map((row) => {
        const profile = profileById.get(row.user_id) || {};
        const businessMember = businessRoleByUserId.get(row.user_id);
        const role = platformRoleByUserId.get(row.user_id) || businessMember?.role || "";
        const displayName = String(profile.full_name || profile.email || "").trim();
        return {
            id: row.id,
            userId: row.user_id,
            userName: displayName || "Unknown user",
            email: profile.email || "",
            role,
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
