import { getSupabaseClient } from "./supabase-client.js";
import { ROLES } from "./roles.js";

export async function getPlatformAdminRole(userId) {
    const supabase = getSupabaseClient();
    if (!supabase || !userId) {
        return "";
    }

    const { data, error } = await supabase
        .from("platform_admins")
        .select("role")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

    if (error) {
        return "";
    }

    return String(data?.role || "").trim().toLowerCase();
}

export async function getPlatformAdminStatus(userId) {
    const role = await getPlatformAdminRole(userId);
    return role === ROLES.SUPER_ADMIN;
}

export async function getBusinessMembership(userId) {
    const supabase = getSupabaseClient();
    if (!supabase || !userId) {
        return null;
    }

    const { data, error } = await supabase
        .from("business_members")
        .select(`
            role,
            business_id,
            branch_id,
            businesses (
                id,
                name,
                subscription_status
            )
        `)
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

    if (error) {
        return null;
    }

    if (!data) {
        return null;
    }

    return {
        role: data.role || ROLES.BUSINESS_ADMIN,
        businessId: data.business_id,
        branchId: data.branch_id || "",
        businessName: data.businesses?.name || "Tia Business Workspace",
        subscriptionLabel: data.businesses?.subscription_status || "Live"
    };
}

function isMissingFeatureTableError(error, tableName) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    return code === "42P01" || message.includes(tableName);
}

function isMissingColumnError(error, columnName) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "PGRST204" || message.includes(columnName) || details.includes(columnName);
}

function mapEnabledFeatureKeys(rows = []) {
    return (rows || [])
        .filter((item) => item.is_enabled !== false)
        .sort((left, right) => {
            const leftOrder = Number.isFinite(Number(left.sort_order)) ? Number(left.sort_order) : Number.MAX_SAFE_INTEGER;
            const rightOrder = Number.isFinite(Number(right.sort_order)) ? Number(right.sort_order) : Number.MAX_SAFE_INTEGER;
            return leftOrder - rightOrder;
        })
        .map((item) => String(item.feature_key || "").trim())
        .filter(Boolean);
}

export async function getBusinessFeatureKeys(businessId) {
    const supabase = getSupabaseClient();
    if (!supabase || !businessId) {
        return null;
    }

    let { data, error } = await supabase
        .from("business_features")
        .select("feature_key, is_enabled, sort_order")
        .eq("business_id", businessId)
        .order("sort_order", { ascending: true, nullsFirst: false });

    if (error && isMissingColumnError(error, "sort_order")) {
        const fallback = await supabase
            .from("business_features")
            .select("feature_key, is_enabled")
            .eq("business_id", businessId);
        data = fallback.data;
        error = fallback.error;
    }

    if (error) {
        if (isMissingFeatureTableError(error, "business_features")) {
            return null;
        }
        return null;
    }

    return mapEnabledFeatureKeys(data || []);
}

export async function getEffectiveBusinessFeatureKeys(businessId, branchId = "") {
    const supabase = getSupabaseClient();
    const organizationFeatureKeys = await getBusinessFeatureKeys(businessId);
    if (!supabase || !businessId || !Array.isArray(organizationFeatureKeys)) {
        return organizationFeatureKeys;
    }

    const normalizedBranchId = String(branchId || "").trim();
    if (!normalizedBranchId) {
        return organizationFeatureKeys;
    }

    let { data, error } = await supabase
        .from("branch_features")
        .select("feature_key, is_enabled, sort_order")
        .eq("business_id", businessId)
        .eq("branch_id", normalizedBranchId)
        .order("sort_order", { ascending: true, nullsFirst: false });

    if (error && isMissingColumnError(error, "sort_order")) {
        const fallback = await supabase
            .from("branch_features")
            .select("feature_key, is_enabled")
            .eq("business_id", businessId)
            .eq("branch_id", normalizedBranchId);
        data = fallback.data;
        error = fallback.error;
    }

    if (error) {
        if (isMissingFeatureTableError(error, "branch_features")) {
            return organizationFeatureKeys;
        }
        return organizationFeatureKeys;
    }

    const branchRows = data || [];
    if (!branchRows.length) {
        return organizationFeatureKeys;
    }

    const organizationFeatureKeySet = new Set(organizationFeatureKeys);
    return mapEnabledFeatureKeys(branchRows).filter((featureKey) => organizationFeatureKeySet.has(featureKey));
}

export async function getProfileName(userId) {
    const supabase = getSupabaseClient();
    if (!supabase || !userId) {
        return null;
    }

    const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();

    if (error) {
        return null;
    }

    return data?.full_name || null;
}

export async function getActiveBranchDetails(userId, businessId) {
    const supabase = getSupabaseClient();
    if (!supabase || !userId || !businessId) {
        return { id: "", name: "Head Office", isHeadOffice: true, canAccessAllBranches: true };
    }

    let { data: member, error: memberError } = await supabase
        .from("business_members")
        .select("branch_id, branches(name, is_head_office)")
        .eq("user_id", userId)
        .eq("business_id", businessId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

    if (memberError) {
        const fallback = await supabase
            .from("business_members")
            .select("branch_id")
            .eq("user_id", userId)
            .eq("business_id", businessId)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();
        member = fallback.data ? { ...fallback.data, branches: null } : fallback.data;
        memberError = fallback.error;
    }

    if (memberError) {
        throw memberError;
    }

    const memberBranchId = String(member?.branch_id || "").trim();
    if (memberBranchId) {
        let branchName = String(member?.branches?.name || "").trim();
        if (!branchName) {
            const byId = await supabase
                .from("branches")
                .select("name, is_head_office")
                .eq("id", memberBranchId)
                .eq("business_id", businessId)
                .maybeSingle();
            if (!byId.error) {
                branchName = String(byId.data?.name || "").trim();
                const isHeadOffice = Boolean(byId.data?.is_head_office);
                return {
                    id: memberBranchId,
                    name: branchName || "Active Branch",
                    isHeadOffice,
                    canAccessAllBranches: isHeadOffice
                };
            }
        }
        const isHeadOffice = Boolean(member?.branches?.is_head_office);
        return {
            id: memberBranchId,
            name: branchName || "Active Branch",
            isHeadOffice,
            canAccessAllBranches: isHeadOffice
        };
    }

    const headOffice = await supabase
        .from("branches")
        .select("id, name, is_head_office")
        .eq("business_id", businessId)
        .eq("is_head_office", true)
        .limit(1)
        .maybeSingle();

    if (!headOffice.error && headOffice.data?.id) {
        return {
            id: String(headOffice.data.id),
            name: String(headOffice.data.name || "Head Office"),
            isHeadOffice: true,
            canAccessAllBranches: true
        };
    }

    return { id: "", name: "Head Office", isHeadOffice: true, canAccessAllBranches: true };
}
