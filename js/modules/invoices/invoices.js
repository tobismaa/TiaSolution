import { createInvoice, getInvoices } from "./invoices-service.js";
import { createTable, formatCurrency, formatStatusTone } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import { getCurrentSessionContext } from "../../core/session.js";

function canPostInvoice(role) {
    const normalized = String(role || "").toLowerCase();
    return normalized === "staff" || normalized === "manager" || normalized === "business_admin";
}

export async function renderInvoices() {
    const session = await getCurrentSessionContext();
    const role = session?.role || "";
    const canPost = canPostInvoice(role);
    const invoices = await getInvoices();
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
                <article class="mini-card"><p>Drafts</p><h3>7</h3></article>
                <article class="mini-card"><p>Sent</p><h3>28</h3></article>
                <article class="mini-card"><p>Overdue</p><h3>5</h3></article>
            </div>
            <section class="panel">
                ${createTable(
                    ["Invoice", "Customer", "Amount", "Status"],
                    invoices.map((invoice) => [
                        invoice.number,
                        invoice.customer,
                        formatCurrency(invoice.amount),
                        `<span class="badge ${formatStatusTone(invoice.status)}">${invoice.status}</span>`
                    ])
                )}
            </section>
        </div>
    `;
}

export function bindInvoicesActions(container, refresh) {
    const button = container.querySelector("#createInvoiceButton");
    button?.addEventListener("click", async () => {
        const customerName = window.prompt("Customer name (optional)") || "";
        const totalRaw = window.prompt("Invoice total (numbers only)");
        if (!totalRaw) return;
        const totalAmount = Number(totalRaw);
        if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
            showToast("Enter a valid invoice amount.");
            return;
        }

        button.disabled = true;
        try {
            await createInvoice({ customerName: customerName.trim(), totalAmount });
            showToast("Invoice posted");
            await refresh();
        } catch (error) {
            showToast(error.message || "Unable to create invoice.");
        } finally {
            button.disabled = false;
        }
    });
}
