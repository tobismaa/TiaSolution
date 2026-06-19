import { formatCurrency } from "../core/utils.js";
import { getCurrentSessionContext } from "../core/session.js";
import { getSupabaseClient } from "../core/supabase-client.js";
import { getReportsSummary } from "../modules/reports/reports-service.js";

function toAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
}

function buildEmptyMetrics() {
    return {
        revenue: formatCurrency(0),
        expenses: formatCurrency(0),
        invoicesDueCount: 0,
        invoicesDueAmount: formatCurrency(0),
        cashPosition: formatCurrency(0),
        receivables: formatCurrency(0),
        payables: formatCurrency(0)
    };
}

async function getAdminMetrics() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return buildEmptyMetrics();
    }

    try {
        const [summary, invoicesResult, expensesResult] = await Promise.all([
            getReportsSummary(session.role),
            supabase
                .from("invoices")
                .select("total_amount, status")
                .eq("business_id", session.businessId),
            supabase
                .from("expenses")
                .select("amount, status")
                .eq("business_id", session.businessId)
        ]);

        if (invoicesResult.error) {
            throw invoicesResult.error;
        }
        if (expensesResult.error) {
            throw expensesResult.error;
        }

        const invoices = invoicesResult.data || [];
        const expenses = expensesResult.data || [];

        const dueInvoiceStatuses = new Set(["sent", "overdue"]);
        const receivableStatuses = new Set(["sent", "overdue"]);
        const payableStatuses = new Set(["pending", "approved"]);

        const invoicesDueRows = invoices.filter((invoice) => dueInvoiceStatuses.has(String(invoice.status || "").toLowerCase()));
        const invoicesDueCount = invoicesDueRows.length;
        const invoicesDueAmount = invoicesDueRows.reduce((sum, invoice) => sum + toAmount(invoice.total_amount), 0);

        const receivables = invoices.reduce((sum, invoice) => {
            const status = String(invoice.status || "").toLowerCase();
            if (!receivableStatuses.has(status)) {
                return sum;
            }
            return sum + toAmount(invoice.total_amount);
        }, 0);

        const payables = expenses.reduce((sum, expense) => {
            const status = String(expense.status || "").toLowerCase();
            if (!payableStatuses.has(status)) {
                return sum;
            }
            return sum + toAmount(expense.amount);
        }, 0);

        const paidInvoiceCash = invoices.reduce((sum, invoice) => {
            const status = String(invoice.status || "").toLowerCase();
            if (status !== "paid") {
                return sum;
            }
            return sum + toAmount(invoice.total_amount);
        }, 0);

        const paidExpenseCash = expenses.reduce((sum, expense) => {
            const status = String(expense.status || "").toLowerCase();
            if (status !== "paid") {
                return sum;
            }
            return sum + toAmount(expense.amount);
        }, 0);

        return {
            revenue: summary.revenue,
            expenses: summary.costBase,
            invoicesDueCount,
            invoicesDueAmount: formatCurrency(invoicesDueAmount),
            cashPosition: formatCurrency(paidInvoiceCash - paidExpenseCash),
            receivables: formatCurrency(receivables),
            payables: formatCurrency(payables)
        };
    } catch {
        return buildEmptyMetrics();
    }
}

export async function renderAdminDashboard() {
    const metrics = await getAdminMetrics();

    return {
        summary: [
            { label: "Revenue", value: metrics.revenue, note: "live data", tone: "up" },
            { label: "Expenses", value: metrics.expenses, note: "posted total", tone: "down" },
            { label: "Invoices Due", value: String(metrics.invoicesDueCount), note: `${metrics.invoicesDueAmount} pending`, tone: "warn" }
        ],
        content: `
            <div class="section-stack">
                <section class="hero-card">
                    <div>
                        <p class="hero-tag">Admin control</p>
                        <h2>Control users, payroll, and organization finance settings.</h2>
                        <p class="hero-copy">Admin owns user management, payroll configuration, and branch-wide financial oversight.</p>
                    </div>
                    <div class="hero-metrics">
                        <div><span>Cash Position</span><strong>${metrics.cashPosition}</strong></div>
                        <div><span>Receivables</span><strong>${metrics.receivables}</strong></div>
                        <div><span>Payables</span><strong>${metrics.payables}</strong></div>
                    </div>
                </section>
                <div class="content-grid">
                    <section class="panel">
                        <div class="panel-head">
                            <h3>Control Focus</h3>
                            <span class="badge paid">Admin</span>
                        </div>
                        <div class="stack-list mt-18">
                            <div class="stack-item"><span>User oversight</span><strong>Admin, Head of Operations, Operations, Account</strong></div>
                            <div class="stack-item"><span>Payroll management</span><strong>Controlled by Admin</strong></div>
                            <div class="stack-item"><span>Payroll levels</span><strong>Configurable by admin</strong></div>
                        </div>
                    </section>
                    <section class="panel">
                        <div class="panel-head">
                            <h3>Board Pack Snapshot</h3>
                            <span class="badge draft">Live</span>
                        </div>
                        <p class="mini-insight">Use reports for financial management and monitor branch postings across invoices, expenses, and transactions.</p>
                    </section>
                </div>
            </div>
        `
    };
}
