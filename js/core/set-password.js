import { getSupabaseClient } from "./supabase-client.js";

function setSubmittingState(button, isSubmitting) {
    if (!button) {
        return;
    }

    button.disabled = isSubmitting;
    button.classList.toggle("is-loading", isSubmitting);
    button.setAttribute("aria-busy", String(isSubmitting));
}

function showError(errorNode, message) {
    if (!errorNode) {
        return;
    }

    errorNode.textContent = message;
    errorNode.hidden = false;
    errorNode.focus();
}

function hideError(errorNode) {
    if (!errorNode) {
        return;
    }

    errorNode.textContent = "";
    errorNode.hidden = true;
}

async function waitForInviteSession(supabase) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
            return data.session;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    return null;
}

async function getInviteSession(supabase) {
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const type = params.get("type") || "invite";

    if (tokenHash) {
        const { data, error } = await supabase.auth.verifyOtp({
            type,
            token_hash: tokenHash
        });

        if (error) {
            throw error;
        }

        if (data?.session) {
            window.history.replaceState({}, "", window.location.pathname);
            return data.session;
        }
    }

    return waitForInviteSession(supabase);
}

export async function initSetPasswordPage() {
    const form = document.getElementById("passwordSetupForm");
    const status = document.getElementById("passwordSetupStatus");
    const errorNode = document.getElementById("passwordSetupError");
    const submitButton = form?.querySelector("[data-password-setup-submit]");
    const supabase = getSupabaseClient();

    if (!supabase) {
        status.textContent = "Supabase is unavailable.";
        showError(errorNode, "Unable to load password setup.");
        return;
    }

    let session = null;
    try {
        session = await getInviteSession(supabase);
    } catch (error) {
        status.textContent = "This invite link is invalid or expired.";
        showError(errorNode, error?.message || "Ask your administrator to send a new invitation.");
        return;
    }

    if (!session) {
        status.textContent = "This invite link is invalid or expired.";
        showError(errorNode, "Ask your administrator to send a new invitation.");
        return;
    }

    status.textContent = "Enter your new password.";
    if (form) {
        form.hidden = false;
    }

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideError(errorNode);

        const data = new FormData(form);
        const password = String(data.get("password") || "");
        const confirmPassword = String(data.get("confirm_password") || "");

        if (password.length < 8) {
            showError(errorNode, "Password must be at least 8 characters.");
            return;
        }

        if (password !== confirmPassword) {
            showError(errorNode, "Passwords do not match.");
            return;
        }

        setSubmittingState(submitButton, true);
        status.textContent = "Saving password...";

        try {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) {
                throw error;
            }

            await supabase.auth.signOut();
            status.textContent = "Password created. Redirecting to login...";
            window.setTimeout(() => {
                window.location.href = "./login.html";
            }, 900);
        } catch (error) {
            status.textContent = "Unable to save password.";
            showError(errorNode, error?.message || "Unable to save password.");
            setSubmittingState(submitButton, false);
        }
    });
}
