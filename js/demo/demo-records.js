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
        { id: "demo-customer-1", name: "Atlas Manufacturing", industry: "Manufacturing", balance: 240000, last_payment_at: "2026-03-18" },
        { id: "demo-customer-2", name: "Lumen Logistics", industry: "Logistics", balance: 125000, last_payment_at: "2026-03-14" }
    ];
    store.expenses = [
        { id: "demo-expense-1", title: "Office Internet", category: "Utilities", amount: 58000, status: "approved", created_at: new Date().toISOString() }
    ];
    store.invoices = [
        { id: "demo-invoice-1", invoice_number: "INV-1001", customer_name: "Atlas Manufacturing", total_amount: 320000, status: "sent", created_at: new Date().toISOString() }
    ];
    store.counters = { customer: 3, expense: 2, invoice: 1002 };
    saveStore(store);
    return store;
}

export function getDemoCustomers() {
    return ensureSeeded().customers;
}

export function addDemoCustomer(payload) {
    const store = ensureSeeded();
    const id = `demo-customer-${store.counters.customer++}`;
    store.customers.unshift({
        id,
        name: payload.name,
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
    store.counters.invoice += 1;
    store.invoices.unshift({
        id,
        invoice_number: invoiceNumber,
        customer_name: payload.customerName || "Walk-in Customer",
        total_amount: Number(payload.totalAmount || 0),
        status: "draft",
        created_at: new Date().toISOString()
    });
    saveStore(store);
}
