import { ROUTES, ROLE_LABELS, ROLES } from "../core/roles.js";
import { formatStatusTone } from "../core/utils.js";
import { getCurrentSessionContext } from "../core/session.js";
import { getActiveBranchDetails } from "../core/data-access.js";

let cachedServerOffsetMs = 0;
let hasSyncedServerOffset = false;

function bindGlobalModalDismissGuard() {
    if (window.__TIA_GLOBAL_MODAL_DISMISS_GUARD_BOUND__) {
        return;
    }

    window.__TIA_GLOBAL_MODAL_DISMISS_GUARD_BOUND__ = true;

    document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) {
            return;
        }

        const clickedOutsideDialog = target.classList.contains("business-modal")
            || Boolean(target.closest(".business-modal__backdrop"));
        if (!clickedOutsideDialog) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }, true);

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || !document.querySelector(".business-modal:not([hidden])")) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }, true);
}

bindGlobalModalDismissGuard();

async function mountTopbarActiveBranchBadge(host, signOutButton) {
    if (!host || !signOutButton) {
        return;
    }

    const existing = host.querySelector("[data-topbar-active-branch]");
    if (existing) {
        return;
    }

    try {
        const session = await getCurrentSessionContext();
        if (!session?.userId || !session?.businessId) {
            return;
        }
        const role = String(session.role || "").trim().toLowerCase();
        if (role === ROLES.SUPER_ADMIN || role === ROLES.BUSINESS_ADMIN) {
            return;
        }

        const branch = await getActiveBranchDetails(session.userId, session.businessId);
        const badge = document.createElement("span");
        const isAllBranches = Boolean(branch?.canAccessAllBranches);
        badge.className = `active-branch-indicator ${isAllBranches ? "is-all" : "is-single"}`;
        badge.setAttribute("data-topbar-active-branch", "true");
        badge.textContent = `Active Branch: ${isAllBranches ? "Head Office" : (branch?.name || "Head Office")}`;
        host.insertBefore(badge, signOutButton);
    } catch {
        // silent fallback: topbar can render without branch badge
    }
}

async function syncServerOffsetFromSupabase() {
    // Disabled direct REST HEAD probing because some projects return 401 for this route,
    // which pollutes dashboard network logs. Clock will use local browser time.
    cachedServerOffsetMs = 0;
    hasSyncedServerOffset = false;
}

export function renderSidebarNav(container, items, activeRoute, onSelect) {
    container.innerHTML = items
        .map((route) => `<button class="nav-item ${route === activeRoute ? "active" : ""}" data-route="${route}" type="button">${ROUTES[route].label}</button>`)
        .join("");

    container.querySelectorAll("[data-route]").forEach((button) => {
        button.addEventListener("click", () => onSelect(button.dataset.route));
    });
}

export function renderSummaryStrip(container, summaryCards) {
    container.innerHTML = summaryCards.length
        ? `
            <div class="summary-grid">
                ${summaryCards.map((card) => `
                    <article class="summary-card">
                        <p class="muted">${card.label}</p>
                        <h3>${card.value}</h3>
                        <span class="trend ${card.tone}">${card.note}</span>
                    </article>
                `).join("")}
            </div>
        `
        : "";
}

export function setPageMeta({ route, titleNode, eyebrowNode, workspaceNode, roleNode, role, fullName, businessName, subscriptionBadge, subscriptionLabel }) {
    titleNode.textContent = ROUTES[route].title;
    eyebrowNode.textContent = ROUTES[route].eyebrow;
    workspaceNode.textContent = businessName;
    roleNode.textContent = String(fullName || "").trim() || ROLE_LABELS[role];
    subscriptionBadge.textContent = subscriptionLabel;
    subscriptionBadge.className = `badge ${formatStatusTone(subscriptionLabel)}`;
}

export function mountTopbarDateClock(signOutButton) {
    const host = signOutButton?.parentElement;
    if (!host) {
        return () => {};
    }

    const existing = host.querySelector("[data-topbar-clock]");
    if (existing) {
        return () => {};
    }

    const appTimeZone = "Africa/Lagos";
    const dateFormatter = new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: appTimeZone
    });

    const timeFormatter = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: appTimeZone
    });

    const widget = document.createElement("div");
    widget.className = "topbar-clock";
    widget.setAttribute("data-topbar-clock", "true");

    const dateNode = document.createElement("span");
    dateNode.className = "topbar-clock__date";
    const timeNode = document.createElement("strong");
    timeNode.className = "topbar-clock__time";

    widget.append(dateNode, timeNode);
    host.insertBefore(widget, signOutButton);

    const tick = () => {
        const baseNow = Date.now();
        const effectiveNow = hasSyncedServerOffset ? (baseNow + cachedServerOffsetMs) : baseNow;
        const now = new Date(effectiveNow);
        dateNode.textContent = `${dateFormatter.format(now)} WAT`;
        timeNode.textContent = `${timeFormatter.format(now)} WAT`;
    };

    void syncServerOffsetFromSupabase().finally(() => {
        tick();
    });
    const timerId = window.setInterval(tick, 1000);
    const resyncId = window.setInterval(() => {
        void syncServerOffsetFromSupabase();
    }, 5 * 60 * 1000);

    return () => {
        window.clearInterval(timerId);
        window.clearInterval(resyncId);
        widget.remove();
    };
}
