import { getCurrentSessionContext } from "../../core/session.js";
import { getOrganizationBranding, saveOrganizationBranding } from "../../core/branding.js";

const MAX_LOGO_BYTES = 300 * 1024;

export async function getCurrentOrganizationBranding(options = {}) {
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        return { branding: null, session };
    }

    const branding = await getOrganizationBranding(session.businessId, options);
    return { branding, session };
}

export async function saveCurrentOrganizationBranding(payload) {
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }

    return saveOrganizationBranding(session.businessId, payload);
}

export function readLogoFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            resolve("");
            return;
        }

        if (!String(file.type || "").startsWith("image/")) {
            reject(new Error("Upload an image file for the logo."));
            return;
        }

        if (file.size > MAX_LOGO_BYTES) {
            reject(new Error("Logo must be 300KB or smaller."));
            return;
        }

        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Unable to read the logo file."));
        reader.readAsDataURL(file);
    });
}
