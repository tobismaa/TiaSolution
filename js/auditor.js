import { getCurrentSessionContext } from "./core/session.js";
import { getStoredBranchScope, resolveBranchScope, saveBranchScope } from "./core/branch-scope.js";
import { getAccessBanner } from "./core/subscription.js";
import { ROLES, ROLE_NAV } from "./core/roles.js";
import { getDefaultRouteForRoutes, getEnabledRoutesForRole } from "./core/features.js";
import { ensureRoute } from "./core/guards.js";
import { getActiveBranchDetails } from "./core/data-access.js";
import { mountTopbarDateClock, renderSidebarNav, renderSummaryStrip, setPageMeta } from "./shared/ui.js";
import { createPageLoadingController } from "./shared/page-loading.js";
import { renderAuditorDashboard, renderAuditorTrialBalance } from "./dashboards/auditor-dashboard.js";
import { renderReports } from "./modules/reports/reports.js";
import { renderAuditLog } from "./modules/audit/audit-log.js";
import { renderGeneralLedgers } from "./modules/general-ledgers/general-ledgers.js";
import { renderAssets } from "./modules/assets/assets.js";
import { renderPayroll } from "./modules/payroll/payroll.js";
import { getBranchesForCurrentBusiness } from "./modules/branches/branches-service.js";
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
        case "trialBalance":
            return await renderAuditorTrialBalance({ branchScope: scope });
        case "generalLedgers":
            return await renderGeneralLedgers({ branchScope: scope });
        case "payroll":
            return await renderPayroll(session.role, { branchScope: scope });
        case "reports":
            return await renderReports(session.role, { branchScope: scope });
        case "assets":
            return await renderAssets({ branchScope: scope });
        case "audit":
            return { summary: [], content: await renderAuditLog() };
        case "dashboard":
        default:
            return await renderAuditorDashboard({ branchScope: scope });
    }
}

export async function initAuditorShell() {
    const session = await getCurrentSessionContext();
    if (!session) {
        window.location.href = `./login.html${getPreservedSearch()}`;
        return;
    }

    if (session.role !== ROLES.AUDITOR && session.role !== ROLES.ACCOUNT) {
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
        <select data-account-branch-scope></select>
    `;
    signOutButton?.parentElement?.insertBefore(scopeWidget, signOutButton);
    const scopeSelect = scopeWidget.querySelector("[data-account-branch-scope]");

    const navItems = getEnabledRoutesForRole(session.role, session.featureKeys)
        || ROLE_NAV[session.role]
        || ROLE_NAV[ROLES.ACCOUNT]
        || ROLE_NAV[ROLES.AUDITOR];
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
        let assignedBranchId = "";
        let assignedBranchName = "Active Branch";
        let assignedHeadOffice = false;

        try {
            const [branches, activeBranch] = await Promise.all([
                getBranchesForCurrentBusiness(),
                getActiveBranchDetails(session.userId, session.businessId)
            ]);
            scopeBranches = (branches || []).filter((branch) => branch.isActive !== false || branch.isHeadOffice);
            assignedBranchId = String(activeBranch?.id || "").trim();
            assignedBranchName = String(activeBranch?.name || "").trim() || "Active Branch";
            assignedHeadOffice = Boolean(activeBranch?.canAccessAllBranches);
        } catch {
            scopeBranches = [];
        }

        const assignedBranch = scopeBranches.find((branch) => String(branch.id || "") === assignedBranchId);
        const canSelectAll = assignedHeadOffice || Boolean(assignedBranch?.isHeadOffice);

        if (!canSelectAll) {
            const lockedBranchId = assignedBranchId || scopeBranches[0]?.id || "";
            const lockedBranchName = assignedBranchName || scopeBranches[0]?.name || "Active Branch";
            scopeState = saveBranchScope(lockedBranchId);
            if (scopeSelect) {
                scopeSelect.innerHTML = `<option value="${lockedBranchId}">${lockedBranchName}</option>`;
                scopeSelect.value = lockedBranchId;
                scopeSelect.disabled = true;
            }
            if (activeBranchIndicator) {
                activeBranchIndicator.textContent = `Active Branch: ${lockedBranchName}`;
                activeBranchIndicator.classList.remove("is-all");
                activeBranchIndicator.classList.add("is-single");
            }
            return {
                branchId: lockedBranchId,
                selectedBranchId: lockedBranchId,
                label: lockedBranchName,
                canSelectAll: false,
                isLocked: true,
                appliesToAll: false
            };
        }

        const resolved = resolveBranchScope(scopeState.branchId, scopeBranches);
        scopeState = saveBranchScope(resolved.selectedBranchId);
        if (scopeSelect) {
            scopeSelect.innerHTML = `
                ${scopeBranches.map((branch) => `<option value="${branch.id}">${branch.name}</option>`).join("")}
            `;
            scopeSelect.value = resolved.selectedBranchId;
            scopeSelect.disabled = false;
        }
        if (activeBranchIndicator) {
            activeBranchIndicator.textContent = `Active Branch: ${resolved.label}`;
            activeBranchIndicator.classList.toggle("is-all", resolved.appliesToAll);
            activeBranchIndicator.classList.toggle("is-single", !resolved.appliesToAll);
        }

        return {
            branchId: resolved.branchId,
            selectedBranchId: resolved.selectedBranchId,
            label: resolved.label,
            canSelectAll: true,
            isLocked: false,
            appliesToAll: resolved.appliesToAll
        };
    }

    async function refresh() {
        loading.show();
        try {
            const scope = await loadScopeBranches();
            const targetRoute = ensureRoute(session.role, getRouteFromHash() || getDefaultRouteForRoutes(navItems), navItems);
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
                pageTitle.textContent = "Account Dashboard";
            }

            const rendered = await renderRoute(targetRoute, session, scope);
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
        if (scopeSelect.disabled) {
            return;
        }
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

initAuditorShell();
