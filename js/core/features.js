import { ROLE_LABELS, ROLE_NAV, ROLES, ROUTES } from "./roles.js";

export const FEATURE_DEFINITIONS = [
    { key: "branches", label: "Branches", description: "Organization branch setup and branch controls." },
    { key: "customerBilling", label: "Customers & Invoices", description: "Customer records, profiles, receipts, invoice creation, payments, and billing." },
    { key: "expenses", label: "Expenses", description: "Expense capture and spend management." },
    { key: "payroll", label: "Payroll", description: "Payroll staff, payroll runs, and compensation control." },
    { key: "users", label: "Users", description: "Organization user administration." },
    { key: "reports", label: "Reports", description: "Financial reports and business reporting views." },
    { key: "settings", label: "Settings", description: "Organization-level setup and preferences." },
    { key: "glPosting", label: "GL Posting", description: "Journal posting and GL transaction capture." },
    { key: "generalLedgers", label: "Chart of Accounts", description: "Ledger and chart of account setup." },
    { key: "trialBalance", label: "Trial Balance", description: "Trial balance reporting." },
    { key: "assets", label: "Asset Management", description: "Capital assets, depreciation, and disposal workflows." },
    { key: "accountManagement", label: "Account Management", description: "Customer account opening and account operations." },
    { key: "operation", label: "Operation Workspace", description: "Operations transaction workspace." },
    { key: "audit", label: "Audit", description: "Audit log and review views." }
];

export const FEATURE_LABELS = FEATURE_DEFINITIONS.reduce((labels, feature) => ({
    ...labels,
    [feature.key]: feature.label
}), {});

export const ROUTE_FEATURES = {
    customerBilling: "customerBilling",
    branches: "branches",
    customers: "customerBilling",
    invoices: "customerBilling",
    expenses: "expenses",
    payroll: "payroll",
    users: "users",
    reports: "reports",
    settings: "settings",
    glPosting: "glPosting",
    generalLedgers: "generalLedgers",
    trialBalance: "trialBalance",
    assets: "assets",
    accountManagement: "accountManagement",
    operation: "operation",
    audit: "audit"
};

const FEATURE_KEYS = new Set(FEATURE_DEFINITIONS.map((feature) => feature.key));
const DASHBOARD_ROLES = [
    ROLES.BUSINESS_ADMIN,
    ROLES.MANAGER,
    ROLES.STAFF,
    ROLES.AUDITOR,
    ROLES.ACCOUNT
];
const DASHBOARD_ROLE_KEYS = new Set(DASHBOARD_ROLES);
const ACCESS_SEPARATOR = ":";
const LEGACY_FEATURE_ALIASES = {
    customers: "customerBilling",
    invoices: "customerBilling"
};
export const LEGACY_FEATURE_KEYS = Object.keys(LEGACY_FEATURE_ALIASES);
const DASHBOARD_EXTRA_FEATURES = {
    [ROLES.BUSINESS_ADMIN]: ["reports", "expenses"],
    [ROLES.MANAGER]: ["expenses"],
    [ROLES.STAFF]: ["expenses"]
};

function getRouteFeatureKeys(route) {
    const value = ROUTE_FEATURES[route];
    if (Array.isArray(value)) {
        return value;
    }
    return value ? [value] : [];
}

export const DASHBOARD_FEATURE_GROUPS = DASHBOARD_ROLES.map((role) => ({
    key: role,
    role,
    label: `${ROLE_LABELS[role] || role} Dashboard`,
    description: `Access visible inside the ${ROLE_LABELS[role] || role} dashboard.`,
    features: [...new Set([
        ...(ROLE_NAV[role] || []).flatMap((route) => getRouteFeatureKeys(route)),
        ...(DASHBOARD_EXTRA_FEATURES[role] || [])
    ])]
        .map((featureKey) => {
            const route = (ROLE_NAV[role] || []).find((item) => getRouteFeatureKeys(item).includes(featureKey)) || "";
            const routeMeta = ROUTES[route] || {};
            const isCombinedRoute = getRouteFeatureKeys(route).length > 1;
            const feature = FEATURE_DEFINITIONS.find((item) => item.key === featureKey) || {};
            return {
                route,
                key: featureKey,
                accessKey: createDashboardFeatureKey(role, featureKey),
                label: isCombinedRoute ? (feature.label || featureKey) : (routeMeta.label || feature.label || featureKey),
                description: isCombinedRoute ? (feature.description || "") : (routeMeta.eyebrow || feature.description || "")
            };
        })
}));

export function createDashboardFeatureKey(role, featureKey) {
    const normalizedRole = String(role || "").trim();
    const normalizedFeature = LEGACY_FEATURE_ALIASES[String(featureKey || "").trim()] || String(featureKey || "").trim();
    if (!DASHBOARD_ROLE_KEYS.has(normalizedRole) || !FEATURE_KEYS.has(normalizedFeature)) {
        return "";
    }

    return `${normalizedRole}${ACCESS_SEPARATOR}${normalizedFeature}`;
}

function parseFeatureAccessKey(key) {
    const normalized = String(key || "").trim();
    if (!normalized) {
        return "";
    }

    const aliasedFeature = LEGACY_FEATURE_ALIASES[normalized] || normalized;
    if (FEATURE_KEYS.has(aliasedFeature)) {
        return aliasedFeature;
    }

    const [role, featureKey] = normalized.split(ACCESS_SEPARATOR);
    return createDashboardFeatureKey(role, featureKey);
}

export function normalizeFeatureKeys(featureKeys) {
    if (!Array.isArray(featureKeys)) {
        return [];
    }

    return [...new Set(
        featureKeys
            .map((key) => String(key || "").trim())
            .map(parseFeatureAccessKey)
            .filter(Boolean)
    )];
}

export function hasFeatureAccess(featureKeys, role, featureKey) {
    if (!Array.isArray(featureKeys)) {
        return true;
    }

    const enabled = new Set(normalizeFeatureKeys(featureKeys));
    const dashboardFeatureKey = createDashboardFeatureKey(role, featureKey);
    return Boolean(dashboardFeatureKey && enabled.has(dashboardFeatureKey));
}

export function getEnabledRoutesForRole(role, featureKeys) {
    const roleRoutes = ROLE_NAV[role] || [];
    if (!Array.isArray(featureKeys)) {
        return roleRoutes;
    }

    const orderedFeatureKeys = normalizeFeatureKeys(featureKeys);
    const featureOrder = new Map(orderedFeatureKeys.map((featureKey, index) => [featureKey, index]));
    const filteredRoutes = roleRoutes.filter((route) => {
        const routeFeatureKeys = getRouteFeatureKeys(route);
        return !routeFeatureKeys.length || routeFeatureKeys.some((featureKey) => hasFeatureAccess(featureKeys, role, featureKey));
    });

    return filteredRoutes.sort((leftRoute, rightRoute) => {
        const leftFeatureKeys = getRouteFeatureKeys(leftRoute);
        const rightFeatureKeys = getRouteFeatureKeys(rightRoute);
        const leftDefaultIndex = roleRoutes.indexOf(leftRoute);
        const rightDefaultIndex = roleRoutes.indexOf(rightRoute);
        const leftOrder = leftFeatureKeys.length
            ? Math.min(...leftFeatureKeys.map((featureKey) => featureOrder.get(createDashboardFeatureKey(role, featureKey)) ?? Number.MAX_SAFE_INTEGER))
            : leftDefaultIndex;
        const rightOrder = rightFeatureKeys.length
            ? Math.min(...rightFeatureKeys.map((featureKey) => featureOrder.get(createDashboardFeatureKey(role, featureKey)) ?? Number.MAX_SAFE_INTEGER))
            : rightDefaultIndex;

        if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
        }
        return leftDefaultIndex - rightDefaultIndex;
    });
}

export function getDefaultRouteForRoutes(routes) {
    return Array.isArray(routes) && routes.length ? routes[0] : "dashboard";
}

export function isFeatureEnabled(featureKeys, featureKey, role = "") {
    if (!Array.isArray(featureKeys)) {
        return true;
    }

    const enabled = normalizeFeatureKeys(featureKeys);
    if (role) {
        return hasFeatureAccess(enabled, role, featureKey);
    }

    return enabled.some((key) => key.endsWith(`${ACCESS_SEPARATOR}${featureKey}`));
}
