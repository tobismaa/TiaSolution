import { createExpense, getExpenses } from "./expenses-service.js";
import { createTable, formatCurrency, formatStatusTone } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import { getCurrentSessionContext } from "../../core/session.js";

function canPostExpense(role) {
    const normalized = String(role || "").toLowerCase();
    return normalized === "staff" || normalized === "manager" || normalized === "business_admin";
}

export async function renderExpenses() {
    const session = await getCurrentSessionContext();
    const role = session?.role || "";
    const canPost = canPostExpense(role);
    const expenses = await getExpenses();
    return `
        <div class="section-stack">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Spend management</p>
                    <h2>Expenses</h2>
                </div>
                <button class="btn btn-primary" id="recordExpenseButton" type="button" ${canPost ? "" : "disabled"}>
                    ${String(role).toLowerCase() === "staff" ? "Post Expense" : "Record Expense"}
                </button>
            </div>
            <section class="panel">
                ${createTable(
                    ["Expense", "Category", "Amount", "Status"],
                    expenses.map((expense) => [
                        expense.name,
                        expense.category,
                        formatCurrency(expense.amount),
                        `<span class="badge ${formatStatusTone(expense.status)}">${expense.status}</span>`
                    ])
                )}
            </section>
        </div>
    `;
}

export function bindExpensesActions(container, refresh) {
    const button = container.querySelector("#recordExpenseButton");
    button?.addEventListener("click", async () => {
        const title = window.prompt("Expense title");
        if (!title) return;
        const category = window.prompt("Category (optional)") || "";
        const amountRaw = window.prompt("Amount (numbers only)");
        if (!amountRaw) return;
        const amount = Number(amountRaw);
        if (!Number.isFinite(amount) || amount <= 0) {
            showToast("Enter a valid amount.");
            return;
        }

        button.disabled = true;
        try {
            await createExpense({ title: title.trim(), category: category.trim(), amount });
            showToast("Expense posted");
            await refresh();
        } catch (error) {
            showToast(error.message || "Unable to record expense.");
        } finally {
            button.disabled = false;
        }
    });
}
