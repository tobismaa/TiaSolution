import {
    createInvoice,
    getInvoiceCustomers,
    getInvoiceDetails,
    getInvoices,
    recordInvoicePayment
} from "./invoices-service.js";
import { createTable, formatCurrency, formatStatusTone } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import { getCurrentSessionContext } from "../../core/session.js";

const DEFAULT_TAX_RATE = 0;

function canPostInvoice(role) {
    const normalized = String(role || "").toLowerCase();
    return normalized === "staff" || normalized === "manager" || normalized === "business_admin";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function setButtonLoading(button, isLoading) {
    if (!button) {
        return;
    }

    if (!button.querySelector(".spinner")) {
        const spinner = document.createElement("span");
        spinner.className = "spinner";
        spinner.setAttribute("aria-hidden", "true");
        button.appendChild(spinner);
    }

    button.classList.toggle("is-loading", Boolean(isLoading));
    button.disabled = Boolean(isLoading);
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function addDays(dateValue, days) {
    const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

function getInvoiceMetrics(invoices) {
    return invoices.reduce((metrics, invoice) => {
        const status = String(invoice.status || "").toLowerCase();
        metrics.total += 1;
        metrics.value += Number(invoice.amount || 0);
        if (status === "draft") metrics.drafts += 1;
        if (status === "sent") metrics.sent += 1;
        if (status === "overdue") metrics.overdue += 1;
        if (status === "paid") metrics.paid += 1;
        return metrics;
    }, { total: 0, value: 0, drafts: 0, sent: 0, overdue: 0, paid: 0 });
}

function renderInvoiceModal(customers, role) {
    const issuedAt = today();
    const dueDate = addDays(issuedAt, 14);
    const customerOptions = customers.length
        ? customers.map((customer) => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>`).join("")
        : `<option value="">Walk-in Customer</option>`;
    const statusOptions = String(role).toLowerCase() === "staff"
        ? `<option value="draft">Draft</option><option value="sent" selected>Sent</option>`
        : `<option value="draft">Draft</option><option value="sent" selected>Sent</option>`;

    return `
        <div class="business-modal" data-invoice-modal hidden>
            <div class="business-modal__backdrop" data-invoice-modal-close></div>
            <div class="business-modal__dialog invoice-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="invoiceModalTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Billing control</p>
                        <h2 id="invoiceModalTitle">Create Invoice</h2>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-invoice-modal-close>&times;</button>
                </div>
                <form class="form-grid invoice-form" data-invoice-form>
                    <div class="invoice-form__grid">
                        <label class="form-field">
                            <span>Customer</span>
                            <select name="customerId" data-invoice-customer>
                                ${customerOptions}
                            </select>
                        </label>
                        <label class="form-field">
                            <span>Issue Date</span>
                            <input type="date" name="issuedAt" value="${issuedAt}" required>
                        </label>
                        <label class="form-field">
                            <span>Due Date</span>
                            <input type="date" name="dueDate" value="${dueDate}" required>
                        </label>
                        <label class="form-field">
                            <span>Status</span>
                            <select name="status">
                                ${statusOptions}
                            </select>
                        </label>
                    </div>

                    <div class="invoice-line-items">
                        <div class="invoice-line-items__head">
                            <h3>Items</h3>
                            <button class="btn btn-secondary" type="button" data-add-invoice-line>Add Item</button>
                        </div>
                        <div class="invoice-line-items__rows" data-invoice-lines>
                            ${renderInvoiceLine()}
                        </div>
                    </div>

                    <label class="form-field">
                        <span>Notes</span>
                        <textarea name="notes" rows="3" placeholder="Payment terms, delivery note, or customer instruction"></textarea>
                    </label>
                    <div class="invoice-form__grid">
                        <label class="form-field">
                            <span>Accepted Payment Methods</span>
                            <input type="text" name="acceptedPaymentMethods" placeholder="Cash, Bank Transfer, POS">
                        </label>
                        <label class="form-field">
                            <span>Payment Terms</span>
                            <input type="text" name="paymentTerms" placeholder="Due on receipt, Net 14, Net 30">
                        </label>
                    </div>

                    <div class="invoice-total-panel" aria-live="polite">
                        <div><span>Subtotal</span><strong data-invoice-subtotal>${formatCurrency(0)}</strong></div>
                        <div><span>Tax</span><strong data-invoice-tax>${formatCurrency(0)}</strong></div>
                        <div><span>Total</span><strong data-invoice-total>${formatCurrency(0)}</strong></div>
                    </div>

                    <div class="button-row invoice-form__actions">
                        <button class="btn btn-secondary" type="button" data-invoice-modal-close>Cancel</button>
                        <button class="btn btn-primary" type="submit" data-save-invoice-button>Create Invoice</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderInvoiceLine() {
    return `
        <div class="invoice-line" data-invoice-line>
            <label class="form-field invoice-line__description">
                <span>Description</span>
                <input type="text" name="description" placeholder="Product or service" required>
            </label>
            <label class="form-field">
                <span>Qty</span>
                <input type="number" name="quantity" min="0.01" step="0.01" value="1" required>
            </label>
            <label class="form-field">
                <span>Unit Price</span>
                <input type="number" name="unitPrice" min="0" step="0.01" value="0" required>
            </label>
            <label class="form-field">
                <span>Tax</span>
                <input type="number" name="taxAmount" min="0" step="0.01" value="0">
            </label>
            <div class="invoice-line__total">
                <span>Line Total</span>
                <strong data-line-total>${formatCurrency(0)}</strong>
            </div>
            <button class="icon-btn invoice-line__remove" type="button" aria-label="Remove line item" data-remove-invoice-line>&times;</button>
        </div>
    `;
}

function renderInvoiceDetailsModal() {
    return `
        <div class="business-modal" data-invoice-details-modal hidden>
            <div class="business-modal__backdrop" data-invoice-details-close></div>
            <div class="business-modal__dialog invoice-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="invoiceDetailsTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Invoice document</p>
                        <h2 id="invoiceDetailsTitle">Invoice Details</h2>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-invoice-details-close>&times;</button>
                </div>
                <div class="invoice-detail-actions">
                    <button class="btn btn-secondary" type="button" data-invoice-detail-print>Download / Print PDF</button>
                    <button class="btn btn-secondary" type="button" data-invoice-detail-email>Send Email</button>
                    <button class="btn btn-primary" type="button" data-invoice-detail-payment>Record Payment</button>
                </div>
                <div class="document-preview" data-invoice-document-preview hidden>
                    <iframe title="Invoice PDF preview" data-invoice-document-frame></iframe>
                </div>
                <div data-invoice-details-body></div>
            </div>
        </div>
    `;
}

function renderPaymentModal() {
    return `
        <div class="business-modal" data-invoice-payment-modal hidden>
            <div class="business-modal__backdrop" data-invoice-payment-close></div>
            <div class="business-modal__dialog invoice-payment-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="invoicePaymentTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Payment receipt</p>
                        <h2 id="invoicePaymentTitle">Record Payment</h2>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-invoice-payment-close>&times;</button>
                </div>
                <form class="form-grid" data-invoice-payment-form>
                    <label class="form-field">
                        <span>Amount Paid</span>
                        <input type="number" name="amount" min="0.01" step="0.01" required>
                    </label>
                    <label class="form-field">
                        <span>Payment Method</span>
                        <select name="paymentMethod">
                            <option value="Cash">Cash</option>
                            <option value="Bank Transfer">Bank Transfer</option>
                            <option value="POS">POS</option>
                            <option value="Cheque">Cheque</option>
                            <option value="Online Payment">Online Payment</option>
                        </select>
                    </label>
                    <label class="form-field">
                        <span>Received Date</span>
                        <input type="date" name="receivedAt" value="${today()}" required>
                    </label>
                    <label class="form-field">
                        <span>Reference</span>
                        <input type="text" name="reference" placeholder="Receipt, transfer, or cheque reference">
                    </label>
                    <div class="button-row invoice-form__actions">
                        <button class="btn btn-secondary" type="button" data-invoice-payment-close>Cancel</button>
                        <button class="btn btn-primary" type="submit" data-save-payment-button>Mark as Paid</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderInvoiceActions(invoice) {
    const id = escapeHtml(invoice.id);
    return `
        <div class="business-row-actions invoice-row-actions">
            <button class="btn btn-secondary" type="button" data-invoice-view="${id}">View</button>
            <button class="btn btn-secondary" type="button" data-invoice-print="${id}">PDF</button>
            <button class="btn btn-secondary" type="button" data-invoice-email="${id}">Email</button>
            <button class="btn btn-primary" type="button" data-invoice-payment="${id}">Payment</button>
        </div>
    `;
}

function renderInvoiceDetail(invoice) {
    const rows = invoice.items.length
        ? invoice.items.map((item) => `
            <tr>
                <td>${escapeHtml(item.description)}</td>
                <td>${escapeHtml(item.quantity)}</td>
                <td>${formatCurrency(item.unitPrice)}</td>
                <td>${formatCurrency(item.taxAmount)}</td>
                <td>${formatCurrency(item.lineTotal)}</td>
            </tr>
        `).join("")
        : `<tr><td colspan="5">No invoice items recorded.</td></tr>`;

    return `
        <section class="invoice-document">
            <div class="invoice-document__head">
                <div>
                    <p class="eyebrow">Invoice</p>
                    <h3>${escapeHtml(invoice.number)}</h3>
                    <span class="badge ${formatStatusTone(invoice.status)}">${escapeHtml(invoice.status)}</span>
                </div>
                <div class="invoice-document__totals">
                    <span>Total</span>
                    <strong>${formatCurrency(invoice.amount)}</strong>
                </div>
            </div>
            <div class="invoice-document__meta">
                <div><span>Customer</span><strong>${escapeHtml(invoice.customer)}</strong></div>
                <div><span>Branch</span><strong>${escapeHtml(invoice.branchName || "Head Office")}</strong></div>
                <div><span>Email</span><strong>${escapeHtml(invoice.customerEmail || "Not set")}</strong></div>
                <div><span>Issued</span><strong>${escapeHtml(invoice.issuedAt || "Pending")}</strong></div>
                <div><span>Due</span><strong>${escapeHtml(invoice.dueDate || "Pending")}</strong></div>
            </div>
            <div class="invoice-document__table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Description</th>
                            <th>Qty</th>
                            <th>Unit Price</th>
                            <th>Tax</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${invoice.acceptedPaymentMethods ? `<div class="invoice-document__note"><span>Accepted Payment Methods</span><p>${escapeHtml(invoice.acceptedPaymentMethods)}</p></div>` : ""}
            ${invoice.paymentTerms ? `<div class="invoice-document__note"><span>Payment Terms</span><p>${escapeHtml(invoice.paymentTerms)}</p></div>` : ""}
            ${invoice.notes ? `<div class="invoice-document__note"><span>Notes</span><p>${escapeHtml(invoice.notes)}</p></div>` : ""}
            <div class="invoice-document__summary">
                <div><span>Subtotal</span><strong>${formatCurrency(invoice.subtotal)}</strong></div>
                <div><span>Tax</span><strong>${formatCurrency(invoice.tax)}</strong></div>
                <div><span>Total</span><strong>${formatCurrency(invoice.amount)}</strong></div>
            </div>
        </section>
    `;
}

function buildInvoicePrintHtml(invoice) {
    const branchName = invoice.branchName || "Head Office";
    const rows = invoice.items.map((item) => `
        <tr>
            <td>${escapeHtml(item.description)}</td>
            <td>${escapeHtml(item.quantity)}</td>
            <td>${formatCurrency(item.unitPrice)}</td>
            <td>${formatCurrency(item.taxAmount)}</td>
            <td>${formatCurrency(item.lineTotal)}</td>
        </tr>
    `).join("");

    return `<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>${escapeHtml(invoice.number)}</title>
            <style>
                * { box-sizing: border-box; }
                :root { --ink: #17212b; --muted: #667085; --brand: #146c43; --brand-2: #0f5132; --line: #d7e8df; }
                body { font-family: Arial, sans-serif; color: var(--ink); margin: 0; padding: 0; background: #eef3f6; }
                .page { width: min(820px, 100%); margin: 0 auto; padding: 30px; background: #ffffff; min-height: 100vh; }
                .hero { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: start; padding: 26px; border-radius: 18px; background: linear-gradient(135deg, var(--brand-2), var(--brand)); color: #fff; }
                h1, h2, h3, p { margin: 0; }
                h1 { font-size: 28px; letter-spacing: 0; }
                .hero p { color: rgba(255,255,255,0.78); margin-top: 6px; }
                .status { display: inline-block; padding: 8px 12px; border-radius: 999px; background: rgba(255,255,255,0.16); font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px; }
                .amount-due { text-align: right; }
                .amount-due span { display: block; color: rgba(255,255,255,0.78); font-size: 12px; text-transform: uppercase; margin-bottom: 5px; }
                .amount-due strong { display: block; font-size: 26px; }
                .grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 14px; align-items: start; margin: 16px 0; }
                .box { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: #fffdf8; }
                .box span, .total span { display: block; color: var(--muted); font-size: 10px; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; }
                .box strong { font-size: 14px; }
                .box p { color: var(--muted); margin-top: 4px; line-height: 1.3; }
                .dates { display: grid; gap: 8px; }
                table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 20px 0; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
                th, td { border-bottom: 1px solid var(--line); padding: 12px; text-align: left; font-size: 13px; }
                th { color: var(--brand); background: #f0f8f4; font-size: 11px; text-transform: uppercase; }
                tr:last-child td { border-bottom: 0; }
                td:nth-child(2), td:nth-child(3), td:nth-child(4), td:nth-child(5),
                th:nth-child(2), th:nth-child(3), th:nth-child(4), th:nth-child(5) { text-align: right; }
                .summary { margin-left: auto; width: min(340px, 100%); display: grid; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
                .note { margin: 18px 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: #f0f8f4; }
                .note span { display: block; color: var(--brand); font-size: 10px; font-weight: 700; text-transform: uppercase; margin-bottom: 5px; }
                .note p { color: var(--ink); line-height: 1.5; }
                .note-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
                .note-grid .note { margin: 0; }
                .total { display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; border-bottom: 1px solid var(--line); background: #fff; }
                .total:last-child { border-bottom: 0; }
                .grand { font-size: 18px; font-weight: 700; color: var(--brand); background: #f0f8f4; }
                .footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
                @media print {
                    body { background: #fff; }
                    .page { width: 100%; padding: 0; min-height: auto; }
                    .hero, .box, table, .summary { break-inside: avoid; }
                }
            </style>
        </head>
        <body>
            <main class="page">
                <section class="hero">
                    <div>
                        <span class="status">${escapeHtml(invoice.status)}</span>
                        <h1>${escapeHtml(branchName)}</h1>
                        <p>Invoice ${escapeHtml(invoice.number)}</p>
                    </div>
                    <div class="amount-due">
                        <span>Amount Due</span>
                        <strong>${formatCurrency(invoice.amount)}</strong>
                    </div>
                </section>
                <section class="grid">
                    <div class="box">
                        <span>Bill To</span>
                        <strong>${escapeHtml(invoice.customer)}</strong>
                        <p>${escapeHtml(invoice.customerEmail || "")}</p>
                        <p>${escapeHtml(invoice.customerPhone || "")}</p>
                    </div>
                    <div class="box dates">
                        <div>
                            <span>Branch</span>
                            <strong>${escapeHtml(branchName)}</strong>
                        </div>
                        <div>
                            <span>Issued</span>
                            <strong>${escapeHtml(invoice.issuedAt || "Pending")}</strong>
                        </div>
                        <div>
                            <span>Due</span>
                            <strong>${escapeHtml(invoice.dueDate || "Pending")}</strong>
                        </div>
                    </div>
                </section>
                <table>
                    <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Tax</th><th>Total</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                ${invoice.acceptedPaymentMethods || invoice.paymentTerms ? `
                    <section class="note-grid">
                        ${invoice.acceptedPaymentMethods ? `<div class="note"><span>Accepted Payment Methods</span><p>${escapeHtml(invoice.acceptedPaymentMethods)}</p></div>` : ""}
                        ${invoice.paymentTerms ? `<div class="note"><span>Payment Terms</span><p>${escapeHtml(invoice.paymentTerms)}</p></div>` : ""}
                    </section>
                ` : ""}
                ${invoice.notes ? `<section class="note"><span>Notes</span><p>${escapeHtml(invoice.notes)}</p></section>` : ""}
                <section class="summary">
                    <div class="total"><span>Subtotal</span><strong>${formatCurrency(invoice.subtotal)}</strong></div>
                    <div class="total"><span>Tax</span><strong>${formatCurrency(invoice.tax)}</strong></div>
                    <div class="total grand"><span>Total</span><strong>${formatCurrency(invoice.amount)}</strong></div>
                </section>
                <footer class="footer">
                    <p>Thank you for your business. Please reference invoice ${escapeHtml(invoice.number)} when making payment.</p>
                </footer>
            </main>
        </body>
        </html>`;
}

function printInvoice(invoice) {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.visibility = "hidden";
    document.body.appendChild(frame);
    frame.onload = () => {
        window.setTimeout(() => {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
            window.setTimeout(() => frame.remove(), 1000);
        }, 120);
    };
    frame.srcdoc = buildInvoicePrintHtml(invoice);
}

function printPreviewFrame(frame) {
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
}

function sendInvoiceEmail(invoice, session) {
    if (!invoice.customerEmail) {
        showToast("Customer email is not set.");
        return;
    }

    const subject = `Invoice ${invoice.number} from ${session?.businessName || "Tia"}`;
    const body = [
        `Hello ${invoice.customer},`,
        "",
        `Please find invoice ${invoice.number} for ${formatCurrency(invoice.amount)}.`,
        `Issued: ${invoice.issuedAt || "Pending"}`,
        `Due: ${invoice.dueDate || "Pending"}`,
        "",
        "You can reply to this email for payment confirmation."
    ].join("\n");

    window.location.href = `mailto:${encodeURIComponent(invoice.customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export async function renderInvoices() {
    const session = await getCurrentSessionContext();
    const role = session?.role || "";
    const canPost = canPostInvoice(role);
    const [invoices, customers] = await Promise.all([
        getInvoices(),
        getInvoiceCustomers()
    ]);
    const metrics = getInvoiceMetrics(invoices);

    return `
        <div class="section-stack">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Billing control</p>
                    <h2>Invoices</h2>
                </div>
                <button class="btn btn-primary" id="createInvoiceButton" type="button" ${canPost ? "" : "disabled"}>
                    ${String(role).toLowerCase() === "staff" ? "Post Invoice" : "Create Invoice"}
                </button>
            </div>
            <div class="cards-three">
                <article class="mini-card"><p>Drafts</p><h3>${metrics.drafts}</h3></article>
                <article class="mini-card"><p>Sent</p><h3>${metrics.sent}</h3></article>
                <article class="mini-card"><p>Total Value</p><h3>${formatCurrency(metrics.value)}</h3></article>
            </div>
            <section class="panel">
                ${createTable(
                    ["Invoice", "Customer", "Issued", "Due", "Amount", "Status", "Actions"],
                    invoices.map((invoice) => [
                        escapeHtml(invoice.number),
                        escapeHtml(invoice.customer),
                        escapeHtml(invoice.issuedAt || "Pending"),
                        escapeHtml(invoice.dueDate || "Pending"),
                        formatCurrency(invoice.amount),
                        `<span class="badge ${formatStatusTone(invoice.status)}">${escapeHtml(invoice.status)}</span>`,
                        renderInvoiceActions(invoice)
                    ])
                )}
            </section>
            ${renderInvoiceModal(customers, role)}
            ${renderInvoiceDetailsModal()}
            ${renderPaymentModal()}
        </div>
    `;
}

export function bindInvoicesActions(container, refresh) {
    const button = container.querySelector("#createInvoiceButton");
    const modal = container.querySelector("[data-invoice-modal]");
    const form = container.querySelector("[data-invoice-form]");
    const linesContainer = container.querySelector("[data-invoice-lines]");
    const subtotalNode = container.querySelector("[data-invoice-subtotal]");
    const taxNode = container.querySelector("[data-invoice-tax]");
    const totalNode = container.querySelector("[data-invoice-total]");
    const saveButton = container.querySelector("[data-save-invoice-button]");
    const detailModal = container.querySelector("[data-invoice-details-modal]");
    const detailBody = container.querySelector("[data-invoice-details-body]");
    const documentPreview = container.querySelector("[data-invoice-document-preview]");
    const documentFrame = container.querySelector("[data-invoice-document-frame]");
    const paymentModal = container.querySelector("[data-invoice-payment-modal]");
    const paymentForm = container.querySelector("[data-invoice-payment-form]");
    const paymentAmount = paymentForm?.querySelector("[name='amount']");
    const savePaymentButton = container.querySelector("[data-save-payment-button]");
    let activeInvoice = null;

    const openModal = () => {
        if (!modal) return;
        modal.hidden = false;
        modal.querySelector("select, input, textarea")?.focus();
        updateTotals();
    };

    const closeModal = () => {
        if (!modal || !form || !linesContainer) return;
        modal.hidden = true;
        form.reset();
        linesContainer.innerHTML = renderInvoiceLine();
        updateTotals();
    };

    const openDetailModal = (invoice, options = {}) => {
        activeInvoice = invoice;
        const showPreview = options.mode === "preview";
        if (detailBody) {
            detailBody.hidden = showPreview;
            detailBody.innerHTML = showPreview ? "" : renderInvoiceDetail(invoice);
        }
        if (documentPreview) {
            documentPreview.hidden = !showPreview;
        }
        if (documentFrame) {
            documentFrame.srcdoc = showPreview ? buildInvoicePrintHtml(invoice) : "";
        }
        if (detailModal) {
            detailModal.hidden = false;
        }
    };

    const closeDetailModal = () => {
        if (detailModal) detailModal.hidden = true;
        if (documentFrame) documentFrame.srcdoc = "";
        if (documentPreview) documentPreview.hidden = true;
        if (detailBody) detailBody.hidden = false;
    };

    const openPaymentModal = (invoice) => {
        if (String(invoice?.status || "").toLowerCase() === "paid") {
            showToast("Invoice has been settled.");
            return;
        }
        activeInvoice = invoice;
        if (paymentAmount) {
            paymentAmount.value = String(invoice.amount || 0);
        }
        if (paymentModal) {
            paymentModal.hidden = false;
            paymentModal.querySelector("input, select, textarea")?.focus();
        }
    };

    const closePaymentModal = () => {
        if (paymentModal) paymentModal.hidden = true;
        paymentForm?.reset();
        const receivedAt = paymentForm?.querySelector("[name='receivedAt']");
        if (receivedAt) {
            receivedAt.value = today();
        }
    };

    const loadInvoice = async (invoiceId) => {
        const invoice = await getInvoiceDetails(invoiceId);
        activeInvoice = invoice;
        return invoice;
    };

    const getLineRows = () => Array.from(linesContainer?.querySelectorAll("[data-invoice-line]") || []);

    function getLineValues(row) {
        const quantity = Number(row.querySelector("[name='quantity']")?.value || 0);
        const unitPrice = Number(row.querySelector("[name='unitPrice']")?.value || 0);
        const taxField = row.querySelector("[name='taxAmount']");
        const taxAmount = Number(taxField?.value || 0);
        const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
        const safeUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
        const safeTaxAmount = Number.isFinite(taxAmount) ? taxAmount : 0;
        return {
            description: row.querySelector("[name='description']")?.value?.trim() || "",
            quantity: safeQuantity,
            unitPrice: safeUnitPrice,
            taxAmount: safeTaxAmount,
            lineTotal: (safeQuantity * safeUnitPrice) + safeTaxAmount
        };
    }

    function updateTotals() {
        const totals = getLineRows().reduce((sum, row) => {
            const values = getLineValues(row);
            const lineTotalNode = row.querySelector("[data-line-total]");
            if (lineTotalNode) {
                lineTotalNode.textContent = formatCurrency(values.lineTotal);
            }
            sum.subtotal += values.quantity * values.unitPrice;
            sum.tax += values.taxAmount;
            sum.total += values.lineTotal;
            return sum;
        }, { subtotal: 0, tax: 0, total: 0 });

        if (subtotalNode) subtotalNode.textContent = formatCurrency(totals.subtotal);
        if (taxNode) taxNode.textContent = formatCurrency(totals.tax);
        if (totalNode) totalNode.textContent = formatCurrency(totals.total);
    }

    button?.addEventListener("click", async () => {
        setButtonLoading(button, true);
        try {
            openModal();
        } finally {
            window.setTimeout(() => setButtonLoading(button, false), 180);
        }
    });

    container.querySelectorAll("[data-invoice-modal-close]").forEach((control) => {
        control.addEventListener("click", closeModal);
    });

    container.querySelectorAll("[data-invoice-details-close]").forEach((control) => {
        control.addEventListener("click", closeDetailModal);
    });

    container.querySelectorAll("[data-invoice-payment-close]").forEach((control) => {
        control.addEventListener("click", closePaymentModal);
    });

    container.querySelector("[data-add-invoice-line]")?.addEventListener("click", (event) => {
        const lineButton = event.currentTarget;
        setButtonLoading(lineButton, true);
        try {
            linesContainer?.insertAdjacentHTML("beforeend", renderInvoiceLine());
            updateTotals();
        } finally {
            window.setTimeout(() => setButtonLoading(lineButton, false), 180);
        }
    });

    linesContainer?.addEventListener("click", (event) => {
        const removeButton = event.target instanceof Element ? event.target.closest("[data-remove-invoice-line]") : null;
        if (!removeButton) return;
        setButtonLoading(removeButton, true);
        try {
            const rows = getLineRows();
            if (rows.length <= 1) {
                rows[0]?.querySelectorAll("input").forEach((input) => {
                    input.value = input.name === "quantity" ? "1" : "0";
                    if (input.name === "description") input.value = "";
                });
            } else {
                removeButton.closest("[data-invoice-line]")?.remove();
            }
            updateTotals();
        } finally {
            window.setTimeout(() => setButtonLoading(removeButton, false), 180);
        }
    });

    linesContainer?.addEventListener("input", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.matches("[name='unitPrice']") && DEFAULT_TAX_RATE > 0) {
            const row = target.closest("[data-invoice-line]");
            const values = row ? getLineValues(row) : null;
            const taxField = row?.querySelector("[name='taxAmount']");
            if (values && taxField && Number(taxField.value || 0) === 0) {
                taxField.value = String(Math.round(values.quantity * values.unitPrice * DEFAULT_TAX_RATE * 100) / 100);
            }
        }
        updateTotals();
    });

    container.addEventListener("click", async (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const viewButton = target.closest("[data-invoice-view]");
        const printButton = target.closest("[data-invoice-print]");
        const emailButton = target.closest("[data-invoice-email]");
        const paymentButton = target.closest("[data-invoice-payment]");
        const detailPrintButton = target.closest("[data-invoice-detail-print]");
        const detailEmailButton = target.closest("[data-invoice-detail-email]");
        const detailPaymentButton = target.closest("[data-invoice-detail-payment]");
        const actionButton = viewButton || printButton || emailButton || paymentButton || detailPrintButton || detailEmailButton || detailPaymentButton;
        if (!actionButton) return;
        if (actionButton.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        setButtonLoading(actionButton, true);

        try {
            if (viewButton) {
                openDetailModal(await loadInvoice(viewButton.getAttribute("data-invoice-view")));
                return;
            }

            if (printButton) {
                const invoice = await loadInvoice(printButton.getAttribute("data-invoice-print"));
                openDetailModal(invoice, { mode: "preview" });
                return;
            }

            if (emailButton) {
                const invoice = await loadInvoice(emailButton.getAttribute("data-invoice-email"));
                sendInvoiceEmail(invoice, await getCurrentSessionContext());
                return;
            }

            if (paymentButton) {
                openPaymentModal(await loadInvoice(paymentButton.getAttribute("data-invoice-payment")));
                return;
            }

            if (detailPrintButton && activeInvoice) {
                if (documentFrame?.srcdoc) {
                    printPreviewFrame(documentFrame);
                } else {
                    printInvoice(activeInvoice);
                }
                return;
            }

            if (detailEmailButton && activeInvoice) {
                sendInvoiceEmail(activeInvoice, await getCurrentSessionContext());
                return;
            }

            if (detailPaymentButton && activeInvoice) {
                openPaymentModal(activeInvoice);
            }
        } catch (error) {
            showToast(error.message || "Unable to load invoice.");
        } finally {
            setButtonLoading(actionButton, false);
        }
    });

    form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form) return;

        const formData = new FormData(form);
        const customerSelect = form.querySelector("[name='customerId']");
        const selectedCustomer = customerSelect?.selectedOptions?.[0]?.textContent?.trim() || "";
        const items = getLineRows().map(getLineValues).filter((item) => item.description && item.quantity > 0);

        if (!items.length) {
            showToast("Add at least one invoice item.");
            return;
        }

        setButtonLoading(saveButton, true);
        try {
            await createInvoice({
                customerId: String(formData.get("customerId") || ""),
                customerName: selectedCustomer,
                issuedAt: String(formData.get("issuedAt") || ""),
                dueDate: String(formData.get("dueDate") || ""),
                status: String(formData.get("status") || "draft"),
                notes: String(formData.get("notes") || "").trim(),
                acceptedPaymentMethods: String(formData.get("acceptedPaymentMethods") || "").trim(),
                paymentTerms: String(formData.get("paymentTerms") || "").trim(),
                items
            });
            showToast("Invoice created");
            closeModal();
            await refresh();
        } catch (error) {
            showToast(error.message || "Unable to create invoice.");
        } finally {
            setButtonLoading(saveButton, false);
        }
    });

    paymentForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!activeInvoice) {
            showToast("Select an invoice first.");
            return;
        }

        const formData = new FormData(paymentForm);
        setButtonLoading(savePaymentButton, true);
        try {
            await recordInvoicePayment(activeInvoice.id, {
                amount: Number(formData.get("amount") || 0),
                paymentMethod: String(formData.get("paymentMethod") || "Cash"),
                receivedAt: String(formData.get("receivedAt") || today()),
                reference: String(formData.get("reference") || "").trim()
            });
            showToast("Payment recorded");
            closePaymentModal();
            closeDetailModal();
            await refresh();
        } catch (error) {
            showToast(error.message || "Unable to record payment.");
        } finally {
            setButtonLoading(savePaymentButton, false);
        }
    });

    updateTotals();
}
