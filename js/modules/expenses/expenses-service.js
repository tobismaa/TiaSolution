import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { addDemoExpense, getDemoExpenses } from "../../demo/demo-records.js";

export async function getExpenses() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (session?.mode !== "live") {
        return getDemoExpenses().map((expense) => ({
            id: expense.id || `${expense.title}-${expense.amount}`,
            name: expense.title,
            category: expense.category || "General",
            amount: Number(expense.amount || 0),
            status: expense.status
        }));
    }

    if (!supabase || !session?.businessId) {
        return [];
    }

    const { data, error } = await supabase
        .from("expenses")
        .select("id, title, category, amount, status")
        .eq("business_id", session.businessId)
        .order("created_at", { ascending: false });

    if (error) {
        throw error;
    }

    return (data || []).map((expense) => ({
        id: expense.id,
        name: expense.title,
        category: expense.category || "General",
        amount: Number(expense.amount || 0),
        status: expense.status
    }));
}

export async function createExpense(payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session) {
        throw new Error("No active session.");
    }
    const role = String(session.role || "").toLowerCase();
    if (!["staff", "manager", "business_admin"].includes(role)) {
        throw new Error("Only Operations, Head of Operations, or Admin can post expenses.");
    }

    if (session.mode !== "live") {
        addDemoExpense(payload);
        return;
    }

    if (!supabase || !session.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const { error } = await supabase.from("expenses").insert({
        business_id: session.businessId,
        title: payload.title,
        category: payload.category || null,
        amount: Number(payload.amount || 0),
        status: "approved"
    });

    if (error) {
        throw error;
    }
}

export async function approveExpense(expenseId) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session) {
        throw new Error("No active session.");
    }
    if (!expenseId) {
        throw new Error("Expense is required.");
    }
    const role = String(session.role || "").toLowerCase();
    if (!["manager", "business_admin"].includes(role)) {
        throw new Error("Only Head of Operations or Admin can approve expenses.");
    }
    if (session.mode !== "live") {
        return;
    }
    if (!supabase || !session.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const { error } = await supabase
        .from("expenses")
        .update({ status: "approved" })
        .eq("business_id", session.businessId)
        .eq("id", expenseId);

    if (error) {
        throw error;
    }
}
