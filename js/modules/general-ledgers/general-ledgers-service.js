import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { ROLES } from "../../core/roles.js";

const ALLOWED_TYPES = new Set(["asset", "liability", "equity", "revenue", "expense"]);
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

export const GENERAL_LEDGER_TYPES = [
    { value: "asset", label: "Asset" },
    { value: "liability", label: "Liability" },
    { value: "equity", label: "Equity" },
    { value: "revenue", label: "Revenue" },
    { value: "expense", label: "Expense" }
];

const CATEGORY_CODE_START = {
    asset: 1010,
    liability: 2010,
    equity: 3010,
    revenue: 4010,
    expense: 5010
};

function getNormalSideForType(type) {
    const normalized = String(type || "").trim().toLowerCase();
    return normalized === "asset" || normalized === "expense" ? "debit" : "credit";
}

function isNumericCode(value) {
    return /^\d+$/.test(String(value || "").trim());
}

function compareCodes(left, right) {
    const a = String(left || "").trim();
    const b = String(right || "").trim();
    if (isNumericCode(a) && isNumericCode(b)) {
        return Number(a) - Number(b);
    }
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function mapGeneralTypeToChartType(type) {
    const normalized = String(type || "").trim().toLowerCase();
    return normalized === "revenue" ? "income" : normalized;
}

function mapChartTypeToGeneralType(type) {
    const normalized = String(type || "").trim().toLowerCase();
    return normalized === "income" ? "revenue" : normalized;
}

function isMissingTableError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return MISSING_TABLE_CODES.has(code)
        || message.includes("chart_of_accounts")
        || details.includes("chart_of_accounts");
}

function isMissingProductsTableError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return MISSING_TABLE_CODES.has(code)
        || message.includes("account_products")
        || details.includes("account_products");
}

function isMissingBranchColumnError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "PGRST204"
        || message.includes("branch_id")
        || details.includes("branch_id")
        || message.includes("branches");
}

function assertAccountRole(session) {
    if (session?.role !== ROLES.AUDITOR && session?.role !== ROLES.ACCOUNT) {
        throw new Error("Only Account role can manage general ledgers.");
    }
}

function mapChartAccountRow(item) {
    return {
        id: String(item.id || ""),
        code: String(item.code || ""),
        name: String(item.name || ""),
        accountType: mapChartTypeToGeneralType(item.account_type),
        parentAccountId: String(item.parent_account_id || ""),
        isActive: item.is_active !== false,
        createdAt: String(item.created_at || "")
    };
}

export async function getChartAccountsForSelection() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return [];
    }
    assertAccountRole(session);

    const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, code, name, account_type, parent_account_id, is_active, created_at")
        .eq("business_id", session.businessId)
        .eq("is_active", true)
        .order("code", { ascending: true });

    if (error) {
        throw error;
    }

    return (data || []).map(mapChartAccountRow);
}

async function getChartAccountsCatalog() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return [];
    }

    const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, code, name, account_type, parent_account_id, is_active, created_at")
        .eq("business_id", session.businessId)
        .eq("is_active", true)
        .order("code", { ascending: true });

    if (error) {
        throw error;
    }

    return (data || []).map(mapChartAccountRow);
}

export async function getNextGeneralLedgerCode(accountType, categoryName = "") {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return "";
    }
    assertAccountRole(session);

    const type = String(accountType || "").trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
        return "";
    }

    const normalizedCategoryName = String(categoryName || "").trim();
    if (!normalizedCategoryName) {
        return "";
    }

    const category = await getCategoryAccountByName(supabase, session.businessId, type, normalizedCategoryName);
    if (!category?.id) {
        return "";
    }

    return generateNextLedgerCodeForCategory(
        supabase,
        session.businessId,
        type,
        String(category.id || ""),
        String(category.code || "")
    );
}

export async function getGeneralLedgerAccounts() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return [];
    }
    assertAccountRole(session);

    const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("id, code, name, account_type, parent_account_id, is_active, created_at")
        .eq("business_id", session.businessId)
        .order("created_at", { ascending: false });

    if (error) {
        if (isMissingTableError(error)) {
            return [];
        }
        throw error;
    }

    const chartRows = data || [];
    const byId = new Map(chartRows.map((row) => [String(row.id || ""), row]));
    return chartRows
        .filter((row) => String(row.parent_account_id || "").trim())
        .map((row) => {
        const parentId = String(row.parent_account_id || "").trim();
        const parent = parentId ? byId.get(parentId) : null;
        return {
            id: String(row.id || ""),
            code: String(row.code || ""),
            name: String(row.name || ""),
            type: mapChartTypeToGeneralType(row.account_type),
            normalSide: getNormalSideForType(mapChartTypeToGeneralType(row.account_type)),
            branchId: "",
            branchName: "Head Office",
            status: row.is_active === false ? "Inactive" : "Active",
            createdAt: String(row.created_at || ""),
            categoryName: String(parent?.name || "")
        };
    });
}

export async function getAccountProducts() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return [];
    }
    assertAccountRole(session);
    return getAccountProductsCatalog();
}

export async function getAccountProductsCatalog() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return [];
    }

    const { data, error } = await supabase
        .from("account_products")
        .select(`
            id,
            product_name,
            product_gl_code,
            is_active,
            created_at,
            product_gl_account_id,
            parent_gl_account_id,
            general_overdraft_account_id
        `)
        .eq("business_id", session.businessId)
        .order("created_at", { ascending: false });

    if (error) {
        if (isMissingProductsTableError(error)) {
            return [];
        }
        throw error;
    }

    const chartAccounts = await getChartAccountsCatalog();
    const byId = new Map(chartAccounts.map((item) => [item.id, item]));

    return (data || []).map((item) => ({
        id: String(item.id || ""),
        name: String(item.product_name || ""),
        productGlCode: String(item.product_gl_code || ""),
        productGlAccountId: String(item.product_gl_account_id || ""),
        productGlName: byId.get(String(item.product_gl_account_id || ""))?.name || "",
        parentGlAccountId: String(item.parent_gl_account_id || ""),
        parentGlLabel: (() => {
            const parent = byId.get(String(item.parent_gl_account_id || ""));
            return parent ? `${parent.code} - ${parent.name}` : "-";
        })(),
        generalOverdraftAccountId: String(item.general_overdraft_account_id || ""),
        generalOverdraftLabel: (() => {
            const go = byId.get(String(item.general_overdraft_account_id || ""));
            return go ? `${go.code} - ${go.name}` : "-";
        })(),
        status: item.is_active === false ? "Inactive" : "Active",
        createdAt: String(item.created_at || "")
    }));
}

async function generateNextCategoryCode(supabase, businessId, accountType) {
    const base = Number(CATEGORY_CODE_START[accountType] || 9010);
    const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("code, parent_account_id")
        .eq("business_id", businessId)
        .eq("account_type", mapGeneralTypeToChartType(accountType))
        .is("parent_account_id", null);

    if (error) {
        throw error;
    }

    const maxCode = (data || []).reduce((max, row) => {
        const code = String(row?.code || "").trim();
        if (!/^\d{4}$/.test(code)) {
            return max;
        }
        const numericCode = Number(code);
        if (!Number.isFinite(numericCode) || numericCode < base) {
            return max;
        }
        return numericCode > max ? numericCode : max;
    }, base - 1);

    return String(maxCode + 1);
}

async function getCategoryAccountByName(supabase, businessId, accountType, categoryName) {
    const normalizedName = String(categoryName || "").trim();
    if (!normalizedName) {
        return null;
    }

    const chartType = mapGeneralTypeToChartType(accountType);
    const existing = await supabase
        .from("chart_of_accounts")
        .select("id, code, name")
        .eq("business_id", businessId)
        .eq("account_type", chartType)
        .is("parent_account_id", null)
        .ilike("name", normalizedName)
        .maybeSingle();

    if (existing.error) {
        throw existing.error;
    }

    return existing.data || null;
}

async function generateNextLedgerCodeForCategory(supabase, businessId, accountType, categoryAccountId, categoryCode) {
    const parentId = String(categoryAccountId || "").trim();
    const parentCode = String(categoryCode || "").trim();
    if (!parentId || !parentCode || !isNumericCode(parentCode)) {
        throw new Error("Select a valid category before creating a ledger.");
    }

    const chartType = mapGeneralTypeToChartType(accountType);
    const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("code")
        .eq("business_id", businessId)
        .eq("account_type", chartType)
        .eq("parent_account_id", parentId);

    if (error) {
        throw error;
    }

    const nextSequence = (data || []).reduce((max, row) => {
        const code = String(row?.code || "").trim();
        if (!code.startsWith(parentCode) || code === parentCode) {
            return max;
        }
        const suffix = code.slice(parentCode.length);
        const sequence = Number(suffix);
        if (!Number.isFinite(sequence)) {
            return max;
        }
        return sequence > max ? sequence : max;
    }, 0) + 1;

    return `${parentCode}${nextSequence}`;
}

async function generateNextLedgerCodeForParent(supabase, businessId, accountType, parentAccountId, parentCode) {
    const parentId = String(parentAccountId || "").trim();
    const codeSeed = String(parentCode || "").trim();
    if (!parentId || !codeSeed || !isNumericCode(codeSeed)) {
        throw new Error("Select a valid parent GL.");
    }

    const chartType = mapGeneralTypeToChartType(accountType);
    const { data, error } = await supabase
        .from("chart_of_accounts")
        .select("code")
        .eq("business_id", businessId)
        .eq("account_type", chartType)
        .eq("parent_account_id", parentId);

    if (error) {
        throw error;
    }

    const nextSequence = (data || []).reduce((max, row) => {
        const code = String(row?.code || "").trim();
        if (!code.startsWith(codeSeed) || code === codeSeed) {
            return max;
        }
        const suffix = code.slice(codeSeed.length);
        const sequence = Number(suffix);
        if (!Number.isFinite(sequence)) {
            return max;
        }
        return sequence > max ? sequence : max;
    }, 0) + 1;

    return `${codeSeed}${nextSequence}`;
}

async function ensureCategoryAccount(supabase, businessId, accountType, categoryName) {
    const normalizedName = String(categoryName || "").trim();
    if (!normalizedName) {
        return "";
    }

    const chartType = mapGeneralTypeToChartType(accountType);
    const existing = await getCategoryAccountByName(supabase, businessId, accountType, normalizedName);
    if (existing?.id) {
        return {
            id: String(existing.id),
            code: String(existing.code || ""),
            name: String(existing.name || normalizedName)
        };
    }

    const categoryCode = await generateNextCategoryCode(supabase, businessId, accountType);
    const inserted = await supabase
        .from("chart_of_accounts")
        .insert({
            business_id: businessId,
            code: categoryCode,
            name: normalizedName,
            account_type: chartType,
            is_active: true
        })
        .select("id, code, name")
        .single();

    if (inserted.error) {
        throw inserted.error;
    }

    return {
        id: String(inserted.data?.id || ""),
        code: String(inserted.data?.code || categoryCode),
        name: String(inserted.data?.name || normalizedName)
    };
}

async function createLedgerAndChartAccount(supabase, businessId, payload = {}) {
    const code = String(payload.code || "").trim();
    const name = String(payload.name || "").trim();
    const accountType = String(payload.accountType || "").trim().toLowerCase();
    const parentAccountId = String(payload.parentAccountId || "").trim();

    const chartInsert = await supabase
        .from("chart_of_accounts")
        .insert({
            business_id: businessId,
            code,
            name,
            account_type: mapGeneralTypeToChartType(accountType),
            parent_account_id: parentAccountId || null,
            is_active: true
        })
        .select("id, code, name")
        .single();

    if (chartInsert.error) {
        throw chartInsert.error;
    }

    return {
        id: String(chartInsert.data?.id || ""),
        code: String(chartInsert.data?.code || code),
        name: String(chartInsert.data?.name || name)
    };
}

export async function getGeneralLedgerCategories(accountType = "") {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return [];
    }
    assertAccountRole(session);

    const type = String(accountType || "").trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) {
        return [];
    }

    const chartType = mapGeneralTypeToChartType(type);
    const { data: chartRows, error: chartError } = await supabase
        .from("chart_of_accounts")
        .select("id, code, name, account_type, parent_account_id")
        .eq("business_id", session.businessId)
        .eq("account_type", chartType)
        .eq("is_active", true)
        .order("name", { ascending: true });

    if (chartError) {
        throw chartError;
    }

    const rows = chartRows || [];
    const parentIds = new Set(
        rows.map((row) => String(row.parent_account_id || "").trim()).filter(Boolean)
    );

    const categories = rows
        .filter((row) => {
            const id = String(row.id || "");
            const code = String(row.code || "").trim();
            return parentIds.has(id) || /^\d{4}$/.test(code);
        })
        .map((row) => ({
            id: String(row.id || ""),
            code: String(row.code || ""),
            name: String(row.name || "")
        }))
        .sort((a, b) => compareCodes(a.code, b.code) || a.name.localeCompare(b.name));

    return categories;
}

export async function createGeneralLedgerCategory(payload = {}) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    assertAccountRole(session);

    const type = String(payload.account_type || "").trim().toLowerCase();
    const categoryName = String(payload.category_name || "").trim();

    if (!ALLOWED_TYPES.has(type)) {
        throw new Error("Select a valid account type.");
    }
    if (!categoryName) {
        throw new Error("Category name is required.");
    }

    const category = await ensureCategoryAccount(supabase, session.businessId, type, categoryName);
    if (!category?.id) {
        throw new Error("Unable to create category.");
    }

    return true;
}

export async function createGeneralLedgerAccount(payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    assertAccountRole(session);

    const name = String(payload.account_name || "").trim();
    const type = String(payload.account_type || "").trim().toLowerCase();
    const categoryName = String(payload.category_name || "").trim();

    if (!name) {
        throw new Error("Account name is required.");
    }

    if (!ALLOWED_TYPES.has(type)) {
        throw new Error("Select a valid account type.");
    }
    if (!categoryName) {
        throw new Error("Select a category before creating a ledger.");
    }

    const categoryAccount = categoryName
        ? await ensureCategoryAccount(supabase, session.businessId, type, categoryName)
        : null;
    const categoryAccountId = String(categoryAccount?.id || "").trim();
    const code = await generateNextLedgerCodeForCategory(
        supabase,
        session.businessId,
        type,
        categoryAccountId,
        categoryAccount?.code
    );

    const { error } = await supabase
        .from("chart_of_accounts")
        .upsert({
            business_id: session.businessId,
            code,
            name,
            account_type: mapGeneralTypeToChartType(type),
            parent_account_id: categoryAccountId || null,
            is_active: true
        }, {
            onConflict: "business_id,code"
        });

    if (error) {
        if (isMissingTableError(error)) {
            throw new Error("Chart of accounts table is not set up yet.");
        }
        throw error;
    }

    return true;
}

export async function createAccountProduct(payload = {}) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    assertAccountRole(session);

    const productName = String(payload.product_name || "").trim();
    if (!productName) {
        throw new Error("Product name is required.");
    }

    const productCategory = await ensureCategoryAccount(
        supabase,
        session.businessId,
        "liability",
        "Account Products"
    );
    const nextCode = await generateNextLedgerCodeForCategory(
        supabase,
        session.businessId,
        "liability",
        productCategory.id,
        productCategory.code
    );
    const productGl = await createLedgerAndChartAccount(supabase, session.businessId, {
        code: nextCode,
        name: productName,
        accountType: "liability",
        parentAccountId: productCategory.id
    });

    const goCategory = await ensureCategoryAccount(
        supabase,
        session.businessId,
        "asset",
        "General Overdraft"
    );
    const goCode = await generateNextLedgerCodeForCategory(
        supabase,
        session.businessId,
        "asset",
        goCategory.id,
        goCategory.code
    );
    const goName = `GO - ${productName}`;
    const generalOverdraftGl = await createLedgerAndChartAccount(supabase, session.businessId, {
        code: goCode,
        name: goName,
        accountType: "asset",
        parentAccountId: goCategory.id
    });

    const productInsert = await supabase
        .from("account_products")
        .insert({
            business_id: session.businessId,
            product_name: productName,
            product_gl_account_id: productGl.id,
            product_gl_code: productGl.code,
            parent_gl_account_id: productCategory.id,
            general_overdraft_account_id: generalOverdraftGl.id,
            is_active: true
        });

    if (productInsert.error) {
        if (isMissingProductsTableError(productInsert.error)) {
            throw new Error("Account product table is not set up yet. Run sql/add-account-products.sql first.");
        }
        throw productInsert.error;
    }

    return {
        id: String(productGl.id || ""),
        code: String(productGl.code || nextCode),
        name: String(productName || "")
    };
}

export async function updateGeneralLedgerAccount(accountId, payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    assertAccountRole(session);

    const id = String(accountId || "").trim();
    const name = String(payload.account_name || "").trim();
    const type = String(payload.account_type || "").trim().toLowerCase();

    if (!id) {
        throw new Error("Ledger account id is required.");
    }
    if (!name) {
        throw new Error("Account name is required.");
    }
    if (!ALLOWED_TYPES.has(type)) {
        throw new Error("Select a valid account type.");
    }

    const { error } = await supabase
        .from("chart_of_accounts")
        .update({
            name,
            account_type: mapGeneralTypeToChartType(type)
        })
        .eq("id", id)
        .eq("business_id", session.businessId);

    if (error) {
        if (isMissingTableError(error)) {
            throw new Error("Chart of accounts table is not set up yet.");
        }
        throw error;
    }

    return true;
}

export async function setGeneralLedgerAccountActive(accountId, isActive) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    assertAccountRole(session);

    const id = String(accountId || "").trim();
    if (!id) {
        throw new Error("Ledger account id is required.");
    }

    const { error } = await supabase
        .from("chart_of_accounts")
        .update({ is_active: Boolean(isActive) })
        .eq("id", id)
        .eq("business_id", session.businessId);

    if (error) {
        if (isMissingTableError(error)) {
            throw new Error("Chart of accounts table is not set up yet.");
        }
        throw error;
    }

    return true;
}
