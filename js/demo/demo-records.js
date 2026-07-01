const STORAGE_KEY = "tia_demo_records_v1";
let demoRecordsMemory = null;

function getDefaultStore() {
    return {
        counters: {
            customer: 1,
            expense: 1,
            invoice: 1
        },
        customers: [],
        expenses: [],
        invoices: []
    };
}

function readStore() {
    const parsed = demoRecordsMemory;
    if (!parsed || typeof parsed !== "object") {
        return getDefaultStore();
    }
    return {
        ...getDefaultStore(),
        ...parsed,
        counters: {
            ...getDefaultStore().counters,
            ...(parsed.counters || {})
        },
        customers: Array.isArray(parsed.customers) ? parsed.customers : [],
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
        invoices: Array.isArray(parsed.invoices) ? parsed.invoices : []
    };
}

function saveStore(store) {
    demoRecordsMemory = store;
}

function ensureSeeded() {
    const store = readStore();
    if (store.customers.length || store.expenses.length || store.invoices.length) {
        return store;
    }

    store.customers = [
        { id: "demo-customer-1", name: "Atlas Manufacturing", email: "accounts@atlas.example", industry: "Manufacturing", balance: 240000, last_payment_at: "2026-03-18" },
        { id: "demo-customer-2", name: "Lumen Logistics", email: "finance@lumen.example", industry: "Logistics", balance: 125000, last_payment_at: "2026-03-14" }
    ];
    store.expenses = [
        { id: "demo-expense-1", title: "Office Internet", category: "Utilities", amount: 58000, status: "approved", created_at: new Date().toISOString() }
    ];
    store.invoices = [
        {
            id: "demo-invoice-1",
            invoice_number: "INV-1001",
            branch_id: "demo-branch-head-office",
            branch_name: "Head Office",
            customer_id: "demo-customer-1",
            customer_name: "Atlas Manufacturing",
            subtotal_amount: 300000,
            tax_amount: 20000,
            total_amount: 320000,
            notes: "Payment due within 14 days.",
            payment_terms: "Net 14",
            accepted_payment_methods: "Cash, Bank Transfer, POS",
            status: "sent",
            issued_at: new Date().toISOString().slice(0, 10),
            due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
            items: [
                {
                    description: "Monthly advisory service",
                    quantity: 1,
                    unit_price: 300000,
                    tax_amount: 20000,
                    line_total: 320000
                }
            ],
            created_at: new Date().toISOString()
        }
    ];
    store.counters = { customer: 3, expense: 2, invoice: 1002 };
    saveStore(store);
    return store;
}

export function getDemoCustomers() {
    return ensureSeeded().customers;
}

export function getDemoCustomerById(customerId) {
    return ensureSeeded().customers.find((customer) => String(customer.id || "") === String(customerId || "")) || null;
}

export function getDemoInvoicesForCustomer(customerId) {
    return ensureSeeded().invoices.filter((invoice) => String(invoice.customer_id || "") === String(customerId || ""));
}

export function addDemoCustomer(payload) {
    const store = ensureSeeded();
    const id = `demo-customer-${store.counters.customer++}`;
    store.customers.unshift({
        id,
        name: payload.name,
        email: payload.email || null,
        phone: payload.phone || null,
        billing_address: payload.billingAddress || payload.billing_address || null,
        industry: payload.industry || "General",
        balance: 0,
        last_payment_at: null
    });
    saveStore(store);
}

export function updateDemoCustomer(customerId, updater) {
    const store = ensureSeeded();
    const index = store.customers.findIndex((customer) => String(customer?.id || "") === String(customerId || ""));
    if (index < 0) {
        return null;
    }

    const current = store.customers[index];
    const next = typeof updater === "function"
        ? updater({ ...current })
        : { ...current, ...(updater || {}) };

    if (!next || typeof next !== "object") {
        return null;
    }

    store.customers[index] = {
        ...current,
        ...next
    };
    saveStore(store);
    return store.customers[index];
}

export function getDemoExpenses() {
    return ensureSeeded().expenses;
}

export function addDemoExpense(payload) {
    const store = ensureSeeded();
    const id = `demo-expense-${store.counters.expense++}`;
    store.expenses.unshift({
        id,
        title: payload.title,
        category: payload.category || "General",
        amount: Number(payload.amount || 0),
        status: "pending",
        created_at: new Date().toISOString()
    });
    saveStore(store);
}

export function getDemoInvoices() {
    return ensureSeeded().invoices;
}

export function addDemoInvoice(payload) {
    const store = ensureSeeded();
    const id = `demo-invoice-${store.counters.invoice}`;
    const invoiceNumber = payload.invoiceNumber || `INV-${String(store.counters.invoice).padStart(4, "0")}`;
    const customer = store.customers.find((item) => String(item.id) === String(payload.customerId));
    store.counters.invoice += 1;
    store.invoices.unshift({
        id,
        invoice_number: invoiceNumber,
        branch_id: payload.branchId || payload.branch_id || "demo-branch-head-office",
        branch_name: payload.branchName || payload.branch_name || "Head Office",
        customer_id: payload.customerId || null,
        customer_name: customer?.name || payload.customerName || "Walk-in Customer",
        subtotal_amount: Number(payload.subtotalAmount || 0),
        tax_amount: Number(payload.taxAmount || 0),
        total_amount: Number(payload.totalAmount || 0),
        notes: payload.notes || "",
        payment_terms: payload.paymentTerms || payload.payment_terms || "",
        accepted_payment_methods: payload.acceptedPaymentMethods || payload.accepted_payment_methods || "",
        status: payload.status || "draft",
        issued_at: payload.issuedAt || new Date().toISOString().slice(0, 10),
        due_date: payload.dueDate || null,
        items: Array.isArray(payload.items) ? payload.items : [],
        created_at: new Date().toISOString()
    });
    saveStore(store);
}

export function getDemoInvoiceById(invoiceId) {
    const store = ensureSeeded();
    const invoice = store.invoices.find((item) => String(item.id || "") === String(invoiceId || ""));
    if (!invoice) {
        return null;
    }

    const customer = store.customers.find((item) => String(item.id || "") === String(invoice.customer_id || ""));
    return {
        ...invoice,
        customer_name: customer?.name || invoice.customer_name || "Walk-in Customer",
        customer_email: customer?.email || "",
        customer_phone: customer?.phone || "",
        customer_billing_address: customer?.billing_address || "",
        items: Array.isArray(invoice.items) ? invoice.items : []
    };
}

export function recordDemoInvoicePayment(invoiceId, payment) {
    const store = ensureSeeded();
    const invoice = store.invoices.find((item) => String(item.id || "") === String(invoiceId || ""));
    if (!invoice) {
        throw new Error("Invoice was not found.");
    }

    invoice.status = "paid";
    invoice.last_payment = {
        amount: Number(payment.amount || invoice.total_amount || 0),
        payment_method: payment.paymentMethod || "Cash",
        reference: payment.reference || "",
        received_at: payment.receivedAt || new Date().toISOString().slice(0, 10)
    };

    const customer = store.customers.find((item) => String(item.id || "") === String(invoice.customer_id || ""));
    if (customer) {
        customer.last_payment_at = invoice.last_payment.received_at;
    }

    saveStore(store);
    return invoice;
}
