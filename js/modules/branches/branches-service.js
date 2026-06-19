import { getCurrentSessionContext } from "../../core/session.js";
import { getSupabaseClient } from "../../core/supabase-client.js";
import { ROLES } from "../../core/roles.js";

function isMissingColumnError(error, columnName) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "PGRST204" || message.includes(columnName) || details.includes(columnName);
}

function isDuplicateBranchNameError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    const hint = String(error?.hint || "").toLowerCase();
    return code === "23505"
        || message.includes("duplicate key")
        || details.includes("already exists")
        || hint.includes("unique")
        || message.includes("branches_business_id_name_key");
}

function toPositiveInteger(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    const rounded = Math.floor(parsed);
    return rounded > 0 ? rounded : null;
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

async function getBusinessBranchLimit(supabase, businessId) {
    const { data, error } = await supabase
        .from("businesses")
        .select("max_branches")
        .eq("id", businessId)
        .maybeSingle();

    if (error) {
        if (isMissingColumnError(error, "max_branches")) {
            return null;
        }
        throw error;
    }

    return toPositiveInteger(data?.max_branches);
}

export async function getBranchesForCurrentBusiness() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return [];
    }

    let { data, error } = await supabase
        .from("branches")
        .select("id, name, code, is_head_office, is_active, created_at")
        .eq("business_id", session.businessId)
        .order("created_at", { ascending: false });

    if (error && isMissingColumnError(error, "is_active")) {
        const fallback = await supabase
            .from("branches")
            .select("id, name, code, is_head_office, created_at")
            .eq("business_id", session.businessId)
            .order("created_at", { ascending: false });
        data = (fallback.data || []).map((item) => ({ ...item, is_active: true }));
        error = fallback.error;
    }

    if (error) {
        throw error;
    }

    return (data || []).map((branch) => ({
        id: branch.id,
        name: branch.name || "",
        code: branch.code || "",
        isHeadOffice: Boolean(branch.is_head_office),
        isActive: branch.is_active === undefined ? true : Boolean(branch.is_active),
        createdAt: branch.created_at || null
    }));
}

export async function getBranchesForCurrentBusinessByScope(branchId = "") {
    const branches = await getBranchesForCurrentBusiness();
    const normalized = String(branchId || "").trim();
    if (!normalized || normalized === "__all__") {
        return branches;
    }
    return branches.filter((branch) => String(branch.id || "") === normalized);
}

export async function getBranchCapacityForCurrentBusiness() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return {
            used: 0,
            limit: null,
            remaining: null
        };
    }

    const branches = await getBranchesForCurrentBusiness();
    const limit = await getBusinessBranchLimit(supabase, session.businessId);
    const used = branches.length;
    const remaining = Number.isFinite(limit) ? Math.max(limit - used, 0) : null;

    return {
        used,
        limit,
        remaining
    };
}

export async function getNextBranchCodeForCurrentBusiness() {
    const branches = await getBranchesForCurrentBusiness();
    const maxSequence = branches.reduce((max, branch) => {
        const sequence = toBranchSequence(branch.code);
        return sequence > max ? sequence : max;
    }, 0);

    return formatBranchCode(maxSequence + 1);
}

export async function createBranchForCurrentBusiness(payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }

    if (session.role !== ROLES.BUSINESS_ADMIN) {
        throw new Error("Only Admin can create branches.");
    }

    const name = String(payload.name || "").trim();
    const requestedHeadOffice = Boolean(payload.is_head_office);

    if (!name) {
        throw new Error("Branch name is required.");
    }

    const branches = await getBranchesForCurrentBusiness();
    const limit = await getBusinessBranchLimit(supabase, session.businessId);
    if (Number.isFinite(limit) && branches.length >= limit) {
        throw new Error(`Branch limit reached (${limit}). Increase allowed branches first.`);
    }

    const hasHeadOffice = branches.some((branch) => branch.isHeadOffice);
    const isHeadOffice = requestedHeadOffice && !hasHeadOffice;
    const code = await getNextBranchCodeForCurrentBusiness();

    const { error } = await supabase
        .from("branches")
        .insert({
            business_id: session.businessId,
            name,
            code,
            is_head_office: isHeadOffice,
            is_active: true
        });

    if (error && isMissingColumnError(error, "is_active")) {
        const fallback = await supabase
            .from("branches")
            .insert({
                business_id: session.businessId,
                name,
                code,
                is_head_office: isHeadOffice
            });
        error = fallback.error;
    }

    if (error) {
        if (isDuplicateBranchNameError(error)) {
            throw new Error("Branch name already exists for this organization. Use a different branch name.");
        }
        throw error;
    }

    return true;
}
