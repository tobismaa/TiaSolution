import { getSupabaseClient } from "./supabase-client.js";

const SECURITY_NOTIFICATION_PATH = "/api/security-notification";

function getApiBaseCandidates() {
    const explicitBase = String(window.TIA_API_BASE_URL || window.TIA_SUPABASE_CONFIG?.apiBaseUrl || "").trim();
    const candidates = [];

    if (explicitBase) {
        candidates.push(explicitBase.replace(/\/$/, ""));
    }

    candidates.push("");

    if (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port !== "8003") {
        candidates.push("http://localhost:8003");
    }

    return [...new Set(candidates)];
}

export async function sendSecurityNotification(payload) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return false;
    }

    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) {
        return false;
    }

    for (const baseUrl of getApiBaseCandidates()) {
        try {
            const response = await fetch(`${baseUrl}${SECURITY_NOTIFICATION_PATH}`, {
                method: "POST",
                headers: {
                    "authorization": `Bearer ${token}`,
                    "content-type": "application/json",
                    "x-tia-auth": token
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                return true;
            }

            let errorBody = "";
            try {
                errorBody = await response.text();
            } catch {
                errorBody = "";
            }
            console.warn(`[Tia security] Email API rejected request with ${response.status}.`, errorBody);
        } catch {
            // Try the next configured endpoint.
        }
    }

    return false;
}
