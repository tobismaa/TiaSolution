import { formatCurrency } from "../core/utils.js";
import { getCurrentSessionContext } from "../core/session.js";
import { getSupabaseClient } from "../core/supabase-client.js";
import { getActiveBranchDetails } from "../core/data-access.js";
import {
    getOpenedAccountByNumber,
    postDepositToOpenedAccount,
    postTransferBetweenOpenedAccounts,
    postWithdrawalFromOpenedAccount
} from "../modules/account-management/account-management-service.js";
import { showToast } from "../shared/toast.js";

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

async function getOperationsMetrics() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        return {
            activeBranchName: "Active Branch",
            glPostingsMonth: 0,
            glPostedValueMonth: 0,
            expensesPending: 0,
            expensesSubmittedMonth: 0,
            expensesSubmittedValueMonth: 0
        };
    }

    try {
        const activeBranch = await getActiveBranchDetails(session.userId, session.businessId);
        const branchId = activeBranch?.canAccessAllBranches ? "" : String(activeBranch?.id || "").trim();
        const { from, toExclusive } = getMonthBounds();

        const journalResult = await runWithBranchFallback(
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
        );
        if (journalResult.error) {
            throw journalResult.error;
        }
        const journalEntries = journalResult.data || [];
        const journalIds = journalEntries.map((entry) => entry.id).filter(Boolean);

        let glPostedValueMonth = 0;
        if (journalIds.length) {
            const lineResult = await supabase
                .from("journal_entry_lines")
                .select("debit")
                .in("journal_entry_id", journalIds);
            if (lineResult.error) {
                throw lineResult.error;
            }
            glPostedValueMonth = (lineResult.data || []).reduce((sum, line) => sum + toAmount(line.debit), 0);
        }

        const expensesResult = await runWithBranchFallback(
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
        );
        if (expensesResult.error) {
            throw expensesResult.error;
        }
        const expenses = expensesResult.data || [];
        const expensesPending = expenses.filter((row) => String(row.status || "").toLowerCase() === "pending").length;
        const expensesSubmittedMonthRows = expenses.filter((row) => {
            const dateText = String(row.incurred_at || "");
            return dateText >= from && dateText < toExclusive;
        });
        const expensesSubmittedMonth = expensesSubmittedMonthRows.length;
        const expensesSubmittedValueMonth = expensesSubmittedMonthRows.reduce((sum, row) => sum + toAmount(row.amount), 0);

        return {
            activeBranchName: activeBranch?.canAccessAllBranches ? "Head Office" : String(activeBranch?.name || "Active Branch"),
            glPostingsMonth: journalEntries.length,
            glPostedValueMonth,
            expensesPending,
            expensesSubmittedMonth,
            expensesSubmittedValueMonth
        };
    } catch {
        return {
            activeBranchName: "Active Branch",
            glPostingsMonth: 0,
            glPostedValueMonth: 0,
            expensesPending: 0,
            expensesSubmittedMonth: 0,
            expensesSubmittedValueMonth: 0
        };
    }
}

function esc(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function isRenderableImage(value) {
    const text = String(value || "").trim().toLowerCase();
    return text.startsWith("data:image/") || text.endsWith(".png") || text.endsWith(".jpg") || text.endsWith(".jpeg") || text.endsWith(".webp");
}

function buildOpsDocumentPreview(url, fileName, emptyText) {
    const resolvedUrl = String(url || "").trim();
    const resolvedName = String(fileName || "").trim();
    if (resolvedUrl && isRenderableImage(resolvedUrl)) {
        return `
            <div class="statement-preview-media">
                <img src="${esc(resolvedUrl)}" alt="${esc(resolvedName || emptyText)}">
            </div>
        `;
    }
    if (resolvedName) {
        return `<div class="passport-empty">${esc(resolvedName)}</div>`;
    }
    return `<div class="passport-empty">${esc(emptyText)}</div>`;
}

function renderAccountLookupCard(prefix, title, options = {}) {
    const showDocuments = options.showDocuments !== false;
    return `
        <div class="payroll-structure-card">
            <label class="form-field">
                <span>${esc(title)} Account Number</span>
                <input type="text" inputmode="numeric" maxlength="10" data-ops-account-input="${esc(prefix)}" placeholder="Enter 10-digit account number">
            </label>
            <div class="payroll-note-card">
                <strong data-ops-account-name="${esc(prefix)}">Customer name will appear here</strong>
                <span data-ops-account-branch="${esc(prefix)}">Branch will appear here</span>
                <span data-ops-account-balance="${esc(prefix)}">Available balance will appear here</span>
            </div>
            ${showDocuments ? `
                <div class="dual-grid mt-18">
                    <div class="passport-card">
                        <span class="label">Passport</span>
                        <div class="statement-preview-box statement-preview-box--compact statement-preview-box--square mt-18" data-ops-account-passport="${esc(prefix)}">${buildOpsDocumentPreview("", "", "No passport uploaded.")}</div>
                    </div>
                    <div class="passport-card">
                        <span class="label">Signature</span>
                        <div class="statement-preview-box statement-preview-box--compact statement-preview-box--square mt-18" data-ops-account-signature="${esc(prefix)}">${buildOpsDocumentPreview("", "", "No signature uploaded.")}</div>
                    </div>
                </div>
            ` : ""}
        </div>
    `;
}

function renderOperationsWorkspace() {
    return `
        <section class="panel mt-18">
            <div class="panel-head">
                <h3>Operations</h3>
                <span class="badge paid">Customer Transactions</span>
            </div>
            <p class="muted mt-18">Post transfers, withdrawals, and deposits directly into customer accounts from one operations workspace.</p>

            <div class="button-row demo-tabbar operations-action-tabs mt-18" role="tablist" aria-label="Operations transaction tabs">
                <button class="btn btn-primary" type="button" data-ops-open-modal="transfer">Transfer</button>
                <button class="btn btn-secondary" type="button" data-ops-open-modal="withdrawal">Withdrawal</button>
                <button class="btn btn-secondary" type="button" data-ops-open-modal="deposit">Deposit</button>
            </div>
        </section>

        <div class="business-modal" data-ops-modal="transfer" hidden>
            <div class="business-modal__backdrop" data-ops-close="transfer"></div>
            <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="opsTransferTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Operation</p>
                        <h3 id="opsTransferTitle">Transfer</h3>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-ops-close="transfer">&times;</button>
                </div>
                <form class="form-grid" data-ops-transfer-form>
                    <div class="dual-grid">
                        ${renderAccountLookupCard("transfer-from", "Source")}
                        ${renderAccountLookupCard("transfer-to", "Destination", { showDocuments: false })}
                    </div>
                    <div class="dual-grid mt-18">
                        <label class="form-field">
                            <span>Amount</span>
                            <input type="text" name="amount" inputmode="decimal" data-ops-amount placeholder="0.00" required>
                        </label>
                        <label class="form-field">
                            <span>Narration</span>
                            <input type="text" name="narration" placeholder="Optional depositor name">
                        </label>
                    </div>
                    <div class="button-row">
                        <button class="btn btn-primary" type="submit" data-ops-submit="transfer">Post Transfer</button>
                        <button class="btn btn-secondary" type="button" data-ops-close="transfer">Cancel</button>
                        <p class="muted" data-ops-status="transfer">Enter both customer accounts to process transfer.</p>
                    </div>
                </form>
            </div>
        </div>

        <div class="business-modal" data-ops-modal="withdrawal" hidden>
            <div class="business-modal__backdrop" data-ops-close="withdrawal"></div>
            <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="opsWithdrawalTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Operation</p>
                        <h3 id="opsWithdrawalTitle">Withdrawal</h3>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-ops-close="withdrawal">&times;</button>
                </div>
                <form class="form-grid" data-ops-withdrawal-form>
                    <div class="dual-grid">
                        ${renderAccountLookupCard("withdrawal", "Customer")}
                        <div class="payroll-note-card">
                            <strong>Withdrawal posting</strong>
                            <span>This debits the customer account immediately and records the transaction in the account statement.</span>
                        </div>
                    </div>
                    <div class="dual-grid mt-18">
                        <label class="form-field">
                            <span>Amount</span>
                            <input type="text" name="amount" inputmode="decimal" data-ops-amount placeholder="0.00" required>
                        </label>
                        <label class="form-field">
                            <span>Withdrawer Name</span>
                            <input type="text" name="narration" placeholder="Optional withdrawer name" data-ops-person-name>
                        </label>
                    </div>
                    <div class="button-row">
                        <button class="btn btn-primary" type="submit" data-ops-submit="withdrawal">Post Withdrawal</button>
                        <button class="btn btn-secondary" type="button" data-ops-close="withdrawal">Cancel</button>
                        <p class="muted" data-ops-status="withdrawal">Enter customer account to process withdrawal.</p>
                    </div>
                </form>
            </div>
        </div>

        <div class="business-modal" data-ops-modal="deposit" hidden>
            <div class="business-modal__backdrop" data-ops-close="deposit"></div>
            <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="opsDepositTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Operation</p>
                        <h3 id="opsDepositTitle">Deposit</h3>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-ops-close="deposit">&times;</button>
                </div>
                <form class="form-grid" data-ops-deposit-form>
                    <div class="dual-grid">
                        ${renderAccountLookupCard("deposit", "Customer", { showDocuments: false })}
                        <div class="payroll-note-card">
                            <strong>Deposit posting</strong>
                            <span>This credits the customer account immediately and records the transaction in the account statement.</span>
                        </div>
                    </div>
                    <div class="dual-grid mt-18">
                        <label class="form-field">
                            <span>Amount</span>
                            <input type="text" name="amount" inputmode="decimal" data-ops-amount placeholder="0.00" required>
                        </label>
                        <label class="form-field">
                            <span>Depositor Name</span>
                            <input type="text" name="narration" placeholder="Enter depositor name" data-ops-person-name required>
                        </label>
                    </div>
                    <div class="button-row">
                        <button class="btn btn-primary" type="submit" data-ops-submit="deposit">Post Deposit</button>
                        <button class="btn btn-secondary" type="button" data-ops-close="deposit">Cancel</button>
                        <p class="muted" data-ops-status="deposit">Enter customer account to process deposit.</p>
                    </div>
                </form>
            </div>
        </div>

        <div class="business-modal" data-ops-modal="success" hidden>
            <div class="business-modal__backdrop" data-ops-close="success"></div>
            <div class="business-modal__dialog ops-success-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="opsSuccessTitle">
                <div class="business-modal__head">
                    <div>
                        <h3 id="opsSuccessTitle" data-ops-success-title>Transaction Successful</h3>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-ops-close="success">&times;</button>
                </div>
                <section class="ops-success-panel">
                    <div class="statement-detail-card statement-detail-card--compact">
                        <span>Reference Number</span>
                        <strong data-ops-success-reference>-</strong>
                    </div>
                    <div class="statement-detail-card statement-detail-card--compact">
                        <span data-ops-success-name-label>Depositor Name</span>
                        <strong data-ops-success-name>-</strong>
                    </div>
                    <div class="statement-detail-card statement-detail-card--compact">
                        <span data-ops-success-amount-label>Amount Deposited</span>
                        <strong class="is-neutral" data-ops-success-amount>-</strong>
                    </div>
                    <div class="button-row mt-18">
                        <button class="btn btn-primary" type="button" data-ops-success-ok>Okay</button>
                    </div>
                </section>
            </div>
        </div>
    `;
}

function setSubmittingState(button, isSubmitting) {
    if (!button) {
        return;
    }
    button.disabled = isSubmitting;
    button.classList.toggle("is-loading", isSubmitting);
    button.setAttribute("aria-busy", String(isSubmitting));
}

function formatBalance(amount) {
    return formatCurrency(Number(amount || 0));
}

function normalizeAmountInput(value) {
    const raw = String(value || "").replace(/,/g, "").trim();
    if (!raw) {
        return "";
    }
    const sanitized = raw.replace(/[^0-9.]/g, "");
    const parts = sanitized.split(".");
    const integerPart = parts[0] || "";
    const decimalPart = parts.length > 1 ? parts.slice(1).join("").slice(0, 2) : "";
    const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const hasDecimalPoint = sanitized.includes(".");
    if (hasDecimalPoint) {
        return `${groupedInteger}.${decimalPart}`;
    }
    return groupedInteger;
}

function parseAmountInput(value) {
    const normalized = String(value || "").replace(/,/g, "").trim();
    return Number(normalized || 0);
}

function bindOperationsWorkspace(container, refresh) {
    const modals = Array.from(container.querySelectorAll("[data-ops-modal]"));
    const successTitleNode = container.querySelector("[data-ops-success-title]");
    const successReferenceNode = container.querySelector("[data-ops-success-reference]");
    const successNameLabelNode = container.querySelector("[data-ops-success-name-label]");
    const successNameNode = container.querySelector("[data-ops-success-name]");
    const successAmountLabelNode = container.querySelector("[data-ops-success-amount-label]");
    const successAmountNode = container.querySelector("[data-ops-success-amount]");
    let pendingSuccessContext = null;

    container.querySelectorAll("[data-ops-person-name]").forEach((field) => {
        field.addEventListener("input", (event) => {
            const input = event.currentTarget;
            const currentValue = String(input.value || "");
            const nextValue = currentValue.replace(/\b([a-z])/g, (match) => match.toUpperCase());
            if (nextValue !== currentValue) {
                const cursorStart = input.selectionStart;
                const cursorEnd = input.selectionEnd;
                input.value = nextValue;
                if (typeof cursorStart === "number" && typeof cursorEnd === "number") {
                    input.setSelectionRange(cursorStart, cursorEnd);
                }
            }
        });
    });

    const resetModalState = (modalKey) => {
        const normalizedKey = String(modalKey || "").trim();
        const modal = container.querySelector(`[data-ops-modal="${normalizedKey}"]`);
        const form = modal?.querySelector("form");
        form?.reset();

        if (normalizedKey === "transfer") {
            fillAccountCard("transfer-from", null);
            fillAccountCard("transfer-to", null);
            const statusNode = container.querySelector('[data-ops-status="transfer"]');
            if (statusNode) {
                statusNode.textContent = "Enter both customer accounts to process transfer.";
            }
            return;
        }

        if (normalizedKey === "withdrawal") {
            fillAccountCard("withdrawal", null);
            const statusNode = container.querySelector('[data-ops-status="withdrawal"]');
            if (statusNode) {
                statusNode.textContent = "Enter customer account to process withdrawal.";
            }
            return;
        }

        if (normalizedKey === "deposit") {
            fillAccountCard("deposit", null);
            const statusNode = container.querySelector('[data-ops-status="deposit"]');
            if (statusNode) {
                statusNode.textContent = "Enter customer account to process deposit.";
            }
            return;
        }

        if (normalizedKey === "success") {
            if (successTitleNode) {
                successTitleNode.textContent = "Transaction Successful";
            }
            if (successReferenceNode) {
                successReferenceNode.textContent = "-";
            }
            if (successNameLabelNode) {
                successNameLabelNode.textContent = "Depositor Name";
            }
            if (successNameNode) {
                successNameNode.textContent = "-";
            }
            if (successAmountLabelNode) {
                successAmountLabelNode.textContent = "Amount Deposited";
            }
            if (successAmountNode) {
                successAmountNode.textContent = "-";
                successAmountNode.classList.remove("is-credit", "is-debit", "is-neutral");
                successAmountNode.classList.add("is-neutral");
            }
            pendingSuccessContext = null;
        }
    };

    const openModal = (modalKey, options = {}) => {
        const { stack = false } = options;
        modals.forEach((modal) => {
            const isTarget = String(modal.getAttribute("data-ops-modal") || "") === modalKey;
            if (stack) {
                if (isTarget) {
                    modal.hidden = false;
                }
                return;
            }
            modal.hidden = !isTarget;
        });
    };

    const closeModal = (modalKey) => {
        const modal = container.querySelector(`[data-ops-modal="${modalKey}"]`);
        if (modal) {
            resetModalState(modalKey);
            modal.hidden = true;
        }
    };

    const openSuccessModal = (title, transactionReference, details = {}) => {
        if (successTitleNode) {
            successTitleNode.textContent = String(title || "Transaction Successful");
        }
        if (successReferenceNode) {
            successReferenceNode.textContent = String(transactionReference || "-");
        }
        if (successNameLabelNode) {
            successNameLabelNode.textContent = String(details.nameLabel || "Customer Name");
        }
        if (successNameNode) {
            successNameNode.textContent = String(details.name || "-");
        }
        if (successAmountLabelNode) {
            successAmountLabelNode.textContent = String(details.amountLabel || "Amount");
        }
        if (successAmountNode) {
            successAmountNode.textContent = String(details.amountText || "-");
            successAmountNode.classList.remove("is-credit", "is-debit", "is-neutral");
            successAmountNode.classList.add(String(details.amountTone || "is-neutral"));
        }
        openModal("success", { stack: true });
    };

    const dismissSuccessModal = () => {
        const context = pendingSuccessContext;
        closeModal("success");
        if (!context) {
            return;
        }

        const form = container.querySelector(context.formSelector);
        form?.reset();
        resetModalState(context.type);
    };

    const getStatusTargets = (prefix) => {
        if (prefix === "transfer-from" || prefix === "transfer-to") {
            return [container.querySelector('[data-ops-status="transfer"]')];
        }
        if (prefix === "withdrawal") {
            return [container.querySelector('[data-ops-status="withdrawal"]')];
        }
        if (prefix === "deposit") {
            return [container.querySelector('[data-ops-status="deposit"]')];
        }
        return [];
    };

    const setLookupStatus = (prefix, message = "") => {
        getStatusTargets(prefix).forEach((node) => {
            if (node) {
                node.textContent = message;
            }
        });
    };

    const fillAccountCard = (prefix, record = null) => {
        const nameNode = container.querySelector(`[data-ops-account-name="${prefix}"]`);
        const branchNode = container.querySelector(`[data-ops-account-branch="${prefix}"]`);
        const balanceNode = container.querySelector(`[data-ops-account-balance="${prefix}"]`);
        const passportNode = container.querySelector(`[data-ops-account-passport="${prefix}"]`);
        const signatureNode = container.querySelector(`[data-ops-account-signature="${prefix}"]`);
        if (!record) {
            if (nameNode) nameNode.textContent = "Customer name will appear here";
            if (branchNode) branchNode.textContent = "Branch will appear here";
            if (balanceNode) balanceNode.textContent = "Available balance will appear here";
            if (passportNode) passportNode.innerHTML = buildOpsDocumentPreview("", "", "No passport uploaded.");
            if (signatureNode) signatureNode.innerHTML = buildOpsDocumentPreview("", "", "No signature uploaded.");
            return;
        }
        if (nameNode) nameNode.textContent = String(record.name || "Customer");
        if (branchNode) branchNode.textContent = String(record.branchName || "-");
        if (balanceNode) balanceNode.textContent = `Available Balance: ${formatBalance(record.availableBalance)}`;
        if (passportNode) {
            passportNode.innerHTML = buildOpsDocumentPreview(
                record.passportFileUrl,
                record.passportFileName,
                "No passport uploaded."
            );
        }
        if (signatureNode) {
            signatureNode.innerHTML = buildOpsDocumentPreview(
                record.signatureFileUrl,
                record.signatureFileName,
                "No signature uploaded."
            );
        }
    };

    const loadAccount = async (prefix, accountNumber) => {
        const normalized = String(accountNumber || "").replace(/\D/g, "").slice(0, 10);
        const input = container.querySelector(`[data-ops-account-input="${prefix}"]`);
        if (input && input.value !== normalized) {
            input.value = normalized;
        }
        if (normalized.length !== 10) {
            fillAccountCard(prefix, null);
            setLookupStatus(prefix, "");
            return null;
        }
        const record = await getOpenedAccountByNumber(normalized);
        if (!record) {
            fillAccountCard(prefix, null);
            throw new Error("Account does not exist.");
        }
        fillAccountCard(prefix, record);
        setLookupStatus(prefix, "Customer details loaded.");
        return record;
    };

    container.querySelectorAll("[data-ops-account-input]").forEach((input) => {
        const prefix = String(input.getAttribute("data-ops-account-input") || "");
        const attemptLookup = async (rawValue) => {
            const nextValue = String(rawValue || "").replace(/\D/g, "").slice(0, 10);
            input.value = nextValue;
            if (nextValue.length === 10) {
                try {
                    await loadAccount(prefix, nextValue);
                } catch (error) {
                    fillAccountCard(prefix, null);
                    setLookupStatus(prefix, error?.message || "Unable to load account details.");
                    showToast(error?.message || "Unable to load account details.");
                }
            } else {
                fillAccountCard(prefix, null);
                setLookupStatus(prefix, "");
            }
        };

        input.addEventListener("input", async (event) => {
            const nextValue = String(event.currentTarget.value || "").replace(/\D/g, "").slice(0, 10);
            await attemptLookup(nextValue);
        });
        input.addEventListener("change", async (event) => {
            await attemptLookup(event.currentTarget.value || "");
        });
        input.addEventListener("blur", async () => {
            if (String(input.value || "").length === 10) {
                try {
                    await loadAccount(prefix, input.value);
                } catch (error) {
                    fillAccountCard(prefix, null);
                    setLookupStatus(prefix, error?.message || "Unable to load account details.");
                }
            }
        });
    });

    container.querySelectorAll("[data-ops-amount]").forEach((input) => {
        input.addEventListener("input", (event) => {
            event.currentTarget.value = normalizeAmountInput(event.currentTarget.value || "");
        });
        input.addEventListener("blur", (event) => {
            event.currentTarget.value = normalizeAmountInput(event.currentTarget.value || "");
        });
    });

    const bindForm = (formSelector, type, handler) => {
        const form = container.querySelector(formSelector);
        const button = container.querySelector(`[data-ops-submit="${type}"]`);
        const statusNode = container.querySelector(`[data-ops-status="${type}"]`);
        form?.addEventListener("submit", async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setSubmittingState(button, true);
            if (statusNode) {
                statusNode.textContent = "Processing transaction...";
            }
            try {
                const result = await handler(data);
                if (statusNode) {
                    statusNode.textContent = "Transaction posted successfully.";
                }
                showToast("Transaction posted successfully.");
                pendingSuccessContext = { type, formSelector };
                const actorName = String(data.get("narration") || "").trim() || "Customer";
                const amountText = formatBalance(parseAmountInput(data.get("amount")));
                openSuccessModal(
                    type === "deposit"
                        ? "Deposit Successful"
                        : type === "withdrawal"
                            ? "Withdrawal Successful"
                            : "Transfer Successful",
                    result?.transactionReference || "-",
                    {
                        nameLabel: type === "deposit"
                            ? "Depositor Name"
                            : type === "withdrawal"
                                ? "Withdrawer Name"
                                : "Sender Name",
                        name: actorName,
                        amountLabel: type === "deposit"
                            ? "Amount Deposited"
                            : type === "withdrawal"
                                ? "Amount Withdrawn"
                                : "Amount Transferred",
                        amountText,
                        amountTone: type === "withdrawal" ? "is-debit" : "is-credit"
                    }
                );
            } catch (error) {
                const message = error?.message || "Unable to post transaction.";
                if (statusNode) {
                    statusNode.textContent = message;
                }
                showToast(message);
            } finally {
                setSubmittingState(button, false);
            }
        });
    };

    bindForm("[data-ops-transfer-form]", "transfer", async (data) => {
        const fromAccount = String(container.querySelector('[data-ops-account-input="transfer-from"]')?.value || "").trim();
        const toAccount = String(container.querySelector('[data-ops-account-input="transfer-to"]')?.value || "").trim();
        const amount = parseAmountInput(data.get("amount"));
        return await postTransferBetweenOpenedAccounts(fromAccount, toAccount, { amount });
    });

    bindForm("[data-ops-withdrawal-form]", "withdrawal", async (data) => {
        const accountNumber = String(container.querySelector('[data-ops-account-input="withdrawal"]')?.value || "").trim();
        const amount = parseAmountInput(data.get("amount"));
        const narration = String(data.get("narration") || "").trim() || "Cash Withdrawal";
        return await postWithdrawalFromOpenedAccount(accountNumber, { amount, narration });
    });

    bindForm("[data-ops-deposit-form]", "deposit", async (data) => {
        const accountNumber = String(container.querySelector('[data-ops-account-input="deposit"]')?.value || "").trim();
        const amount = parseAmountInput(data.get("amount"));
        const narration = String(data.get("narration") || "").trim();
        return await postDepositToOpenedAccount(accountNumber, { amount, narration });
    });

    container.querySelectorAll("[data-ops-open-modal]").forEach((button) => {
        button.addEventListener("click", () => openModal(String(button.getAttribute("data-ops-open-modal") || "transfer")));
    });
    container.querySelectorAll("[data-ops-close]").forEach((control) => {
        control.addEventListener("click", async () => {
            const modalKey = String(control.getAttribute("data-ops-close") || "");
            if (modalKey === "success") {
                dismissSuccessModal();
                return;
            }
            closeModal(modalKey);
        });
    });
    container.querySelector("[data-ops-success-ok]")?.addEventListener("click", () => {
        dismissSuccessModal();
    });
}

export async function renderOperationsDashboard() {
    const metrics = await getOperationsMetrics();
    return {
        summary: [
            { label: "GL Postings (Month)", value: String(metrics.glPostingsMonth), note: "live data", tone: "up" },
            { label: "Posted Value (Month)", value: formatCurrency(metrics.glPostedValueMonth), note: "debit side total", tone: "up" },
            { label: "Pending Expense Approvals", value: String(metrics.expensesPending), note: "awaiting Head of Operations", tone: "warn" }
        ],
        content: `
            <section class="hero-card">
                <div>
                    <p class="hero-tag">Operations posting</p>
                    <h2>Operations users post expenses, ledger transactions, and customer account movements directly to the active branch workflow.</h2>
                    <p class="hero-copy">This workspace shows live operational posting volume and branch activity.</p>
                </div>
                <div class="hero-metrics">
                    <div><span>Active branch</span><strong>${metrics.activeBranchName}</strong></div>
                    <div><span>Expenses submitted (month)</span><strong>${metrics.expensesSubmittedMonth}</strong></div>
                    <div><span>Expense value (month)</span><strong>${formatCurrency(metrics.expensesSubmittedValueMonth)}</strong></div>
                </div>
            </section>
        `
    };
}

export async function renderOperationsWorkspacePage() {
    return {
        summary: [],
        content: renderOperationsWorkspace(),
        afterRender(container, refresh) {
            bindOperationsWorkspace(container, refresh);
        }
    };
}
