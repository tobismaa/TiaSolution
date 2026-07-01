import { ROLE_NAV, getDefaultRoute } from "./roles.js";
import { getDefaultRouteForRoutes } from "./features.js";

export function canAccessRoute(role, route, allowedRoutes = null) {
    const routes = Array.isArray(allowedRoutes) ? allowedRoutes : ROLE_NAV[role];
    return routes?.includes(route) ?? false;
}

export function ensureRoute(role, route, allowedRoutes = null) {
    if (canAccessRoute(role, route, allowedRoutes)) {
        return route;
    }

    const routes = Array.isArray(allowedRoutes) ? allowedRoutes : ROLE_NAV[role];
    if ((route === "customers" || route === "invoices") && routes?.includes("customerBilling")) {
        return "customerBilling";
    }

    return Array.isArray(allowedRoutes) ? getDefaultRouteForRoutes(allowedRoutes) : getDefaultRoute(role);
}
