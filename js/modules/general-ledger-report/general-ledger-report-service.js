import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { ROLES } from "../../core/roles.js";

function ensureAccountRole(session) {
    const role = String(session?.role || "").trim().toLowerCase();
    const allowed = new Set([ROLES.AUDITOR, ROLES.ACCOUNT, ROLES.MANAGER, ROLES.STAFF]);
    if (!allowed.has(role)) {
        throw new Error("You do not have access to General Ledger Report.");
    }
}

function toAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
}

function mapGeneralTypeToChartType(type) {
    const normalized = String(type || "").trim().toLowerCase();
    return normalized === "revenue" ? "income" : normalized;
}

function isBranchColumnError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "PGRST204" || message.includes("branch_id") || details.includes("branch_id") || message.includes("branches");
}

function normalizeLedgerSelectionId(value) {
    const raw = String(value || "")
        .replaceAll("\u200B", "")
        .trim();
    if (!raw) {
        return { isChart: false, id: "" };
    }

    const chartMatch = raw.match(/^coa:([0-9a-f-]{36})$/i);
    if (chartMatch?.[1]) {
        return { isChart: true, id: chartMatch[1] };
    }

    return { isChart: false, id: raw };
}

async function getProfileNameMap(supabase, userIds = []) {
    const uniqueIds = Array.from(new Set((userIds || []).map((id) => String(id || "").trim()).filter(Boolean)));
    if (!uniqueIds.length) {
        return new Map();
    }

    const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", uniqueIds);

    if (error) {
        return new Map();
    }

    const pairs = (data || []).map((row) => [String(row.id), String(row.full_name || "").trim()]);
    return new Map(pairs);
}

export async function searchLedgerAccountsByName(query = "", options = {}) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return [];
    }
    ensureAccountRole(session);

    const searchText = String(query || "").trim();
    let request = supabase
        .from("chart_of_accounts")
        .select("id, code, name")
        .eq("business_id", session.businessId)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(30);

    if (searchText) {
        request = request.or(`name.ilike.%${searchText}%,code.ilike.%${searchText}%`);
    }

    const { data, error } = await request;
    if (error) {
        throw error;
    }

    return (data || []).map((item) => ({
        id: `coa:${item.id}`,
        code: item.code || "",
        name: item.name || "",
        branchId: "",
        branchName: ""
    }));
}

export async function getGeneralLedgerStatement({ accountId, dateFrom, dateTo, branchId = "" }) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    ensureAccountRole(session);

    const normalizedSelection = normalizeLedgerSelectionId(accountId);
    if (!normalizedSelection.id) {
        throw new Error("Select a general ledger account.");
    }
    const isChartAccountId = normalizedSelection.isChart;
    const glAccountId = normalizedSelection.id;

    const from = String(dateFrom || "").trim();
    const to = String(dateTo || "").trim();
    const normalizedBranchId = String(branchId || "").trim();
    if (!from || !to) {
        throw new Error("Pick both date range values.");
    }

    const chartById = await supabase
        .from("chart_of_accounts")
        .select("id, code, name, account_type, is_active")
        .eq("business_id", session.businessId)
        .eq("id", glAccountId)
        .maybeSingle();

    if (chartById.error) {
        throw chartById.error;
    }
    if (!chartById.data) {
        throw new Error("The selected ledger account was not found.");
    }

    const chartAccount = {
        id: chartById.data.id,
        code: chartById.data.code || "",
        name: chartById.data.name || ""
    };

    const selectedGl = {
        id: isChartAccountId ? `coa:${chartById.data.id}` : String(chartById.data.id || ""),
        account_code: chartById.data.code || "",
        account_name: chartById.data.name || "",
        account_type: chartById.data.account_type || "",
        is_active: Boolean(chartById.data.is_active),
        branch_id: null,
        branches: null
    };

    if (!chartAccount) {
        throw new Error("Unable to auto-link this General Ledger to chart accounts.");
    }

    const chartAccountId = String(chartAccount.id || "");

    let openingQuery = supabase
        .from("journal_entry_lines")
        .select(`
            debit,
            credit,
            journal_entries!inner (
                id,
                entry_date,
                business_id
            )
        `)
        .eq("account_id", chartAccountId)
        .lt("journal_entries.entry_date", from)
        .eq("journal_entries.business_id", session.businessId);

    if (normalizedBranchId) {
        openingQuery = openingQuery.eq("journal_entries.branch_id", normalizedBranchId);
    }

    const { data: openingRows, error: openingError } = await openingQuery;
    if (openingError) {
        throw openingError;
    }

    const openingBalance = (openingRows || []).reduce((sum, row) => sum + toAmount(row.debit) - toAmount(row.credit), 0);

    let movementQuery = supabase
        .from("journal_entry_lines")
        .select(`
            id,
            description,
            debit,
            credit,
            journal_entries!inner (
                id,
                entry_date,
                reference,
                memo,
                source_type,
                created_at,
                created_by,
                business_id
            )
        `)
        .eq("account_id", chartAccountId)
        .eq("journal_entries.business_id", session.businessId)
        .gte("journal_entries.entry_date", from)
        .lte("journal_entries.entry_date", to);

    if (normalizedBranchId) {
        movementQuery = movementQuery.eq("journal_entries.branch_id", normalizedBranchId);
    }

    const { data: movementRows, error: movementError } = await movementQuery;
    if (movementError) {
        throw movementError;
    }

    const sortedRows = (movementRows || []).slice().sort((a, b) => {
        const dateA = String(a?.journal_entries?.entry_date || "");
        const dateB = String(b?.journal_entries?.entry_date || "");
        if (dateA !== dateB) {
            return dateA.localeCompare(dateB);
        }
        const createdA = String(a?.journal_entries?.created_at || "");
        const createdB = String(b?.journal_entries?.created_at || "");
        if (createdA !== createdB) {
            return createdA.localeCompare(createdB);
        }
        return String(a?.journal_entries?.id || a?.id || "").localeCompare(String(b?.journal_entries?.id || b?.id || ""));
    });

    const profileNames = await getProfileNameMap(
        supabase,
        sortedRows.map((row) => row?.journal_entries?.created_by)
    );

    let running = openingBalance;
    const lines = sortedRows.map((row) => {
        const debit = toAmount(row.debit);
        const credit = toAmount(row.credit);
        const postedById = String(row?.journal_entries?.created_by || "").trim();
        const sourceType = String(row?.journal_entries?.source_type || "").trim().toLowerCase();
        const isReversalPosting = sourceType === "reversal_posting";
        const description = isReversalPosting
            ? (row.journal_entries?.memo || row.description || "-")
            : (row.description || row.journal_entries?.memo || "-");
        running += debit - credit;
        return {
            date: row.journal_entries?.entry_date || "",
            entryId: row.journal_entries?.id || "",
            reference: row.journal_entries?.reference || "-",
            description,
            memo: description,
            postedAt: row.journal_entries?.created_at || "",
            postedById,
            postedByName: profileNames.get(postedById) || "Unknown user",
            debit,
            credit,
            balance: running
        };
    });

    const totals = lines.reduce((acc, line) => ({
        debit: acc.debit + line.debit,
        credit: acc.credit + line.credit
    }), { debit: 0, credit: 0 });

    let resolvedBranchName = "Head Office";
    if (normalizedBranchId) {
        const branchLookup = await supabase
            .from("branches")
            .select("name")
            .eq("business_id", session.businessId)
            .eq("id", normalizedBranchId)
            .maybeSingle();

        if (!branchLookup.error && branchLookup.data?.name) {
            resolvedBranchName = String(branchLookup.data.name);
        } else {
            resolvedBranchName = "Selected Branch";
        }
    }

    return {
        account: {
            id: selectedGl.id,
            code: selectedGl.account_code || chartAccount.code || "",
            name: selectedGl.account_name || chartAccount.name || ""
        },
        branchId: normalizedBranchId,
        branchName: resolvedBranchName,
        from,
        to,
        openingBalance,
        closingBalance: running,
        totalDebit: totals.debit,
        totalCredit: totals.credit,
        lines
    };
}

export async function getJournalEntryDetails(entryId) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    ensureAccountRole(session);

    const normalizedEntryId = String(entryId || "").trim();
    if (!normalizedEntryId) {
        throw new Error("Invalid journal entry reference.");
    }

    const { data: entry, error } = await supabase
        .from("journal_entries")
        .select(`
            id,
            entry_date,
            reference,
            memo,
            created_at,
            created_by,
            branches (
                name
            ),
            journal_entry_lines (
                id,
                description,
                debit,
                credit,
                chart_of_accounts (
                    code,
                    name
                )
            )
        `)
        .eq("business_id", session.businessId)
        .eq("id", normalizedEntryId)
        .maybeSingle();

    if (error) {
        throw error;
    }
    if (!entry) {
        throw new Error("Journal entry was not found.");
    }

    const profileNames = await getProfileNameMap(supabase, [entry.created_by]);
    const postedById = String(entry.created_by || "").trim();

    return {
        id: entry.id,
        reference: entry.reference || "-",
        description: entry.memo || "-",
        entryDate: entry.entry_date || "",
        postedAt: entry.created_at || "",
        postedByName: profileNames.get(postedById) || "Unknown user",
        branchName: entry.branches?.name || "-",
        lines: (entry.journal_entry_lines || []).map((line) => ({
            id: line.id,
            accountCode: line.chart_of_accounts?.code || "-",
            accountName: line.chart_of_accounts?.name || "Unknown account",
            description: line.description || "-",
            debit: toAmount(line.debit),
            credit: toAmount(line.credit)
        }))
    };
}

export async function getJournalEntryDetailsByReference(reference) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    ensureAccountRole(session);

    const normalizedReference = String(reference || "").trim();
    if (!normalizedReference) {
        throw new Error("Invalid journal entry reference.");
    }

    const { data: entry, error } = await supabase
        .from("journal_entries")
        .select("id, created_at")
        .eq("business_id", session.businessId)
        .ilike("reference", normalizedReference)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }
    if (!entry?.id) {
        throw new Error("Journal entry was not found.");
    }

    return await getJournalEntryDetails(entry.id);
}

export async function getGeneralLedgerBranchComparison({ accountId, dateFrom, dateTo }) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    const role = String(session.role || "").trim().toLowerCase();
    if (role !== ROLES.AUDITOR && role !== ROLES.ACCOUNT) {
        throw new Error("Only Account role can run branch comparison.");
    }

    const { data: branches, error: branchError } = await supabase
        .from("branches")
        .select("id, name, is_active")
        .eq("business_id", session.businessId)
        .order("name", { ascending: true });

    if (branchError) {
        throw branchError;
    }

    const activeBranches = (branches || []).filter((branch) => branch.is_active !== false);
    const comparisons = await Promise.all(activeBranches.map(async (branch) => {
        try {
            const statement = await getGeneralLedgerStatement({
                accountId,
                dateFrom,
                dateTo,
                branchId: String(branch.id || "")
            });

            return {
                branchId: String(branch.id || ""),
                branchName: String(branch.name || "Unnamed Branch"),
                totalDebit: statement.totalDebit,
                totalCredit: statement.totalCredit,
                closingBalance: statement.closingBalance
            };
        } catch {
            return {
                branchId: String(branch.id || ""),
                branchName: String(branch.name || "Unnamed Branch"),
                totalDebit: 0,
                totalCredit: 0,
                closingBalance: 0
            };
        }
    }));

    return comparisons;
}
