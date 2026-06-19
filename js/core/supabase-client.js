import { supabaseConfig } from "./supabase-config.js";

let client;

export function getSupabaseClient() {
    if (client) {
        return client;
    }

    if (!window.supabase?.createClient) {
        return null;
    }

    client = window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey);
    return client;
}

export async function getSupabaseStatus() {
    const supabase = getSupabaseClient();
    const projectUrl = supabaseConfig.url;
    const projectHost = new URL(projectUrl).host;

    if (!supabase) {
        return {
            status: "Unavailable",
            tone: "due",
            message: "Supabase client library failed to load.",
            session: "Unavailable",
            projectUrl,
            projectHost
        };
    }

    try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
            throw error;
        }

        const hasSession = Boolean(data.session);
        return {
            status: "Connected",
            tone: "paid",
            message: hasSession ? "Supabase responded and an auth session is available." : "Supabase responded. No signed-in user session yet.",
            session: hasSession ? "Active session" : "No active session",
            projectUrl,
            projectHost
        };
    } catch (error) {
        return {
            status: "Error",
            tone: "due",
            message: `Connection check failed: ${error.message || "Unknown error"}`,
            session: "Unavailable",
            projectUrl,
            projectHost
        };
    }
}
