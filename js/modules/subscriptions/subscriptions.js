import { getSubscriptions } from "./subscriptions-service.js";
import { createTable, formatStatusTone } from "../../core/utils.js";

function formatDate(value) {
    if (!value) {
        return "Open-ended";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Open-ended";
    }

    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    }).format(date);
}

export async function renderSubscriptions() {
    const subscriptions = await getSubscriptions();
    return `
        <div class="section-stack">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Billing oversight</p>
                    <h2>Subscriptions</h2>
                </div>
                <button class="btn btn-secondary" type="button">Export Billing Report</button>
            </div>
            <section class="panel">
                ${createTable(
                    ["Business", "Plan", "Start", "End", "Status"],
                    subscriptions.map((subscription) => [
                        subscription.business,
                        subscription.plan,
                        formatDate(subscription.startedAt),
                        formatDate(subscription.renewal),
                        `<span class="badge ${formatStatusTone(subscription.status)}">${subscription.status}</span>`
                    ])
                )}
            </section>
        </div>
    `;
}
