import { getCurrentSessionContext } from "./core/session.js";
import { getAccessBanner } from "./core/subscription.js";
import { ROLES, ROLE_NAV, getDefaultRoute } from "./core/roles.js";
import { ensureRoute } from "./core/guards.js";
import { mountTopbarDateClock, renderSidebarNav, renderSummaryStrip, setPageMeta } from "./shared/ui.js";
import { renderSuperAdminDashboard } from "./dashboards/super-admin-dashboard.js";
import { renderBusinesses } from "./modules/businesses/businesses.js";
import { renderDemoRequests, bindDemoRequestActions } from "./modules/demo-requests/demo-requests.js";
import { renderSubscriptions } from "./modules/subscriptions/subscriptions.js";
import { renderSettings } from "./modules/settings/settings.js";
import { ensureLoginSessionClaimed, signOutUser, startLoginAttemptMonitor } from "./core/auth.js";

function getRouteFromHash() {
    return window.location.hash.replace("#", "") || "";
}

function setHash(route) {
    window.location.hash = route;
}

function bindModalSafetyGuards() {
    if (window.__TIA_MODAL_SAFETY_GUARD_BOUND__) {
        return;
    }
    window.__TIA_MODAL_SAFETY_GUARD_BOUND__ = true;

    document.addEventListener("click", (event) => {
        const backdrop = event.target instanceof Element
            ? event.target.closest(".business-modal__backdrop")
            : null;
        if (!backdrop) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }, true);

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
            return;
        }
        if (!document.querySelector(".business-modal:not([hidden])")) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }, true);
}

let loadingSafetyTimer = null;

function getLoadingOverlay() {
    return document.getElementById("pageLoadingOverlay");
}

function showPageLoading() {
    const overlay = getLoadingOverlay();
    if (overlay) {
        if (loadingSafetyTimer) {
            window.clearTimeout(loadingSafetyTimer);
        }
        overlay.hidden = false;
        loadingSafetyTimer = window.setTimeout(() => {
            hidePageLoading();
        }, 3000);
    }
}

function hidePageLoading() {
    const overlay = getLoadingOverlay();
    if (loadingSafetyTimer) {
        window.clearTimeout(loadingSafetyTimer);
        loadingSafetyTimer = null;
    }
    if (overlay) {
        overlay.hidden = true;
    }
}

function bindSuperAdminLoadingInteractions({ sidebarNav, pageContent }) {
    const shouldSkip = (element) => {
        if (!element) {
            return true;
        }

        if (element.disabled) {
            return true;
        }

        if (element.closest("[data-no-loading]")) {
            return true;
        }

        // Skip close-only controls so dismissing modals feels instant.
        if (element.closest("[data-platform-user-modal-close], [data-platform-user-details-close], [data-ledger-modal-close]")) {
            return true;
        }

        return false;
    };

    const shouldTrackPageNavigation = (element) => {
        if (!element) {
            return false;
        }

        if (element.matches("[data-page-loading-trigger]")) {
            return true;
        }

        if (element.matches("[data-route]")) {
            return true;
        }

        const href = String(element.getAttribute("href") || "").trim();
        return href.startsWith("#");
    };

    sidebarNav?.addEventListener("click", (event) => {
        const control = event.target.closest("button, a, [role='tab']");
        if (shouldSkip(control)) {
            return;
        }
        showPageLoading();
    });

    pageContent?.addEventListener("click", (event) => {
        const control = event.target.closest("button, a, [role='tab']");
        if (shouldSkip(control) || !shouldTrackPageNavigation(control)) {
            return;
        }

        showPageLoading();
    });

    pageContent?.addEventListener("submit", () => {
        showPageLoading();
    });
}

async function renderRoute(route, session) {
    switch (route) {
        case "businesses":
            return await renderBusinesses();
        case "demoRequests":
            return { summary: [], content: await renderDemoRequests(), afterRender: bindDemoRequestActions };
        case "subscriptions":
            return { summary: [], content: await renderSubscriptions() };
        case "settings":
            return { summary: [], content: await renderSettings(session) };
        case "dashboard":
        default:
            return await renderSuperAdminDashboard();
    }
}

export async function initSuperAdminShell() {
    const session = await getCurrentSessionContext();
    if (!session) {
        window.location.href = "./login.html";
        return;
    }

    if (!await ensureLoginSessionClaimed()) {
        return;
    }

    if (session.role !== ROLES.SUPER_ADMIN || session.mode !== "live") {
        window.location.href = "./app.html";
        return;
    }

    const sidebarNav = document.getElementById("sidebarNav");
    const pageTitle = document.getElementById("pageTitle");
    const pageEyebrow = document.getElementById("pageEyebrow");
    const pageContent = document.getElementById("pageContent");
    const summaryStrip = document.getElementById("summaryStrip");
    const workspaceName = document.getElementById("workspaceName");
    const roleSummary = document.getElementById("roleSummary");
    const subscriptionBadge = document.getElementById("subscriptionBadge");
    const sidebarPeriod = document.getElementById("sidebarPeriod");
    const sidebarInsight = document.getElementById("sidebarInsight");
    const signOutButton = document.getElementById("signOutButton");
    mountTopbarDateClock(signOutButton);
    startLoginAttemptMonitor();
    bindModalSafetyGuards();

    const navItems = ROLE_NAV[ROLES.SUPER_ADMIN];
    const banner = getAccessBanner(session);
    sidebarPeriod.textContent = session.currentPeriod;
    sidebarInsight.textContent = "";
    window.TIA_PAGE_LOADING = { show: showPageLoading, hide: hidePageLoading };
    bindSuperAdminLoadingInteractions({ sidebarNav, pageContent });

    async function refresh() {
        try {
            const targetRoute = ensureRoute(ROLES.SUPER_ADMIN, getRouteFromHash() || getDefaultRoute(ROLES.SUPER_ADMIN));
            if (targetRoute !== getRouteFromHash()) {
                showPageLoading();
                setHash(targetRoute);
                return;
            }

            showPageLoading();
            renderSidebarNav(sidebarNav, navItems, targetRoute, (route) => setHash(route));
            setPageMeta({
                route: targetRoute,
                titleNode: pageTitle,
                eyebrowNode: pageEyebrow,
                workspaceNode: workspaceName,
                roleNode: roleSummary,
                role: ROLES.SUPER_ADMIN,
                fullName: session.fullName,
                businessName: session.businessName,
                subscriptionBadge,
                subscriptionLabel: banner.label
            });

            if (targetRoute === "dashboard") {
                pageEyebrow.textContent = "Platform control";
                pageTitle.textContent = "Super Admin Dashboard";
            }

            const rendered = await renderRoute(targetRoute, session);
            renderSummaryStrip(summaryStrip, rendered.summary || []);
            pageContent.innerHTML = rendered.content || "";
            if (typeof rendered.afterRender === "function") {
                rendered.afterRender(pageContent, refresh);
            }
        } catch (error) {
            summaryStrip.innerHTML = "";
            pageContent.innerHTML = `
                <section class="panel">
                    <p class="hero-tag">Load error</p>
                    <h2>We could not render this workspace.</h2>
                    <p class="muted">${error?.message || "An unexpected error occurred while loading the dashboard."}</p>
                </section>
            `;
        } finally {
            hidePageLoading();
        }
    }

    signOutButton?.addEventListener("click", async () => {
        showPageLoading();
        await signOutUser();
    });
    window.addEventListener("hashchange", refresh);

    if (!window.location.hash) {
        setHash(getDefaultRoute(ROLES.SUPER_ADMIN));
    }

    await refresh();
}

initSuperAdminShell();
