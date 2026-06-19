import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { addDemoCustomer, getDemoCustomers } from "../../demo/demo-records.js";

export async function getCustomers() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (session?.mode !== "live") {
        return getDemoCustomers().map((customer) => ({
            name: customer.name,
            industry: customer.industry || "Unassigned",
            balance: Number(customer.balance || 0),
            lastPayment: customer.last_payment_at || "Pending"
        }));
    }

    if (!supabase || !session?.businessId) {
        return [];
    }

    const { data, error } = await supabase
        .from("customers")
        .select("name, industry, balance, last_payment_at")
        .eq("business_id", session.businessId)
        .order("name");

    if (error) {
        throw error;
    }

    return (data || []).map((customer) => ({
        name: customer.name,
        industry: customer.industry || "Unassigned",
        balance: Number(customer.balance || 0),
        lastPayment: customer.last_payment_at || "Pending"
    }));
}

export async function createCustomer(payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session) {
        throw new Error("No active session.");
    }

    if (session.mode !== "live") {
        addDemoCustomer(payload);
        return;
    }

    if (!supabase || !session.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const { error } = await supabase.from("customers").insert({
        business_id: session.businessId,
        name: payload.name,
        industry: payload.industry || null,
        email: payload.email || null,
        phone: payload.phone || null
    });

    if (error) {
        throw error;
    }
}
