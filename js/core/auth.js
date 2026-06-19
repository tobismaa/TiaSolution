import { clearStoredSession } from "./session.js";
import { getCurrentSessionContext } from "./session.js";
import { getSupabaseClient } from "./supabase-client.js";
import { ROLES } from "./roles.js";

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

export async function signInWithPassword(email, password) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        throw error;
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
        await supabase.auth.signOut();
    }
    window.location.href = "./login.html";
}

export function initLoginPage() {
    const loginForm = document.getElementById("loginForm");
    const status = document.getElementById("authStatus");
    const errorBanner = document.getElementById("authErrorBanner");
    const submitButton = loginForm?.querySelector("[data-login-submit]");

    clearStoredSession();

    loginForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(loginForm);
        status.textContent = "Signing in...";
        hideLoginError(errorBanner);
        setSubmittingState(submitButton, true);
        showLoginLoading();

        try {
            await signInWithPassword(String(form.get("email") || ""), String(form.get("password") || ""));
            const session = await getCurrentSessionContext();
            if (session?.role === ROLES.SUPER_ADMIN && session?.mode === "live") {
                window.location.href = "./super-admin.html";
                return;
            }

            if (session?.role === ROLES.BUSINESS_ADMIN) {
                window.location.href = "./business-admin.html";
                return;
            }

            if (session?.role === ROLES.MANAGER) {
                window.location.href = "./head-of-operations.html";
                return;
            }

            if (session?.role === ROLES.STAFF) {
                window.location.href = "./operations.html";
                return;
            }

            if (session?.role === ROLES.AUDITOR || session?.role === ROLES.ACCOUNT) {
                window.location.href = "./auditor.html";
                return;
            }

            window.location.href = "./app.html";
        } catch (error) {
            const message = error?.message || "Unable to sign in.";
            status.textContent = message;
            showLoginError(errorBanner, message);
            setSubmittingState(submitButton, false);
            hideLoginLoading();
        }
    });
}
