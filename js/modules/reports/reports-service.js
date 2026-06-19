import { formatCurrency } from "../../core/utils.js";
import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { ROLES } from "../../core/roles.js";
import { getActiveBranchDetails } from "../../core/data-access.js";
import { getOpenedAccountTransactionRows } from "../account-management/account-management-service.js";

const TB_TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];

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

function isBranchColumnError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "PGRST204" || message.includes("branch_id") || details.includes("branch_id");
}

async function runWithBranchFallback(buildWithBranch, buildWithoutBranch) {
    const primary = await buildWithBranch();
    if (!primary.error) {
        return primary;
    }
    if (!isBranchColumnError(primary.error)) {
        return primary;
    }
    return await buildWithoutBranch();
}

function formatSummaryDefaults() {
    return {
        revenue: formatCurrency(0),
        costBase: formatCurrency(0),
        profit: formatCurrency(0),
        inflows: formatCurrency(0),
        outflows: formatCurrency(0),
        trialBalance: formatCurrency(0),
        taxSummary: formatCurrency(0),
        closeStatus: "No activity yet"
    };
}

function applyBusinessScope(query, role, businessId) {
    if (role === "super_admin") {
        return query;
    }

    if (!businessId) {
        return null;
    }

    return query.eq("business_id", businessId);
}

function applyBranchScope(query, branchId) {
    const normalizedBranchId = String(branchId || "").trim();
    if (!normalizedBranchId) {
        return query;
    }

    return query.eq("branch_id", normalizedBranchId);
}

export async function getReportsSummary(role = "", options = {}) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session) {
        return formatSummaryDefaults();
    }

    const scopedInvoicesQuery = applyBusinessScope(
        supabase.from("invoices").select("total_amount, tax_amount, status"),
        role || session.role,
        session.businessId
    );
    const scopedExpensesQuery = applyBusinessScope(
        supabase.from("expenses").select("amount, tax_amount, status"),
        role || session.role,
        session.businessId
    );

    if (!scopedInvoicesQuery || !scopedExpensesQuery) {
        return formatSummaryDefaults();
    }

    let branchId = String(options?.branchId || "").trim();
    const effectiveRole = String(role || session.role || "").trim().toLowerCase();
    const mustUseActiveBranch = effectiveRole === ROLES.MANAGER || effectiveRole === ROLES.STAFF;
    if (mustUseActiveBranch) {
        const activeBranch = await getActiveBranchDetails(session.userId, session.businessId);
        branchId = activeBranch?.canAccessAllBranches ? "" : String(activeBranch?.id || "").trim();
    }

    const invoicesQuery = applyBranchScope(scopedInvoicesQuery, branchId);
    const expensesQuery = applyBranchScope(scopedExpensesQuery, branchId);

    const [{ data: invoices, error: invoicesError }, { data: expenses, error: expensesError }] = await Promise.all([
        invoicesQuery,
        expensesQuery
    ]);

    if (invoicesError) throw invoicesError;
    if (expensesError) throw expensesError;

    const receivableStatuses = new Set(["sent", "paid", "overdue"]);
    const committedExpenseStatuses = new Set(["approved", "paid"]);

    const revenueValue = (invoices || []).reduce((sum, invoice) => {
        const status = String(invoice.status || "").toLowerCase();
        if (!receivableStatuses.has(status)) {
            return sum;
        }
        return sum + Number(invoice.total_amount || 0);
    }, 0);

    const costBaseValue = (expenses || []).reduce((sum, expense) => {
        const status = String(expense.status || "").toLowerCase();
        if (!committedExpenseStatuses.has(status)) {
            return sum;
        }
        return sum + Number(expense.amount || 0);
    }, 0);

    const invoiceTaxValue = (invoices || []).reduce((sum, invoice) => {
        const status = String(invoice.status || "").toLowerCase();
        if (!receivableStatuses.has(status)) {
            return sum;
        }
        return sum + Number(invoice.tax_amount || 0);
    }, 0);

    const expenseTaxValue = (expenses || []).reduce((sum, expense) => {
        const status = String(expense.status || "").toLowerCase();
        if (!committedExpenseStatuses.has(status)) {
            return sum;
        }
        return sum + Number(expense.tax_amount || 0);
    }, 0);

    const draftInvoices = (invoices || []).filter((invoice) => String(invoice.status || "").toLowerCase() === "draft").length;
    const pendingExpenses = (expenses || []).filter((expense) => String(expense.status || "").toLowerCase() === "pending").length;

    const inflowsValue = revenueValue;
    const outflowsValue = costBaseValue;
    const profitValue = revenueValue - costBaseValue;
    const trialBalanceValue = profitValue;
    const taxSummaryValue = invoiceTaxValue - expenseTaxValue;
    const closeStatus = draftInvoices + pendingExpenses > 0 ? "Attention needed" : "On track";

    return {
        revenue: formatCurrency(revenueValue),
        costBase: formatCurrency(costBaseValue),
        profit: formatCurrency(profitValue),
        inflows: formatCurrency(inflowsValue),
        outflows: formatCurrency(outflowsValue),
        trialBalance: formatCurrency(trialBalanceValue),
        taxSummary: formatCurrency(taxSummaryValue),
        closeStatus
    };
}

function normalizeAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
}

function getTrialBalanceColumns(totalDebit, totalCredit) {
    const net = normalizeAmount(totalDebit) - normalizeAmount(totalCredit);
    if (Math.abs(net) < 0.0000001) {
        return { debit: 0, credit: 0 };
    }
    if (net > 0) {
        return { debit: net, credit: 0 };
    }
    return { debit: 0, credit: Math.abs(net) };
}

function formatTypeLabel(type) {
    const labels = {
        asset: "Assets",
        liability: "Liabilities",
        equity: "Equity",
        income: "Income",
        expense: "Expenses"
    };
    return labels[String(type || "").trim().toLowerCase()] || "Other";
}

export async function getTrialBalanceReport(options = {}) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const role = String(session.role || "").trim().toLowerCase();
    const allowed = new Set([ROLES.BUSINESS_ADMIN, ROLES.MANAGER, ROLES.STAFF, ROLES.AUDITOR, ROLES.ACCOUNT]);
    if (!allowed.has(role)) {
        throw new Error("You do not have access to trial balance report.");
    }

    const dateFrom = String(options?.dateFrom || "").trim();
    const dateTo = String(options?.dateTo || "").trim();
    if (!dateFrom || !dateTo) {
        throw new Error("Pick both date range values.");
    }

    let branchId = String(options?.branchId || "").trim();
    const mustUseActiveBranch = role === ROLES.MANAGER || role === ROLES.STAFF;
    if (mustUseActiveBranch) {
        const activeBranch = await getActiveBranchDetails(session.userId, session.businessId);
        branchId = activeBranch?.canAccessAllBranches ? "" : String(activeBranch?.id || "").trim();
    }

    const { data: accounts, error: accountsError } = await supabase
        .from("chart_of_accounts")
        .select("id, code, name, account_type, is_active, parent_account_id")
        .eq("business_id", session.businessId)
        .eq("is_active", true)
        .order("code", { ascending: true });

    if (accountsError) {
        throw accountsError;
    }

    const lineResult = await runWithBranchFallback(
        () => {
            let query = supabase
                .from("journal_entry_lines")
                .select(`
                    account_id,
                    debit,
                    credit,
                    journal_entries!inner (
                        id,
                        business_id,
                        entry_date
                    )
                `)
                .eq("journal_entries.business_id", session.businessId)
                .gte("journal_entries.entry_date", dateFrom)
                .lte("journal_entries.entry_date", dateTo);
            if (branchId) {
                query = query.eq("journal_entries.branch_id", branchId);
            }
            return query;
        },
        () => supabase
            .from("journal_entry_lines")
            .select(`
                account_id,
                debit,
                credit,
                journal_entries!inner (
                    id,
                    business_id,
                    entry_date
                )
            `)
            .eq("journal_entries.business_id", session.businessId)
            .gte("journal_entries.entry_date", dateFrom)
            .lte("journal_entries.entry_date", dateTo)
    );

    if (lineResult.error) {
        throw lineResult.error;
    }

    const totalsByAccount = new Map();
    for (const row of (lineResult.data || [])) {
        const accountId = String(row.account_id || "").trim();
        if (!accountId) {
            continue;
        }
        const prev = totalsByAccount.get(accountId) || { debit: 0, credit: 0 };
        totalsByAccount.set(accountId, {
            debit: prev.debit + normalizeAmount(row.debit),
            credit: prev.credit + normalizeAmount(row.credit)
        });
    }

    const accountCatalog = (accounts || []).map((account) => ({
        id: String(account.id || ""),
        code: account.code || "",
        name: account.name || "",
        type: String(account.account_type || "").toLowerCase(),
        parentId: String(account.parent_account_id || "").trim()
    }));

    const parentIds = new Set(
        accountCatalog.map((row) => row.parentId).filter(Boolean)
    );

    const byId = new Map(accountCatalog.map((row) => [row.id, row]));

    const accountRows = accountCatalog.map((account) => {
        const totals = totalsByAccount.get(String(account.id || "")) || { debit: 0, credit: 0 };
        const columns = getTrialBalanceColumns(totals.debit, totals.credit);
        return {
            id: account.id,
            code: account.code || "",
            name: account.name || "",
            type: String(account.type || "").toLowerCase(),
            parentId: String(account.parentId || "").trim(),
            debit: columns.debit,
            credit: columns.credit
        };
    }).filter((row) => !parentIds.has(String(row.id || "")));

    const grouped = TB_TYPE_ORDER.map((type) => {
        const rows = accountRows
            .filter((row) => row.type === type)
            .sort((a, b) => compareCodes(a.code, b.code) || String(a.name || "").localeCompare(String(b.name || "")));

        const categorized = new Map();
        for (const row of rows) {
            const parent = row.parentId ? byId.get(row.parentId) : null;
            const categoryCode = String(parent?.code || "").trim();
            const categoryName = String(parent?.name || "Uncategorized").trim() || "Uncategorized";
            const categoryKey = `${categoryCode}::${categoryName}`;
            if (!categorized.has(categoryKey)) {
                categorized.set(categoryKey, {
                    code: categoryCode,
                    name: categoryName,
                    rows: []
                });
            }
            categorized.get(categoryKey).rows.push(row);
        }

        const categories = Array.from(categorized.values())
            .map((category) => {
                const subtotal = (category.rows || []).reduce((acc, row) => ({
                    debit: acc.debit + row.debit,
                    credit: acc.credit + row.credit
                }), { debit: 0, credit: 0 });
                return {
                    code: category.code,
                    name: category.name,
                    rows: category.rows,
                    subtotal
                };
            })
            .sort((a, b) => compareCodes(a.code, b.code) || a.name.localeCompare(b.name));

        const subtotal = categories.reduce((acc, category) => ({
            debit: acc.debit + category.subtotal.debit,
            credit: acc.credit + category.subtotal.credit
        }), { debit: 0, credit: 0 });

        return {
            type,
            label: formatTypeLabel(type),
            rows,
            categories,
            subtotal
        };
    });

    const totals = grouped.reduce((acc, group) => ({
        debit: acc.debit + group.subtotal.debit,
        credit: acc.credit + group.subtotal.credit
    }), { debit: 0, credit: 0 });

    return {
        dateFrom,
        dateTo,
        groups: grouped,
        totals,
        isBalanced: Math.abs(totals.debit - totals.credit) < 0.01,
        rowCount: accountRows.length
    };
}

export async function getTransactionSummaryReport(options = {}) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const role = String(session.role || "").trim().toLowerCase();
    const allowed = new Set([ROLES.BUSINESS_ADMIN, ROLES.MANAGER, ROLES.STAFF, ROLES.AUDITOR, ROLES.ACCOUNT]);
    if (!allowed.has(role)) {
        throw new Error("You do not have access to transaction summary.");
    }

    const dateFrom = String(options?.dateFrom || "").trim();
    const dateTo = String(options?.dateTo || "").trim();
    if (!dateFrom || !dateTo) {
        throw new Error("Pick both date range values.");
    }

    let branchId = String(options?.branchId || "").trim();
    const mustUseActiveBranch = role === ROLES.MANAGER || role === ROLES.STAFF;
    if (mustUseActiveBranch) {
        const activeBranch = await getActiveBranchDetails(session.userId, session.businessId);
        branchId = activeBranch?.canAccessAllBranches ? "" : String(activeBranch?.id || "").trim();
    }

    const linesResult = await runWithBranchFallback(
        () => {
            let query = supabase
                .from("journal_entry_lines")
                .select(`
                    id,
                    description,
                    debit,
                    credit,
                    account_id,
                    chart_of_accounts!inner (
                        code,
                        name
                    ),
                    journal_entries!inner (
                        id,
                        business_id,
                        entry_date,
                        reference,
                        memo,
                        source_type,
                        created_at,
                        branch_id
                    )
                `)
                .eq("journal_entries.business_id", session.businessId)
                .gte("journal_entries.entry_date", dateFrom)
                .lte("journal_entries.entry_date", dateTo);
            if (branchId) {
                query = query.eq("journal_entries.branch_id", branchId);
            }
            return query;
        },
        () => supabase
            .from("journal_entry_lines")
            .select(`
                id,
                description,
                debit,
                credit,
                account_id,
                chart_of_accounts!inner (
                    code,
                    name
                ),
                journal_entries!inner (
                    id,
                    business_id,
                    entry_date,
                    reference,
                    memo,
                    source_type,
                    created_at
                )
            `)
            .eq("journal_entries.business_id", session.businessId)
            .gte("journal_entries.entry_date", dateFrom)
            .lte("journal_entries.entry_date", dateTo)
    );

    if (linesResult.error) {
        throw linesResult.error;
    }

    const glRows = (linesResult.data || []).map((line) => {
        const entry = Array.isArray(line.journal_entries)
            ? (line.journal_entries[0] || {})
            : (line.journal_entries || {});
        const debit = normalizeAmount(line.debit);
        const credit = normalizeAmount(line.credit);
        const amount = debit > 0 ? debit : credit;
        const type = debit > 0 ? "DR" : "CR";
        return {
            id: String(line.id || ""),
            entryId: String(entry.id || ""),
            date: String(entry.entry_date || ""),
            reference: String(entry.reference || "-"),
            sourceType: String(entry.source_type || "manual_posting"),
            glCode: String(line.chart_of_accounts?.code || "-"),
            glName: String(line.chart_of_accounts?.name || "-"),
            description: String(line.description || entry.memo || "-"),
            amount,
            type
        };
    });

    const customerAccountRows = await getOpenedAccountTransactionRows({
        dateFrom,
        dateTo,
        branchId
    }).catch(() => []);

    const rows = [...glRows, ...customerAccountRows];

    rows.sort((a, b) => {
        const dateA = new Date(`${a.date}T00:00:00Z`).getTime();
        const dateB = new Date(`${b.date}T00:00:00Z`).getTime();
        if (dateA !== dateB) {
            return dateB - dateA;
        }
        return String(b.reference || "").localeCompare(String(a.reference || ""));
    });

    return rows;
}
