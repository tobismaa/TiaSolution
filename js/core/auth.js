import { clearStoredSession } from "./session.js";
import { getCurrentSessionContext } from "./session.js";
import { getSupabaseClient } from "./supabase-client.js";
import { ROLES } from "./roles.js";
import { showAlertModal } from "../shared/modal.js";
import { sendSecurityNotification } from "./security-notifications.js";

const LOGIN_SESSION_KEY = "tia_login_session_key";
const REMEMBERED_LOGIN_EMAIL_KEY = "tia_login_email";
let sessionTimeoutMonitorStarted = false;

function setSubmittingState(button, isSubmitting) {
    if (!button) {
        return;
    }

    button.disabled = isSubmitting;
    button.classList.toggle("is-loading", isSubmitting);
    button.setAttribute("aria-busy", String(isSubmitting));
}

function showLoginLoading() {
    const overlay = document.getElementById("pageLoadingOverlay");
    if (overlay) {
        overlay.hidden = false;
    }
}

function hideLoginLoading() {
    const overlay = document.getElementById("pageLoadingOverlay");
    if (overlay) {
        overlay.hidden = true;
    }
}

function hideLoginError(errorBanner) {
    if (!errorBanner) {
        return;
    }

    errorBanner.hidden = true;
    errorBanner.textContent = "";
}

function showLoginError(errorBanner, message) {
    if (!errorBanner) {
        return;
    }

    errorBanner.textContent = message;
    errorBanner.hidden = false;
    errorBanner.focus();
}

function getLoginSessionKey() {
    let key = window.localStorage.getItem(LOGIN_SESSION_KEY);
    if (!key) {
        key = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        window.localStorage.setItem(LOGIN_SESSION_KEY, key);
    }
    return key;
}

function clearLoginSessionKey() {
    window.localStorage.removeItem(LOGIN_SESSION_KEY);
}

function getDashboardUrl(session) {
    if (session?.role === ROLES.SUPER_ADMIN && session?.mode === "live") {
        return "./super-admin.html";
    }

    if (session?.role === ROLES.BUSINESS_ADMIN) {
        return "./business-admin.html";
    }

    if (session?.role === ROLES.MANAGER) {
        return "./head-of-operations.html";
    }

    if (session?.role === ROLES.STAFF) {
        return "./operations.html";
    }

    if (session?.role === ROLES.AUDITOR || session?.role === ROLES.ACCOUNT) {
        return "./auditor.html";
    }

    return "./app.html";
}

async function forceLocalSignOut(message, options = {}) {
    if (window.__TIA_FORCE_LOCAL_SIGN_OUT_STARTED__) {
        return;
    }
    window.__TIA_FORCE_LOCAL_SIGN_OUT_STARTED__ = true;

    const supabase = getSupabaseClient();
    if (supabase) {
        try {
            await supabase.auth.signOut();
        } catch {
            // Redirect still needs to happen if Supabase sign-out fails locally.
        }
    }

    clearStoredSession();
    clearLoginSessionKey();

    showAlertModal(message || "Your session has ended. Please sign in again.", {
        title: options.title || "Session ended",
        eyebrow: options.eyebrow || "Security",
        actionLabel: "Go to Login"
    });

    window.setTimeout(() => {
        window.location.href = "./login.html";
    }, 900);
}

async function getConfiguredSessionTimeoutMinutes(supabase) {
    const { data, error } = await supabase.rpc("get_session_timeout_minutes");
    if (error) {
        return 0;
    }

    const minutes = Number(data || 0);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

function startSessionTimeoutMonitor(supabase) {
    if (sessionTimeoutMonitorStarted || !supabase) {
        return;
    }

    sessionTimeoutMonitorStarted = true;
    let timeoutMinutes = 0;
    let lastActivityAt = Date.now();

    const markActivity = () => {
        lastActivityAt = Date.now();
    };

    ["click", "keydown", "mousemove", "scroll", "touchstart"].forEach((eventName) => {
        window.addEventListener(eventName, markActivity, { passive: true });
    });

    getConfiguredSessionTimeoutMinutes(supabase).then((minutes) => {
        timeoutMinutes = minutes;
    }).catch(() => {
        timeoutMinutes = 0;
    });

    window.setInterval(async () => {
        if (!timeoutMinutes) {
            try {
                timeoutMinutes = await getConfiguredSessionTimeoutMinutes(supabase);
            } catch {
                timeoutMinutes = 0;
            }
            return;
        }

        const idleMs = Date.now() - lastActivityAt;
        if (idleMs >= timeoutMinutes * 60 * 1000) {
            await forceLocalSignOut("You were signed out because this session was idle for too long.", {
                title: "Session timed out",
                eyebrow: "Security timeout"
            });
        }
    }, 30000);
}

async function claimLoginSession() {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return;
    }

    const { data, error } = await supabase.rpc("start_user_login_session", {
        p_session_key: getLoginSessionKey()
    });

    if (error) {
        const message = String(error?.message || "").toLowerCase();
        if (message.includes("start_user_login_session") || message.includes("function")) {
            throw new Error("Login session tracking is missing. Run sql/add-user-login-sessions.sql.");
        }
        throw error;
    }

    if (data !== true) {
        await supabase.auth.signOut();
        clearLoginSessionKey();
        throw new Error("This user is already signed in elsewhere. Please log out from the active session first.");
    }
}

async function releaseLoginSession() {
    const supabase = getSupabaseClient();
    const key = window.localStorage.getItem(LOGIN_SESSION_KEY);
    if (!supabase || !key) {
        clearLoginSessionKey();
        return;
    }

    try {
        await supabase.rpc("end_user_login_session", { p_session_key: key });
    } catch {
        // Auth sign-out should still continue even if the tracking RPC is unavailable.
    } finally {
        clearLoginSessionKey();
    }
}

export function startLoginAttemptMonitor() {
    if (window.__TIA_LOGIN_ATTEMPT_MONITOR_STARTED__) {
        return;
    }

    const supabase = getSupabaseClient();
    const sessionKey = window.localStorage.getItem(LOGIN_SESSION_KEY);
    if (!supabase || !sessionKey) {
        return;
    }

    window.__TIA_LOGIN_ATTEMPT_MONITOR_STARTED__ = true;
    startSessionTimeoutMonitor(supabase);
    const seenKey = `tia_login_attempt_seen_${sessionKey}`;
    let lastSeenAttemptAt = window.sessionStorage.getItem(seenKey) || "";

    const poll = async () => {
        try {
            const { data, error } = await supabase
                .from("user_login_sessions")
                .select("is_active, last_login_attempt_at, login_attempt_count")
                .eq("session_key", sessionKey)
                .maybeSingle();

            if (error || !data) {
                return;
            }

            if (data.is_active === false) {
                await forceLocalSignOut("A Super Admin logged out this session.", {
                    title: "Logged out by admin",
                    eyebrow: "Security action"
                });
                return;
            }

            if (!data?.last_login_attempt_at) {
                return;
            }

            const attemptAt = String(data.last_login_attempt_at || "");
            if (!attemptAt || attemptAt === lastSeenAttemptAt) {
                return;
            }

            lastSeenAttemptAt = attemptAt;
            window.sessionStorage.setItem(seenKey, attemptAt);
            showAlertModal("Someone tried to log in to your account from another system.", {
                title: "Login attempt blocked",
                eyebrow: "Security warning",
                actionLabel: "Close"
            });
            sendSecurityNotification({
                type: "blocked_login_attempt",
                occurredAt: attemptAt
            }).then((sent) => {
                console.info(`[Tia security] Blocked-login email ${sent ? "sent or accepted" : "was not sent"}.`);
            }).catch((error) => {
                console.warn("[Tia security] Blocked-login email failed.", error);
            });
        } catch {
            // Keep the dashboard quiet if the optional monitor cannot poll.
        }
    };

    window.setTimeout(poll, 1500);
    window.setInterval(poll, 10000);
}

export async function ensureLoginSessionClaimed() {
    try {
        await claimLoginSession();
        return true;
    } catch (error) {
        const supabase = getSupabaseClient();
        if (supabase) {
            await supabase.auth.signOut();
        }
        clearStoredSession();
        clearLoginSessionKey();
        window.alert(error?.message || "This user is already signed in elsewhere.");
        window.location.href = "./login.html";
        return false;
    }
}

export async function signInWithPassword(email, password) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        throw error;
    }

    try {
        await claimLoginSession();
    } catch (sessionError) {
        await supabase.auth.signOut();
        clearLoginSessionKey();
        throw sessionError;
    }
}

export async function signUpWithPassword(email, password, profileData = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: profileData.full_name || profileData.name || "",
                role: profileData.role || ROLES.BUSINESS_ADMIN,
                platform_role: profileData.platform_role || "",
                business_name: profileData.business_name || "New Tia Business",
                subscription: profileData.subscription || "Trial"
            }
        }
    });

    if (error) {
        throw error;
    }
}

export async function signOutUser() {
    clearStoredSession();
    const supabase = getSupabaseClient();
    if (supabase) {
        await releaseLoginSession();
        await supabase.auth.signOut();
    } else {
        clearLoginSessionKey();
    }
    window.location.href = "./login.html";
}

export async function initLoginPage() {
    const loginForm = document.getElementById("loginForm");
    const status = document.getElementById("authStatus");
    const errorBanner = document.getElementById("authErrorBanner");
    const submitButton = loginForm?.querySelector("[data-login-submit]");
    const emailInput = loginForm?.querySelector('input[name="email"]');
    const passwordInput = loginForm?.querySelector("[data-login-password]");

    clearStoredSession();
    if (emailInput) {
        emailInput.value = window.localStorage.getItem(REMEMBERED_LOGIN_EMAIL_KEY) || "";
    }

    const supabase = getSupabaseClient();
    if (supabase) {
        showLoginLoading();
        try {
            const { data } = await supabase.auth.getSession();
            if (data.session) {
                const isAllowed = await ensureLoginSessionClaimed();
                if (!isAllowed) {
                    return;
                }
                const session = await getCurrentSessionContext();
                window.location.href = getDashboardUrl(session);
                return;
            }
        } catch {
            // If the pre-check fails, keep the login form usable.
        } finally {
            hideLoginLoading();
        }
    }

    loginForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(loginForm);
        status.textContent = "Signing in...";
        hideLoginError(errorBanner);
        setSubmittingState(submitButton, true);
        showLoginLoading();

        try {
            const email = String(form.get("email") || "").trim().toLowerCase();
            const password = String(passwordInput?.value || "");
            window.localStorage.setItem(REMEMBERED_LOGIN_EMAIL_KEY, email);
            await signInWithPassword(email, password);
            const session = await getCurrentSessionContext();
            window.location.href = getDashboardUrl(session);
        } catch (error) {
            const message = error?.message || "Unable to sign in.";
            status.textContent = message;
            showLoginError(errorBanner, message);
            if (passwordInput) {
                passwordInput.value = "";
            }
            setSubmittingState(submitButton, false);
            hideLoginLoading();
        }
    });
}
