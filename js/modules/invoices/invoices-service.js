import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { getActiveBranchDetails } from "../../core/data-access.js";
import { getStoredBranchScope } from "../../core/branch-scope.js";
import { getBranchesForCurrentBusiness } from "../branches/branches-service.js";
import {
    addDemoInvoice,
    getDemoCustomers,
    getDemoInvoiceById,
    getDemoInvoices,
    recordDemoInvoicePayment
} from "../../demo/demo-records.js";

const DEFAULT_TERMS_DAYS = 14;

function isMissingColumnError(error, columnName) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "PGRST204" || message.includes(columnName) || details.includes(columnName);
}

function isMissingOptionalInvoiceColumnError(error) {
    return isMissingColumnError(error, "notes")
        || isMissingColumnError(error, "payment_terms")
        || isMissingColumnError(error, "accepted_payment_methods");
}

function isDuplicateInvoiceNumberError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "23505"
        || message.includes("duplicate key")
        || details.includes("invoice_number")
        || message.includes("invoices_business_id_invoice_number_key");
}

function normalizeInvoicePrefix(value) {
    const normalized = String(value || "INV")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || "INV";
}

function getInvoiceSequence(invoiceNumber, prefix) {
    const normalized = String(invoiceNumber || "").trim().toUpperCase();
    const normalizedPrefix = normalizeInvoicePrefix(prefix);
    if (!normalized.startsWith(`${normalizedPrefix}-`)) {
        return 0;
    }

    const match = normalized.match(/(\d+)$/);
    if (!match) {
        return 0;
    }
    if (match[1].length > 6) {
        return 0;
    }

    const sequence = Number(match[1]);
    return Number.isFinite(sequence) ? sequence : 0;
}

async function getInvoicePrefix(supabase, businessId) {
    const { data, error } = await supabase
        .from("business_settings")
        .select("invoice_prefix")
        .eq("business_id", businessId)
        .maybeSingle();

    if (error) {
        return "INV";
    }

    return normalizeInvoicePrefix(data?.invoice_prefix || "INV");
}

async function getNextInvoiceNumber(supabase, businessId) {
    const prefix = await getInvoicePrefix(supabase, businessId);
    const { data, error } = await supabase
        .from("invoices")
        .select("invoice_number")
        .eq("business_id", businessId);

    if (error) {
        return `${prefix}-${Date.now()}`;
    }

    const highest = (data || []).reduce((max, row) => {
        const sequence = getInvoiceSequence(row?.invoice_number, prefix);
        return sequence > max ? sequence : max;
    }, 0);

    return `${prefix}-${String(highest + 1).padStart(4, "0")}`;
}

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
        invoiceNumber: String(payload.invoiceNumber || "").trim(),
        customerId: String(payload.customerId || "").trim() || null,
        customerName: String(payload.customerName || "").trim(),
        branchId: String(payload.branchId || "").trim() || null,
        branchName: String(payload.branchName || "").trim(),
        notes: String(payload.notes || "").trim(),
        paymentTerms: String(payload.paymentTerms || "").trim(),
        acceptedPaymentMethods: String(payload.acceptedPaymentMethods || "").trim(),
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
        branchId: invoice.branch_id || null,
        branchName: invoice.branches?.name || invoice.branch_name || "Head Office",
        notes: invoice.notes || "",
        paymentTerms: invoice.payment_terms || "",
        acceptedPaymentMethods: invoice.accepted_payment_methods || "",
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

async function getSelectedScopeBranchForInvoice(session) {
    if (String(session?.role || "").toLowerCase() !== "business_admin") {
        return null;
    }

    const selectedBranchId = String(getStoredBranchScope()?.branchId || "").trim();
    if (!selectedBranchId) {
        return null;
    }

    const branches = await getBranchesForCurrentBusiness().catch(() => []);
    const selected = branches.find((branch) => String(branch.id || "") === selectedBranchId);
    if (!selected) {
        return null;
    }

    return {
        id: String(selected.id || "").trim(),
        name: String(selected.name || "").trim(),
        isHeadOffice: Boolean(selected.isHeadOffice),
        canAccessAllBranches: Boolean(selected.isHeadOffice)
    };
}

export async function resolveInvoiceBranch(session, preferredBranchId = "", preferredBranchName = "") {
    const activeBranch = await getActiveBranchDetails(session.userId, session.businessId);
    const selectedScopeBranch = activeBranch?.canAccessAllBranches
        ? await getSelectedScopeBranchForInvoice(session)
        : null;
    const branch = selectedScopeBranch || activeBranch || {};

    return {
        id: String(preferredBranchId || branch.id || "").trim() || null,
        name: String(preferredBranchName || branch.name || "Head Office").trim()
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
            branchId: invoice.branch_id || null,
            branchName: invoice.branches?.name || invoice.branch_name || "Head Office",
            issuedAt: invoice.issued_at || "",
            dueDate: invoice.due_date || "",
            subtotal: Number(invoice.subtotal_amount || invoice.total_amount || 0),
            tax: Number(invoice.tax_amount || 0),
            amount: Number(invoice.total_amount || 0),
            status: invoice.status,
            notes: invoice.notes || "",
            paymentTerms: invoice.payment_terms || invoice.paymentTerms || "",
            acceptedPaymentMethods: invoice.accepted_payment_methods || invoice.acceptedPaymentMethods || "",
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
            branch_id,
            issued_at,
            due_date,
            subtotal_amount,
            tax_amount,
            total_amount,
            notes,
            payment_terms,
            accepted_payment_methods,
            status,
            customers (
                name
            ),
            branches (
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

    if (error && isMissingOptionalInvoiceColumnError(error)) {
        return getInvoicesWithoutNotes(supabase, session);
    }

    if (error) {
        throw error;
    }

    return (data || []).map((invoice) => ({
        id: invoice.id || invoice.invoice_number,
        number: invoice.invoice_number,
        customer: invoice.customers?.name || "Walk-in Customer",
        branchId: invoice.branch_id || null,
        branchName: invoice.branches?.name || "Head Office",
        issuedAt: invoice.issued_at || "",
        dueDate: invoice.due_date || "",
        subtotal: Number(invoice.subtotal_amount || 0),
        tax: Number(invoice.tax_amount || 0),
        amount: Number(invoice.total_amount || 0),
        status: invoice.status,
        notes: invoice.notes || "",
        paymentTerms: invoice.payment_terms || "",
        acceptedPaymentMethods: invoice.accepted_payment_methods || "",
        items: Array.isArray(invoice.invoice_items) ? invoice.invoice_items : []
    }));
}

async function getInvoicesWithoutNotes(supabase, session) {
    const { data, error } = await supabase
        .from("invoices")
        .select(`
            id,
            invoice_number,
            branch_id,
            issued_at,
            due_date,
            subtotal_amount,
            tax_amount,
            total_amount,
            status,
            customers (
                name
            ),
            branches (
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
        branchId: invoice.branch_id || null,
        branchName: invoice.branches?.name || "Head Office",
        issuedAt: invoice.issued_at || "",
        dueDate: invoice.due_date || "",
        subtotal: Number(invoice.subtotal_amount || 0),
        tax: Number(invoice.tax_amount || 0),
        amount: Number(invoice.total_amount || 0),
        status: invoice.status,
        notes: "",
        paymentTerms: "",
        acceptedPaymentMethods: "",
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
            branch_id,
            issued_at,
            due_date,
            subtotal_amount,
            tax_amount,
            total_amount,
            notes,
            payment_terms,
            accepted_payment_methods,
            status,
            customers (
                name,
                email,
                phone,
                billing_address
            ),
            branches (
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
        .eq("id", invoiceId)
        .single();

    if (error && isMissingOptionalInvoiceColumnError(error)) {
        return getInvoiceDetailsWithoutNotes(supabase, session, invoiceId);
    }

    if (error) {
        throw error;
    }

    const invoice = mapInvoiceDetail(data);
    if (invoice.branchId) {
        return invoice;
    }

    const branch = await resolveInvoiceBranch(session);
    return {
        ...invoice,
        branchId: branch.id,
        branchName: branch.name
    };
}

async function getInvoiceDetailsWithoutNotes(supabase, session, invoiceId) {
    const { data, error } = await supabase
        .from("invoices")
        .select(`
            id,
            customer_id,
            invoice_number,
            branch_id,
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
            branches (
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
        .eq("id", invoiceId)
        .single();

    if (error) {
        throw error;
    }

    const invoice = mapInvoiceDetail(data);
    if (invoice.branchId) {
        return invoice;
    }

    const branch = await resolveInvoiceBranch(session);
    return {
        ...invoice,
        branchId: branch.id,
        branchName: branch.name
    };
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
    let branchId = invoice.branchId;
    let branchName = invoice.branchName;

    if (session.mode !== "live") {
        addDemoInvoice({
            ...invoice,
            branchId: branchId || "demo-branch-head-office",
            branchName: branchName || "Head Office"
        });
        return;
    }

    if (!supabase || !session.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const resolvedBranch = await resolveInvoiceBranch(session, branchId, branchName);
    branchId = resolvedBranch.id;
    branchName = resolvedBranch.name;

    const invoiceRow = {
        business_id: session.businessId,
        branch_id: branchId || null,
        customer_id: invoice.customerId,
        invoice_number: invoice.invoiceNumber || await getNextInvoiceNumber(supabase, session.businessId),
        subtotal_amount: invoice.subtotalAmount,
        tax_amount: invoice.taxAmount,
        total_amount: invoice.totalAmount,
        issued_at: invoice.issuedAt,
        due_date: invoice.dueDate,
        status: invoice.status,
        created_by: session.userId || null
    };
    if (invoice.notes) {
        invoiceRow.notes = invoice.notes;
    }
    if (invoice.paymentTerms) {
        invoiceRow.payment_terms = invoice.paymentTerms;
    }
    if (invoice.acceptedPaymentMethods) {
        invoiceRow.accepted_payment_methods = invoice.acceptedPaymentMethods;
    }

    let { data: createdInvoice, error } = await supabase.from("invoices").insert(invoiceRow).select("id").single();

    if (error && isMissingOptionalInvoiceColumnError(error)) {
        delete invoiceRow.notes;
        delete invoiceRow.payment_terms;
        delete invoiceRow.accepted_payment_methods;
        const fallback = await supabase.from("invoices").insert(invoiceRow).select("id").single();
        createdInvoice = fallback.data;
        error = fallback.error;
    }

    if (error && isDuplicateInvoiceNumberError(error) && !invoice.invoiceNumber) {
        invoiceRow.invoice_number = await getNextInvoiceNumber(supabase, session.businessId);
        const retry = await supabase.from("invoices").insert(invoiceRow).select("id").single();
        createdInvoice = retry.data;
        error = retry.error;
    }

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
    const paymentBranch = await resolveInvoiceBranch(session, invoice.branchId, invoice.branchName);

    const { error: paymentError } = await supabase.from("payments").insert({
        business_id: session.businessId,
        branch_id: paymentBranch.id || null,
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
