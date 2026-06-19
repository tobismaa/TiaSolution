import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { addDemoInvoice, getDemoInvoices } from "../../demo/demo-records.js";

export async function getInvoices() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (session?.mode !== "live") {
        return getDemoInvoices().map((invoice) => ({
            id: invoice.id || invoice.invoice_number,
            number: invoice.invoice_number,
            customer: invoice.customer_name || "Walk-in Customer",
            amount: Number(invoice.total_amount || 0),
            status: invoice.status
        }));
    }

    if (!supabase || !session?.businessId) {
        return [];
    }

    const { data, error } = await supabase
        .from("invoices")
        .select(`
            id,
            invoice_number,
            total_amount,
            status,
            customers (
                name
            )
        `)
        .eq("business_id", session.businessId)
        .order("created_at", { ascending: false });

    if (error) {
        throw error;
    }

    return (data || []).map((invoice) => ({
        id: invoice.id || invoice.invoice_number,
        number: invoice.invoice_number,
        customer: invoice.customers?.name || "Walk-in Customer",
        amount: Number(invoice.total_amount || 0),
        status: invoice.status
    }));
}

export async function createInvoice(payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session) {
        throw new Error("No active session.");
    }
    const role = String(session.role || "").toLowerCase();
    if (!["staff", "manager", "business_admin"].includes(role)) {
        throw new Error("Only Operations, Head of Operations, or Admin can post invoices.");
    }

    if (session.mode !== "live") {
        addDemoInvoice(payload);
        return;
    }

    if (!supabase || !session.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const invoiceNumber = payload.invoiceNumber || `INV-${Date.now()}`;
    const totalAmount = Number(payload.totalAmount || 0);

    const { error } = await supabase.from("invoices").insert({
        business_id: session.businessId,
        invoice_number: invoiceNumber,
        subtotal_amount: totalAmount,
        tax_amount: 0,
        total_amount: totalAmount,
        status: "sent"
    });

    if (error) {
        throw error;
    }
}

export async function approveInvoice(invoiceId) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session) {
        throw new Error("No active session.");
    }
    if (!invoiceId) {
        throw new Error("Invoice is required.");
    }
    const role = String(session.role || "").toLowerCase();
    if (!["manager", "business_admin"].includes(role)) {
        throw new Error("Only Head of Operations or Admin can approve invoices.");
    }
    if (session.mode !== "live") {
        return;
    }
    if (!supabase || !session.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const { error } = await supabase
        .from("invoices")
        .update({ status: "sent" })
        .eq("business_id", session.businessId)
        .eq("id", invoiceId);

    if (error) {
        throw error;
    }
}
