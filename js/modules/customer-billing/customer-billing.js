import { isFeatureEnabled } from "../../core/features.js";
import { renderCustomers, bindCustomersActions } from "../customers/customers.js";
import { renderInvoices, bindInvoicesActions } from "../invoices/invoices.js";

let activeCustomerBillingTab = "customers";

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

export async function renderCustomerBilling(session) {
    const canViewCustomerBilling = isFeatureEnabled(session?.featureKeys, "customerBilling", session?.role);
    const customerContent = canViewCustomerBilling ? await renderCustomers() : "";
    const invoiceContent = canViewCustomerBilling ? await renderInvoices() : "";

    return {
        summary: [],
        content: canViewCustomerBilling
            ? `
                <div class="customer-billing-workspace">
                    <div class="customer-billing-tabs" role="tablist" aria-label="Customers and invoices">
                        <button
                            class="customer-billing-tab ${activeCustomerBillingTab === "customers" ? "is-active" : ""}"
                            type="button"
                            role="tab"
                            aria-selected="${String(activeCustomerBillingTab === "customers")}"
                            data-customer-billing-tab="customers"
                        >
                            Manage Customer
                        </button>
                        <button
                            class="customer-billing-tab ${activeCustomerBillingTab === "invoices" ? "is-active" : ""}"
                            type="button"
                            role="tab"
                            aria-selected="${String(activeCustomerBillingTab === "invoices")}"
                            data-customer-billing-tab="invoices"
                        >
                            Invoice
                        </button>
                    </div>
                    <section class="customer-billing-panel" data-customer-billing-panel="customers" ${activeCustomerBillingTab === "customers" ? "" : "hidden"}>
                        ${customerContent}
                    </section>
                    <section class="customer-billing-panel" data-customer-billing-panel="invoices" ${activeCustomerBillingTab === "invoices" ? "" : "hidden"}>
                        ${invoiceContent}
                    </section>
                </div>
            `
            : `
                <section class="panel">
                    <p class="hero-tag">Access unavailable</p>
                    <h2>No customer or invoice access is enabled for this dashboard.</h2>
                    <p class="muted">Ask the platform admin to enable customer or invoice access for this organization or branch.</p>
                </section>
        `,
        afterRender(pageContent, refresh) {
            if (canViewCustomerBilling) {
                pageContent.querySelectorAll("[data-customer-billing-tab]").forEach((tab) => {
                    tab.addEventListener("click", () => {
                        setButtonLoading(tab, true);
                        const tabKey = String(tab.getAttribute("data-customer-billing-tab") || "customers");
                        activeCustomerBillingTab = tabKey;
                        pageContent.querySelectorAll("[data-customer-billing-tab]").forEach((button) => {
                            const isActive = button === tab;
                            button.classList.toggle("is-active", isActive);
                            button.setAttribute("aria-selected", String(isActive));
                        });
                        pageContent.querySelectorAll("[data-customer-billing-panel]").forEach((panel) => {
                            panel.hidden = panel.getAttribute("data-customer-billing-panel") !== tabKey;
                        });
                        window.setTimeout(() => setButtonLoading(tab, false), 160);
                    });
                });
                bindCustomersActions(pageContent, refresh);
                bindInvoicesActions(pageContent, refresh);
            }
        }
    };
}
