import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import {
    addDemoInvoice,
    getDemoCustomers,
    getDemoInvoiceById,
    getDemoInvoices,
    recordDemoInvoicePayment
} from "../../demo/demo-records.js";

const DEFAULT_TERMS_DAYS = 14;

function today() {
    return new Date().toISOString().slice(0, 10);
}

function addDays(dateValue, days) {
    const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

function toMoney(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function normalizeStatus(value) {
    const normalized = String(value || "draft").trim().toLowerCase();
    return ["draft", "sent", "paid", "overdue", "cancelled"].includes(normalized) ? normalized : "draft";
}

function normalizeItems(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => {
            const quantity = toMoney(item.quantity || 1);
            const unitPrice = toMoney(item.unitPrice ?? item.unit_price);
            const taxAmount = toMoney(item.taxAmount ?? item.tax_amount);
            const lineTotal = toMoney((quantity * unitPrice) + taxAmount);
            return {
                description: String(item.description || "").trim(),
                quantity,
                unitPrice,
                taxAmount,
                lineTotal
            };
        })
        .filter((item) => item.description && item.quantity > 0 && item.unitPrice >= 0);
}

function buildInvoicePayload(payload) {
    const issuedAt = payload.issuedAt || today();
    const items = normalizeItems(payload.items);
    if (!items.length) {
        throw new Error("Add at least one invoice item.");
    }

    const subtotalAmount = toMoney(items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0));
    const taxAmount = toMoney(items.reduce((sum, item) => sum + item.taxAmount, 0));
    const totalAmount = toMoney(subtotalAmount + taxAmount);

    if (totalAmount <= 0) {
        throw new Error("Invoice total must be greater than zero.");
    }

    return {
        invoiceNumber: String(payload.invoiceNumber || "").trim() || `INV-${Date.now()}`,
        customerId: String(payload.customerId || "").trim() || null,
        customerName: String(payload.customerName || "").trim(),
        issuedAt,
        dueDate: payload.dueDate || addDays(issuedAt, DEFAULT_TERMS_DAYS),
        status: normalizeStatus(payload.status),
        subtotalAmount,
        taxAmount,
        totalAmount,
        items
    };
}

function mapInvoiceDetail(invoice) {
    return {
        id: invoice.id || invoice.invoice_number,
        number: invoice.invoice_number,
        customerId: invoice.customer_id || null,
        customer: invoice.customers?.name || invoice.customer_name || "Walk-in Customer",
        customerEmail: invoice.customers?.email || invoice.customer_email || "",
        customerPhone: invoice.customers?.phone || invoice.customer_phone || "",
        customerAddress: invoice.customers?.billing_address || invoice.customer_billing_address || "",
        issuedAt: invoice.issued_at || "",
        dueDate: invoice.due_date || "",
        subtotal: Number(invoice.subtotal_amount || invoice.total_amount || 0),
        tax: Number(invoice.tax_amount || 0),
        amount: Number(invoice.total_amount || 0),
        status: invoice.status,
        items: (Array.isArray(invoice.invoice_items) ? invoice.invoice_items : (invoice.items || [])).map((item) => ({
            description: item.description || "",
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unit_price ?? item.unitPrice ?? 0),
            taxAmount: Number(item.tax_amount ?? item.taxAmount ?? 0),
            lineTotal: Number(item.line_total ?? item.lineTotal ?? 0)
        }))
    };
}

export async function getInvoices() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (session?.mode !== "live") {
        return getDemoInvoices().map((invoice) => ({
            id: invoice.id || invoice.invoice_number,
            number: invoice.invoice_number,
            customer: invoice.customer_name || "Walk-in Customer",
            issuedAt: invoice.issued_at || "",
            dueDate: invoice.due_date || "",
            subtotal: Number(invoice.subtotal_amount || invoice.total_amount || 0),
            tax: Number(invoice.tax_amount || 0),
            amount: Number(invoice.total_amount || 0),
            status: invoice.status,
            items: Array.isArray(invoice.items) ? invoice.items : []
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
            issued_at,
            due_date,
            subtotal_amount,
            tax_amount,
            total_amount,
            status,
            customers (
                name
            ),
            invoice_items (
                description,
                quantity,
                unit_price,
                tax_amount,
                line_total
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
        issuedAt: invoice.issued_at || "",
        dueDate: invoice.due_date || "",
        subtotal: Number(invoice.subtotal_amount || 0),
        tax: Number(invoice.tax_amount || 0),
        amount: Number(invoice.total_amount || 0),
        status: invoice.status,
        items: Array.isArray(invoice.invoice_items) ? invoice.invoice_items : []
    }));
}

export async function getInvoiceDetails(invoiceId) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!invoiceId) {
        throw new Error("Invoice is required.");
    }

    if (session?.mode !== "live") {
        const invoice = getDemoInvoiceById(invoiceId);
        if (!invoice) {
            throw new Error("Invoice was not found.");
        }
        return mapInvoiceDetail(invoice);
    }

    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const { data, error } = await supabase
        .from("invoices")
        .select(`
            id,
            customer_id,
            invoice_number,
            issued_at,
            due_date,
            subtotal_amount,
            tax_amount,
            total_amount,
            status,
            customers (
                name,
                email,
                phone,
                billing_address
            ),
            invoice_items (
                description,
                quantity,
                unit_price,
                tax_amount,
                line_total
            )
        `)
        .eq("business_id", session.businessId)
        .eq("id", invoiceId)
        .single();

    if (error) {
        throw error;
    }

    return mapInvoiceDetail(data);
}

export async function getInvoiceCustomers() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (session?.mode !== "live") {
        return getDemoCustomers().map((customer) => ({
            id: customer.id,
            name: customer.name
        }));
    }

    if (!supabase || !session?.businessId) {
        return [];
    }

    const { data, error } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", session.businessId)
        .order("name", { ascending: true });

    if (error) {
        throw error;
    }

    return data || [];
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

    const invoice = buildInvoicePayload(payload);

    if (session.mode !== "live") {
        addDemoInvoice(invoice);
        return;
    }

    if (!supabase || !session.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const { data: createdInvoice, error } = await supabase.from("invoices").insert({
        business_id: session.businessId,
        customer_id: invoice.customerId,
        invoice_number: invoice.invoiceNumber,
        subtotal_amount: invoice.subtotalAmount,
        tax_amount: invoice.taxAmount,
        total_amount: invoice.totalAmount,
        issued_at: invoice.issuedAt,
        due_date: invoice.dueDate,
        status: invoice.status,
        created_by: session.userId || null
    }).select("id").single();

    if (error) {
        throw error;
    }

    const itemRows = invoice.items.map((item) => ({
        invoice_id: createdInvoice.id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        tax_amount: item.taxAmount,
        line_total: item.lineTotal
    }));

    const { error: itemsError } = await supabase.from("invoice_items").insert(itemRows);

    if (itemsError) {
        await supabase.from("invoices").delete().eq("id", createdInvoice.id).eq("business_id", session.businessId);
        throw itemsError;
    }
}

export async function recordInvoicePayment(invoiceId, payload = {}) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session) {
        throw new Error("No active session.");
    }
    if (!invoiceId) {
        throw new Error("Invoice is required.");
    }

    const amount = toMoney(payload.amount);
    if (amount <= 0) {
        throw new Error("Enter a valid payment amount.");
    }

    const payment = {
        amount,
        paymentMethod: String(payload.paymentMethod || "Cash").trim() || "Cash",
        reference: String(payload.reference || "").trim(),
        receivedAt: payload.receivedAt || today()
    };

    if (session.mode !== "live") {
        recordDemoInvoicePayment(invoiceId, payment);
        return;
    }

    if (!supabase || !session.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const invoice = await getInvoiceDetails(invoiceId);

    const { error: paymentError } = await supabase.from("payments").insert({
        business_id: session.businessId,
        invoice_id: invoiceId,
        customer_id: invoice.customerId,
        amount: payment.amount,
        payment_method: payment.paymentMethod,
        received_at: payment.receivedAt,
        reference: payment.reference || null,
        created_by: session.userId || null
    });

    if (paymentError) {
        throw paymentError;
    }

    const { error: invoiceError } = await supabase
        .from("invoices")
        .update({ status: "paid" })
        .eq("business_id", session.businessId)
        .eq("id", invoiceId);

    if (invoiceError) {
        throw invoiceError;
    }

    if (invoice.customerId) {
        await supabase
            .from("customers")
            .update({ last_payment_at: payment.receivedAt })
            .eq("business_id", session.businessId)
            .eq("id", invoice.customerId);
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
