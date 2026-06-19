import { DEFAULT_TRIAL_DAYS, getCurrentPeriodLabel } from "./constants.js";
import { ROLES, ROLE_LABELS } from "./roles.js";
import { getSupabaseClient } from "./supabase-client.js";
import { getBusinessMembership, getPlatformAdminRole, getProfileName } from "./data-access.js";

const STORAGE_KEY = "tia_demo_session";
const DEMO_ROLES = [ROLES.BUSINESS_ADMIN, ROLES.MANAGER, ROLES.STAFF, ROLES.AUDITOR, ROLES.ACCOUNT];
let demoSessionMemory = null;

function getDefaultSessionName(role, mode) {
    const roleLabel = String(ROLE_LABELS[role] || role || "User").trim();
    if (mode === "trial") {
        return `${roleLabel} Trial User`;
    }
    return `${roleLabel} Demo User`;
}

function encodeDemoSession(session) {
    try {
        return btoa(JSON.stringify(session));
    } catch {
        return "";
    }
}

function decodeDemoSession(value) {
    try {
        const parsed = JSON.parse(atob(String(value || "").trim()));
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function updateDemoSessionQuery(session) {
    const url = new URL(window.location.href);
    if (!session) {
        url.searchParams.delete(STORAGE_KEY);
    } else {
        const encoded = encodeDemoSession(session);
        if (encoded) {
            url.searchParams.set(STORAGE_KEY, encoded);
        }
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function saveDemoSession(role, mode = "demo", options = {}) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + DEFAULT_TRIAL_DAYS);
    const allowedRoles = Array.isArray(options.allowedRoles) && options.allowedRoles.length
        ? options.allowedRoles
        : (mode === "trial" ? DEMO_ROLES : [role]);

    const session = {
        mode,
        role,
        grantedRole: options.grantedRole || role,
        allowedRoles,
        fullName: String(options.fullName || "").trim() || getDefaultSessionName(role, mode),
        businessName: mode === "demo" ? "Tia Demo Workspace" : "Tia Trial Workspace",
        currentPeriod: getCurrentPeriodLabel(),
        trialEndsAt: expiresAt.toISOString()
    };

    demoSessionMemory = session;
    updateDemoSessionQuery(session);
    return session;
}

export function clearStoredSession() {
    demoSessionMemory = null;
    updateDemoSessionQuery(null);
}

export function getStoredSession() {
    if (demoSessionMemory) {
        return demoSessionMemory;
    }
    const params = new URLSearchParams(window.location.search);
    const parsed = decodeDemoSession(params.get(STORAGE_KEY));
    demoSessionMemory = parsed;
    return parsed;
}

export async function getCurrentSessionContext() {
    const supabase = getSupabaseClient();
    if (!supabase) {
        const demo = getStoredSession();
        if (!demo) {
            return null;
        }

        return {
            fullName: String(demo.fullName || "").trim() || getDefaultSessionName(demo.role, demo.mode),
            role: demo.role,
            grantedRole: demo.grantedRole || demo.role,
            allowedRoles: Array.isArray(demo.allowedRoles) && demo.allowedRoles.length ? demo.allowedRoles : [demo.role],
            businessName: demo.businessName,
            mode: demo.mode,
            userEmail: demo.mode === "trial" ? "trial@tia.app" : "demo@tia.app",
            subscriptionLabel: demo.mode === "trial" ? "Trial" : "Preview",
            currentPeriod: demo.currentPeriod
        };
    }

    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) {
        const demo = getStoredSession();
        if (!demo) {
            return null;
        }

        return {
            fullName: String(demo.fullName || "").trim() || getDefaultSessionName(demo.role, demo.mode),
            role: demo.role,
            grantedRole: demo.grantedRole || demo.role,
            allowedRoles: Array.isArray(demo.allowedRoles) && demo.allowedRoles.length ? demo.allowedRoles : [demo.role],
            businessName: demo.businessName,
            mode: demo.mode,
            userEmail: demo.mode === "trial" ? "trial@tia.app" : "demo@tia.app",
            subscriptionLabel: demo.mode === "trial" ? "Trial" : "Preview",
            currentPeriod: demo.currentPeriod
        };
    }

    const metadataRole = String(user.user_metadata?.role || "").trim().toLowerCase();
    const metadataPlatformRole = String(user.user_metadata?.platform_role || "").trim().toLowerCase();
    const [membership, platformAdminRole] = await Promise.all([
        getBusinessMembership(user.id),
        getPlatformAdminRole(user.id)
    ]);

    const nonSuperMetadataRole = metadataRole && metadataRole !== ROLES.SUPER_ADMIN
        ? metadataRole
        : (metadataPlatformRole && metadataPlatformRole !== ROLES.SUPER_ADMIN ? metadataPlatformRole : "");
    const platformBusinessRole = platformAdminRole && platformAdminRole !== ROLES.SUPER_ADMIN
        ? platformAdminRole
        : "";
    const metadataConfirmsSuperAdmin = metadataRole === ROLES.SUPER_ADMIN || metadataPlatformRole === ROLES.SUPER_ADMIN;
    const isPlatformAdmin = platformAdminRole === ROLES.SUPER_ADMIN && (metadataConfirmsSuperAdmin || !membership);
    const profileName = await getProfileName(user.id);
    const displayName = String(
        profileName
        || user.user_metadata?.full_name
        || user.user_metadata?.name
        || user.email
        || ""
    ).trim();
    const resolvedBusinessRole = membership?.role
        || nonSuperMetadataRole
        || platformBusinessRole
        || ROLES.BUSINESS_ADMIN;

    return {
        userId: user.id,
        fullName: displayName,
        role: isPlatformAdmin ? ROLES.SUPER_ADMIN : resolvedBusinessRole,
        businessId: isPlatformAdmin ? null : (membership?.businessId || user.user_metadata?.business_id || null),
        businessName: isPlatformAdmin
            ? (user.user_metadata?.business_name || "Tia Platform Workspace")
            : (membership?.businessName || user.user_metadata?.business_name || "Tia Business Workspace"),
        mode: "live",
        userEmail: user.email,
        subscriptionLabel: isPlatformAdmin
            ? "Live"
            : (membership?.subscriptionLabel || user.user_metadata?.subscription || "Live"),
        currentPeriod: getCurrentPeriodLabel()
    };
}
