import { getStoredSession, saveDemoSession } from "../core/session.js";

export function enterDemo(role) {
    const current = getStoredSession();
    const allowedRoles = Array.isArray(current?.allowedRoles) && current.allowedRoles.length
        ? current.allowedRoles
        : [role];

    if (!allowedRoles.includes(role)) {
        throw new Error("This role is not available for your demo access.");
    }

    return saveDemoSession(role, "demo", {
        allowedRoles,
        grantedRole: current?.grantedRole || role
    });
}
