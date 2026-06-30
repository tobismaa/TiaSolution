import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { addDemoCustomer, getDemoCustomerById, getDemoCustomers, getDemoInvoicesForCustomer } from "../../demo/demo-records.js";

function mapCustomer(customer) {
    return {
        id: customer.id,
        name: customer.name,
        email: customer.email || "",
        phone: customer.phone || "",
        industry: customer.industry || "Unassigned",
        billingAddress: customer.billing_address || "",
        balance: Number(customer.balance || 0),
        lastPayment: customer.last_payment_at || "Pending"
    };
}

function mapInvoice(invoice, payments = []) {
    const latestPayment = payments
        .filter((payment) => String(payment.invoice_id || "") === String(invoice.id || ""))
        .sort((a, b) => String(b.received_at || "").localeCompare(String(a.received_at || "")))[0] || invoice.last_payment || null;

    return {
        id: invoice.id,
        number: invoice.invoice_number,
        issuedAt: invoice.issued_at || "",
        dueDate: invoice.due_date || "",
        subtotal: Number(invoice.subtotal_amount || 0),
        tax: Number(invoice.tax_amount || 0),
        amount: Number(invoice.total_amount || 0),
        status: invoice.status || "draft",
        items: (Array.isArray(invoice.invoice_items) ? invoice.invoice_items : (invoice.items || [])).map((item) => ({
            description: item.description || "",
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unit_price ?? item.unitPrice ?? 0),
            taxAmount: Number(item.tax_amount ?? item.taxAmount ?? 0),
            lineTotal: Number(item.line_total ?? item.lineTotal ?? 0)
        })),
        latestPayment: latestPayment ? {
            amount: Number(latestPayment.amount || 0),
            paymentMethod: latestPayment.payment_method || latestPayment.paymentMethod || "",
            reference: latestPayment.reference || "",
            receivedAt: latestPayment.received_at || latestPayment.receivedAt || ""
        } : null
    };
}

export async function getCustomers() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (session?.mode !== "live") {
        return getDemoCustomers().map(mapCustomer);
    }

    if (!supabase || !session?.businessId) {
        return [];
    }

    const { data, error } = await supabase
        .from("customers")
        .select("id, name, email, phone, industry, billing_address, balance, last_payment_at")
        .eq("business_id", session.businessId)
        .order("name");

    if (error) {
        throw error;
    }

    return (data || []).map(mapCustomer);
}

export async function getCustomerProfile(customerId) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!customerId) {
        throw new Error("Customer is required.");
    }

    if (session?.mode !== "live") {
        const customer = getDemoCustomerById(customerId);
        if (!customer) {
            throw new Error("Customer was not found.");
        }
        const invoices = getDemoInvoicesForCustomer(customerId);
        const payments = invoices
            .filter((invoice) => invoice.last_payment)
            .map((invoice) => ({
                id: `${invoice.id}-payment`,
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoice_number,
                amount: Number(invoice.last_payment.amount || 0),
                paymentMethod: invoice.last_payment.payment_method || "",
                reference: invoice.last_payment.reference || "",
                receivedAt: invoice.last_payment.received_at || ""
            }));

        return {
            customer: mapCustomer(customer),
            invoices: invoices.map((invoice) => mapInvoice(invoice)),
            payments
        };
    }

    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const [customerResult, invoicesResult, paymentsResult] = await Promise.all([
        supabase
            .from("customers")
            .select("id, name, email, phone, industry, billing_address, balance, last_payment_at")
            .eq("business_id", session.businessId)
            .eq("id", customerId)
            .single(),
        supabase
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
                invoice_items (
                    description,
                    quantity,
                    unit_price,
                    tax_amount,
                    line_total
                )
            `)
            .eq("business_id", session.businessId)
            .eq("customer_id", customerId)
            .order("created_at", { ascending: false }),
        supabase
            .from("payments")
            .select("id, invoice_id, amount, payment_method, received_at, reference")
            .eq("business_id", session.businessId)
            .eq("customer_id", customerId)
            .order("received_at", { ascending: false })
    ]);

    if (customerResult.error) throw customerResult.error;
    if (invoicesResult.error) throw invoicesResult.error;
    if (paymentsResult.error) throw paymentsResult.error;

    const payments = paymentsResult.data || [];
    return {
        customer: mapCustomer(customerResult.data),
        invoices: (invoicesResult.data || []).map((invoice) => mapInvoice(invoice, payments)),
        payments: payments.map((payment) => {
            const invoice = (invoicesResult.data || []).find((item) => String(item.id) === String(payment.invoice_id));
            return {
                id: payment.id,
                invoiceId: payment.invoice_id,
                invoiceNumber: invoice?.invoice_number || "Invoice",
                amount: Number(payment.amount || 0),
                paymentMethod: payment.payment_method || "",
                reference: payment.reference || "",
                receivedAt: payment.received_at || ""
            };
        })
    };
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
        phone: payload.phone || null,
        billing_address: payload.billingAddress || null
    });

    if (error) {
        throw error;
    }
}
