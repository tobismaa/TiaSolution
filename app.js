import { getCurrentSessionContext } from "./js/core/session.js";
import { ROLES } from "./js/core/roles.js";

async function redirectWorkspace() {
    const session = await getCurrentSessionContext();
    if (!session) {
        window.location.href = "./login.html";
        return;
    }

    switch (session.role) {
        case ROLES.SUPER_ADMIN:
            window.location.href = "./super-admin.html";
            return;
        case ROLES.BUSINESS_ADMIN:
            window.location.href = "./business-admin.html";
            return;
        case ROLES.MANAGER:
            window.location.href = "./head-of-operations.html";
            return;
        case ROLES.STAFF:
            window.location.href = "./operations.html";
            return;
        case ROLES.AUDITOR:
            window.location.href = "./auditor.html";
            return;
        default:
            window.location.href = "./login.html";
    }
}

redirectWorkspace();
