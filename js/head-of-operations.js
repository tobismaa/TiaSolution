import { getCurrentSessionContext } from "./core/session.js";
import { getAccessBanner } from "./core/subscription.js";
import { ROLES, ROLE_NAV } from "./core/roles.js";
import { getDefaultRouteForRoutes, getEnabledRoutesForRole } from "./core/features.js";
import { applyOrganizationBranding } from "./core/branding.js";
import { ensureRoute } from "./core/guards.js";
import { mountTopbarDateClock, renderSidebarNav, renderSummaryStrip, setPageMeta } from "./shared/ui.js";
import { createPageLoadingController } from "./shared/page-loading.js";
import { renderHeadOfOperationsDashboard } from "./dashboards/head-of-operations-dashboard.js";
import { renderCustomers, bindCustomersActions } from "./modules/customers/customers.js";
import { renderInvoices, bindInvoicesActions } from "./modules/invoices/invoices.js";
import { renderCustomerBilling } from "./modules/customer-billing/customer-billing.js";
import { renderExpenses, bindExpensesActions } from "./modules/expenses/expenses.js";
import { renderGlPosting } from "./modules/gl-posting/gl-posting.js";
import { renderReports } from "./modules/reports/reports.js";
import { ensureLoginSessionClaimed, signOutUser, startLoginAttemptMonitor } from "./core/auth.js";

function getRouteFromHash() {
    return window.location.hash.replace("#", "") || "";
}

function getPreservedSearch() {
    return window.location.search || "";
}

function setHash(route) {
    window.location.hash = route;
}

async function renderRoute(route, session) {
    switch (route) {
        case "customerBilling":
            return await renderCustomerBilling(session);
        case "customers":
            return { summary: [], content: await renderCustomers(), afterRender: bindCustomersActions };
        case "invoices":
            return { summary: [], content: await renderInvoices(), afterRender: bindInvoicesActions };
        case "expenses":
            return { summary: [], content: await renderExpenses(), afterRender: bindExpensesActions };
        case "glPosting":
            return await renderGlPosting();
        case "reports":
            return await renderReports(session.role);
        case "dashboard":
        default:
            return await renderHeadOfOperationsDashboard();
    }
}

export async function initHeadOfOperationsShell() {
    const session = await getCurrentSessionContext();
    if (!session) {
        window.location.href = `./login.html${getPreservedSearch()}`;
        return;
    }

    if (!await ensureLoginSessionClaimed()) {
        return;
    }

    if (session.role !== ROLES.MANAGER) {
        window.location.href = `./app.html${getPreservedSearch()}`;
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
    const loading = createPageLoadingController();
    mountTopbarDateClock(signOutButton);
    startLoginAttemptMonitor();
    await applyOrganizationBranding(session);

    const navItems = getEnabledRoutesForRole(ROLES.MANAGER, session.featureKeys);
    const banner = getAccessBanner(session);
    sidebarPeriod.textContent = session.currentPeriod;
    sidebarInsight.textContent = session.mode === "live"
        ? `Signed in as ${session.userEmail || "business user"}.`
        : "Preview data is loaded so prospects can explore before paying.";
    window.TIA_PAGE_LOADING = { show: loading.show, hide: loading.hide };
    loading.bindInteractions({ sidebarNav, pageContent });

    async function refresh() {
        loading.show();
        try {
            const targetRoute = ensureRoute(ROLES.MANAGER, getRouteFromHash() || getDefaultRouteForRoutes(navItems), navItems);
            if (targetRoute !== getRouteFromHash()) {
                setHash(targetRoute);
                return;
            }

            renderSidebarNav(sidebarNav, navItems, targetRoute, (route) => setHash(route));
            setPageMeta({
                route: targetRoute,
                titleNode: pageTitle,
                eyebrowNode: pageEyebrow,
                workspaceNode: workspaceName,
                roleNode: roleSummary,
                role: ROLES.MANAGER,
                fullName: session.fullName,
                businessName: session.businessName,
                subscriptionBadge,
                subscriptionLabel: banner.label
            });

            if (targetRoute === "dashboard") {
                pageTitle.textContent = "Head of Operation Dashboard";
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
            loading.hide();
        }
    }

    signOutButton?.addEventListener("click", signOutUser);
    window.addEventListener("hashchange", refresh);

    if (!window.location.hash) {
        setHash(getDefaultRouteForRoutes(navItems));
    }

    await refresh();
}

initHeadOfOperationsShell();
