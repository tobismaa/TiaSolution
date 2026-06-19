import { enterDemo } from "./demo-access.js";
import { startTrial } from "../trial/trial-access.js";
import { getStoredSession } from "../core/session.js";
import { ROLE_LABELS } from "../core/roles.js";
import { showToast } from "../shared/toast.js";

function setButtonsDisabled(disabled) {
    const roleButtons = Array.from(document.querySelectorAll(".demo-role-button"));
    roleButtons.forEach((button) => {
        button.disabled = disabled;
    });

    const openWorkspaceButton = document.getElementById("openWorkspaceButton");
    const startTrialButton = document.getElementById("startTrialButton");

    if (openWorkspaceButton) openWorkspaceButton.disabled = disabled;
    if (startTrialButton) startTrialButton.disabled = disabled;

    return roleButtons;
}

function initDemoDashboard() {
    const status = document.getElementById("demoDashboardStatus");
    const gateBadge = document.getElementById("demoGateBadge");
    const openWorkspaceButton = document.getElementById("openWorkspaceButton");
    const startTrialButton = document.getElementById("startTrialButton");
    const session = getStoredSession();

    if (!session || !session.role) {
        setButtonsDisabled(true);
        return;
    }

    const roleButtons = setButtonsDisabled(false);
    const allowedRoles = Array.isArray(session.allowedRoles) && session.allowedRoles.length
        ? session.allowedRoles
        : [session.role];
    const roleLabel = ROLE_LABELS[session.role] || "Demo Role";

    if (gateBadge) {
        gateBadge.textContent = "Unlocked";
        gateBadge.classList.remove("pink");
        gateBadge.classList.add("paid");
    }

    if (status) {
        const accessText = session.grantedRole === "all_roles"
            ? "All roles available."
            : `Role-limited access: ${roleLabel}.`;
        status.textContent = `Access granted. ${accessText} You can open workspace now.`;
    }

    roleButtons.forEach((button) => {
        const role = button.dataset.role;
        const isAllowed = allowedRoles.includes(role);
        button.disabled = !isAllowed;

        if (!isAllowed) {
            button.title = "Not granted for this demo link";
            return;
        }

        button.addEventListener("click", () => {
            enterDemo(role);
            showToast(`Switched to ${button.textContent}`);
            window.location.href = `./app.html${window.location.search}`;
        });
    });

    openWorkspaceButton?.addEventListener("click", () => {
        window.location.href = `./app.html${window.location.search}`;
    });

    startTrialButton?.addEventListener("click", () => {
        startTrial();
        showToast("Trial mode started");
        window.location.href = `./app.html${window.location.search}`;
    });
}

initDemoDashboard();
