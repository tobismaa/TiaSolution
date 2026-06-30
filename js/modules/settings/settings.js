import { ROLES } from "../../core/roles.js";
import { formatRole } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import {
    forceLogoutSession,
    getActiveLoginSessions,
    getEmailTwoFactorLoginThreshold,
    getSessionTimeoutMinutes,
    saveEmailTwoFactorLoginThreshold,
    saveSessionTimeoutMinutes
} from "./settings-service.js";

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function setSubmittingState(button, isSubmitting) {
    if (!button) {
        return;
    }

    button.disabled = isSubmitting;
    button.classList.toggle("is-loading", isSubmitting);
    button.setAttribute("aria-busy", String(isSubmitting));
}

function renderManagedSettings() {
    return `
        <div class="section-stack">
            <section class="panel">
                <div class="panel-head">
                    <div>
                        <p class="eyebrow">Settings</p>
                        <h3>Managed by Super Admin</h3>
                    </div>
                </div>
                <p class="muted">Organization theme, color, logo, branch logo, and security session controls are configured from the Super Admin workspace.</p>
            </section>
        </div>
    `;
}

function renderActiveSessions(sessions = []) {
    const rows = sessions.length
        ? sessions.map((session) => `
            <tr>
                <td>
                    <strong>${escapeHtml(session.userName || "User")}</strong>
                    <span class="muted table-subtext">${escapeHtml(session.email || "No email on profile")}</span>
                </td>
                <td>${escapeHtml(formatRole(session.role) || "-")}</td>
                <td>${formatDateTime(session.signedInAt)}</td>
                <td>${session.loginAttemptCount || 0}</td>
                <td>${formatDateTime(session.lastLoginAttemptAt)}</td>
                <td>
                    <button class="btn btn-secondary" type="button" data-force-logout-session-id="${escapeHtml(session.id)}">
                        <span class="btn-label">Log Out</span>
                        <span class="spinner" aria-hidden="true"></span>
                    </button>
                </td>
            </tr>
        `).join("")
        : `<tr><td colspan="6">No active user sessions found.</td></tr>`;

    return `
        <section class="panel">
            <div class="panel-head">
                <div>
                    <p class="eyebrow">Active sessions</p>
                    <h3>Logged-in users</h3>
                </div>
                <button class="btn btn-secondary" type="button" data-refresh-sessions>Refresh</button>
            </div>
            <div class="table-wrap mt-18">
                <table>
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Role</th>
                            <th>Signed In</th>
                            <th>Blocked Attempts</th>
                            <th>Last Attempt</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody data-active-sessions-body>${rows}</tbody>
                </table>
            </div>
            <p class="muted mt-12" data-session-action-status>Force logout ends the active dashboard session. The user will be redirected to login on their next session check.</p>
        </section>
    `;
}

function renderSuperAdminSettings(timeoutMinutes, twoFactorThreshold, sessions) {
    return `
        <div class="section-stack">
            <div class="button-row demo-tabbar settings-subtabs" role="tablist" aria-label="Super admin settings">
                <button class="btn btn-primary" type="button" role="tab" aria-selected="true" data-settings-tab="security">Security Settings</button>
                <button class="btn btn-secondary" type="button" role="tab" aria-selected="false" data-settings-tab="sessions">Active Session</button>
            </div>
            <div data-settings-panel="security">
                <section class="panel">
                    <div class="panel-head">
                        <div>
                            <p class="eyebrow">Security settings</p>
                            <h3>Session timeout</h3>
                        </div>
                    </div>
                    <form class="form-grid mt-18" data-session-timeout-form>
                        <label class="form-field">
                            <span>Idle Timeout Minutes</span>
                            <input name="session_timeout_minutes" type="number" min="5" max="720" step="1" value="${escapeHtml(timeoutMinutes)}" required>
                            <small>Users are signed out after this many idle minutes. Use 5 to 720 minutes.</small>
                        </label>
                        <label class="form-field">
                            <span>Email 2FA After Logins</span>
                            <input name="email_2fa_after_logins" type="number" min="1" max="1000" step="1" value="${escapeHtml(twoFactorThreshold)}" required>
                            <small>After this many successful logins, the next login must be verified with an email code.</small>
                        </label>
                        <div class="button-row">
                            <button class="btn btn-primary" type="submit" data-session-timeout-save>
                                <span class="btn-label">Save Timeout</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <p class="muted" data-session-timeout-status></p>
                        </div>
                    </form>
                </section>
            </div>
            <div data-settings-panel="sessions" hidden>
                ${renderActiveSessions(sessions)}
            </div>
        </div>
    `;
}

export async function renderSettings(session) {
    if (session?.role !== ROLES.SUPER_ADMIN) {
        return renderManagedSettings();
    }

    const [timeoutMinutes, twoFactorThreshold, sessions] = await Promise.all([
        getSessionTimeoutMinutes(),
        getEmailTwoFactorLoginThreshold(),
        getActiveLoginSessions()
    ]);

    return renderSuperAdminSettings(timeoutMinutes, twoFactorThreshold, sessions);
}

export function bindSettingsActions(container, refresh) {
    const timeoutForm = container.querySelector("[data-session-timeout-form]");

    timeoutForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const saveButton = timeoutForm.querySelector("[data-session-timeout-save]");
        const status = timeoutForm.querySelector("[data-session-timeout-status]");
        const data = new FormData(timeoutForm);

        setSubmittingState(saveButton, true);
        if (status) {
            status.textContent = "Saving timeout...";
        }

        try {
            await Promise.all([
                saveSessionTimeoutMinutes(Number(data.get("session_timeout_minutes") || 0)),
                saveEmailTwoFactorLoginThreshold(Number(data.get("email_2fa_after_logins") || 0))
            ]);
            showToast("Security settings saved.");
            if (status) {
                status.textContent = "Security settings saved.";
            }
            if (typeof refresh === "function") {
                await refresh();
            }
        } catch (error) {
            showToast(error?.message || "Unable to save session timeout.", { tone: "error" });
            if (status) {
                status.textContent = error?.message || "Unable to save session timeout.";
            }
        } finally {
            setSubmittingState(saveButton, false);
        }
    });

    container.addEventListener("click", async (event) => {
        const settingsTab = event.target.closest("[data-settings-tab]");
        if (settingsTab) {
            const tabKey = settingsTab.getAttribute("data-settings-tab") || "security";
            container.querySelectorAll("[data-settings-tab]").forEach((button) => {
                const isActive = button === settingsTab;
                button.classList.toggle("btn-primary", isActive);
                button.classList.toggle("btn-secondary", !isActive);
                button.setAttribute("aria-selected", String(isActive));
            });
            container.querySelectorAll("[data-settings-panel]").forEach((panel) => {
                panel.hidden = panel.getAttribute("data-settings-panel") !== tabKey;
            });
            return;
        }

        const refreshButton = event.target.closest("[data-refresh-sessions]");
        if (refreshButton) {
            if (typeof refresh === "function") {
                await refresh();
            }
            return;
        }

        const logoutButton = event.target.closest("[data-force-logout-session-id]");
        if (!logoutButton) {
            return;
        }

        const sessionId = logoutButton.getAttribute("data-force-logout-session-id");
        const status = container.querySelector("[data-session-action-status]");
        setSubmittingState(logoutButton, true);
        if (status) {
            status.textContent = "Logging out user...";
        }

        try {
            await forceLogoutSession(sessionId);
            showToast("User logged out.");
            if (status) {
                status.textContent = "User logged out.";
            }
            if (typeof refresh === "function") {
                await refresh();
            }
        } catch (error) {
            showToast(error?.message || "Unable to log out user.", { tone: "error" });
            if (status) {
                status.textContent = error?.message || "Unable to log out user.";
            }
            setSubmittingState(logoutButton, false);
        }
    });
}
