import { createCustomer, getCustomerProfile, getCustomers } from "./customers-service.js";
import { createInvoice, recordInvoicePayment } from "../invoices/invoices-service.js";
import { createTable, formatCurrency, formatStatusTone } from "../../core/utils.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { showToast } from "../../shared/toast.js";

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function addDays(dateValue, days) {
    const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

function toBase64Utf8(value) {
    return btoa(unescape(encodeURIComponent(value)));
}

function downloadTextFile(fileName, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderCustomerModal() {
    return `
        <div class="business-modal" data-customer-form-modal hidden>
            <div class="business-modal__backdrop" data-customer-form-close></div>
            <div class="business-modal__dialog customer-form-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="customerFormTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Customer profile</p>
                        <h2 id="customerFormTitle">Register Customer</h2>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-customer-form-close>&times;</button>
                </div>
                <form class="form-grid customer-register-form" data-customer-form>
                    <div class="customer-register-form__grid">
                        <label class="form-field">
                            <span>Name</span>
                            <input type="text" name="name" required>
                        </label>
                        <label class="form-field">
                            <span>Email</span>
                            <input type="email" name="email">
                        </label>
                        <label class="form-field">
                            <span>Phone</span>
                            <input type="tel" name="phone">
                        </label>
                        <label class="form-field">
                            <span>Industry</span>
                            <input type="text" name="industry">
                        </label>
                    </div>
                    <label class="form-field">
                        <span>Billing Address</span>
                        <textarea name="billingAddress" rows="3"></textarea>
                    </label>
                    <div class="button-row customer-form__actions">
                        <button class="btn btn-secondary" type="button" data-customer-form-close>Cancel</button>
                        <button class="btn btn-primary" type="submit" data-save-customer-button>Save Customer</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderCustomerDashboardModal() {
    return `
        <div class="business-modal" data-customer-dashboard-modal hidden>
            <div class="business-modal__backdrop" data-customer-dashboard-close></div>
            <div class="business-modal__dialog customer-dashboard-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="customerDashboardTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Customer dashboard</p>
                        <h2 id="customerDashboardTitle" data-customer-dashboard-title>Customer</h2>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-customer-dashboard-close>&times;</button>
                </div>
                <div class="customer-dashboard-actions">
                    <button class="btn btn-primary" type="button" data-open-customer-invoice-form>Create Invoice</button>
                    <button class="btn btn-secondary" type="button" data-email-customer>Email Customer</button>
                </div>
                <div data-customer-dashboard-body></div>
                <section class="customer-inline-panel" data-customer-invoice-panel hidden>
                    <div class="customer-inline-panel__head">
                        <div>
                            <p class="eyebrow">Billing</p>
                            <h3>Create Invoice</h3>
                        </div>
                        <button class="icon-btn" type="button" aria-label="Close invoice form" data-close-customer-invoice-form>&times;</button>
                    </div>
                    <form class="form-grid" data-customer-invoice-form>
                        <div class="customer-register-form__grid">
                            <label class="form-field">
                                <span>Invoice Number</span>
                                <input type="text" name="invoiceNumber" placeholder="Auto generated if empty">
                            </label>
                            <label class="form-field">
                                <span>Issue Date</span>
                                <input type="date" name="issuedAt" value="${today()}" required>
                            </label>
                            <label class="form-field">
                                <span>Due Date</span>
                                <input type="date" name="dueDate" value="${addDays(today(), 14)}" required>
                            </label>
                            <label class="form-field">
                                <span>Status</span>
                                <select name="status">
                                    <option value="draft">Draft</option>
                                    <option value="sent" selected>Sent</option>
                                </select>
                            </label>
                        </div>
                        <div class="invoice-line-items">
                            <div class="invoice-line-items__head">
                                <h3>Items</h3>
                                <button class="btn btn-secondary" type="button" data-add-customer-invoice-line>Add Item</button>
                            </div>
                            <div class="invoice-line-items__rows" data-customer-invoice-lines>
                                ${renderInvoiceLine()}
                            </div>
                        </div>
                        <div class="invoice-total-panel" aria-live="polite">
                            <div><span>Subtotal</span><strong data-customer-invoice-subtotal>${formatCurrency(0)}</strong></div>
                            <div><span>Tax</span><strong data-customer-invoice-tax>${formatCurrency(0)}</strong></div>
                            <div><span>Total</span><strong data-customer-invoice-total>${formatCurrency(0)}</strong></div>
                        </div>
                        <div class="button-row customer-form__actions">
                            <button class="btn btn-secondary" type="button" data-close-customer-invoice-form>Cancel</button>
                            <button class="btn btn-primary" type="submit" data-save-customer-invoice-button>Create Invoice</button>
                        </div>
                    </form>
                </section>
            </div>
        </div>
    `;
}

function renderPaymentModal() {
    return `
        <div class="business-modal" data-customer-payment-modal hidden>
            <div class="business-modal__backdrop" data-customer-payment-close></div>
            <div class="business-modal__dialog invoice-payment-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="customerPaymentTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Receipt</p>
                        <h2 id="customerPaymentTitle">Record Payment</h2>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-customer-payment-close>&times;</button>
                </div>
                <form class="form-grid" data-customer-payment-form>
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
                        <input type="text" name="reference">
                    </label>
                    <div class="button-row customer-form__actions">
                        <button class="btn btn-secondary" type="button" data-customer-payment-close>Cancel</button>
                        <button class="btn btn-primary" type="submit" data-save-customer-payment-button>Record Payment</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderInvoiceLine() {
    return `
        <div class="invoice-line" data-customer-invoice-line>
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
            <button class="icon-btn invoice-line__remove" type="button" aria-label="Remove line item" data-remove-customer-invoice-line>&times;</button>
        </div>
    `;
}

function renderCustomerDashboard(profile) {
    const { customer, invoices, payments } = profile;
    const totalInvoiced = invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
    const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const outstanding = Math.max(totalInvoiced - totalPaid, 0);
    const pendingInvoices = invoices.filter((invoice) => {
        const status = String(invoice.status || "").toLowerCase();
        return status !== "paid" && status !== "cancelled";
    });

    const renderInvoiceRows = (rows, emptyMessage) => rows.length
        ? rows.map((invoice) => `
            <tr>
                <td>${escapeHtml(invoice.number)}</td>
                <td>${escapeHtml(invoice.issuedAt || "Pending")}</td>
                <td>${escapeHtml(invoice.dueDate || "Pending")}</td>
                <td>${formatCurrency(invoice.amount)}</td>
                <td><span class="badge ${formatStatusTone(invoice.status)}">${escapeHtml(invoice.status)}</span></td>
                <td>
                    <div class="business-row-actions">
                        <button class="btn btn-secondary" type="button" data-customer-receipt="${escapeHtml(invoice.id)}">Receipt</button>
                        <button class="btn btn-primary" type="button" data-customer-payment="${escapeHtml(invoice.id)}">Payment</button>
                    </div>
                </td>
            </tr>
        `).join("")
        : `<tr><td colspan="6">${emptyMessage}</td></tr>`;

    const invoiceRows = renderInvoiceRows(invoices, "No invoice history yet.");
    const pendingRows = renderInvoiceRows(pendingInvoices, "No pending invoices.");

    const paymentRows = payments.length
        ? payments.map((payment) => `
            <tr>
                <td>${escapeHtml(payment.invoiceNumber)}</td>
                <td>${escapeHtml(payment.receivedAt || "Pending")}</td>
                <td>${escapeHtml(payment.paymentMethod || "Not set")}</td>
                <td>${escapeHtml(payment.reference || "Not set")}</td>
                <td>${formatCurrency(payment.amount)}</td>
            </tr>
        `).join("")
        : `<tr><td colspan="5">No payment history yet.</td></tr>`;

    return `
        <section class="customer-profile-hero">
            <div>
                <p class="eyebrow">Customer</p>
                <h3>${escapeHtml(customer.name)}</h3>
                <p>${escapeHtml(customer.email || "No email")} ${customer.phone ? `&middot; ${escapeHtml(customer.phone)}` : ""}</p>
            </div>
            <div class="customer-profile-hero__balance">
                <span>Outstanding</span>
                <strong>${formatCurrency(outstanding)}</strong>
            </div>
        </section>
        <div class="customer-profile-grid">
            <article><span>Industry</span><strong>${escapeHtml(customer.industry)}</strong></article>
            <article><span>Balance</span><strong>${formatCurrency(customer.balance)}</strong></article>
            <article><span>Last Payment</span><strong>${escapeHtml(customer.lastPayment)}</strong></article>
            <article><span>Billing Address</span><strong>${escapeHtml(customer.billingAddress || "Not set")}</strong></article>
        </div>
        <section class="customer-tabs" data-customer-tabs>
            <div class="customer-tabs__nav" role="tablist" aria-label="Customer history">
                <button class="customer-tab is-active" type="button" role="tab" aria-selected="true" data-customer-tab="invoices">Invoice History</button>
                <button class="customer-tab" type="button" role="tab" aria-selected="false" data-customer-tab="payments">Payment History</button>
                <button class="customer-tab" type="button" role="tab" aria-selected="false" data-customer-tab="pending">Pending Invoice</button>
            </div>
            <div class="customer-tab-panel is-active" role="tabpanel" data-customer-tab-panel="invoices">
                <section class="customer-history-section">
                    <h3>Invoice History</h3>
                    <div class="customer-history-table">
                        <table>
                            <thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody>${invoiceRows}</tbody>
                        </table>
                    </div>
                </section>
            </div>
            <div class="customer-tab-panel" role="tabpanel" data-customer-tab-panel="payments" hidden>
                <section class="customer-history-section">
                    <h3>Payment History</h3>
                    <div class="customer-history-table">
                        <table>
                            <thead><tr><th>Invoice</th><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
                            <tbody>${paymentRows}</tbody>
                        </table>
                    </div>
                </section>
            </div>
            <div class="customer-tab-panel" role="tabpanel" data-customer-tab-panel="pending" hidden>
                <section class="customer-history-section">
                    <h3>Pending Invoice</h3>
                    <div class="customer-history-table">
                        <table>
                            <thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody>${pendingRows}</tbody>
                        </table>
                    </div>
                </section>
            </div>
        </section>
    `;
}

function buildCustomerEmailDraft(customer, session) {
    const subject = `Message from ${session?.businessName || "Tia"}`;
    const body = [
        `Hello ${customer.name},`,
        "",
        "We are reaching out regarding your customer account.",
        "",
        "Thank you."
    ].join("\r\n");

    return [
        `To: ${customer.email}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        body,
        ""
    ].join("\r\n");
}

function buildReceiptHtml(customer, invoice, session) {
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
        : `<tr><td colspan="5">No line items recorded.</td></tr>`;

    return `<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Receipt ${escapeHtml(invoice.number)}</title>
            <style>
                * { box-sizing: border-box; }
                :root { --ink: #17212b; --muted: #667085; --brand: #143f6b; --line: #d8e0e8; }
                body { font-family: Arial, sans-serif; color: var(--ink); margin: 0; padding: 0; background: #eef3f6; }
                .page { width: min(820px, 100%); margin: 0 auto; padding: 34px; background: #ffffff; min-height: 100vh; }
                .hero { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: start; padding: 26px; border-radius: 18px; background: linear-gradient(135deg, #143f6b, #285a8e); color: #fff; }
                h1, h2, h3, p { margin: 0; }
                h1 { font-size: 28px; letter-spacing: 0; }
                .hero p { color: rgba(255,255,255,0.78); margin-top: 6px; }
                .status { display: inline-block; padding: 8px 12px; border-radius: 999px; background: rgba(255,255,255,0.16); font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px; }
                .amount-due { text-align: right; }
                .amount-due span { display: block; color: rgba(255,255,255,0.78); font-size: 12px; text-transform: uppercase; margin-bottom: 5px; }
                .amount-due strong { display: block; font-size: 26px; }
                .grid { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 16px; margin: 22px 0; }
                .box { border: 1px solid var(--line); border-radius: 14px; padding: 16px; background: #fffdf8; }
                .box span, .total span { display: block; color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; }
                .box strong { font-size: 15px; }
                .box p { color: var(--muted); margin-top: 5px; }
                .dates { display: grid; gap: 10px; }
                table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 20px 0; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
                th, td { border-bottom: 1px solid var(--line); padding: 12px; text-align: left; font-size: 13px; }
                th { color: var(--brand); background: #f3f7fb; font-size: 11px; text-transform: uppercase; }
                tr:last-child td { border-bottom: 0; }
                td:nth-child(2), td:nth-child(3), td:nth-child(4), td:nth-child(5),
                th:nth-child(2), th:nth-child(3), th:nth-child(4), th:nth-child(5) { text-align: right; }
                .summary { margin-left: auto; width: min(340px, 100%); display: grid; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
                .total { display: flex; justify-content: space-between; gap: 16px; padding: 12px 14px; border-bottom: 1px solid var(--line); background: #fff; }
                .total:last-child { border-bottom: 0; }
                .grand { font-size: 18px; font-weight: 700; color: var(--brand); background: #f7fbff; }
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
                        <span class="status">paid</span>
                        <h1>${escapeHtml(session?.businessName || "Tia Business Workspace")}</h1>
                        <p>Receipt ${escapeHtml(invoice.number)}</p>
                    </div>
                    <div class="amount-due">
                        <span>Amount Paid</span>
                        <strong>${formatCurrency(invoice.amount)}</strong>
                    </div>
                </section>
                <section class="grid">
                    <div class="box">
                        <span>Bill To</span>
                        <strong>${escapeHtml(customer.name)}</strong>
                        <p>${escapeHtml(customer.email || "")}</p>
                        <p>${escapeHtml(customer.phone || "")}</p>
                    </div>
                    <div class="box dates">
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
                <section class="summary">
                    <div class="total"><span>Subtotal</span><strong>${formatCurrency(invoice.subtotal)}</strong></div>
                    <div class="total"><span>Tax</span><strong>${formatCurrency(invoice.tax)}</strong></div>
                    <div class="total grand"><span>Total Paid</span><strong>${formatCurrency(invoice.amount)}</strong></div>
                </section>
                <footer class="footer">
                    <p>Thank you for your payment. This receipt confirms settlement of invoice ${escapeHtml(invoice.number)}.</p>
                </footer>
            </main>
        </body>
        </html>`;
}

function printHtml(html) {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
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
    frame.srcdoc = html;
}

export async function renderCustomers() {
    const customers = await getCustomers();
    return `
        <div class="section-stack">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Customer ledger</p>
                    <h2>Customers</h2>
                </div>
                <button class="btn btn-primary" id="addCustomerButton" type="button">Register Customer</button>
            </div>
            <section class="panel">
                ${createTable(
                    ["Name", "Email", "Phone", "Balance", "Last Payment", "Actions"],
                    customers.map((customer) => [
                        `<button class="cell-link customer-name-link" type="button" data-open-customer="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</button>`,
                        escapeHtml(customer.email || "Not set"),
                        escapeHtml(customer.phone || "Not set"),
                        formatCurrency(customer.balance),
                        escapeHtml(customer.lastPayment),
                        `<button class="btn btn-secondary" type="button" data-open-customer="${escapeHtml(customer.id)}">Open Profile</button>`
                    ])
                )}
            </section>
            ${renderCustomerModal()}
            ${renderCustomerDashboardModal()}
            ${renderPaymentModal()}
        </div>
    `;
}

export function bindCustomersActions(container, refresh) {
    const addButton = container.querySelector("#addCustomerButton");
    const customerFormModal = container.querySelector("[data-customer-form-modal]");
    const customerForm = container.querySelector("[data-customer-form]");
    const saveCustomerButton = container.querySelector("[data-save-customer-button]");
    const dashboardModal = container.querySelector("[data-customer-dashboard-modal]");
    const dashboardTitle = container.querySelector("[data-customer-dashboard-title]");
    const dashboardBody = container.querySelector("[data-customer-dashboard-body]");
    const invoicePanel = container.querySelector("[data-customer-invoice-panel]");
    const invoiceForm = container.querySelector("[data-customer-invoice-form]");
    const invoiceLines = container.querySelector("[data-customer-invoice-lines]");
    const saveInvoiceButton = container.querySelector("[data-save-customer-invoice-button]");
    const subtotalNode = container.querySelector("[data-customer-invoice-subtotal]");
    const taxNode = container.querySelector("[data-customer-invoice-tax]");
    const totalNode = container.querySelector("[data-customer-invoice-total]");
    const paymentModal = container.querySelector("[data-customer-payment-modal]");
    const paymentForm = container.querySelector("[data-customer-payment-form]");
    const paymentAmount = paymentForm?.querySelector("[name='amount']");
    const savePaymentButton = container.querySelector("[data-save-customer-payment-button]");
    let activeProfile = null;
    let activeInvoice = null;

    const openCustomerForm = () => {
        if (customerFormModal) {
            customerFormModal.hidden = false;
            customerFormModal.querySelector("input, select, textarea")?.focus();
        }
    };
    const closeCustomerForm = () => {
        if (customerFormModal) customerFormModal.hidden = true;
        customerForm?.reset();
    };
    const closeDashboard = () => {
        if (dashboardModal) dashboardModal.hidden = true;
        if (invoicePanel) invoicePanel.hidden = true;
    };
    const openDashboard = async (customerId) => {
        activeProfile = await getCustomerProfile(customerId);
        activeInvoice = null;
        if (dashboardTitle) dashboardTitle.textContent = activeProfile.customer.name;
        if (dashboardBody) dashboardBody.innerHTML = renderCustomerDashboard(activeProfile);
        if (dashboardModal) dashboardModal.hidden = false;
    };

    const getLineRows = () => Array.from(invoiceLines?.querySelectorAll("[data-customer-invoice-line]") || []);
    const getLineValues = (row) => {
        const quantity = Number(row.querySelector("[name='quantity']")?.value || 0);
        const unitPrice = Number(row.querySelector("[name='unitPrice']")?.value || 0);
        const taxAmount = Number(row.querySelector("[name='taxAmount']")?.value || 0);
        return {
            description: row.querySelector("[name='description']")?.value?.trim() || "",
            quantity: Number.isFinite(quantity) ? quantity : 0,
            unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
            taxAmount: Number.isFinite(taxAmount) ? taxAmount : 0
        };
    };
    const updateInvoiceTotals = () => {
        const totals = getLineRows().reduce((sum, row) => {
            const item = getLineValues(row);
            const lineTotal = (item.quantity * item.unitPrice) + item.taxAmount;
            const lineTotalNode = row.querySelector("[data-line-total]");
            if (lineTotalNode) lineTotalNode.textContent = formatCurrency(lineTotal);
            sum.subtotal += item.quantity * item.unitPrice;
            sum.tax += item.taxAmount;
            sum.total += lineTotal;
            return sum;
        }, { subtotal: 0, tax: 0, total: 0 });
        if (subtotalNode) subtotalNode.textContent = formatCurrency(totals.subtotal);
        if (taxNode) taxNode.textContent = formatCurrency(totals.tax);
        if (totalNode) totalNode.textContent = formatCurrency(totals.total);
    };

    addButton?.addEventListener("click", openCustomerForm);
    container.querySelectorAll("[data-customer-form-close]").forEach((control) => control.addEventListener("click", closeCustomerForm));
    container.querySelectorAll("[data-customer-dashboard-close]").forEach((control) => control.addEventListener("click", closeDashboard));
    container.querySelectorAll("[data-customer-payment-close]").forEach((control) => {
        control.addEventListener("click", () => {
            if (paymentModal) paymentModal.hidden = true;
            paymentForm?.reset();
        });
    });

    customerForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(customerForm);
        const name = String(formData.get("name") || "").trim();
        if (!name) {
            showToast("Customer name is required.");
            return;
        }

        if (saveCustomerButton) saveCustomerButton.disabled = true;
        try {
            await createCustomer({
                name,
                email: String(formData.get("email") || "").trim(),
                phone: String(formData.get("phone") || "").trim(),
                industry: String(formData.get("industry") || "").trim(),
                billingAddress: String(formData.get("billingAddress") || "").trim()
            });
            showToast("Customer registered");
            closeCustomerForm();
            await refresh();
        } catch (error) {
            showToast(error.message || "Unable to save customer.");
        } finally {
            if (saveCustomerButton) saveCustomerButton.disabled = false;
        }
    });

    container.addEventListener("click", async (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const tabButton = target.closest("[data-customer-tab]");
        if (tabButton) {
            const tabKey = String(tabButton.getAttribute("data-customer-tab") || "");
            const tabsRoot = tabButton.closest("[data-customer-tabs]");
            tabsRoot?.querySelectorAll("[data-customer-tab]").forEach((button) => {
                const isActive = button === tabButton;
                button.classList.toggle("is-active", isActive);
                button.setAttribute("aria-selected", isActive ? "true" : "false");
            });
            tabsRoot?.querySelectorAll("[data-customer-tab-panel]").forEach((panel) => {
                const isActive = String(panel.getAttribute("data-customer-tab-panel") || "") === tabKey;
                panel.classList.toggle("is-active", isActive);
                panel.hidden = !isActive;
            });
            return;
        }

        const profileButton = target.closest("[data-open-customer]");
        const receiptButton = target.closest("[data-customer-receipt]");
        const paymentButton = target.closest("[data-customer-payment]");

        try {
            if (profileButton) {
                await openDashboard(profileButton.getAttribute("data-open-customer"));
                return;
            }
            if (target.closest("[data-open-customer-invoice-form]")) {
                if (!activeProfile) return;
                if (invoicePanel) invoicePanel.hidden = false;
                invoicePanel?.querySelector("input, select, textarea")?.focus();
                updateInvoiceTotals();
                return;
            }
            if (target.closest("[data-close-customer-invoice-form]")) {
                if (invoicePanel) invoicePanel.hidden = true;
                invoiceForm?.reset();
                if (invoiceLines) invoiceLines.innerHTML = renderInvoiceLine();
                updateInvoiceTotals();
                return;
            }
            if (target.closest("[data-email-customer]")) {
                if (!activeProfile?.customer?.email) {
                    showToast("Customer email is not set.");
                    return;
                }
                const session = await getCurrentSessionContext();
                const draft = buildCustomerEmailDraft(activeProfile.customer, session);
                downloadTextFile(`${activeProfile.customer.name.replace(/[^a-z0-9_-]+/gi, "-") || "customer"}-email.eml`, draft, "message/rfc822;charset=utf-8");
                showToast("Customer email draft downloaded.");
                return;
            }
            if (receiptButton && activeProfile) {
                const invoice = activeProfile.invoices.find((item) => String(item.id) === String(receiptButton.getAttribute("data-customer-receipt")));
                if (!invoice?.latestPayment && String(invoice?.status || "").toLowerCase() !== "paid") {
                    showToast("Record a payment before generating a receipt.");
                    return;
                }
                printHtml(buildReceiptHtml(activeProfile.customer, invoice, await getCurrentSessionContext()));
                return;
            }
            if (paymentButton && activeProfile) {
                activeInvoice = activeProfile.invoices.find((item) => String(item.id) === String(paymentButton.getAttribute("data-customer-payment")));
                if (String(activeInvoice?.status || "").toLowerCase() === "paid") {
                    showToast("Invoice has been settled.");
                    return;
                }
                if (paymentAmount && activeInvoice) paymentAmount.value = String(activeInvoice.amount || 0);
                if (paymentModal) paymentModal.hidden = false;
                paymentModal?.querySelector("input, select, textarea")?.focus();
            }
        } catch (error) {
            showToast(error.message || "Unable to open customer profile.");
        }
    });

    invoiceLines?.addEventListener("click", (event) => {
        const removeButton = event.target instanceof Element ? event.target.closest("[data-remove-customer-invoice-line]") : null;
        if (!removeButton) return;
        const rows = getLineRows();
        if (rows.length <= 1) {
            rows[0]?.querySelectorAll("input").forEach((input) => {
                input.value = input.name === "quantity" ? "1" : "0";
                if (input.name === "description") input.value = "";
            });
        } else {
            removeButton.closest("[data-customer-invoice-line]")?.remove();
        }
        updateInvoiceTotals();
    });
    invoiceLines?.addEventListener("input", updateInvoiceTotals);
    container.querySelector("[data-add-customer-invoice-line]")?.addEventListener("click", () => {
        invoiceLines?.insertAdjacentHTML("beforeend", renderInvoiceLine());
        updateInvoiceTotals();
    });

    invoiceForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!activeProfile) return;
        const formData = new FormData(invoiceForm);
        const items = getLineRows().map(getLineValues).filter((item) => item.description && item.quantity > 0);
        if (!items.length) {
            showToast("Add at least one invoice item.");
            return;
        }

        if (saveInvoiceButton) saveInvoiceButton.disabled = true;
        try {
            await createInvoice({
                customerId: activeProfile.customer.id,
                customerName: activeProfile.customer.name,
                invoiceNumber: String(formData.get("invoiceNumber") || "").trim(),
                issuedAt: String(formData.get("issuedAt") || ""),
                dueDate: String(formData.get("dueDate") || ""),
                status: String(formData.get("status") || "sent"),
                items
            });
            showToast("Invoice created");
            invoiceForm.reset();
            if (invoiceLines) invoiceLines.innerHTML = renderInvoiceLine();
            if (invoicePanel) invoicePanel.hidden = true;
            await openDashboard(activeProfile.customer.id);
        } catch (error) {
            showToast(error.message || "Unable to create invoice.");
        } finally {
            if (saveInvoiceButton) saveInvoiceButton.disabled = false;
        }
    });

    paymentForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!activeProfile || !activeInvoice) return;
        const formData = new FormData(paymentForm);
        if (savePaymentButton) savePaymentButton.disabled = true;
        try {
            await recordInvoicePayment(activeInvoice.id, {
                amount: Number(formData.get("amount") || 0),
                paymentMethod: String(formData.get("paymentMethod") || "Cash"),
                receivedAt: String(formData.get("receivedAt") || today()),
                reference: String(formData.get("reference") || "").trim()
            });
            showToast("Payment recorded");
            if (paymentModal) paymentModal.hidden = true;
            paymentForm.reset();
            await openDashboard(activeProfile.customer.id);
        } catch (error) {
            showToast(error.message || "Unable to record payment.");
        } finally {
            if (savePaymentButton) savePaymentButton.disabled = false;
        }
    });

    updateInvoiceTotals();
}
