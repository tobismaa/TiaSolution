import { formatCurrency } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import { getGeneralLedgerStatement, searchLedgerAccountsByName } from "./general-ledger-report-service.js";

function esc(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;");
}

function toCsvCell(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
}

function exportStatementCsv(statement) {
    if (!statement) {
        return;
    }

    const rows = [
        ["General Ledger Statement", `${statement.account.code} - ${statement.account.name}`],
        ["Date Range", `${statement.from} to ${statement.to}`],
        ["Opening Balance", statement.openingBalance],
        ["Total Debit", statement.totalDebit],
        ["Total Credit", statement.totalCredit],
        ["Closing Balance", statement.closingBalance],
        [],
        ["Date", "Reference", "Description", "Debit", "Credit", "Balance"],
        ...statement.lines.map((line) => [
            line.date,
            line.reference,
            line.description || line.memo,
            line.debit,
            line.credit,
            line.balance
        ])
    ];

    const csv = rows.map((row) => row.map(toCsvCell).join(",")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gl-statement-${statement.account.code || "account"}-${statement.from}-to-${statement.to}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function renderStatement(statement) {
    if (!statement) {
        return `
            <section class="panel">
                <p class="muted">Run a search to view general ledger statement.</p>
            </section>
        `;
    }

    return `
        <section class="panel">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Statement</p>
                    <h3>${esc(statement.account.code)} - ${esc(statement.account.name)}</h3>
                </div>
                <button class="btn btn-secondary" type="button" data-gl-export>Export Excel</button>
            </div>
            <div class="stack-list mt-18">
                <div class="stack-item"><span>Opening Balance</span><strong>${formatCurrency(statement.openingBalance)}</strong></div>
                <div class="stack-item"><span>Total Debit</span><strong>${formatCurrency(statement.totalDebit)}</strong></div>
                <div class="stack-item"><span>Total Credit</span><strong>${formatCurrency(statement.totalCredit)}</strong></div>
                <div class="stack-item"><span>Closing Balance</span><strong>${formatCurrency(statement.closingBalance)}</strong></div>
            </div>
            <div class="mt-18 table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Reference</th>
                            <th>Description</th>
                            <th>Debit</th>
                            <th>Credit</th>
                            <th>Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${statement.lines.length
                            ? statement.lines.map((line) => `
                                <tr>
                                    <td>${esc(line.date)}</td>
                                    <td>${esc(line.reference)}</td>
                                    <td>${esc(line.description || line.memo)}</td>
                                    <td>${formatCurrency(line.debit)}</td>
                                    <td>${formatCurrency(line.credit)}</td>
                                    <td>${formatCurrency(line.balance)}</td>
                                </tr>
                            `).join("")
                            : `<tr><td colspan="6">No debit or credit movement for this date range.</td></tr>`
                        }
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

export async function renderGeneralLedgerReport() {
    return {
        summary: [],
        content: `
            <div class="section-stack">
                <div class="module-header">
                    <div>
                        <p class="eyebrow">Ledger statement</p>
                        <h2>General Ledger Report</h2>
                    </div>
                </div>
                <section class="panel">
                    <form class="form-grid" id="glReportForm">
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Search Ledger Name</span>
                                <input name="search_name" type="search" placeholder="e.g. Cash, Revenue, Expense">
                            </label>
                            <label class="form-field">
                                <span>Choose Ledger</span>
                                <select name="account_id" required>
                                    <option value="">Select a ledger account</option>
                                </select>
                            </label>
                        </div>
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Date From</span>
                                <input name="date_from" type="date" required>
                            </label>
                            <label class="form-field">
                                <span>Date To</span>
                                <input name="date_to" type="date" required>
                            </label>
                        </div>
                        <div class="button-row">
                            <button class="btn btn-primary" type="submit">
                                <span class="btn-label">Open Statement</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <p class="muted" data-gl-report-status>Search account name, choose ledger, and date range.</p>
                        </div>
                    </form>
                </section>
                <div data-gl-report-result>
                    ${renderStatement(null)}
                </div>
            </div>
        `,
        afterRender(container) {
            const form = container.querySelector("#glReportForm");
            const status = container.querySelector("[data-gl-report-status]");
            const resultHost = container.querySelector("[data-gl-report-result]");
            const searchInput = form?.querySelector('input[name="search_name"]');
            const accountSelect = form?.querySelector('select[name="account_id"]');
            const submitButton = form?.querySelector('button[type="submit"]');
            let currentStatement = null;

            const setSubmitState = (isLoading) => {
                if (!submitButton) return;
                submitButton.disabled = isLoading;
                submitButton.classList.toggle("is-loading", isLoading);
                submitButton.setAttribute("aria-busy", String(isLoading));
            };

            const populateOptions = async (query = "") => {
                if (!accountSelect) {
                    return;
                }

                try {
                    const options = await searchLedgerAccountsByName(query);
                    const currentValue = accountSelect.value;
                    accountSelect.innerHTML = `
                        <option value="">Select a ledger account</option>
                        ${options.map((item) => `
                            <option value="${esc(item.id)}">${esc(item.code)} - ${esc(item.name)}</option>
                        `).join("")}
                    `;
                    if (currentValue && options.some((item) => item.id === currentValue)) {
                        accountSelect.value = currentValue;
                    }
                } catch (error) {
                    status.textContent = error?.message || "Unable to load ledger account list.";
                }
            };

            searchInput?.addEventListener("input", () => {
                void populateOptions(searchInput.value);
            });

            form?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!form || !status || !resultHost) {
                    return;
                }

                const data = new FormData(form);
                status.textContent = "Loading statement...";
                setSubmitState(true);
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    const statement = await getGeneralLedgerStatement({
                        accountId: String(data.get("account_id") || ""),
                        dateFrom: String(data.get("date_from") || ""),
                        dateTo: String(data.get("date_to") || "")
                    });

                    currentStatement = statement;
                    resultHost.innerHTML = renderStatement(statement);
                    status.textContent = "Statement loaded.";
                    showToast("General ledger statement loaded.");

                    const exportButton = resultHost.querySelector("[data-gl-export]");
                    exportButton?.addEventListener("click", () => {
                        exportStatementCsv(currentStatement);
                        showToast("General ledger statement exported.");
                    });
                } catch (error) {
                    currentStatement = null;
                    resultHost.innerHTML = renderStatement(null);
                    status.textContent = error?.message || "Unable to load statement.";
                    showToast(error?.message || "Unable to load statement.");
                } finally {
                    setSubmitState(false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });

            void populateOptions("");
        }
    };
}
