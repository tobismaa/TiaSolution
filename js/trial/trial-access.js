import { saveDemoSession } from "../core/session.js";
import { ROLES } from "../core/roles.js";

export function startTrial() {
    return saveDemoSession(ROLES.BUSINESS_ADMIN, "trial", {
        allowedRoles: [ROLES.BUSINESS_ADMIN, ROLES.MANAGER, ROLES.STAFF, ROLES.AUDITOR, ROLES.ACCOUNT],
        grantedRole: "trial"
    });
}
