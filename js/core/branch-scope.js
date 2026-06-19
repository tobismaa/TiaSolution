const STORAGE_KEY = "tia_admin_branch_scope_v1";
const ALL_BRANCHES_VALUE = "__all__";
let branchScopeMemory = { branchId: "" };

export function getAllBranchesScopeValue() {
    return ALL_BRANCHES_VALUE;
}

export function getStoredBranchScope() {
    const branchId = String(branchScopeMemory.branchId || "").trim();
    return { branchId: branchId === ALL_BRANCHES_VALUE ? "" : branchId };
}

export function saveBranchScope(branchId) {
    const normalized = String(branchId || "").trim();
    branchScopeMemory = { branchId: normalized };
    return branchScopeMemory;
}

export function resolveBranchScope(branchId, branches) {
    const available = Array.isArray(branches) ? branches : [];
    const normalized = String(branchId || "").trim();
    const selected = available.find((branch) => String(branch.id || "") === normalized)
        || available.find((branch) => Boolean(branch.isHeadOffice))
        || available[0]
        || null;

    if (!selected) {
        return {
            selectedBranchId: "",
            branchId: "",
            label: "Head Office",
            appliesToAll: true
        };
    }

    const selectedBranchId = String(selected.id || "").trim();
    const appliesToAll = Boolean(selected.isHeadOffice);

    return {
        selectedBranchId,
        branchId: appliesToAll ? "" : selectedBranchId,
        label: selected.name || "Selected Branch",
        appliesToAll
    };
}
