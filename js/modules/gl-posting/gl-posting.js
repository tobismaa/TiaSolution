import { createTable, formatCurrency } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import { getGeneralLedgerStatement, searchLedgerAccountsByName } from "../general-ledger-report/general-ledger-report-service.js";
import {
    createJournalPosting,
    getJournalEntryDetailsById,
    createJournalReversalPosting,
    getJournalEntryByReference,
    getPostingSetupData,
    getRecentJournalPostings
} from "./gl-posting-service.js";

let activeGlPostingTabState = "journal";

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;");
}

function setSubmittingState(button, isSubmitting) {
    if (!button) {
        return;
    }
    button.disabled = isSubmitting;
    button.classList.toggle("is-loading", isSubmitting);
    button.setAttribute("aria-busy", String(isSubmitting));
}

function formatDateTime(value) {
    if (!value) {
        return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Africa/Lagos"
    }).format(date);
}

function padNumber(value, size = 2) {
    return String(value).padStart(size, "0");
}

async function getServerTodayIso() {
    return new Date().toISOString().slice(0, 10);
}

function generatePostingReference(dateIso = "") {
    const dateToken = String(dateIso || "").trim().replaceAll("-", "");
    const todayToken = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const sourceDate = dateToken.length === 8 ? dateToken : todayToken;
    const now = new Date();
    const timeToken = Number.isNaN(now.getTime())
        ? `${Date.now()}`
        : `${padNumber(now.getHours())}${padNumber(now.getMinutes())}${padNumber(now.getSeconds())}`;
    return `JV-${sourceDate}-${timeToken}`;
}

function renderEntryLinesTable(lines = [], entryDate = "") {
    return createTable(
        ["Date", "Account", "Description", "Debit", "Credit"],
        (lines || []).map((line) => [
            entryDate || "-",
            `${line.accountCode || "-"} - ${line.accountName || "Unknown account"}`,
            line.description || "-",
            formatCurrency(Number(line.debit || 0)),
            formatCurrency(Number(line.credit || 0))
        ])
    );
}

function getReversalLines(lines = []) {
    return (lines || []).map((line) => ({
        ...line,
        debit: Number(line.credit || 0),
        credit: Number(line.debit || 0)
    }));
}

function renderCurrentEntry(entry) {
    if (!entry) {
        return `
            <p class="muted">Enter a reference number to load the current transaction entry.</p>
        `;
    }
    return `
        <div class="mt-18 table-wrap">
            ${renderEntryLinesTable(entry.lines, entry.entryDate)}
        </div>
    `;
}

function renderReversalPreview(entry) {
    if (!entry) {
        return `<p class="muted">Click Reverse Entry to preview swapped debit/credit lines.</p>`;
    }
    return `
        <div class="stack-list">
            <div class="stack-item"><span>Reversal Of</span><strong>${entry.reference || "-"}</strong></div>
            <div class="stack-item"><span>Action</span><strong>Debit and credit sides swapped</strong></div>
        </div>
        <div class="mt-18 table-wrap">
            ${renderEntryLinesTable(getReversalLines(entry.lines), entry.entryDate)}
        </div>
    `;
}

function formatDateOnly(value) {
    if (!value) {
        return "-";
    }
    const date = new Date(value);
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

function formatBalanceWithSide(value) {
    const amount = Number(value || 0);
    const abs = Math.abs(amount);
    if (abs < 0.0000001) {
        return formatCurrency(0);
    }
    return `${formatCurrency(abs)} ${amount < 0 ? "CR" : "DR"}`;
}

function renderGlStatementInline(statement) {
    if (!statement) {
        return `<p class="muted">No statement loaded yet.</p>`;
    }
    return `
        <div class="stack-list">
            <div class="stack-item"><span>Account</span><strong>${statement.account.code} - ${statement.account.name}</strong></div>
            <div class="stack-item"><span>Branch Scope</span><strong>${statement.branchName || "Head Office"}</strong></div>
            <div class="stack-item"><span>Opening Balance</span><strong>${formatBalanceWithSide(statement.openingBalance)}</strong></div>
            <div class="stack-item"><span>Closing Balance</span><strong>${formatBalanceWithSide(statement.closingBalance)}</strong></div>
        </div>
        <div class="mt-18 table-wrap">
            <table class="gl-transaction-table">
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
                    ${(statement.lines || []).length
                        ? (statement.lines || []).map((line) => `
                            <tr>
                                <td>${escapeHtml(formatDateOnly(line.date))}</td>
                                <td>
                                    ${line.entryId
                                        ? `<button class="text-btn gl-ref-btn" type="button" data-gl-inline-entry-open data-entry-id="${escapeHtml(line.entryId)}">${escapeHtml(line.reference || "-")}</button>`
                                        : escapeHtml(line.reference || "-")
                                    }
                                </td>
                                <td>${escapeHtml(line.description || line.memo || "-")}</td>
                                <td>${escapeHtml(formatCurrency(line.debit))}</td>
                                <td>${escapeHtml(formatCurrency(line.credit))}</td>
                                <td>${escapeHtml(formatBalanceWithSide(line.balance))}</td>
                            </tr>
                        `).join("")
                        : `<tr><td colspan="6">No statement lines found.</td></tr>`
                    }
                </tbody>
            </table>
        </div>
    `;
}

function renderRecentPostingsTable(entries = []) {
    return `
        <div class="table-wrap">
            <table class="gl-recent-activity-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Reference</th>
                        <th>Description</th>
                        <th>Debit</th>
                        <th>Credit</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
                    ${entries.length
                        ? entries.map((entry) => `
                            <tr>
                                <td>${escapeHtml(entry.entryDate || "-")}</td>
                                <td><button class="text-btn gl-ref-btn" type="button" data-gl-recent-ref data-entry-id="${escapeHtml(entry.id || "")}">${escapeHtml(entry.reference || "-")}</button></td>
                                <td>${escapeHtml(entry.description || "-")}</td>
                                <td>${escapeHtml(formatCurrency(entry.totalDebit))}</td>
                                <td>${escapeHtml(formatCurrency(entry.totalCredit))}</td>
                                <td>${escapeHtml(formatDateTime(entry.createdAt))}</td>
                            </tr>
                        `).join("")
                        : `<tr><td colspan="6">No recent posting activity.</td></tr>`
                    }
                </tbody>
            </table>
        </div>
    `;
}

export async function renderGlPosting() {
    const [{ accounts, activeBranch }, recent] = await Promise.all([
        getPostingSetupData(),
        getRecentJournalPostings(10)
    ]);

    const accountLookup = accounts.map((account) => ({
        id: String(account.id || ""),
        label: `${account.code} - ${account.name}`
    }));
    const accountOptions = accountLookup
        .map((account) => `<option value="${account.label}"></option>`)
        .join("");

    return {
        summary: [],
        content: `
            <div class="section-stack gl-posting-module">
                <div class="demo-tabbar gl-posting-tabbar" role="tablist" aria-label="GL posting tabs">
                    <button class="btn btn-primary" type="button" data-gl-tab="journal" aria-selected="true">Journal Entries</button>
                    <button class="btn btn-secondary" type="button" data-gl-tab="reversal" aria-selected="false">Reversal</button>
                    <button class="btn btn-secondary" type="button" data-gl-tab="report" aria-selected="false">Report</button>
                </div>

                <section class="panel" data-gl-panel="journal">
                    <div class="module-header">
                        <div>
                            <p class="eyebrow">Journal posting</p>
                            <h2>Post to General Ledger</h2>
                        </div>
                    </div>
                    <form class="form-grid mt-18" data-gl-posting-form>
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Reference Number</span>
                                <input name="reference" type="text" maxlength="80" readonly>
                            </label>
                            <div class="form-field">
                                <span>Backposting</span>
                                <label class="form-check">
                                    <input name="enable_backposting" type="checkbox" value="1">
                                    <span>Use custom posting date</span>
                                </label>
                            </div>
                        </div>
                        <div class="triple-grid">
                            <label class="form-field" data-gl-backpost-date hidden>
                                <span>Posting Date</span>
                                <input name="entry_date" type="date">
                            </label>
                        </div>
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Debit Account</span>
                                <input name="debit_account_search" type="search" list="glAccountList" placeholder="Type account code or name" autocomplete="off" required>
                                <input name="debit_account_id" type="hidden" required>
                            </label>
                            <label class="form-field">
                                <span>Credit Account</span>
                                <input name="credit_account_search" type="search" list="glAccountList" placeholder="Type account code or name" autocomplete="off" required>
                                <input name="credit_account_id" type="hidden" required>
                            </label>
                            <label class="form-field">
                                <span>Amount</span>
                                <input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required>
                            </label>
                        </div>
                        <datalist id="glAccountList">
                            ${accountOptions}
                        </datalist>
                        <label class="form-field">
                            <span>Description</span>
                            <textarea name="description" rows="3" placeholder="Narration for this posting"></textarea>
                        </label>
                        <div class="button-row">
                            <button class="btn btn-primary" type="submit" data-gl-post-submit>
                                <span class="btn-label">Post to GL</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <p class="muted" data-gl-post-status>Debit and credit are posted in a balanced journal entry.</p>
                        </div>
                    </form>
                </section>

                <section class="panel" data-gl-panel="reversal" hidden>
                    <div class="module-header">
                        <div>
                            <p class="eyebrow">Reversal posting</p>
                            <h2>Reverse Journal Entry</h2>
                        </div>
                    </div>
                    <form class="form-grid mt-18" data-gl-reversal-search-form>
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Reference Number</span>
                                <input name="reference" type="search" maxlength="80" placeholder="Enter reference e.g. JV-20260401-101010" required>
                            </label>
                        </div>
                        <div class="button-row">
                            <button class="btn btn-secondary" type="submit" data-gl-reversal-load>
                                <span class="btn-label">Load Entry</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <p class="muted" data-gl-reversal-status>Enter a reference to load transaction entry.</p>
                        </div>
                    </form>
                    <section class="panel mt-18">
                        <div class="module-header">
                            <div>
                                <p class="eyebrow">Current entry</p>
                                <h3>Loaded Transaction</h3>
                            </div>
                        </div>
                        <div class="mt-18" data-gl-reversal-current>
                            <p class="muted">Enter a reference number to load the current transaction entry.</p>
                        </div>
                    </section>
                    <section class="panel mt-18">
                        <div class="module-header">
                            <div>
                                <p class="eyebrow">Reversal preview</p>
                                <h3>Swapped Entry</h3>
                            </div>
                        </div>
                        <div class="button-row mt-18">
                            <button class="btn btn-secondary" type="button" data-gl-reverse-prepare disabled>Reverse Entry</button>
                            <label class="form-check gl-reverse-confirm" data-gl-reverse-confirm-wrap>
                                <input type="checkbox" data-gl-reverse-confirm-input disabled>
                                <span>I confirm this reversal</span>
                            </label>
                            <button class="btn btn-primary" type="button" data-gl-reverse-post disabled>
                                <span class="btn-label">Post Reversal</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                        </div>
                        <div class="mt-18" data-gl-reversal-preview>
                            <p class="muted">Click Reverse Entry to preview swapped debit/credit lines.</p>
                        </div>
                    </section>
                </section>

                <section class="panel" data-gl-panel="report" hidden>
                    <div class="module-header">
                        <div>
                            <p class="eyebrow">General ledger statement</p>
                            <h2>GL Report</h2>
                        </div>
                    </div>
                    <form class="form-grid mt-18" data-gl-report-form-inline>
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Search GL Name</span>
                                <input name="search_name" type="search" list="glPostingReportList" placeholder="Type account code or name..." autocomplete="off" required>
                                <input name="account_id" type="hidden">
                            </label>
                            <label class="form-field">
                                <span>Date From</span>
                                <input name="date_from" type="date" required>
                            </label>
                            <label class="form-field">
                                <span>Date To</span>
                                <input name="date_to" type="date" required>
                            </label>
                        </div>
                        <datalist id="glPostingReportList"></datalist>
                        <div class="button-row">
                            <button class="btn btn-secondary" type="submit" data-gl-report-view-inline>
                                <span class="btn-label">View Statement</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <p class="muted" data-gl-report-status-inline>Pick a General Ledger from suggestions.</p>
                        </div>
                    </form>
                    <div class="mt-18" data-gl-report-result-inline>
                        <p class="muted">No statement loaded yet.</p>
                    </div>
                </section>

                <section class="panel">
                    <div class="module-header">
                        <div>
                            <p class="eyebrow">Recent activity</p>
                            <h3>Recent GL Postings</h3>
                        </div>
                    </div>
                    ${renderRecentPostingsTable(recent)}
                </section>
                <div class="business-modal" data-gl-entry-modal hidden>
                    <div class="business-modal__backdrop" data-gl-entry-close></div>
                    <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="glEntryDetailsTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Reference Detail</p>
                                <h3 id="glEntryDetailsTitle">Journal Entry</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-gl-entry-close>&times;</button>
                        </div>
                        <div class="gl-statement-modal__content" data-gl-entry-content>
                            <p class="muted">No entry selected yet.</p>
                        </div>
                    </div>
                </div>
                <div class="business-modal" data-gl-success-modal hidden>
                    <div class="business-modal__backdrop" data-gl-success-close></div>
                    <div class="business-modal__dialog gl-success-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="glSuccessTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Successful</p>
                                <h3 id="glSuccessTitle">Posting completed</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-gl-success-close>&times;</button>
                        </div>
                        <div class="gl-success-modal__body" data-gl-success-message></div>
                    </div>
                </div>
            </div>
        `,
        afterRender(container, refresh) {
            const tabButtons = Array.from(container.querySelectorAll("[data-gl-tab]"));
            const panels = Array.from(container.querySelectorAll("[data-gl-panel]"));
            const successModal = container.querySelector("[data-gl-success-modal]");
            const successMessageNode = container.querySelector("[data-gl-success-message]");
            const successCloseControls = Array.from(container.querySelectorAll(".business-modal__close[data-gl-success-close]"));
            const entryModal = container.querySelector("[data-gl-entry-modal]");
            const entryContent = container.querySelector("[data-gl-entry-content]");
            const entryCloseControls = Array.from(container.querySelectorAll(".business-modal__close[data-gl-entry-close]"));
            let successModalOnClose = null;
            const openSuccessModal = (messageHtml, onClose = null) => {
                if (!successModal || !successMessageNode) {
                    if (typeof onClose === "function") {
                        onClose();
                    }
                    return;
                }
                successMessageNode.innerHTML = messageHtml;
                successModalOnClose = typeof onClose === "function" ? onClose : null;
                successModal.hidden = false;
            };
            const closeSuccessModal = () => {
                if (successModal) {
                    successModal.hidden = true;
                }
                const callback = successModalOnClose;
                successModalOnClose = null;
                if (typeof callback === "function") {
                    void callback();
                }
            };
            successCloseControls.forEach((control) => {
                control.addEventListener("click", closeSuccessModal);
            });
            const openEntryModal = () => {
                if (entryModal) {
                    entryModal.hidden = false;
                }
            };
            const closeEntryModal = () => {
                if (entryModal) {
                    entryModal.hidden = true;
                }
            };
            entryCloseControls.forEach((control) => {
                control.addEventListener("click", closeEntryModal);
            });

            const setActiveTab = (tabKey) => {
                tabButtons.forEach((button) => {
                    const active = String(button.getAttribute("data-gl-tab") || "") === tabKey;
                    button.classList.toggle("btn-primary", active);
                    button.classList.toggle("btn-secondary", !active);
                    button.setAttribute("aria-selected", String(active));
                });
                panels.forEach((panel) => {
                    panel.hidden = String(panel.getAttribute("data-gl-panel") || "") !== tabKey;
                });
                activeGlPostingTabState = tabKey;
            };
            tabButtons.forEach((button) => {
                button.addEventListener("click", () => {
                    setActiveTab(String(button.getAttribute("data-gl-tab") || "journal"));
                });
            });
            const savedTab = String(activeGlPostingTabState || "journal").toLowerCase();
            const initialTab = (savedTab === "journal" || savedTab === "reversal" || savedTab === "report") ? savedTab : "journal";
            setActiveTab(initialTab);

            const form = container.querySelector("[data-gl-posting-form]");
            const statusNode = container.querySelector("[data-gl-post-status]");
            const submitButton = container.querySelector("[data-gl-post-submit]");
            const dateField = form?.querySelector("[data-gl-backpost-date]");
            const dateInput = form?.querySelector('input[name="entry_date"]');
            const backpostingToggle = form?.querySelector('input[name="enable_backposting"]');
            const referenceInput = form?.querySelector('input[name="reference"]');
            const debitSearchInput = form?.querySelector('input[name="debit_account_search"]');
            const creditSearchInput = form?.querySelector('input[name="credit_account_search"]');
            const debitIdInput = form?.querySelector('input[name="debit_account_id"]');
            const creditIdInput = form?.querySelector('input[name="credit_account_id"]');
            let serverToday = "";

            const resolveAccountId = (searchText) => {
                const normalized = String(searchText || "").trim().toLowerCase();
                if (!normalized) {
                    return "";
                }
                const exact = accountLookup.find((item) => item.label.toLowerCase() === normalized);
                if (exact) {
                    return exact.id;
                }
                const startsWith = accountLookup.find((item) => item.label.toLowerCase().startsWith(normalized));
                return startsWith?.id || "";
            };

            const bindAccountSearch = (searchInput, idInput) => {
                if (!searchInput || !idInput) {
                    return;
                }
                const update = () => {
                    const resolved = resolveAccountId(searchInput.value);
                    idInput.value = resolved;
                };
                searchInput.addEventListener("input", update);
                searchInput.addEventListener("change", update);
                searchInput.addEventListener("blur", update);
            };

            const refreshReference = () => {
                if (!referenceInput) {
                    return;
                }
                const activeDate = backpostingToggle?.checked ? String(dateInput?.value || "") : serverToday;
                referenceInput.value = generatePostingReference(activeDate);
            };

            const applyBackpostingState = () => {
                const isBackposting = Boolean(backpostingToggle?.checked);
                if (dateField) {
                    dateField.hidden = !isBackposting;
                }
                if (dateInput) {
                    dateInput.required = isBackposting;
                    dateInput.disabled = !isBackposting;
                }
                refreshReference();
            };

            void getServerTodayIso().then((today) => {
                serverToday = today;
                if (dateInput && !dateInput.value) {
                    dateInput.value = today;
                }
                applyBackpostingState();
            });

            backpostingToggle?.addEventListener("change", applyBackpostingState);
            dateInput?.addEventListener("change", refreshReference);
            bindAccountSearch(debitSearchInput, debitIdInput);
            bindAccountSearch(creditSearchInput, creditIdInput);

            form?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!form) {
                    return;
                }

                const formData = new FormData(form);
                const isBackposting = formData.get("enable_backposting") === "1";
                const entryDate = String(isBackposting ? formData.get("entry_date") : serverToday).trim();
                const debitAccountId = String(formData.get("debit_account_id") || "").trim();
                const creditAccountId = String(formData.get("credit_account_id") || "").trim();

                if (!entryDate) {
                    if (statusNode) {
                        statusNode.textContent = "Posting date could not be resolved. Try again.";
                    }
                    return;
                }
                if (!debitAccountId || !creditAccountId) {
                    if (statusNode) {
                        statusNode.textContent = "Select debit and credit accounts from the suggestion list.";
                    }
                    return;
                }

                setSubmittingState(submitButton, true);
                if (statusNode) {
                    statusNode.textContent = "Posting journal entry...";
                }
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    const posted = await createJournalPosting({
                        entry_date: entryDate,
                        reference: String(formData.get("reference") || ""),
                        description: String(formData.get("description") || ""),
                        debit_account_id: debitAccountId,
                        credit_account_id: creditAccountId,
                        amount: Number(formData.get("amount") || 0)
                    });

                    if (statusNode) {
                        statusNode.textContent = "Posted successfully.";
                    }
                    showToast("GL posting completed.");
                    openSuccessModal(`
                        <p class="muted">Successful</p>
                        <p><strong>Reference:</strong> ${posted?.reference || "-"}</p>
                    `, async () => {
                        if (typeof refresh === "function") {
                            await refresh();
                        }
                    });
                } catch (error) {
                    const message = error?.message || "Unable to post journal entry.";
                    if (statusNode) {
                        statusNode.textContent = message;
                    }
                    showToast(message);
                } finally {
                    setSubmittingState(submitButton, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });

            const reversalForm = container.querySelector("[data-gl-reversal-search-form]");
            const reversalStatus = container.querySelector("[data-gl-reversal-status]");
            const reversalLoadButton = container.querySelector("[data-gl-reversal-load]");
            const reversalCurrentNode = container.querySelector("[data-gl-reversal-current]");
            const reversalPreviewNode = container.querySelector("[data-gl-reversal-preview]");
            const reversePrepareButton = container.querySelector("[data-gl-reverse-prepare]");
            const reverseConfirmInput = container.querySelector("[data-gl-reverse-confirm-input]");
            const reversePostButton = container.querySelector("[data-gl-reverse-post]");
            const reversalReferenceInput = reversalForm?.querySelector('input[name="reference"]');
            const reportForm = container.querySelector("[data-gl-report-form-inline]");
            const reportSearchInput = reportForm?.querySelector('input[name="search_name"]');
            const reportAccountIdInput = reportForm?.querySelector('input[name="account_id"]');
            const reportDateFromInput = reportForm?.querySelector('input[name="date_from"]');
            const reportDateToInput = reportForm?.querySelector('input[name="date_to"]');
            const reportViewButton = container.querySelector("[data-gl-report-view-inline]");
            const reportStatus = container.querySelector("[data-gl-report-status-inline]");
            const reportResult = container.querySelector("[data-gl-report-result-inline]");
            const reportList = container.querySelector("#glPostingReportList");

            let selectedEntry = null;
            let reversalReady = false;
            let reportOptions = [];
            let reportSearchTimer = null;

            const renderEntryDetailsHtml = (entry) => {
                if (!entry) {
                    return `<p class="muted">No transaction details available.</p>`;
                }
                return `
                    <div class="gl-summary-grid">
                        <article class="gl-summary-card"><span>Reference</span><strong>${escapeHtml(entry.reference || "-")}</strong></article>
                        <article class="gl-summary-card"><span>Description</span><strong>${escapeHtml(entry.description || "-")}</strong></article>
                        <article class="gl-summary-card"><span>Entry Date</span><strong>${escapeHtml(formatDateOnly(entry.entryDate))}</strong></article>
                        <article class="gl-summary-card"><span>Posted At</span><strong>${escapeHtml(formatDateTime(entry.createdAt))}</strong></article>
                        <article class="gl-summary-card"><span>Branch</span><strong>${escapeHtml(entry.branchName || "-")}</strong></article>
                    </div>
                    <div class="mt-18 table-wrap">
                        ${renderEntryLinesTable(entry.lines, entry.entryDate)}
                    </div>
                `;
            };

            const openEntryById = async (entryId) => {
                const id = String(entryId || "").trim();
                if (!id || !entryContent) {
                    return;
                }
                entryContent.innerHTML = `<p class="muted">Loading reference detail...</p>`;
                openEntryModal();
                window.TIA_PAGE_LOADING?.show?.();
                try {
                    const entry = await getJournalEntryDetailsById(id);
                    entryContent.innerHTML = renderEntryDetailsHtml(entry);
                } catch (error) {
                    entryContent.innerHTML = `<p class="muted">${escapeHtml(error?.message || "Unable to load reference detail.")}</p>`;
                } finally {
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            };

            container.querySelectorAll("[data-gl-recent-ref]").forEach((button) => {
                button.addEventListener("click", () => {
                    void openEntryById(button.getAttribute("data-entry-id"));
                });
            });


            const resetReversalState = () => {
                reversalReady = false;
                if (reversePrepareButton) {
                    reversePrepareButton.disabled = !selectedEntry;
                }
                if (reverseConfirmInput) {
                    reverseConfirmInput.checked = false;
                    reverseConfirmInput.disabled = !selectedEntry;
                }
                if (reversePostButton) {
                    reversePostButton.disabled = true;
                }
                if (reversalPreviewNode) {
                    reversalPreviewNode.innerHTML = renderReversalPreview(null);
                }
            };

            const prepareReversalPreview = () => {
                if (!selectedEntry) {
                    if (reversalStatus) {
                        reversalStatus.textContent = "Load a transaction first.";
                    }
                    return;
                }
                reversalReady = true;
                if (reversalPreviewNode) {
                    reversalPreviewNode.innerHTML = renderReversalPreview(selectedEntry);
                }
                if (reverseConfirmInput) {
                    reverseConfirmInput.disabled = false;
                    reverseConfirmInput.checked = false;
                }
                if (reversePostButton) {
                    reversePostButton.disabled = true;
                }
                if (reversalStatus) {
                    reversalStatus.textContent = "Reversal preview ready. Confirm and click Post Reversal.";
                }
            };

            reversalReferenceInput?.addEventListener("input", () => {
                selectedEntry = null;
                if (reversalCurrentNode) {
                    reversalCurrentNode.innerHTML = renderCurrentEntry(null);
                }
                resetReversalState();
            });

            reversalForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!reversalReferenceInput) {
                    return;
                }
                const reference = String(reversalReferenceInput.value || "").trim();
                if (!reference) {
                    if (reversalStatus) {
                        reversalStatus.textContent = "Enter a reference number.";
                    }
                    return;
                }

                setSubmittingState(reversalLoadButton, true);
                if (reversalStatus) {
                    reversalStatus.textContent = "Loading transaction entry...";
                }
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    selectedEntry = await getJournalEntryByReference(reference);
                    if (reversalCurrentNode) {
                        reversalCurrentNode.innerHTML = renderCurrentEntry(selectedEntry);
                    }
                    resetReversalState();
                    if (reversalStatus) {
                        reversalStatus.textContent = "Transaction loaded. Click Reverse Entry.";
                    }
                } catch (error) {
                    selectedEntry = null;
                    if (reversalCurrentNode) {
                        reversalCurrentNode.innerHTML = renderCurrentEntry(null);
                    }
                    resetReversalState();
                    const message = error?.message || "Unable to load journal entry.";
                    if (reversalStatus) {
                        reversalStatus.textContent = message;
                    }
                    showToast(message);
                } finally {
                    setSubmittingState(reversalLoadButton, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });

            reversePrepareButton?.addEventListener("click", () => {
                prepareReversalPreview();
            });

            reverseConfirmInput?.addEventListener("change", () => {
                const canPost = Boolean(selectedEntry) && reversalReady && Boolean(reverseConfirmInput.checked);
                if (reversePostButton) {
                    reversePostButton.disabled = !canPost;
                }
            });

            reversePostButton?.addEventListener("click", async () => {
                if (!selectedEntry || !reversalReady) {
                    if (reversalStatus) {
                        reversalStatus.textContent = "Prepare reversal first.";
                    }
                    return;
                }
                if (!reverseConfirmInput?.checked) {
                    if (reversalStatus) {
                        reversalStatus.textContent = "Confirm reversal before posting.";
                    }
                    return;
                }

                setSubmittingState(reversePostButton, true);
                if (reversalStatus) {
                    reversalStatus.textContent = "Posting reversal...";
                }
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    const reversal = await createJournalReversalPosting({
                        entry_id: selectedEntry.id,
                        entry_date: serverToday
                    });
                    if (reversalStatus) {
                        reversalStatus.textContent = `Reversal posted: ${reversal.reference}.`;
                    }
                    showToast("Reversal posted successfully.");
                    openSuccessModal(`
                        <p class="muted">Successful</p>
                        <p><strong>Reference:</strong> ${reversal?.reference || "-"}</p>
                    `, async () => {
                        if (typeof refresh === "function") {
                            await refresh();
                        }
                    });
                } catch (error) {
                    const message = error?.message || "Unable to post reversal.";
                    if (reversalStatus) {
                        reversalStatus.textContent = message;
                    }
                    showToast(message);
                } finally {
                    setSubmittingState(reversePostButton, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });

            const resolveReportAccountId = (value) => {
                const normalized = String(value || "").trim().toLowerCase();
                if (!normalized) {
                    return "";
                }
                const exact = reportOptions.find((item) => String(item.label || "").toLowerCase() === normalized);
                return String(exact?.id || "");
            };

            const loadReportSuggestions = async (query) => {
                try {
                    const branchId = activeBranch?.canAccessAllBranches ? "" : String(activeBranch?.id || "").trim();
                    const rows = await searchLedgerAccountsByName(query, { branchId });
                    reportOptions = (rows || []).map((item) => ({
                        id: item.id,
                        label: `${item.code} - ${item.name}`
                    }));
                    if (reportList) {
                        reportList.innerHTML = "";
                        const optionNodes = reportOptions.map((item) => {
                            const option = document.createElement("option");
                            option.value = item.label;
                            return option;
                        });
                        reportList.replaceChildren(...optionNodes);
                    }
                } catch {
                    reportOptions = [];
                }
            };

            void getServerTodayIso().then((today) => {
                if (reportDateToInput && !reportDateToInput.value) {
                    reportDateToInput.value = today;
                }
                if (reportDateFromInput && !reportDateFromInput.value) {
                    const base = new Date(`${today}T00:00:00Z`);
                    if (!Number.isNaN(base.getTime())) {
                        base.setUTCMonth(base.getUTCMonth() - 1);
                        reportDateFromInput.value = `${base.getUTCFullYear()}-${padNumber(base.getUTCMonth() + 1)}-${padNumber(base.getUTCDate())}`;
                    }
                }
            });

            reportSearchInput?.addEventListener("input", () => {
                if (reportSearchTimer) {
                    window.clearTimeout(reportSearchTimer);
                }
                if (reportAccountIdInput) {
                    reportAccountIdInput.value = resolveReportAccountId(reportSearchInput.value);
                }
                reportSearchTimer = window.setTimeout(() => {
                    void loadReportSuggestions(String(reportSearchInput.value || "").trim());
                }, 180);
            });
            reportSearchInput?.addEventListener("change", () => {
                if (reportAccountIdInput) {
                    reportAccountIdInput.value = resolveReportAccountId(reportSearchInput.value);
                }
            });
            reportSearchInput?.addEventListener("focus", () => {
                void loadReportSuggestions(String(reportSearchInput.value || "").trim());
            });

            reportForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!reportForm) {
                    return;
                }
                const data = new FormData(reportForm);
                const accountId = String(data.get("account_id") || "").trim() || resolveReportAccountId(String(data.get("search_name") || ""));
                const dateFrom = String(data.get("date_from") || "").trim();
                const dateTo = String(data.get("date_to") || "").trim();
                const branchId = activeBranch?.canAccessAllBranches ? "" : String(activeBranch?.id || "").trim();

                if (!accountId) {
                    if (reportStatus) {
                        reportStatus.textContent = "Pick a General Ledger from suggestions before viewing.";
                    }
                    return;
                }

                setSubmittingState(reportViewButton, true);
                if (reportStatus) {
                    reportStatus.textContent = "Loading statement...";
                }
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    const statement = await getGeneralLedgerStatement({
                        accountId,
                        dateFrom,
                        dateTo,
                        branchId
                    });
                    if (reportResult) {
                        reportResult.innerHTML = renderGlStatementInline(statement);
                        reportResult.querySelectorAll("[data-gl-inline-entry-open]").forEach((button) => {
                            button.addEventListener("click", () => {
                                void openEntryById(button.getAttribute("data-entry-id"));
                            });
                        });
                    }
                    if (reportStatus) {
                        reportStatus.textContent = "Statement loaded.";
                    }
                } catch (error) {
                    if (reportStatus) {
                        reportStatus.textContent = error?.message || "Unable to load statement.";
                    }
                    if (reportResult) {
                        reportResult.innerHTML = `<p class="muted">${error?.message || "Unable to load statement."}</p>`;
                    }
                } finally {
                    setSubmittingState(reportViewButton, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });
        }
    };
}
