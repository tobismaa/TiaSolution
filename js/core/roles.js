export const ROLES = {
    SUPER_ADMIN: "super_admin",
    BUSINESS_ADMIN: "business_admin",
    MANAGER: "manager",
    STAFF: "staff",
    AUDITOR: "auditor",
    ACCOUNT: "account"
};

export const ROLE_LABELS = {
    [ROLES.SUPER_ADMIN]: "Super Admin",
    [ROLES.BUSINESS_ADMIN]: "Admin",
    [ROLES.MANAGER]: "Head of Operations",
    [ROLES.STAFF]: "Operations",
    [ROLES.AUDITOR]: "Audit",
    [ROLES.ACCOUNT]: "Account"
};

export const ROUTES = {
    dashboard: { label: "Dashboard", title: "Dashboard", eyebrow: "Workspace overview" },
    trialBalance: { label: "Trial Balance", title: "Trial Balance", eyebrow: "Ledger position report" },
    glPosting: { label: "GL Posting", title: "GL Posting", eyebrow: "Journal posting" },
    branches: { label: "Branches", title: "Branches", eyebrow: "Organization structure" },
    generalLedgers: { label: "Chart of Accounts", title: "Chart of Accounts", eyebrow: "Account structure" },
    customerBilling: { label: "Customers & Invoices", title: "Customers & Invoices", eyebrow: "Customer ledger and billing control" },
    customers: { label: "Customers", title: "Customers", eyebrow: "Customer ledger" },
    invoices: { label: "Invoices", title: "Invoices", eyebrow: "Billing control" },
    expenses: { label: "Expenses", title: "Expenses", eyebrow: "Spend management" },
    reports: { label: "Reports", title: "Reports", eyebrow: "Financial insight" },
    assets: { label: "Assets", title: "Asset Management", eyebrow: "Capitalization and depreciation" },
    users: { label: "Users", title: "Users", eyebrow: "User administration" },
    audit: { label: "Audit", title: "Audit Log", eyebrow: "Review and traceability" },
    settings: { label: "Settings", title: "Settings", eyebrow: "Platform setup" },
    payroll: { label: "Payroll", title: "Payroll", eyebrow: "Compensation control" },
    operation: { label: "Operation", title: "Operation", eyebrow: "Customer transaction workspace" },
    accountManagement: { label: "Account Management", title: "Account Management", eyebrow: "Customer account opening" },
    businesses: { label: "Organizations", title: "Organizations", eyebrow: "Platform control" },
    demoRequests: { label: "Demo Requests", title: "Demo Requests", eyebrow: "Pre-sales access review" },
    subscriptions: { label: "Subscriptions", title: "Subscriptions", eyebrow: "Billing oversight" }
};

export const ROLE_NAV = {
    [ROLES.BUSINESS_ADMIN]: ["dashboard", "branches", "customerBilling", "payroll", "users"],
    [ROLES.MANAGER]: ["dashboard", "customerBilling", "glPosting", "reports"],
    [ROLES.STAFF]: ["dashboard", "operation", "accountManagement", "customerBilling", "payroll", "glPosting", "reports", "assets"],
    [ROLES.AUDITOR]: ["dashboard", "trialBalance", "generalLedgers", "reports"],
    [ROLES.ACCOUNT]: ["dashboard", "payroll", "generalLedgers", "reports"],
    [ROLES.SUPER_ADMIN]: ["dashboard", "businesses", "demoRequests", "subscriptions", "settings"]
};

export function getDefaultRoute(role) {
    return ROLE_NAV[role]?.[0] || "dashboard";
}
