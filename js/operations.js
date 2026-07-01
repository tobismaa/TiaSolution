import { getCurrentSessionContext } from "./core/session.js";
import { getAccessBanner } from "./core/subscription.js";
import { ROLES, ROLE_NAV } from "./core/roles.js";
import { getDefaultRouteForRoutes, getEnabledRoutesForRole } from "./core/features.js";
import { ensureRoute } from "./core/guards.js";
import { mountTopbarDateClock, renderSidebarNav, renderSummaryStrip, setPageMeta } from "./shared/ui.js";
import { createPageLoadingController } from "./shared/page-loading.js";
import { renderOperationsDashboard, renderOperationsWorkspacePage } from "./dashboards/operations-dashboard.js";
import { renderAccountManagement } from "./modules/account-management/account-management.js";
import { renderCustomers, bindCustomersActions } from "./modules/customers/customers.js";
import { renderInvoices, bindInvoicesActions } from "./modules/invoices/invoices.js";
import { renderCustomerBilling } from "./modules/customer-billing/customer-billing.js";
import { renderExpenses, bindExpensesActions } from "./modules/expenses/expenses.js";
import { renderGlPosting } from "./modules/gl-posting/gl-posting.js";
import { renderReports } from "./modules/reports/reports.js";
import { renderAssets } from "./modules/assets/assets.js";
import { signOutUser } from "./core/auth.js";

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
        case "accountManagement":
            return await renderAccountManagement();
        case "operation":
            return await renderOperationsWorkspacePage();
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
        case "assets":
            return await renderAssets();
        case "dashboard":
        default:
            return await renderOperationsDashboard();
    }
}

export async function initOperationsShell() {
    const session = await getCurrentSessionContext();
    if (!session) {
        window.location.href = `./login.html${getPreservedSearch()}`;
        return;
    }

    if (session.role !== ROLES.STAFF) {
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

    const navItems = getEnabledRoutesForRole(ROLES.STAFF, session.featureKeys);
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
            const targetRoute = ensureRoute(ROLES.STAFF, getRouteFromHash() || getDefaultRouteForRoutes(navItems), navItems);
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
                role: ROLES.STAFF,
                fullName: session.fullName,
                businessName: session.businessName,
                subscriptionBadge,
                subscriptionLabel: banner.label
            });

            if (targetRoute === "dashboard") {
                pageTitle.textContent = "Operations Dashboard";
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

initOperationsShell();
