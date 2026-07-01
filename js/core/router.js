import { getCurrentSessionContext } from "./session.js";
import { getAccessBanner } from "./subscription.js";
import { ROLES, ROLE_NAV, getDefaultRoute } from "./roles.js";
import { ensureRoute } from "./guards.js";
import { mountTopbarDateClock, renderSidebarNav, renderSummaryStrip, setPageMeta } from "../shared/ui.js";
import { createPageLoadingController } from "../shared/page-loading.js";
import { renderAdminDashboard } from "../dashboards/admin-dashboard.js";
import { renderBranches } from "../modules/branches/branches.js";
import { renderHeadOfOperationsDashboard } from "../dashboards/head-of-operations-dashboard.js";
import { renderOperationsDashboard } from "../dashboards/operations-dashboard.js";
import { renderAuditorDashboard, renderAuditorTrialBalance } from "../dashboards/auditor-dashboard.js";
import { renderSuperAdminDashboard } from "../dashboards/super-admin-dashboard.js";
import { renderCustomers, bindCustomersActions } from "../modules/customers/customers.js";
import { renderInvoices, bindInvoicesActions } from "../modules/invoices/invoices.js";
import { renderCustomerBilling } from "../modules/customer-billing/customer-billing.js";
import { renderExpenses, bindExpensesActions } from "../modules/expenses/expenses.js";
import { renderGlPosting } from "../modules/gl-posting/gl-posting.js";
import { renderPayroll } from "../modules/payroll/payroll.js";
import { renderReports } from "../modules/reports/reports.js";
import { renderAssets } from "../modules/assets/assets.js";
import { renderUsers } from "../modules/users/users.js";
import { renderGeneralLedgers } from "../modules/general-ledgers/general-ledgers.js";
import { renderSettings } from "../modules/settings/settings.js";
import { renderAuditLog } from "../modules/audit/audit-log.js";
import { renderBusinesses } from "../modules/businesses/businesses.js";
import { renderDemoRequests, bindDemoRequestActions } from "../modules/demo-requests/demo-requests.js";
import { renderSubscriptions } from "../modules/subscriptions/subscriptions.js";
import { ensureLoginSessionClaimed, signOutUser, startLoginAttemptMonitor } from "./auth.js";

function getRouteFromHash() {
    return window.location.hash.replace("#", "") || "";
}

function getPreservedSearch() {
    return window.location.search || "";
}

function setHash(route) {
    const nextHash = `#${route}`;
    if (window.location.hash === nextHash) {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        return;
    }
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

function getDashboardRenderer(role) {
    if (role === ROLES.SUPER_ADMIN) return renderSuperAdminDashboard;
    if (role === ROLES.MANAGER) return renderHeadOfOperationsDashboard;
    if (role === ROLES.STAFF) return renderOperationsDashboard;
    if (role === ROLES.AUDITOR || role === ROLES.ACCOUNT) return renderAuditorDashboard;
    return renderAdminDashboard;
}

async function renderRoute(route, session) {
    switch (route) {
        case "trialBalance": return await renderAuditorTrialBalance();
        case "glPosting": return await renderGlPosting();
        case "branches": return await renderBranches();
        case "customerBilling": return await renderCustomerBilling(session);
        case "customers": return { summary: [], content: await renderCustomers(), afterRender: bindCustomersActions };
        case "invoices": return { summary: [], content: await renderInvoices(), afterRender: bindInvoicesActions };
        case "expenses": return { summary: [], content: await renderExpenses(), afterRender: bindExpensesActions };
        case "payroll": return await renderPayroll(session.role);
        case "reports": return await renderReports(session.role);
        case "assets": return await renderAssets();
        case "users":
            return await renderUsers();
        case "generalLedgers":
            return await renderGeneralLedgers();
        case "platformUsers":
            return await renderUsers({ platform: true });
        case "audit": return { summary: [], content: await renderAuditLog() };
        case "settings": return { summary: [], content: await renderSettings(session) };
        case "businesses": return await renderBusinesses();
        case "demoRequests": return { summary: [], content: await renderDemoRequests(), afterRender: bindDemoRequestActions };
        case "subscriptions": return { summary: [], content: await renderSubscriptions() };
        case "platformReports": return await renderReports(session.role);
        case "dashboard":
        default:
            return getDashboardRenderer(session.role)();
    }
}

export async function initAppShell() {
    const session = await getCurrentSessionContext();
    if (!session) {
        window.location.href = "./login.html";
        return;
    }

    if (!await ensureLoginSessionClaimed()) {
        return;
    }

    if (session.role === ROLES.SUPER_ADMIN && session.mode === "live") {
        window.location.href = `./super-admin.html${getPreservedSearch()}`;
        return;
    }

    if (session.role === ROLES.BUSINESS_ADMIN) {
        window.location.href = `./business-admin.html${getPreservedSearch()}`;
        return;
    }

    if (session.role === ROLES.MANAGER) {
        window.location.href = `./head-of-operations.html${getPreservedSearch()}`;
        return;
    }

    if (session.role === ROLES.STAFF) {
        window.location.href = `./operations.html${getPreservedSearch()}`;
        return;
    }

    if (session.role === ROLES.AUDITOR || session.role === ROLES.ACCOUNT) {
        window.location.href = `./auditor.html${getPreservedSearch()}`;
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
    bindModalSafetyGuards();

    const navItems = ROLE_NAV[session.role] || ROLE_NAV[ROLES.BUSINESS_ADMIN];
    const banner = getAccessBanner(session);
    sidebarPeriod.textContent = session.currentPeriod;
    sidebarInsight.textContent = session.role === ROLES.SUPER_ADMIN
        ? "Platform overview loads from Supabase."
        : (session.mode === "live"
            ? `Signed in as ${session.userEmail || "business user"}.`
            : "Preview data is loaded so prospects can explore before paying.");
    window.TIA_PAGE_LOADING = { show: loading.show, hide: loading.hide };
    loading.bindInteractions({ sidebarNav, pageContent });

    async function refresh() {
        loading.show();
        try {
            const targetRoute = ensureRoute(session.role, getRouteFromHash() || getDefaultRoute(session.role));
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
                role: session.role,
                fullName: session.fullName,
                businessName: session.businessName,
                subscriptionBadge,
                subscriptionLabel: banner.label
            });

            if (targetRoute === "dashboard") {
                if (session.role === ROLES.SUPER_ADMIN) {
                    pageTitle.textContent = "Super Admin Dashboard";
                } else if (session.role === ROLES.BUSINESS_ADMIN) {
                    pageTitle.textContent = "Admin Dashboard";
                } else if (session.role === ROLES.MANAGER) {
                    pageTitle.textContent = "Head of Operation Dashboard";
                } else if (session.role === ROLES.STAFF) {
                    pageTitle.textContent = "Operations Dashboard";
                } else if (session.role === ROLES.AUDITOR || session.role === ROLES.ACCOUNT) {
                    pageTitle.textContent = "Account Dashboard";
                }
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
        setHash(getDefaultRoute(session.role));
        await refresh();
    } else {
        await refresh();
    }
}
