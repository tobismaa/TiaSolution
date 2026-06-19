export function formatCurrency(value) {
    return new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

export function formatStatusTone(status) {
    const normalized = String(status).toLowerCase();
    if (normalized.includes("paid") || normalized.includes("active") || normalized.includes("approved") || normalized.includes("connected")) {
        return "paid";
    }
    if (normalized.includes("due") || normalized.includes("trial") || normalized.includes("pending") || normalized.includes("error") || normalized.includes("deactivated") || normalized.includes("expired")) {
        return "due";
    }
    if (normalized.includes("demo") || normalized.includes("preview")) {
        return "pink";
    }
    return "draft";
}

export function formatRole(role) {
    const normalized = String(role || "").trim().toLowerCase();
    const labels = {
        super_admin: "Super Admin",
        business_admin: "Admin",
        manager: "Head of Operations",
        staff: "Operations",
        auditor: "Audit",
        account: "Account"
    };

    if (labels[normalized]) {
        return labels[normalized];
    }

    return String(role || "")
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

export function createTable(headers, rows) {
    const head = headers.map((header) => `<th>${header}</th>`).join("");
    const body = rows.length
        ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${headers.length}">No records available.</td></tr>`;

    return `
        <table>
            <thead><tr>${head}</tr></thead>
            <tbody>${body}</tbody>
        </table>
    `;
}
