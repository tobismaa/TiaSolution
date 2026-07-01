import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { supabaseConfig } from "../../core/supabase-config.js";
import { getBusinesses } from "../businesses/businesses-service.js";

export const PLATFORM_USER_ROLES = [
    { value: "super_admin", label: "Super Admin" },
    { value: "business_admin", label: "Admin" },
    { value: "manager", label: "Head of Operations" },
    { value: "staff", label: "Operations" },
    { value: "account", label: "Account" },
    { value: "auditor", label: "Audit" }
];

export const ORGANIZATION_USER_ROLES = [
    { value: "business_admin", label: "Admin" },
    { value: "manager", label: "Head of Operations" },
    { value: "staff", label: "Operations" },
    { value: "account", label: "Account" },
    { value: "auditor", label: "Audit" }
];

function isMissingColumnError(error, columnName) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "PGRST204" || message.includes(columnName) || details.includes(columnName);
}

function toBranchSequence(code) {
    const text = String(code || "").trim().toUpperCase();
    const match = text.match(/(\d+)$/);
    if (!match) {
        return 0;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatBranchCode(sequence) {
    return `BR-${String(sequence).padStart(3, "0")}`;
}

async function ensureHeadOfficeBranch(supabase, businessId) {
    let { data: branches, error } = await supabase
        .from("branches")
        .select("id, name, code, is_head_office")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true });

    if (error) {
        throw error;
    }

    const rows = branches || [];
    const existingHeadOffice = rows.find((branch) => Boolean(branch.is_head_office));
    if (existingHeadOffice?.id) {
        return existingHeadOffice.id;
    }

    const namedHeadOffice = rows.find((branch) => String(branch.name || "").trim().toLowerCase() === "head office");
    if (namedHeadOffice?.id) {
        const { error: updateError } = await supabase
            .from("branches")
            .update({ is_head_office: true })
            .eq("business_id", businessId)
            .eq("id", namedHeadOffice.id);
        if (updateError) {
            throw updateError;
        }
        return namedHeadOffice.id;
    }

    const maxSequence = rows.reduce((max, row) => {
        const sequence = toBranchSequence(row.code);
        return sequence > max ? sequence : max;
    }, 0);
    const nextCode = formatBranchCode(maxSequence + 1);

    let { data: inserted, error: insertError } = await supabase
        .from("branches")
        .insert({
            business_id: businessId,
            name: "Head Office",
            code: nextCode,
            is_head_office: true,
            is_active: true
        })
        .select("id")
        .single();

    if (insertError && isMissingColumnError(insertError, "is_active")) {
        const fallback = await supabase
            .from("branches")
            .insert({
                business_id: businessId,
                name: "Head Office",
                code: nextCode,
                is_head_office: true
            })
            .select("id")
            .single();
        inserted = fallback.data;
        insertError = fallback.error;
    }

    if (insertError) {
        throw insertError;
    }

    return inserted?.id || null;
}

async function getHeadOfficeBranchName(supabase, businessId) {
    if (!supabase || !businessId) {
        return "";
    }

    const { data, error } = await supabase
        .from("branches")
        .select("name")
        .eq("business_id", businessId)
        .eq("is_head_office", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) {
        return "";
    }

    return String(data?.name || "").trim();
}

function isPlatformRoleConstraintError(error) {
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    const hint = String(error?.hint || "").toLowerCase();
    return message.includes("platform_admins_role_check")
        || details.includes("platform_admins_role_check")
        || hint.includes("platform_admins_role_check");
}

function resolveUserRole(platformRole, businessRole) {
    const normalizedPlatformRole = String(platformRole || "").trim().toLowerCase();
    const normalizedBusinessRole = String(businessRole || "").trim().toLowerCase();

    // If platform role is only the fallback super_admin, prefer the organization role.
    if (normalizedPlatformRole === "super_admin" && normalizedBusinessRole) {
        return normalizedBusinessRole;
    }

    return normalizedPlatformRole || normalizedBusinessRole || "staff";
}

function getSignupClient() {
    if (!window.supabase?.createClient) {
        return null;
    }

    return window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        }
    });
}

export async function getOrganizationsForUserOnboarding() {
    const session = await getCurrentSessionContext();
    if (session?.role !== "super_admin") {
        return [];
    }

    const businesses = await getBusinesses();
    return businesses
        .map((item) => ({
            id: item.id,
            name: item.name || "Unnamed organization"
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getBranchesForUserOnboarding(options = {}) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || session?.role !== "business_admin" || !session?.businessId) {
        return [];
    }

    await ensureHeadOfficeBranch(supabase, session.businessId);

    let { data, error } = await supabase
        .from("branches")
        .select("id, name, is_active, is_head_office")
        .eq("business_id", session.businessId)
        .order("name", { ascending: true });

    if (error && isMissingColumnError(error, "is_active")) {
        const fallback = await supabase
            .from("branches")
            .select("id, name, is_head_office")
            .eq("business_id", session.businessId)
            .order("name", { ascending: true });
        data = (fallback.data || []).map((item) => ({ ...item, is_active: true }));
        error = fallback.error;
    }

    if (error) {
        throw error;
    }

    const rows = (data || [])
        // Keep Head Office always visible in dropdown; other branches remain active-only.
        .filter((branch) => branch.is_active !== false || Boolean(branch.is_head_office))
        .map((branch) => ({
            id: branch.id,
            name: branch.name || "Unnamed branch",
            isHeadOffice: Boolean(branch.is_head_office)
        }));

    rows.sort((a, b) => {
        if (a.isHeadOffice && !b.isHeadOffice) return -1;
        if (!a.isHeadOffice && b.isHeadOffice) return 1;
        return a.name.localeCompare(b.name);
    });

    const scopeBranchId = String(options.branchId || "").trim();
    const scopedRows = !scopeBranchId
        ? rows
        : rows.filter((branch) => String(branch.id || "") === scopeBranchId);

    return scopedRows.map((branch) => ({
        id: branch.id,
        name: branch.name
    }));
}

export async function getUsers(options = {}) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase) {
        return [];
    }

    if (session?.role === "super_admin") {
        const [
            { data: profiles, error: profilesError },
            { data: platformAdmins, error: platformAdminsError },
            { data: businessMembers, error: businessMembersError }
        ] = await Promise.all([
            supabase
                .from("profiles")
                .select("id, full_name, email, created_at")
                .order("created_at", { ascending: false }),
            supabase
                .from("platform_admins")
                .select("user_id, created_at, is_active, role"),
            supabase
                .from("business_members")
                .select(`
                    user_id,
                    created_at,
                    is_active,
                    role,
                    businesses (
                        name
                    )
                `)
        ]);

        if (profilesError) {
            throw profilesError;
        }
        if (platformAdminsError) {
            throw platformAdminsError;
        }
        if (businessMembersError) {
            throw businessMembersError;
        }

        const platformMap = new Map((platformAdmins || []).map((item) => [item.user_id, item]));
        const businessMap = new Map();
        (businessMembers || []).forEach((member) => {
            const existing = businessMap.get(member.user_id);
            if (!existing || (existing.is_active !== true && member.is_active === true)) {
                businessMap.set(member.user_id, member);
            }
        });

        return (profiles || []).map((profile) => {
            const platformUser = platformMap.get(profile.id);
            const businessUser = businessMap.get(profile.id);
            const role = resolveUserRole(platformUser?.role, businessUser?.role);
            const usingBusinessRole = role === String(businessUser?.role || "").toLowerCase() && Boolean(businessUser?.role);
            const isActive = usingBusinessRole
                ? Boolean(businessUser?.is_active)
                : platformUser
                    ? Boolean(platformUser.is_active)
                    : businessUser
                        ? Boolean(businessUser.is_active)
                        : true;

            return {
                id: profile.id,
                name: profile.full_name || "User",
                email: profile.email || "",
                organizationName: businessUser?.businesses?.name || "",
                role,
                status: isActive ? "Active" : "Inactive",
                createdAt: profile.created_at || platformUser?.created_at || businessUser?.created_at || null
            };
        });
    }

    if (!session?.businessId) {
        return [];
    }

    let { data, error } = await supabase
        .from("business_members")
        .select(`
            user_id,
            role,
            is_active,
            branch_id,
            profiles (
                full_name,
                email
            ),
            branches (
                name
            )
        `)
        .eq("business_id", session.businessId)
        .order("created_at", { ascending: false });

    if (error && isMissingColumnError(error, "branch_id")) {
        const fallback = await supabase
            .from("business_members")
            .select(`
                user_id,
                role,
                is_active,
                profiles (
                    full_name,
                    email
                )
            `)
            .eq("business_id", session.businessId)
            .order("created_at", { ascending: false });
        data = (fallback.data || []).map((item) => ({ ...item, branch_id: "", branches: null }));
        error = fallback.error;
    }

    if (error) {
        throw error;
    }

    const scopeBranchId = String(options.branchId || "").trim();
    let headOfficeBranchId = "";
    if (scopeBranchId) {
        const headOfficeLookup = await supabase
            .from("branches")
            .select("id")
            .eq("business_id", session.businessId)
            .eq("is_head_office", true)
            .limit(1)
            .maybeSingle();
        headOfficeBranchId = String(headOfficeLookup.data?.id || "");
    }

    const scopedRows = !scopeBranchId
        ? (data || [])
        : (data || []).filter((user) => {
            const memberBranchId = String(user.branch_id || "");
            const role = String(user.role || "").toLowerCase();
            if (memberBranchId === scopeBranchId) {
                return true;
            }
            // Legacy fallback: show admin under head office scope even if branch link is missing.
            return role === "business_admin" && !memberBranchId && headOfficeBranchId === scopeBranchId;
        });

    const headOfficeName = await getHeadOfficeBranchName(supabase, session.businessId);

    return scopedRows.map((user) => ({
        id: user.user_id,
        name: user.profiles?.full_name || "Business User",
        email: user.profiles?.email || "",
        role: user.role,
        branchId: user.branch_id || "",
        branchName: user.branches?.name || (String(user.role || "").toLowerCase() === "business_admin" ? headOfficeName : ""),
        status: user.is_active ? "Active" : "Inactive"
    }));
}

export async function createOrganizationUser(payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }

    if (session.role !== "business_admin") {
        throw new Error("Only Admin can create organization users.");
    }

    const fullName = String(payload.full_name || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const role = String(payload.role || "staff").trim().toLowerCase();
    const isActive = Boolean(payload.is_active);
    let branchId = String(payload.branch_id || "").trim();
    const allowedBusinessMemberRoles = new Set(["business_admin", "manager", "staff", "account", "auditor"]);

    if (!fullName || !email || !password) {
        throw new Error("Please complete the required user fields.");
    }

    if (!allowedBusinessMemberRoles.has(role)) {
        throw new Error("Select a valid organization role.");
    }

    if (role === "business_admin") {
        branchId = await ensureHeadOfficeBranch(supabase, session.businessId);
    }

    const signupClient = getSignupClient();
    if (!signupClient) {
        throw new Error("Supabase signup client is unavailable.");
    }

    const { data: signUpData, error: signUpError } = await signupClient.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: fullName,
                role,
                platform_role: "",
                business_id: session.businessId,
                business_name: session.businessName || "Organization Workspace",
                subscription: "Live"
            }
        }
    });

    if (signUpError) {
        throw signUpError;
    }

    const userId = signUpData?.user?.id;
    if (!userId) {
        throw new Error("Unable to create the organization user login.");
    }

    let { error: memberError } = await supabase
        .from("business_members")
        .upsert({
            business_id: session.businessId,
            user_id: userId,
            role,
            is_active: isActive,
            branch_id: branchId || null
        }, {
            onConflict: "business_id,user_id"
        });

    if (memberError && isMissingColumnError(memberError, "branch_id")) {
        const fallback = await supabase
            .from("business_members")
            .upsert({
                business_id: session.businessId,
                user_id: userId,
                role,
                is_active: isActive
            }, {
                onConflict: "business_id,user_id"
            });
        memberError = fallback.error;
    }

    if (memberError) {
        throw memberError;
    }

    const { error: profileUpsertError } = await supabase
        .from("profiles")
        .upsert({
            id: userId,
            full_name: fullName,
            email
        }, {
            onConflict: "id"
        });

    if (profileUpsertError) {
        throw profileUpsertError;
    }

    return true;
}

export async function getBusinessUserById(userId) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || session?.role !== "business_admin" || !session?.businessId || !userId) {
        return null;
    }

    let { data, error } = await supabase
        .from("business_members")
        .select(`
            user_id,
            business_id,
            role,
            is_active,
            branch_id,
            created_at,
            profiles (
                full_name,
                email
            ),
            branches (
                name
            )
        `)
        .eq("business_id", session.businessId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error && isMissingColumnError(error, "branch_id")) {
        const fallback = await supabase
            .from("business_members")
            .select(`
                user_id,
                business_id,
                role,
                is_active,
                created_at,
                profiles (
                    full_name,
                    email
                )
            `)
            .eq("business_id", session.businessId)
            .eq("user_id", userId)
            .maybeSingle();
        data = fallback.data ? { ...fallback.data, branch_id: "", branches: null } : fallback.data;
        error = fallback.error;
    }

    if (error) {
        throw error;
    }
    if (!data) {
        return null;
    }

    const headOfficeName = await getHeadOfficeBranchName(supabase, session.businessId);

    return {
        id: data.user_id,
        name: data.profiles?.full_name || "Business User",
        email: data.profiles?.email || "",
        businessId: data.business_id || "",
        role: data.role || "staff",
        branchId: data.branch_id || "",
        branchName: data.branches?.name || (String(data.role || "").toLowerCase() === "business_admin" ? headOfficeName : ""),
        status: data.is_active ? "Active" : "Inactive",
        createdAt: data.created_at || null
    };
}

export async function getOrganizationUsersForPlatform(businessId) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || session?.role !== "super_admin" || !businessId) {
        return [];
    }

    let { data, error } = await supabase
        .from("business_members")
        .select(`
            user_id,
            role,
            is_active,
            branch_id,
            created_at,
            profiles (
                full_name,
                email
            ),
            branches (
                name
            )
        `)
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });

    if (error && isMissingColumnError(error, "branch_id")) {
        const fallback = await supabase
            .from("business_members")
            .select(`
                user_id,
                role,
                is_active,
                created_at,
                profiles (
                    full_name,
                    email
                )
            `)
            .eq("business_id", businessId)
            .order("created_at", { ascending: false });
        data = (fallback.data || []).map((item) => ({ ...item, branch_id: "", branches: null }));
        error = fallback.error;
    }

    if (error) {
        throw error;
    }

    const headOfficeName = await getHeadOfficeBranchName(supabase, businessId);

    return (data || []).map((user) => ({
        id: user.user_id,
        name: user.profiles?.full_name || "Business User",
        email: user.profiles?.email || "",
        role: user.role,
        branchId: user.branch_id || "",
        branchName: user.branches?.name || (String(user.role || "").toLowerCase() === "business_admin" ? headOfficeName : ""),
        status: user.is_active ? "Active" : "Inactive",
        createdAt: user.created_at || null
    }));
}

export async function updateBusinessUserDetails(userId, payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || session?.role !== "business_admin" || !session?.businessId || !userId) {
        throw new Error("Unable to update organization user.");
    }

    const fullName = String(payload.full_name || "").trim();
    const role = String(payload.role || "staff").trim().toLowerCase();
    let branchId = String(payload.branch_id || "").trim();
    const isActive = Boolean(payload.is_active);
    const allowedBusinessMemberRoles = new Set(["business_admin", "manager", "staff", "account", "auditor"]);

    if (!fullName) {
        throw new Error("Please provide a full name.");
    }

    if (!allowedBusinessMemberRoles.has(role)) {
        throw new Error("Select a valid organization role.");
    }

    if (role === "business_admin") {
        branchId = await ensureHeadOfficeBranch(supabase, session.businessId);
    }

    const { error: profileError } = await supabase
        .from("profiles")
        .upsert({
            id: userId,
            full_name: fullName
        }, {
            onConflict: "id"
        });

    if (profileError) {
        throw profileError;
    }

    let { error: memberError } = await supabase
        .from("business_members")
        .update({
            role,
            is_active: isActive,
            branch_id: branchId || null
        })
        .eq("business_id", session.businessId)
        .eq("user_id", userId);

    if (memberError && isMissingColumnError(memberError, "branch_id")) {
        const fallback = await supabase
            .from("business_members")
            .update({
                role,
                is_active: isActive
            })
            .eq("business_id", session.businessId)
            .eq("user_id", userId);
        memberError = fallback.error;
    }

    if (memberError) {
        throw memberError;
    }

    return true;
}

export async function createPlatformUser(payload) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const fullName = String(payload.full_name || "").trim();
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "");
    const isActive = Boolean(payload.is_active);
    const role = String(payload.role || "super_admin").trim() || "super_admin";
    const businessId = String(payload.business_id || "").trim();
    let branchId = String(payload.branch_id || "").trim();

    if (!fullName || !email || !password) {
        throw new Error("Please complete the required user fields.");
    }

    const signupClient = getSignupClient();
    if (!signupClient) {
        throw new Error("Supabase signup client is unavailable.");
    }

    const { data: signUpData, error: signUpError } = await signupClient.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: fullName,
                role,
                platform_role: role === "super_admin" ? "super_admin" : "",
                subscription: "Live"
            }
        }
    });

    if (signUpError) {
        throw signUpError;
    }

    const userId = signUpData?.user?.id;
    if (!userId) {
        throw new Error("Unable to create the platform user login.");
    }

    if (role === "super_admin") {
        const { error: platformAdminError } = await supabase
            .from("platform_admins")
            .upsert({
                user_id: userId,
                is_active: isActive,
                role: "super_admin"
            }, {
                onConflict: "user_id"
            });

        if (platformAdminError) {
            throw platformAdminError;
        }
    } else {
        const { error: platformAdminError } = await supabase
            .from("platform_admins")
            .upsert({
                user_id: userId,
                is_active: false,
                role: "super_admin"
            }, {
                onConflict: "user_id"
            });

        if (platformAdminError && !isPlatformRoleConstraintError(platformAdminError)) {
            throw platformAdminError;
        }
    }

    const allowedBusinessMemberRoles = new Set(["business_admin", "manager", "staff", "account", "auditor"]);
    if (businessId && allowedBusinessMemberRoles.has(role)) {
        if (role === "business_admin") {
            branchId = await ensureHeadOfficeBranch(supabase, businessId);
        }

        let { error: memberError } = await supabase
            .from("business_members")
            .upsert({
                business_id: businessId,
                user_id: userId,
                role,
                is_active: isActive,
                branch_id: branchId || null
            }, {
                onConflict: "business_id,user_id"
            });

        if (memberError && isMissingColumnError(memberError, "branch_id")) {
            const fallback = await supabase
                .from("business_members")
                .upsert({
                    business_id: businessId,
                    user_id: userId,
                    role,
                    is_active: isActive
                }, {
                    onConflict: "business_id,user_id"
                });
            memberError = fallback.error;
        }

        if (memberError) {
            throw memberError;
        }
    }

    return true;
}

export async function getPlatformUserById(userId) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || session?.role !== "super_admin" || !userId) {
        return null;
    }

    const [
        { data: profile, error: profileError },
        { data: platformAdmin, error: platformError },
        { data: businessMembers, error: businessError }
    ] = await Promise.all([
        supabase
            .from("profiles")
            .select("id, full_name, email, created_at")
            .eq("id", userId)
            .maybeSingle(),
        supabase
            .from("platform_admins")
            .select("user_id, created_at, is_active, role")
            .eq("user_id", userId)
            .maybeSingle(),
        supabase
            .from("business_members")
            .select(`
                user_id,
                business_id,
                created_at,
                is_active,
                role,
                businesses (
                    name
                )
            `)
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
    ]);

    if (profileError) {
        throw profileError;
    }
    if (platformError) {
        throw platformError;
    }
    if (businessError) {
        throw businessError;
    }

    const businessUser = (businessMembers || [])[0];
    if (!profile && !platformAdmin && !businessUser) {
        return null;
    }

    const role = resolveUserRole(platformAdmin?.role, businessUser?.role);
    const usingBusinessRole = role === String(businessUser?.role || "").toLowerCase() && Boolean(businessUser?.role);
    const isActive = usingBusinessRole
        ? Boolean(businessUser?.is_active)
        : platformAdmin
            ? Boolean(platformAdmin.is_active)
            : businessUser
                ? Boolean(businessUser.is_active)
                : true;

    return {
        id: userId,
        name: profile?.full_name || "User",
        email: profile?.email || "",
        businessId: businessUser?.business_id || "",
        organizationName: businessUser?.businesses?.name || "",
        role,
        status: isActive ? "Active" : "Inactive",
        createdAt: profile?.created_at || platformAdmin?.created_at || businessUser?.created_at || null
    };
}

export async function updatePlatformUserDetails(userId, payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || session?.role !== "super_admin" || !userId) {
        throw new Error("Unable to update the platform user.");
    }

    const fullName = String(payload.full_name || "").trim();
    const role = String(payload.role || "super_admin").trim() || "super_admin";
    const isActive = Boolean(payload.is_active);
    const businessId = String(payload.business_id || "").trim();
    let branchId = String(payload.branch_id || "").trim();
    const allowedBusinessMemberRoles = new Set(["business_admin", "manager", "staff", "account", "auditor"]);

    if (!fullName) {
        throw new Error("Please provide a full name.");
    }

    const { error: profileError } = await supabase
        .from("profiles")
        .upsert({
            id: userId,
            full_name: fullName
        }, {
            onConflict: "id"
        });

    if (profileError) {
        throw profileError;
    }

    if (role === "super_admin") {
        const { error: platformAdminError } = await supabase
            .from("platform_admins")
            .upsert({
                user_id: userId,
                is_active: isActive,
                role: "super_admin"
            }, {
                onConflict: "user_id"
            });

        if (platformAdminError) {
            throw platformAdminError;
        }

        return true;
    }

    if (!allowedBusinessMemberRoles.has(role)) {
        throw new Error("Unsupported role selected.");
    }

    const { error: platformAdminError } = await supabase
        .from("platform_admins")
        .upsert({
            user_id: userId,
            is_active: false,
            role: "super_admin"
        }, {
            onConflict: "user_id"
        });

    if (platformAdminError && !isPlatformRoleConstraintError(platformAdminError)) {
        throw platformAdminError;
    }

    let targetBusinessId = businessId;
    if (!targetBusinessId) {
        const { data: existingMembership, error: membershipError } = await supabase
            .from("business_members")
            .select("business_id")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (membershipError) {
            throw membershipError;
        }

        targetBusinessId = String(existingMembership?.business_id || "").trim();
    }

    if (!targetBusinessId) {
        throw new Error("Select an organization for this role.");
    }

    if (role === "business_admin") {
        branchId = await ensureHeadOfficeBranch(supabase, targetBusinessId);
    }

    const { error: deactivateOtherMembershipsError } = await supabase
        .from("business_members")
        .update({ is_active: false })
        .eq("user_id", userId)
        .neq("business_id", targetBusinessId);

    if (deactivateOtherMembershipsError) {
        throw deactivateOtherMembershipsError;
    }

    let { error: upsertMembershipError } = await supabase
        .from("business_members")
        .upsert({
            business_id: targetBusinessId,
            user_id: userId,
            role,
            is_active: isActive,
            branch_id: branchId || null
        }, {
            onConflict: "business_id,user_id"
        });

    if (upsertMembershipError && isMissingColumnError(upsertMembershipError, "branch_id")) {
        const fallback = await supabase
            .from("business_members")
            .upsert({
                business_id: targetBusinessId,
                user_id: userId,
                role,
                is_active: isActive
            }, {
                onConflict: "business_id,user_id"
            });
        upsertMembershipError = fallback.error;
    }

    if (upsertMembershipError) {
        throw upsertMembershipError;
    }

    return true;
}
