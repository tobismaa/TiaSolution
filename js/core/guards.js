import { ROLE_NAV, getDefaultRoute } from "./roles.js";

export function canAccessRoute(role, route) {
    return ROLE_NAV[role]?.includes(route) ?? false;
}

export function ensureRoute(role, route) {
    return canAccessRoute(role, route) ? route : getDefaultRoute(role);
}
