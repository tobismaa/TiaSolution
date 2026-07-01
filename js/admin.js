import { getCurrentSessionContext } from "./core/session.js";
import { getStoredBranchScope, resolveBranchScope, saveBranchScope } from "./core/branch-scope.js";
import { getAccessBanner } from "./core/subscription.js";
import { ROLES, ROLE_NAV } from "./core/roles.js";
import { getDefaultRouteForRoutes, getEnabledRoutesForRole } from "./core/features.js";
import { ensureRoute } from "./core/guards.js";
import { mountTopbarDateClock, renderSidebarNav, renderSummaryStrip, setPageMeta } from "./shared/ui.js";
import { createPageLoadingController } from "./shared/page-loading.js";
import { renderAdminDashboard } from "./dashboards/admin-dashboard.js";
import { renderBranches } from "./modules/branches/branches.js";
import { getBranchesForCurrentBusiness } from "./modules/branches/branches-service.js";
import { renderCustomers, bindCustomersActions } from "./modules/customers/customers.js";
import { renderInvoices, bindInvoicesActions } from "./modules/invoices/invoices.js";
import { renderCustomerBilling } from "./modules/customer-billing/customer-billing.js";
import { renderExpenses, bindExpensesActions } from "./modules/expenses/expenses.js";
import { renderPayroll } from "./modules/payroll/payroll.js";
import { renderReports } from "./modules/reports/reports.js";
import { renderUsers } from "./modules/users/users.js";
import { renderSettings } from "./modules/settings/settings.js";
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

async function renderRoute(route, session, scope) {
    switch (route) {
        case "branches":
            return await renderBranches({
                branchId: scope?.branchId || "",
                selectedBranchId: scope?.selectedBranchId || "",
                appliesToAll: Boolean(scope?.appliesToAll),
                label: scope?.label || "Head Office"
            });
        case "customerBilling":
            return await renderCustomerBilling(session);
        case "customers":
            return { summary: [], content: await renderCustomers(), afterRender: bindCustomersActions };
        case "invoices":
            return { summary: [], content: await renderInvoices(), afterRender: bindInvoicesActions };
        case "expenses":
            return { summary: [], content: await renderExpenses(), afterRender: bindExpensesActions };
        case "payroll":
            return await renderPayroll(session.role);
        case "reports":
            return await renderReports(session.role);
        case "users":
            return await renderUsers({ branchId: scope?.branchId || "" });
        case "settings":
            return { summary: [], content: await renderSettings(session) };
        case "dashboard":
        default:
            return await renderAdminDashboard();
    }
}

export async function initAdminShell() {
    const session = await getCurrentSessionContext();
    if (!session) {
        window.location.href = `./login.html${getPreservedSearch()}`;
        return;
    }

    if (session.role !== ROLES.BUSINESS_ADMIN) {
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
    const activeBranchIndicator = document.getElementById("activeBranchIndicator");
    const signOutButton = document.getElementById("signOutButton");
    const loading = createPageLoadingController();
    mountTopbarDateClock(signOutButton);
    const scopeWidget = document.createElement("label");
    scopeWidget.className = "topbar-scope";
    scopeWidget.innerHTML = `
        <span>Branch Scope</span>
        <select data-admin-branch-scope></select>
    `;
    signOutButton?.parentElement?.insertBefore(scopeWidget, signOutButton);
    const scopeSelect = scopeWidget.querySelector("[data-admin-branch-scope]");

    const navItems = getEnabledRoutesForRole(ROLES.BUSINESS_ADMIN, session.featureKeys);
    const banner = getAccessBanner(session);
    sidebarPeriod.textContent = session.currentPeriod;
    sidebarInsight.textContent = session.mode === "live"
        ? `Signed in as ${session.userEmail || "business user"}.`
        : "Preview data is loaded so prospects can explore before paying.";
    window.TIA_PAGE_LOADING = { show: loading.show, hide: loading.hide };
    loading.bindInteractions({ sidebarNav, pageContent });
    let scopeState = getStoredBranchScope();
    let scopeBranches = [];

    async function loadScopeBranches() {
        try {
            scopeBranches = await getBranchesForCurrentBusiness();
            scopeBranches = scopeBranches.filter((branch) => branch.isActive !== false || branch.isHeadOffice);
        } catch {
            scopeBranches = [];
        }

        const resolved = resolveBranchScope(scopeState.branchId, scopeBranches);
        scopeState = saveBranchScope(resolved.selectedBranchId);

        if (scopeSelect) {
            scopeSelect.innerHTML = `
                ${scopeBranches.map((branch) => `<option value="${branch.id}">${branch.name}</option>`).join("")}
            `;
            scopeSelect.value = resolved.selectedBranchId;
        }

        if (activeBranchIndicator) {
            activeBranchIndicator.textContent = `Active Branch: ${resolved.label}`;
            activeBranchIndicator.classList.toggle("is-all", resolved.appliesToAll);
            activeBranchIndicator.classList.toggle("is-single", !resolved.appliesToAll);
        }
        scopeState = { ...scopeState, ...resolved };
    }

    async function refresh() {
        loading.show();
        try {
            await loadScopeBranches();
            const targetRoute = ensureRoute(ROLES.BUSINESS_ADMIN, getRouteFromHash() || getDefaultRouteForRoutes(navItems), navItems);
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
                role: ROLES.BUSINESS_ADMIN,
                fullName: session.fullName,
                businessName: session.businessName,
                subscriptionBadge,
                subscriptionLabel: banner.label
            });

            if (targetRoute === "dashboard") {
                pageTitle.textContent = "Admin Dashboard";
            }

            const rendered = await renderRoute(targetRoute, session, scopeState);
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
    scopeSelect?.addEventListener("change", async (event) => {
        const nextBranchId = String(event.target?.value || "");
        scopeState = saveBranchScope(nextBranchId);
        await refresh();
    });
    window.addEventListener("hashchange", refresh);

    if (!window.location.hash) {
        setHash(getDefaultRouteForRoutes(navItems));
    }

    await refresh();
}

initAdminShell();
