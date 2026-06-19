import { formatCurrency } from "../core/utils.js";
import { getCurrentSessionContext } from "../core/session.js";
import { getSupabaseClient } from "../core/supabase-client.js";

const DEBIT_NATURE_TYPES = new Set(["asset", "expense"]);
const BALANCE_SHEET_TYPES = new Set(["asset", "liability", "equity"]);
const ALL_BRANCHES_TOKEN = "__all__";
const PAGE_SIZE = 1000;
const TB_TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;");
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
    return buildWithoutBranch();
}

function toAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
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

function getUtcTodayIso() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

async function getServerTodayIso() {
    return getUtcTodayIso();
}

function formatShortDate(iso) {
    if (!iso) {
        return "-";
    }
    const date = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Africa/Lagos"
    }).format(date);
}

function formatAccountTypeLabel(type) {
    const labels = {
        asset: "Asset",
        liability: "Liability",
        equity: "Equity",
        income: "Income",
        expense: "Expense"
    };
    return labels[String(type || "").trim().toLowerCase()] || "Account";
}

function formatTypeGroupLabel(type) {
    const labels = {
        asset: "Assets",
        liability: "Liabilities",
        equity: "Equity",
        income: "Income",
        expense: "Expenses"
    };
    return labels[String(type || "").trim().toLowerCase()] || "Other";
}

function getTrialBalanceColumns(account) {
    const net = toAmount(account.totalDebit) - toAmount(account.totalCredit);
    if (Math.abs(net) < 0.0000001) {
        return { debit: 0, credit: 0 };
    }
    if (net > 0) {
        return { debit: net, credit: 0 };
    }
    return { debit: 0, credit: Math.abs(net) };
}

function getBalanceSheetAmount(account) {
    const type = String(account?.accountType || "").trim().toLowerCase();
    if (DEBIT_NATURE_TYPES.has(type)) {
        return toAmount(account.totalDebit) - toAmount(account.totalCredit);
    }
    return toAmount(account.totalCredit) - toAmount(account.totalDebit);
}

function buildTrialBalanceGroups(accounts = [], trialRows = []) {
    const accountById = new Map(accounts.map((account) => [String(account.id || ""), account]));

    return TB_TYPE_ORDER.map((type) => {
        const rows = (trialRows || [])
            .filter((row) => String(row.accountType || "").toLowerCase() === type)
            .sort((a, b) => compareCodes(a.code, b.code) || String(a.name || "").localeCompare(String(b.name || "")));

        const categories = new Map();
        for (const row of rows) {
            const parent = row.parentId ? accountById.get(String(row.parentId || "")) : null;
            const categoryCode = String(parent?.code || "").trim();
            const categoryName = String(parent?.name || "Uncategorized").trim() || "Uncategorized";
            const categoryKey = `${categoryCode}::${categoryName}`;
            if (!categories.has(categoryKey)) {
                categories.set(categoryKey, {
                    code: categoryCode,
                    name: categoryName,
                    rows: []
                });
            }
            categories.get(categoryKey).rows.push(row);
        }

        const categoryList = Array.from(categories.values())
            .map((category) => ({
                ...category,
                subtotal: category.rows.reduce((totals, row) => ({
                    debit: totals.debit + toAmount(row.debitBalance),
                    credit: totals.credit + toAmount(row.creditBalance)
                }), { debit: 0, credit: 0 })
            }))
            .sort((a, b) => compareCodes(a.code, b.code) || a.name.localeCompare(b.name));

        const subtotal = categoryList.reduce((totals, category) => ({
            debit: totals.debit + category.subtotal.debit,
            credit: totals.credit + category.subtotal.credit
        }), { debit: 0, credit: 0 });

        return {
            type,
            label: formatTypeGroupLabel(type),
            categories: categoryList,
            subtotal
        };
    });
}

async function getAllJournalLines({ supabase, businessId, asOfDate, branchId }) {
    const normalizedBranchId = String(branchId || "").trim();
    let offset = 0;
    const rows = [];

    while (true) {
        const rangeEnd = offset + PAGE_SIZE - 1;
        const result = await runWithBranchFallback(
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
                    .eq("journal_entries.business_id", businessId)
                    .lte("journal_entries.entry_date", asOfDate)
                    .range(offset, rangeEnd);
                if (normalizedBranchId) {
                    query = query.eq("journal_entries.branch_id", normalizedBranchId);
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
                .eq("journal_entries.business_id", businessId)
                .lte("journal_entries.entry_date", asOfDate)
                .range(offset, rangeEnd)
        );

        if (result.error) {
            throw result.error;
        }

        const batch = result.data || [];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) {
            break;
        }
        offset += PAGE_SIZE;
    }

    return rows;
}

async function getAccountingSnapshot(branchId = "") {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return {
            asOfDate: getUtcTodayIso(),
            scopeLabel: "Head Office",
            accounts: [],
            trialRows: [],
            trialGroups: [],
            trialTotals: { debit: 0, credit: 0 },
            balanceSheet: {
                assetRows: [],
                liabilityRows: [],
                equityRows: [],
                totals: {
                    assets: 0,
                    liabilities: 0,
                    equity: 0,
                    liabilitiesAndEquity: 0
                }
            }
        };
    }

    const normalizedBranchId = String(branchId || "").trim();
    const asOfDate = await getServerTodayIso();

    const [accountsResult, lines] = await Promise.all([
        supabase
            .from("chart_of_accounts")
            .select("id, code, name, account_type, is_active, parent_account_id")
            .eq("business_id", session.businessId)
            .order("code", { ascending: true }),
        getAllJournalLines({
            supabase,
            businessId: session.businessId,
            asOfDate,
            branchId: normalizedBranchId
        })
    ]);

    if (accountsResult.error) {
        throw accountsResult.error;
    }

    const accounts = (accountsResult.data || []).map((account) => ({
        id: String(account.id || ""),
        code: String(account.code || ""),
        name: String(account.name || ""),
        accountType: String(account.account_type || "").toLowerCase(),
        parentId: String(account.parent_account_id || "").trim(),
        isActive: Boolean(account.is_active),
        totalDebit: 0,
        totalCredit: 0
    }));

    const accountMap = new Map(accounts.map((account) => [account.id, account]));
    for (const line of lines) {
        const accountId = String(line.account_id || "");
        if (!accountId || !accountMap.has(accountId)) {
            continue;
        }
        const account = accountMap.get(accountId);
        account.totalDebit += toAmount(line.debit);
        account.totalCredit += toAmount(line.credit);
    }

    const trialRows = accounts
        .map((account) => {
            const columns = getTrialBalanceColumns(account);
            return {
                ...account,
                debitBalance: columns.debit,
                creditBalance: columns.credit
            };
        })
        .filter((account) => account.debitBalance > 0 || account.creditBalance > 0)
        .sort((left, right) => compareCodes(left.code, right.code) || left.name.localeCompare(right.name));

    const trialTotals = trialRows.reduce((totals, row) => ({
        debit: totals.debit + row.debitBalance,
        credit: totals.credit + row.creditBalance
    }), { debit: 0, credit: 0 });

    const trialGroups = buildTrialBalanceGroups(accounts, trialRows);

    const bsRows = accounts
        .filter((account) => BALANCE_SHEET_TYPES.has(account.accountType))
        .map((account) => ({
            ...account,
            balanceSheetAmount: getBalanceSheetAmount(account)
        }))
        .filter((account) => Math.abs(account.balanceSheetAmount) > 0.0000001)
        .sort((left, right) => compareCodes(left.code, right.code) || left.name.localeCompare(right.name));

    const assetRows = bsRows.filter((row) => row.accountType === "asset");
    const liabilityRows = bsRows.filter((row) => row.accountType === "liability");
    const equityRows = bsRows.filter((row) => row.accountType === "equity");

    const totals = {
        assets: assetRows.reduce((sum, row) => sum + row.balanceSheetAmount, 0),
        liabilities: liabilityRows.reduce((sum, row) => sum + row.balanceSheetAmount, 0),
        equity: equityRows.reduce((sum, row) => sum + row.balanceSheetAmount, 0),
        liabilitiesAndEquity: 0
    };
    totals.liabilitiesAndEquity = totals.liabilities + totals.equity;

    return {
        asOfDate,
        scopeLabel: normalizedBranchId ? "Selected Branch" : "Head Office",
        accounts,
        trialRows,
        trialGroups,
        trialTotals,
        balanceSheet: {
            assetRows,
            liabilityRows,
            equityRows,
            totals
        }
    };
}

function renderTrialRows(groups = []) {
    if (!groups.length || !groups.some((group) => (group.categories || []).length)) {
        return `<tr><td colspan="5">No journal postings found for this scope.</td></tr>`;
    }

    return groups.map((group) => `
        <tr class="trial-balance-group-row">
            <td colspan="5"><strong>${escapeHtml(group.label)}</strong></td>
        </tr>
        ${(group.categories || []).map((category) => `
            <tr class="trial-balance-category-row">
                <td colspan="5">${escapeHtml(category.code ? `${category.code} - ${category.name}` : category.name)}</td>
            </tr>
            ${(category.rows || []).map((row) => `
                <tr>
                    <td>${escapeHtml(row.code || "-")}</td>
                    <td>${escapeHtml(row.name || "-")}</td>
                    <td>${escapeHtml(formatAccountTypeLabel(row.accountType))}</td>
                    <td class="accounting-num">${row.debitBalance > 0 ? formatCurrency(row.debitBalance) : "-"}</td>
                    <td class="accounting-num">${row.creditBalance > 0 ? formatCurrency(row.creditBalance) : "-"}</td>
                </tr>
            `).join("")}
            <tr class="trial-balance-subtotal-row">
                <td colspan="3"><strong>${escapeHtml(category.code ? `${category.code} - ${category.name}` : category.name)} Total</strong></td>
                <td class="accounting-num"><strong>${formatCurrency(category.subtotal.debit)}</strong></td>
                <td class="accounting-num"><strong>${formatCurrency(category.subtotal.credit)}</strong></td>
            </tr>
        `).join("")}
        <tr class="trial-balance-subtotal-row">
            <td colspan="3"><strong>${escapeHtml(group.label)} Total</strong></td>
            <td class="accounting-num"><strong>${formatCurrency(group.subtotal.debit)}</strong></td>
            <td class="accounting-num"><strong>${formatCurrency(group.subtotal.credit)}</strong></td>
        </tr>
    `).join("");
}

function renderBalanceSheetRows(rows = []) {
    if (!rows.length) {
        return `<tr><td colspan="3">No records</td></tr>`;
    }

    return rows.map((row) => `
        <tr>
            <td>${escapeHtml(row.code || "-")}</td>
            <td>${escapeHtml(row.name || "-")}</td>
            <td class="accounting-num">${formatCurrency(row.balanceSheetAmount)}</td>
        </tr>
    `).join("");
}

export async function renderAuditorDashboard(context = {}) {
    const scope = context?.branchScope || {};
    const scopedBranchId = String(scope?.branchId || "").trim();
    const effectiveBranchId = scopedBranchId && scopedBranchId !== ALL_BRANCHES_TOKEN ? scopedBranchId : "";
    const snapshot = await getAccountingSnapshot(effectiveBranchId);
    const trialGap = Math.abs(snapshot.trialTotals.debit - snapshot.trialTotals.credit);
    const balanceSheetGap = Math.abs(snapshot.balanceSheet.totals.assets - snapshot.balanceSheet.totals.liabilitiesAndEquity);
    const scopeLabel = String(scope?.label || snapshot.scopeLabel || "Head Office");

    return {
        summary: [
            { label: "Trial Balance Debit", value: formatCurrency(snapshot.trialTotals.debit), note: "current scope", tone: "up" },
            { label: "Trial Balance Credit", value: formatCurrency(snapshot.trialTotals.credit), note: trialGap < 0.01 ? "balanced" : "check mismatch", tone: trialGap < 0.01 ? "up" : "warn" },
            { label: "Balance Sheet Gap", value: formatCurrency(balanceSheetGap), note: "should be 0.00", tone: balanceSheetGap < 0.01 ? "up" : "warn" }
        ],
        content: `
            <div class="section-stack">
                <section class="hero-card">
                    <div>
                        <p class="hero-tag">Account Overview</p>
                        <h2>Monitor accounting health before opening detailed reports.</h2>
                        <p class="hero-copy">Use the Trial Balance tab for full Trial Balance and Balance Sheet tables.</p>
                    </div>
                    <div class="hero-metrics">
                        <div><span>Scope</span><strong>${escapeHtml(scopeLabel)}</strong></div>
                        <div><span>As At</span><strong>${escapeHtml(formatShortDate(snapshot.asOfDate))}</strong></div>
                        <div><span>Assets</span><strong>${formatCurrency(snapshot.balanceSheet.totals.assets)}</strong></div>
                        <div><span>Liabilities + Equity</span><strong>${formatCurrency(snapshot.balanceSheet.totals.liabilitiesAndEquity)}</strong></div>
                    </div>
                </section>
            </div>
        `,
        afterRender() {}
    };
}

export async function renderAuditorTrialBalance(context = {}) {
    const scope = context?.branchScope || {};
    const scopedBranchId = String(scope?.branchId || "").trim();
    const effectiveBranchId = scopedBranchId && scopedBranchId !== ALL_BRANCHES_TOKEN ? scopedBranchId : "";
    const snapshot = await getAccountingSnapshot(effectiveBranchId);
    const trialGap = Math.abs(snapshot.trialTotals.debit - snapshot.trialTotals.credit);
    const balanceSheetGap = Math.abs(snapshot.balanceSheet.totals.assets - snapshot.balanceSheet.totals.liabilitiesAndEquity);
    const scopeLabel = String(scope?.label || snapshot.scopeLabel || "Head Office");

    return {
        summary: [
            { label: "Trial Balance Debit", value: formatCurrency(snapshot.trialTotals.debit), note: "current scope", tone: "up" },
            { label: "Trial Balance Credit", value: formatCurrency(snapshot.trialTotals.credit), note: trialGap < 0.01 ? "balanced" : "check mismatch", tone: trialGap < 0.01 ? "up" : "warn" },
            { label: "Balance Sheet Gap", value: formatCurrency(balanceSheetGap), note: "should be 0.00", tone: balanceSheetGap < 0.01 ? "up" : "warn" }
        ],
        content: `
            <div class="section-stack">
                <section class="panel">
                    <div class="panel-head">
                        <h3>Trial Balance</h3>
                        <span class="badge draft">${escapeHtml(scopeLabel)}</span>
                    </div>
                    <p class="muted mt-18">As at ${escapeHtml(formatShortDate(snapshot.asOfDate))}</p>
                    <div class="accounting-table-wrap mt-18">
                        <table class="accounting-table">
                            <thead>
                                <tr>
                                    <th>Code</th>
                                    <th>Account</th>
                                    <th>Type</th>
                                    <th class="accounting-num">Debit</th>
                                    <th class="accounting-num">Credit</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${renderTrialRows(snapshot.trialGroups)}
                                <tr class="trial-balance-subtotal-row">
                                    <td colspan="3"><strong>Grand Total</strong></td>
                                    <td class="accounting-num"><strong>${formatCurrency(snapshot.trialTotals.debit)}</strong></td>
                                    <td class="accounting-num"><strong>${formatCurrency(snapshot.trialTotals.credit)}</strong></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-head">
                        <h3>Balance Sheet</h3>
                        <span class="badge ${balanceSheetGap < 0.01 ? "paid" : "warn"}">${balanceSheetGap < 0.01 ? "Balanced" : "Check Gap"}</span>
                    </div>
                    <div class="dual-grid mt-18">
                        <div class="accounting-table-wrap">
                            <table class="accounting-table">
                                <thead>
                                    <tr>
                                        <th colspan="3">Assets</th>
                                    </tr>
                                    <tr>
                                        <th>Code</th>
                                        <th>Account</th>
                                        <th class="accounting-num">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${renderBalanceSheetRows(snapshot.balanceSheet.assetRows)}
                                    <tr class="trial-balance-subtotal-row">
                                        <td colspan="2"><strong>Total Assets</strong></td>
                                        <td class="accounting-num"><strong>${formatCurrency(snapshot.balanceSheet.totals.assets)}</strong></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div class="section-stack">
                            <div class="accounting-table-wrap">
                                <table class="accounting-table">
                                    <thead>
                                        <tr>
                                            <th colspan="3">Liabilities</th>
                                        </tr>
                                        <tr>
                                            <th>Code</th>
                                            <th>Account</th>
                                            <th class="accounting-num">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${renderBalanceSheetRows(snapshot.balanceSheet.liabilityRows)}
                                        <tr class="trial-balance-subtotal-row">
                                            <td colspan="2"><strong>Total Liabilities</strong></td>
                                            <td class="accounting-num"><strong>${formatCurrency(snapshot.balanceSheet.totals.liabilities)}</strong></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div class="accounting-table-wrap">
                                <table class="accounting-table">
                                    <thead>
                                        <tr>
                                            <th colspan="3">Equity</th>
                                        </tr>
                                        <tr>
                                            <th>Code</th>
                                            <th>Account</th>
                                            <th class="accounting-num">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${renderBalanceSheetRows(snapshot.balanceSheet.equityRows)}
                                        <tr class="trial-balance-subtotal-row">
                                            <td colspan="2"><strong>Total Equity</strong></td>
                                            <td class="accounting-num"><strong>${formatCurrency(snapshot.balanceSheet.totals.equity)}</strong></td>
                                        </tr>
                                        <tr class="trial-balance-subtotal-row">
                                            <td colspan="2"><strong>Total Liabilities + Equity</strong></td>
                                            <td class="accounting-num"><strong>${formatCurrency(snapshot.balanceSheet.totals.liabilitiesAndEquity)}</strong></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        `,
        afterRender() {}
    };
}
