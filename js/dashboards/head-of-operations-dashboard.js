import { formatCurrency } from "../core/utils.js";
import { getCurrentSessionContext } from "../core/session.js";
import { getSupabaseClient } from "../core/supabase-client.js";
import { getActiveBranchDetails } from "../core/data-access.js";
import { isFeatureEnabled } from "../core/features.js";

function toAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
}

function getMonthBounds() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return {
        from: monthStart.toISOString().slice(0, 10),
        toExclusive: monthEnd.toISOString().slice(0, 10)
    };
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

async function getManagerMetrics() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return {
            activeBranchName: "Active Branch",
            pendingApprovals: 0,
            overdueInvoiceValue: 0,
            dueThisWeekValue: 0,
            spendWatchValue: 0,
            postedTransactionsMonth: 0
        };
    }

    try {
        const activeBranch = await getActiveBranchDetails(session.userId, session.businessId);
        const branchId = activeBranch?.canAccessAllBranches ? "" : String(activeBranch?.id || "").trim();
        const { from, toExclusive } = getMonthBounds();

        const [invoicesResult, expensesResult, journalResult] = await Promise.all([
            runWithBranchFallback(
                () => {
                    let query = supabase
                        .from("invoices")
                        .select("total_amount, status, issued_at")
                        .eq("business_id", session.businessId);
                    if (branchId) {
                        query = query.eq("branch_id", branchId);
                    }
                    return query;
                },
                () => supabase
                    .from("invoices")
                    .select("total_amount, status, issued_at")
                    .eq("business_id", session.businessId)
            ),
            runWithBranchFallback(
                () => {
                    let query = supabase
                        .from("expenses")
                        .select("amount, status, incurred_at")
                        .eq("business_id", session.businessId);
                    if (branchId) {
                        query = query.eq("branch_id", branchId);
                    }
                    return query;
                },
                () => supabase
                    .from("expenses")
                    .select("amount, status, incurred_at")
                    .eq("business_id", session.businessId)
            ),
            runWithBranchFallback(
                () => {
                    let query = supabase
                        .from("journal_entries")
                        .select("id, entry_date")
                        .eq("business_id", session.businessId)
                        .gte("entry_date", from)
                        .lt("entry_date", toExclusive);
                    if (branchId) {
                        query = query.eq("branch_id", branchId);
                    }
                    return query;
                },
                () => supabase
                    .from("journal_entries")
                    .select("id, entry_date")
                    .eq("business_id", session.businessId)
                    .gte("entry_date", from)
                    .lt("entry_date", toExclusive)
            )
        ]);

        if (invoicesResult.error) throw invoicesResult.error;
        if (expensesResult.error) throw expensesResult.error;
        if (journalResult.error) throw journalResult.error;

        const invoices = invoicesResult.data || [];
        const expenses = expensesResult.data || [];
        const journals = journalResult.data || [];

        const pendingInvoiceStatuses = new Set(["draft", "pending"]);
        const pendingExpenseStatuses = new Set(["pending"]);
        const committedExpenseStatuses = new Set(["approved", "paid"]);

        const pendingApprovals =
            invoices.filter((row) => pendingInvoiceStatuses.has(String(row.status || "").toLowerCase())).length +
            expenses.filter((row) => pendingExpenseStatuses.has(String(row.status || "").toLowerCase())).length;

        const overdueInvoiceValue = invoices.reduce((sum, row) => {
            const status = String(row.status || "").toLowerCase();
            if (status !== "overdue") {
                return sum;
            }
            return sum + toAmount(row.total_amount);
        }, 0);

        const dueThisWeekValue = invoices.reduce((sum, row) => {
            const status = String(row.status || "").toLowerCase();
            if (status !== "sent" && status !== "overdue") {
                return sum;
            }
            return sum + toAmount(row.total_amount);
        }, 0);

        const spendWatchValue = expenses.reduce((sum, row) => {
            const status = String(row.status || "").toLowerCase();
            const dateText = String(row.incurred_at || "");
            if (!committedExpenseStatuses.has(status) || dateText < from || dateText >= toExclusive) {
                return sum;
            }
            return sum + toAmount(row.amount);
        }, 0);

        return {
            activeBranchName: activeBranch?.canAccessAllBranches ? "Head Office" : String(activeBranch?.name || "Active Branch"),
            pendingApprovals,
            overdueInvoiceValue,
            dueThisWeekValue,
            spendWatchValue,
            postedTransactionsMonth: journals.length
        };
    } catch {
        return {
            activeBranchName: "Active Branch",
            pendingApprovals: 0,
            overdueInvoiceValue: 0,
            dueThisWeekValue: 0,
            spendWatchValue: 0,
            postedTransactionsMonth: 0
        };
    }
}

export async function renderHeadOfOperationsDashboard() {
    const metrics = await getManagerMetrics();
    const session = await getCurrentSessionContext();
    const summary = [
        { label: "Team Queue", value: String(metrics.pendingApprovals), note: "items to review", tone: "warn", feature: "customerBilling" },
        { label: "Due This Week", value: formatCurrency(metrics.dueThisWeekValue), note: "collections expected", tone: "up", feature: "customerBilling" },
        { label: "Spend Watch", value: formatCurrency(metrics.spendWatchValue), note: "approved month spend", tone: "down", feature: "expenses" }
    ].filter((card) => isFeatureEnabled(session?.featureKeys, card.feature, session?.role));

    return {
        summary,
        content: `
            <section class="hero-card">
                <div>
                    <p class="hero-tag">Operations control</p>
                    <h2>Head of Operations approves operational postings and submits payroll to admin.</h2>
                    <p class="hero-copy">This workspace focuses on reviewing invoices, expenses, and transactions posted by Operations users before they move forward.</p>
                </div>
                <div class="hero-metrics">
                    <div><span>Active branch</span><strong>${metrics.activeBranchName}</strong></div>
                    <div><span>Pending approvals</span><strong>${metrics.pendingApprovals}</strong></div>
                    <div><span>Overdue invoices</span><strong>${formatCurrency(metrics.overdueInvoiceValue)}</strong></div>
                    <div><span>Transactions posted (month)</span><strong>${metrics.postedTransactionsMonth}</strong></div>
                </div>
            </section>
        `
    };
}
