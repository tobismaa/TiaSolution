import { getSupabaseClient } from "../../core/supabase-client.js";

export async function getSubscriptions() {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return [];
    }

    const { data, error } = await supabase
        .from("subscriptions")
        .select(`
            plan_name,
            status,
            starts_at,
            ends_at,
            businesses (
                name
            )
        `)
        .order("starts_at", { ascending: false });

    if (error) {
        throw error;
    }

    return (data || []).map((subscription) => ({
        business: subscription.businesses?.name || "Unknown Client",
        plan: subscription.plan_name,
        startedAt: subscription.starts_at || null,
        renewal: subscription.ends_at || "Open-ended",
        status: subscription.status
    }));
}
