import { getCustomers, createCustomer } from "./customers-service.js";
import { createTable, formatCurrency } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";

export async function renderCustomers() {
    const customers = await getCustomers();
    return `
        <div class="section-stack">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Customer ledger</p>
                    <h2>Customers</h2>
                </div>
                <button class="btn btn-primary" id="addCustomerButton" type="button">Add Customer</button>
            </div>
            <section class="panel">
                ${createTable(
                    ["Name", "Industry", "Balance", "Last Payment"],
                    customers.map((customer) => [
                        customer.name,
                        customer.industry,
                        formatCurrency(customer.balance),
                        customer.lastPayment
                    ])
                )}
            </section>
        </div>
    `;
}

export function bindCustomersActions(container, refresh) {
    const button = container.querySelector("#addCustomerButton");
    button?.addEventListener("click", async () => {
        const name = window.prompt("Customer name");
        if (!name) return;
        const industry = window.prompt("Industry (optional)") || "";
        const email = window.prompt("Email (optional)") || "";
        const phone = window.prompt("Phone (optional)") || "";

        button.disabled = true;
        try {
            await createCustomer({ name: name.trim(), industry: industry.trim(), email: email.trim(), phone: phone.trim() });
            showToast("Customer added");
            await refresh();
        } catch (error) {
            showToast(error.message || "Unable to add customer.");
        } finally {
            button.disabled = false;
        }
    });
}
