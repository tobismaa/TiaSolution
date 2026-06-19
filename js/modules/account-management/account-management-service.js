import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { getDemoCustomers, updateDemoCustomer } from "../../demo/demo-records.js";

const ACCOUNT_RECORDS_KEY = "tia_opened_accounts_v1";
let accountRecordsMemory = [];
const ACCOUNT_PRODUCT_SERIES_START = 2011200000;
const ACCOUNT_PRODUCT_SERIES_STEP = 1000000;
const ACCOUNT_SETUP_SQL = "sql/add-account-opening-fields.sql";

function readRecords() {
    return Array.isArray(accountRecordsMemory) ? accountRecordsMemory.slice() : [];
}

function writeRecords(records) {
    accountRecordsMemory = Array.isArray(records) ? records.map((item) => ({ ...item })) : [];
}

function normalizeAccountType(accountType) {
    return String(accountType || "").trim().toLowerCase();
}

function sanitizeAccountCodeDigits(value) {
    return String(value || "").replace(/\D/g, "");
}

async function getLiveAccountProduct(productName) {
    const session = await getCurrentSessionContext();
    const supabase = getSupabaseClient();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable for account opening.");
    }

    const normalizedName = String(productName || "").trim();
    if (!normalizedName) {
        return null;
    }

    const { data, error } = await supabase
        .from("account_products")
        .select("id, product_name, product_gl_code")
        .eq("business_id", session.businessId)
        .ilike("product_name", normalizedName)
        .eq("is_active", true)
        .maybeSingle();

    if (error) {
        if (isMissingTableError(error)) {
            throw new Error("Account product table is not set up yet. Run sql/add-account-products.sql first.");
        }
        throw error;
    }

    return data || null;
}

async function getLiveAccountProductsInSequence() {
    const session = await getCurrentSessionContext();
    const supabase = getSupabaseClient();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable for account opening.");
    }

    const { data, error } = await supabase
        .from("account_products")
        .select("id, product_name, is_active, created_at")
        .eq("business_id", session.businessId)
        .eq("is_active", true)
        .order("created_at", { ascending: true });

    if (error) {
        if (isMissingTableError(error)) {
            throw new Error("Account product table is not set up yet. Run sql/add-account-products.sql first.");
        }
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function resolveLiveAccountBase(accountType) {
    const normalizedType = String(accountType || "").trim().toLowerCase();
    const products = await getLiveAccountProductsInSequence();
    const productIndex = products.findIndex((item) => String(item?.product_name || "").trim().toLowerCase() === normalizedType);
    if (productIndex >= 0) {
        return ACCOUNT_PRODUCT_SERIES_START + (productIndex * ACCOUNT_PRODUCT_SERIES_STEP);
    }

    const product = await getLiveAccountProduct(accountType);
    if (product?.id) {
        const fallbackIndex = Math.max(products.length - 1, 0);
        return ACCOUNT_PRODUCT_SERIES_START + (fallbackIndex * ACCOUNT_PRODUCT_SERIES_STEP);
    }

    throw new Error("Select a valid account product before generating account number.");
}

function resolveLocalAccountBase(accountType) {
    const normalizedType = normalizeAccountType(accountType);
    if (!normalizedType) {
        return 0;
    }

    const orderedTypes = [];
    readRecords()
        .slice()
        .sort((left, right) => String(left?.createdAt || "").localeCompare(String(right?.createdAt || "")))
        .forEach((item) => {
            const type = normalizeAccountType(item?.accountType);
            if (type && !orderedTypes.includes(type)) {
                orderedTypes.push(type);
            }
        });

    if (!orderedTypes.includes(normalizedType)) {
        orderedTypes.push(normalizedType);
    }

    const productIndex = orderedTypes.indexOf(normalizedType);
    return productIndex >= 0
        ? ACCOUNT_PRODUCT_SERIES_START + (productIndex * ACCOUNT_PRODUCT_SERIES_STEP)
        : 0;
}

function isMissingTableError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    return code === "42P01"
        || code === "PGRST205"
        || message.includes("does not exist")
        || message.includes("could not find the table")
        || message.includes("schema cache");
}

function isMissingColumnError(error, columnName = "") {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    const normalizedColumn = String(columnName || "").toLowerCase();
    return code === "PGRST204"
        || (normalizedColumn && (message.includes(normalizedColumn) || details.includes(normalizedColumn)));
}

function buildAccountSchemaError(error) {
    const message = String(error?.message || "").trim();
    return new Error(message || `Account opening database fields are not set up. Run ${ACCOUNT_SETUP_SQL} first.`);
}

function getBranchName(branchesValue) {
    if (Array.isArray(branchesValue)) {
        return String(branchesValue[0]?.name || "").trim();
    }
    return String(branchesValue?.name || "").trim();
}

function normalizeStatementEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries.map((entry) => ({
        date: String(entry?.date || "").trim(),
        reference: String(entry?.reference || "").trim(),
        postedBy: String(entry?.postedBy || entry?.posted_by || "").trim(),
        narration: String(entry?.narration || "").trim(),
        debit: Number(entry?.debit || 0),
        credit: Number(entry?.credit || 0),
        balance: Number(entry?.balance || 0)
    }));
}

function buildStatementEntry({ date, reference = "", postedBy = "", narration, debit = 0, credit = 0, balance = 0 }) {
    return {
        date: String(date || "").trim(),
        reference: String(reference || "").trim(),
        postedBy: String(postedBy || "").trim(),
        narration: String(narration || "").trim(),
        debit: Number(debit || 0),
        credit: Number(credit || 0),
        balance: Number(balance || 0)
    };
}

async function generateTransactionReference(prefix, postingDate = "") {
    const normalizedPrefix = String(prefix || "").trim().toUpperCase();
    const parsedPostingDate = new Date(String(postingDate || new Date().toISOString().slice(0, 10)));
    const year = Number.isNaN(parsedPostingDate.getTime())
        ? new Date().getFullYear()
        : parsedPostingDate.getFullYear();
    const referenceStem = `${normalizedPrefix}-${year}`;

    const session = await getCurrentSessionContext();
    const rows = session?.mode === "live"
        ? await getLiveAccountRows(session, { orderDescending: true })
        : readRecords();

    let highestSequence = 0;
    rows.forEach((record) => {
        normalizeStatementEntries(record?.statementEntries).forEach((entry) => {
            const reference = String(entry?.reference || "").trim().toUpperCase();
            if (!reference.startsWith(`${referenceStem}-`)) {
                return;
            }
            const sequence = Number(reference.split("-").pop() || 0);
            if (Number.isFinite(sequence) && sequence > highestSequence) {
                highestSequence = sequence;
            }
        });
    });

    return `${referenceStem}-${String(highestSequence + 1).padStart(6, "0")}`;
}

function mapCustomerRow(row) {
    return {
        id: String(row?.id || "").trim(),
        businessId: String(row?.business_id || "").trim(),
        name: String(row?.name || "").trim(),
        accountNumber: String(row?.account_number || "").trim(),
        firstName: String(row?.first_name || "").trim(),
        lastName: String(row?.last_name || "").trim(),
        otherName: String(row?.other_name || "").trim(),
        phone: String(row?.phone || "").trim(),
        dob: String(row?.date_of_birth || "").trim(),
        email: String(row?.email || "").trim(),
        accountType: String(row?.account_type || row?.industry || "").trim(),
        branchId: String(row?.branch_id || "").trim(),
        branchName: getBranchName(row?.branches),
        residentialAddress: String(row?.residential_address || row?.billing_address || "").trim(),
        currentBalance: Number(row?.current_balance || row?.balance || 0),
        ledgerBalance: Number(row?.ledger_balance || 0),
        availableBalance: Number(row?.available_balance || 0),
        overdraft: Number(row?.overdraft || 0),
        statementEntries: normalizeStatementEntries(row?.statement_entries),
        passportFileName: String(row?.passport_file_name || "").trim(),
        passportFileUrl: String(row?.passport_file_url || "").trim(),
        signatureFileName: String(row?.signature_file_name || "").trim(),
        signatureFileUrl: String(row?.signature_file_url || "").trim(),
        status: String(row?.status || "Active").trim(),
        operationsNote: String(row?.operations_note || "").trim(),
        createdAt: String(row?.created_at || "").trim(),
        updatedAt: String(row?.updated_at || "").trim()
    };
}

function splitCustomerName(fullName = "") {
    const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] || "",
        lastName: parts.length > 1 ? parts[parts.length - 1] : "",
        otherName: parts.length > 2 ? parts.slice(1, -1).join(" ") : (parts.length === 2 ? "" : (parts[1] || ""))
    };
}

function mapExistingRecord(item) {
    return {
        id: String(item?.id || "").trim(),
        reference: buildExistingRecordReference(item),
        name: String(item?.name || "").trim(),
        email: String(item?.email || "").trim(),
        phone: String(item?.phone || "").trim(),
        industry: String(item?.industry || "").trim(),
        branchId: String(item?.branchId || item?.branch_id || "").trim(),
        branchName: String(item?.branchName || "").trim(),
        residentialAddress: String(item?.residentialAddress || item?.billing_address || item?.billingAddress || "").trim(),
        passportFileName: String(item?.passportFileName || item?.passport_file_name || "").trim(),
        passportFileUrl: String(item?.passportFileUrl || item?.passport_file_url || "").trim(),
        signatureFileName: String(item?.signatureFileName || item?.signature_file_name || "").trim(),
        signatureFileUrl: String(item?.signatureFileUrl || item?.signature_file_url || "").trim(),
        createdAt: String(item?.createdAt || item?.created_at || "").trim()
    };
}

function buildExistingRecordReference(item) {
    const explicitReference = String(item?.customerReference || item?.customer_reference || "").trim();
    if (explicitReference) {
        return explicitReference.replace(/\D/g, "").slice(0, 10);
    }

    const seed = String(item?.id || item?.email || item?.phone || item?.name || "").trim().toUpperCase();
    let hash = 7;
    for (const character of seed) {
        hash = ((hash * 131) + character.charCodeAt(0)) % 10000000000;
    }
    return String(Math.trunc(hash)).padStart(10, "0").slice(-10);
}

function getAccountSelectFields(includeBranch = true) {
    const baseFields = [
        "id",
        "business_id",
        "branch_id",
        "name",
        "email",
        "phone",
        "industry",
        "billing_address",
        "balance",
        "created_at",
        "updated_at",
        "account_number",
        "first_name",
        "last_name",
        "other_name",
        "date_of_birth",
        "account_type",
        "residential_address",
        "current_balance",
        "ledger_balance",
        "available_balance",
        "overdraft",
        "statement_entries",
        "passport_file_name",
        "passport_file_url",
        "signature_file_name",
        "signature_file_url",
        "status",
        "operations_note"
    ];
    return includeBranch
        ? `${baseFields.join(", ")}, branches(name)`
        : baseFields.join(", ");
}

async function getLiveAccountRows(session, options = {}) {
    const supabase = getSupabaseClient();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable for account opening.");
    }

    const includeBranch = options.includeBranch !== false;
    let query = supabase
        .from("customers")
        .select(getAccountSelectFields(includeBranch))
        .eq("business_id", session.businessId);

    if (options.accountNumber) {
        query = query.eq("account_number", String(options.accountNumber || "").trim());
    }

    if (options.accountType) {
        query = query.ilike("account_type", String(options.accountType || "").trim());
    }

    if (options.orderDescending) {
        query = query.order("created_at", { ascending: false });
    }

    const { data, error } = await query;
    if (error) {
        if (isMissingTableError(error)
            || isMissingColumnError(error, "account_number")
            || isMissingColumnError(error, "first_name")
            || isMissingColumnError(error, "statement_entries")
            || isMissingColumnError(error, "current_balance")) {
            throw buildAccountSchemaError(error);
        }
        throw error;
    }
    return (data || []).map(mapCustomerRow);
}

async function getNextLiveAccountNumber(accountType) {
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable for account opening.");
    }
    const normalizedType = String(accountType || "").trim();
    const base = await resolveLiveAccountBase(normalizedType);
    if (!base) {
        throw new Error("Select a valid account product before generating account number.");
    }

    const rows = await getLiveAccountRows(session, {
        accountType: normalizedType,
        includeBranch: false
    });
    const highestNumber = rows.reduce((max, row) => {
        const value = Number(row.accountNumber || 0);
        return Number.isFinite(value) && value > max ? value : max;
    }, 0);
    return String(Math.max(base, highestNumber + 1));
}

export async function generateAccountNumberForType(accountType) {
    const session = await getCurrentSessionContext();
    if (session?.mode === "live") {
        return getNextLiveAccountNumber(accountType);
    }

    const normalizedType = normalizeAccountType(accountType);
    const base = resolveLocalAccountBase(normalizedType);
    if (!base) {
        throw new Error("Select a valid account type before generating account number.");
    }

    const sameTypeCount = readRecords().filter((item) => normalizeAccountType(item.accountType) === normalizedType).length;
    return String(base + sameTypeCount);
}

export async function getOpenedAccounts() {
    const session = await getCurrentSessionContext();
    if (session?.mode === "live") {
        const rows = await getLiveAccountRows(session, { orderDescending: true });
        return rows.map((item) => ({
            id: item.id,
            name: item.name,
            accountNumber: item.accountNumber,
            accountType: item.accountType,
            branchName: item.branchName,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt
        }));
    }

    return readRecords()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .map((item) => ({
            id: String(item.id || ""),
            name: String(item.name || "").trim(),
            accountNumber: String(item.accountNumber || "").trim(),
            accountType: String(item.accountType || "").trim(),
            branchName: String(item.branchName || "").trim(),
            createdAt: String(item.createdAt || ""),
            updatedAt: String(item.updatedAt || "")
        }));
}

export async function getExistingAccountOpeningRecords() {
    const session = await getCurrentSessionContext();
    if (session?.mode === "live") {
        const rows = await getLiveAccountRows(session, { orderDescending: true });
        return rows
            .filter((item) => !String(item?.accountNumber || "").trim())
            .map((item) => mapExistingRecord(item));
    }

    return getDemoCustomers()
        .filter((item) => !String(item?.account_number || item?.accountNumber || "").trim())
        .map((item) => mapExistingRecord(item));
}

export async function openAccountFromExistingRecord(recordId, payload = {}) {
    const normalizedRecordId = String(recordId || "").trim();
    if (!normalizedRecordId) {
        throw new Error("Select an existing record before opening the account.");
    }

    const accountType = String(payload?.accountType || "").trim();
    if (!accountType) {
        throw new Error("Select an account product before continuing.");
    }

    const branchId = String(payload?.branchId || "").trim();
    const branchName = String(payload?.branchName || "").trim();
    if (!branchId && !branchName) {
        throw new Error("No domiciled branch is available for this user.");
    }

    const session = await getCurrentSessionContext();
    const accountNumber = await generateAccountNumberForType(accountType);

    if (session?.mode === "live") {
        const supabase = getSupabaseClient();
        if (!supabase || !session.businessId) {
            throw new Error("Business context is unavailable for account opening.");
        }

        const rows = await getLiveAccountRows(session, { orderDescending: true });
        const current = rows.find((item) => item.id === normalizedRecordId);
        if (!current) {
            throw new Error("The selected existing record could not be found.");
        }
        if (String(current.accountNumber || "").trim()) {
            throw new Error("This record has already been converted into an account.");
        }

        const nameParts = splitCustomerName(current.name);
        const openingBalance = Number(current.currentBalance || current.availableBalance || current.ledgerBalance || 0);
        const updatePayload = {
            branch_id: branchId || current.branchId || null,
            account_number: accountNumber,
            first_name: current.firstName || nameParts.firstName || current.name || null,
            last_name: current.lastName || nameParts.lastName || null,
            other_name: current.otherName || nameParts.otherName || null,
            account_type: accountType,
            industry: accountType,
            residential_address: current.residentialAddress || null,
            billing_address: current.residentialAddress || null,
            current_balance: openingBalance,
            ledger_balance: Number(current.ledgerBalance || openingBalance || 0),
            available_balance: Number(current.availableBalance || openingBalance || 0),
            overdraft: Number(current.overdraft || 0),
            statement_entries: Array.isArray(current.statementEntries) ? current.statementEntries : [],
            passport_file_name: current.passportFileName || null,
            passport_file_url: current.passportFileUrl || null,
            signature_file_name: current.signatureFileName || null,
            signature_file_url: current.signatureFileUrl || null,
            status: current.status || "Active",
            operations_note: current.operationsNote || null
        };

        const { error } = await supabase
            .from("customers")
            .update(updatePayload)
            .eq("business_id", session.businessId)
            .eq("id", normalizedRecordId);

        if (error) {
            if (isMissingTableError(error)
                || isMissingColumnError(error, "account_number")
                || isMissingColumnError(error, "first_name")
                || isMissingColumnError(error, "current_balance")) {
                throw buildAccountSchemaError(error);
            }
            throw error;
        }

        const opened = await getOpenedAccountByNumber(accountNumber);
        if (!opened) {
            throw new Error("Account was created but could not be reloaded.");
        }
        return opened;
    }

    const existing = getDemoCustomers().find((item) => String(item?.id || "") === normalizedRecordId);
    if (!existing) {
        throw new Error("The selected existing record could not be found.");
    }
    if (String(existing?.account_number || existing?.accountNumber || "").trim()) {
        throw new Error("This record has already been converted into an account.");
    }

    const nameParts = splitCustomerName(existing.name);
    const nowIso = new Date().toISOString();
    updateDemoCustomer(normalizedRecordId, {
        account_number: accountNumber,
        account_type: accountType,
        branch_id: branchId || null,
        branch_name: branchName || "",
        first_name: nameParts.firstName || existing.name,
        last_name: nameParts.lastName || "",
        other_name: nameParts.otherName || "",
        residential_address: existing.billing_address || "",
        updated_at: nowIso
    });

    const localRecord = {
        id: normalizedRecordId,
        name: String(existing.name || "").trim(),
        accountNumber,
        firstName: nameParts.firstName || String(existing.name || "").trim(),
        lastName: nameParts.lastName || "",
        otherName: nameParts.otherName || "",
        phone: String(existing.phone || "").trim(),
        dob: "",
        email: String(existing.email || "").trim(),
        accountType,
        branchId,
        branchName,
        residentialAddress: String(existing.billing_address || "").trim(),
        currentBalance: Number(existing.balance || 0),
        ledgerBalance: Number(existing.balance || 0),
        availableBalance: Number(existing.balance || 0),
        overdraft: 0,
        statementEntries: [],
        passportFileName: String(existing.passport_file_name || existing.passportFileName || "").trim(),
        passportFileUrl: String(existing.passport_file_url || existing.passportFileUrl || "").trim(),
        signatureFileName: String(existing.signature_file_name || existing.signatureFileName || "").trim(),
        signatureFileUrl: String(existing.signature_file_url || existing.signatureFileUrl || "").trim(),
        status: "Active",
        operationsNote: "",
        createdAt: String(existing.created_at || nowIso),
        updatedAt: nowIso
    };

    const currentRecords = readRecords();
    currentRecords.unshift(localRecord);
    writeRecords(currentRecords);
    return localRecord;
}

export async function openAccountFromExistingAccount(accountNumber, payload = {}) {
    const normalizedAccountNumber = String(accountNumber || "").trim();
    if (!normalizedAccountNumber) {
        throw new Error("Enter an existing account number before opening a new account.");
    }

    const accountType = String(payload?.accountType || "").trim();
    if (!accountType) {
        throw new Error("Select an account product before continuing.");
    }

    const branchId = String(payload?.branchId || "").trim();
    const branchName = String(payload?.branchName || "").trim();
    if (!branchId && !branchName) {
        throw new Error("No domiciled branch is available for this user.");
    }

    const current = await getOpenedAccountByNumber(normalizedAccountNumber);
    if (!current) {
        throw new Error("Account number not found.");
    }

    const session = await getCurrentSessionContext();
    const newAccountNumber = await generateAccountNumberForType(accountType);
    const nameParts = splitCustomerName(current.name);

    if (session?.mode === "live") {
        const supabase = getSupabaseClient();
        if (!supabase || !session.businessId) {
            throw new Error("Business context is unavailable for account opening.");
        }

        const rowPayload = {
            business_id: session.businessId,
            branch_id: branchId || current.branchId || null,
            name: current.name || [current.firstName, current.otherName, current.lastName].filter(Boolean).join(" "),
            email: current.email || null,
            phone: current.phone || null,
            industry: accountType || null,
            billing_address: current.residentialAddress || null,
            account_number: newAccountNumber,
            first_name: current.firstName || nameParts.firstName || current.name || null,
            last_name: current.lastName || nameParts.lastName || null,
            other_name: current.otherName || nameParts.otherName || null,
            date_of_birth: current.dob || null,
            account_type: accountType,
            residential_address: current.residentialAddress || null,
            current_balance: 0,
            ledger_balance: 0,
            available_balance: 0,
            overdraft: 0,
            statement_entries: [],
            passport_file_name: current.passportFileName || null,
            passport_file_url: current.passportFileUrl || null,
            signature_file_name: current.signatureFileName || null,
            signature_file_url: current.signatureFileUrl || null,
            status: current.status || "Active",
            operations_note: current.operationsNote || null,
            balance: 0
        };

        const { error } = await supabase
            .from("customers")
            .insert(rowPayload);

        if (error) {
            if (isMissingTableError(error)
                || isMissingColumnError(error, "account_number")
                || isMissingColumnError(error, "first_name")
                || isMissingColumnError(error, "statement_entries")
                || isMissingColumnError(error, "current_balance")) {
                throw buildAccountSchemaError(error);
            }
            throw error;
        }

        const opened = await getOpenedAccountByNumber(newAccountNumber);
        if (!opened) {
            throw new Error("New account was created but could not be reloaded.");
        }
        return opened;
    }

    const localRecord = {
        id: crypto.randomUUID(),
        name: current.name || [current.firstName, current.otherName, current.lastName].filter(Boolean).join(" "),
        accountNumber: newAccountNumber,
        firstName: current.firstName || nameParts.firstName || current.name || "",
        lastName: current.lastName || nameParts.lastName || "",
        otherName: current.otherName || nameParts.otherName || "",
        phone: current.phone || "",
        dob: current.dob || "",
        email: current.email || "",
        accountType,
        branchId,
        branchName,
        residentialAddress: current.residentialAddress || "",
        currentBalance: 0,
        ledgerBalance: 0,
        availableBalance: 0,
        overdraft: 0,
        statementEntries: [],
        passportFileName: current.passportFileName || "",
        passportFileUrl: current.passportFileUrl || "",
        signatureFileName: current.signatureFileName || "",
        signatureFileUrl: current.signatureFileUrl || "",
        status: current.status || "Active",
        operationsNote: current.operationsNote || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    const currentRecords = readRecords();
    currentRecords.unshift(localRecord);
    writeRecords(currentRecords);
    return localRecord;
}

export async function getOpenedAccountsDirectory() {
    const session = await getCurrentSessionContext();
    if (session?.mode === "live") {
        const rows = await getLiveAccountRows(session, { orderDescending: true });
        return rows
            .map((item) => ({
                id: item.id,
                accountNumber: item.accountNumber,
                fullName: item.name,
                branchId: item.branchId,
                branchName: item.branchName,
                status: item.status
            }))
            .filter((item) => item.accountNumber && item.fullName);
    }

    return readRecords()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .map((item) => ({
            id: String(item.id || "").trim(),
            accountNumber: String(item.accountNumber || "").trim(),
            fullName: String(item.name || "").trim(),
            branchId: String(item.branchId || "").trim(),
            branchName: String(item.branchName || "").trim(),
            status: String(item.status || "").trim()
        }))
        .filter((item) => item.accountNumber && item.fullName);
}

export async function getOpenedAccountByNumber(accountNumber) {
    const normalized = String(accountNumber || "").trim();
    if (!normalized) {
        return null;
    }

    const session = await getCurrentSessionContext();
    if (session?.mode === "live") {
        const rows = await getLiveAccountRows(session, {
            accountNumber: normalized
        });
        return rows[0] || null;
    }

    const match = readRecords().find((item) => String(item.accountNumber || "").trim() === normalized);
    return match ? { ...match } : null;
}

export async function getOpenedAccountTransactionRows(options = {}) {
    const dateFrom = String(options?.dateFrom || "").trim();
    const dateTo = String(options?.dateTo || "").trim();
    const branchId = String(options?.branchId || "").trim();

    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00Z`).getTime() : Number.NEGATIVE_INFINITY;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59Z`).getTime() : Number.POSITIVE_INFINITY;

    const session = await getCurrentSessionContext();
    const rows = session?.mode === "live"
        ? await getLiveAccountRows(session, { orderDescending: true })
        : readRecords();

    return rows
        .filter((record) => !branchId || String(record?.branchId || "").trim() === branchId)
        .flatMap((record) => {
            const accountNumber = String(record?.accountNumber || "").trim();
            const customerName = String(record?.name || "").trim();
            const branchName = String(record?.branchName || "").trim();
            const entries = normalizeStatementEntries(record?.statementEntries);

            return entries
                .map((entry, index) => {
                    const date = String(entry?.date || "").trim();
                    const time = date ? new Date(`${date}T00:00:00Z`).getTime() : Number.NaN;
                    if (Number.isNaN(time) || time < fromTime || time > toTime) {
                        return null;
                    }
                    const debit = Number(entry?.debit || 0);
                    const credit = Number(entry?.credit || 0);
                    const amount = debit > 0 ? debit : credit;
                    return {
                        id: `${accountNumber}-${date}-${index}`,
                        entryId: "",
                        date,
                        reference: accountNumber || "-",
                        sourceType: "customer_account",
                        glCode: accountNumber || "-",
                        glName: customerName || "-",
                        description: String(entry?.narration || "Customer Account Transaction").trim(),
                        amount,
                        type: debit > 0 ? "DR" : "CR",
                        branchName
                    };
                })
                .filter(Boolean);
        });
}

export async function openAccount(payload) {
    const session = await getCurrentSessionContext();
    if (!session) {
        throw new Error("No active session found. Please sign in again.");
    }

    const firstName = String(payload?.firstName || "").trim();
    const lastName = String(payload?.lastName || "").trim();
    const phone = String(payload?.phone || "").trim();
    const dob = String(payload?.dob || "").trim();
    const accountType = String(payload?.accountType || "").trim();
    const branchId = String(payload?.branchId || "").trim();
    const branchName = String(payload?.branchName || "").trim();
    const email = String(payload?.email || "").trim();
    const billingAddress = String(payload?.residentialAddress || "").trim();
    const otherName = String(payload?.otherName || "").trim();

    if (!firstName) {
        throw new Error("Enter the customer's first name.");
    }
    if (!lastName) {
        throw new Error("Enter the customer's last name.");
    }
    if (!phone) {
        throw new Error("Enter the customer's phone number.");
    }
    if (!dob) {
        throw new Error("Enter the customer's date of birth.");
    }
    if (!accountType) {
        throw new Error("Select an account type.");
    }
    if (!branchId && !branchName) {
        throw new Error("No domiciled branch is available for this user.");
    }

    const fullName = [firstName, otherName, lastName].filter(Boolean).join(" ");
    const accountNumber = await generateAccountNumberForType(accountType);

    const localRecord = {
        id: crypto.randomUUID(),
        name: fullName,
        accountNumber,
        firstName,
        lastName,
        otherName,
        phone,
        dob,
        email,
        accountType,
        branchId,
        branchName,
        residentialAddress: billingAddress,
        currentBalance: 0,
        ledgerBalance: 0,
        availableBalance: 0,
        overdraft: 0,
        statementEntries: [],
        passportFileName: "",
        passportFileUrl: "",
        signatureFileName: "",
        signatureFileUrl: "",
        status: "Active",
        createdAt: new Date().toISOString()
    };

    const supabase = getSupabaseClient();
    if (session.mode === "live") {
        if (!supabase || !session.businessId) {
            throw new Error("Business context is unavailable for account opening.");
        }

        const rowPayload = {
            business_id: session.businessId,
            branch_id: branchId || null,
            name: fullName,
            email: email || null,
            phone: phone || null,
            industry: accountType || null,
            billing_address: billingAddress || null,
            account_number: accountNumber,
            first_name: firstName,
            last_name: lastName,
            other_name: otherName || null,
            date_of_birth: dob,
            account_type: accountType,
            residential_address: billingAddress || null,
            current_balance: 0,
            ledger_balance: 0,
            available_balance: 0,
            overdraft: 0,
            statement_entries: [],
            passport_file_name: "",
            passport_file_url: "",
            signature_file_name: "",
            signature_file_url: "",
            status: "Active",
            operations_note: null,
            balance: 0
        };

        const { error } = await supabase
            .from("customers")
            .insert(rowPayload);

        if (error) {
            if (isMissingTableError(error)
                || isMissingColumnError(error, "account_number")
                || isMissingColumnError(error, "first_name")
                || isMissingColumnError(error, "statement_entries")
                || isMissingColumnError(error, "current_balance")) {
                throw buildAccountSchemaError(error);
            }
            throw new Error(error.message || "We could not save this account right now. Please check the customer table setup and try again.");
        }

        const created = await getOpenedAccountByNumber(accountNumber);
        return created || localRecord;
    }

    const currentRecords = readRecords();
    currentRecords.unshift(localRecord);
    writeRecords(currentRecords);
    return localRecord;
}

export async function updateOpenedAccount(accountNumber, payload) {
    const normalized = String(accountNumber || "").trim();
    if (!normalized) {
        throw new Error("Enter an account number before updating.");
    }

    const session = await getCurrentSessionContext();
    if (session?.mode === "live") {
        const supabase = getSupabaseClient();
        if (!supabase || !session.businessId) {
            throw new Error("Business context is unavailable for account update.");
        }

        const current = await getOpenedAccountByNumber(normalized);
        if (!current) {
            throw new Error("Account number not found.");
        }

        const updatePayload = {
            phone: String(payload?.phone ?? current.phone ?? "").trim() || null,
            email: String(payload?.email ?? current.email ?? "").trim() || null,
            residential_address: String(payload?.residentialAddress ?? current.residentialAddress ?? "").trim() || null,
            billing_address: String(payload?.residentialAddress ?? current.residentialAddress ?? "").trim() || null,
            status: String(payload?.status ?? current.status ?? "Active").trim() || "Active",
            operations_note: String(payload?.operationsNote ?? current.operationsNote ?? "").trim() || null,
            passport_file_name: String(payload?.passportFileName ?? current.passportFileName ?? "").trim() || null,
            passport_file_url: String(payload?.passportFileUrl ?? current.passportFileUrl ?? "").trim() || null,
            signature_file_name: String(payload?.signatureFileName ?? current.signatureFileName ?? "").trim() || null,
            signature_file_url: String(payload?.signatureFileUrl ?? current.signatureFileUrl ?? "").trim() || null
        };

        const { error } = await supabase
            .from("customers")
            .update(updatePayload)
            .eq("business_id", session.businessId)
            .eq("account_number", normalized);

        if (error) {
            if (isMissingTableError(error)
                || isMissingColumnError(error, "account_number")
                || isMissingColumnError(error, "passport_file_name")) {
                throw buildAccountSchemaError(error);
            }
            throw error;
        }

        const updated = await getOpenedAccountByNumber(normalized);
        return updated || current;
    }

    const records = readRecords();
    const index = records.findIndex((item) => String(item.accountNumber || "").trim() === normalized);
    if (index < 0) {
        throw new Error("Account number not found.");
    }

    const current = records[index];
    const next = {
        ...current,
        phone: String(payload?.phone ?? current.phone ?? "").trim(),
        email: String(payload?.email ?? current.email ?? "").trim(),
        residentialAddress: String(payload?.residentialAddress ?? current.residentialAddress ?? "").trim(),
        status: String(payload?.status ?? current.status ?? "Active").trim(),
        operationsNote: String(payload?.operationsNote ?? current.operationsNote ?? "").trim(),
        passportFileName: String(payload?.passportFileName ?? current.passportFileName ?? "").trim(),
        passportFileUrl: String(payload?.passportFileUrl ?? current.passportFileUrl ?? "").trim(),
        signatureFileName: String(payload?.signatureFileName ?? current.signatureFileName ?? "").trim(),
        signatureFileUrl: String(payload?.signatureFileUrl ?? current.signatureFileUrl ?? "").trim(),
        updatedAt: new Date().toISOString()
    };

    records[index] = next;
    writeRecords(records);
    return next;
}

export async function postNetSalaryToOpenedAccount(accountNumber, payload = {}) {
    const normalized = String(accountNumber || "").trim();
    if (!normalized) {
        throw new Error("A valid staff account number is required for payroll posting.");
    }

    const amount = Number(payload?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Net salary amount must be greater than zero.");
    }

    const postingDate = String(payload?.postingDate || new Date().toISOString().slice(0, 10)).trim();
    const narration = String(payload?.narration || "Salary").trim() || "Salary";

    const session = await getCurrentSessionContext();
    if (session?.mode === "live") {
        const supabase = getSupabaseClient();
        if (!supabase || !session.businessId) {
            throw new Error("Business context is unavailable for payroll posting.");
        }

        const current = await getOpenedAccountByNumber(normalized);
        if (!current) {
            throw new Error(`Staff account ${normalized} was not found for payroll posting.`);
        }

        const nextBalance = Number(current.currentBalance || 0) + amount;
        const statementEntries = Array.isArray(current.statementEntries) ? current.statementEntries.slice() : [];
        statementEntries.unshift(buildStatementEntry({
            date: postingDate,
            narration,
            debit: 0,
            credit: amount,
            balance: nextBalance
        }));

        const { error } = await supabase
            .from("customers")
            .update({
                current_balance: nextBalance,
                ledger_balance: Number(current.ledgerBalance || 0) + amount,
                available_balance: Number(current.availableBalance || 0) + amount,
                balance: nextBalance,
                statement_entries: statementEntries
            })
            .eq("business_id", session.businessId)
            .eq("account_number", normalized);

        if (error) {
            if (isMissingTableError(error)
                || isMissingColumnError(error, "account_number")
                || isMissingColumnError(error, "statement_entries")
                || isMissingColumnError(error, "current_balance")) {
                throw buildAccountSchemaError(error);
            }
            throw error;
        }

        return await getOpenedAccountByNumber(normalized);
    }

    const records = readRecords();
    const index = records.findIndex((item) => String(item.accountNumber || "").trim() === normalized);
    if (index < 0) {
        throw new Error(`Staff account ${normalized} was not found for payroll posting.`);
    }

    const current = records[index];
    const nextBalance = Number(current.currentBalance || 0) + amount;
    const statementEntries = Array.isArray(current.statementEntries) ? current.statementEntries.slice() : [];
    statementEntries.unshift(buildStatementEntry({
        date: postingDate,
        narration,
        debit: 0,
        credit: amount,
        balance: nextBalance
    }));

    const next = {
        ...current,
        currentBalance: nextBalance,
        ledgerBalance: Number(current.ledgerBalance || 0) + amount,
        availableBalance: Number(current.availableBalance || 0) + amount,
        statementEntries,
        updatedAt: new Date().toISOString()
    };

    records[index] = next;
    writeRecords(records);
    return next;
}

async function saveLiveAccountTransaction(accountNumber, mutator) {
    const session = await getCurrentSessionContext();
    const supabase = getSupabaseClient();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }

    const current = await getOpenedAccountByNumber(accountNumber);
    if (!current) {
        throw new Error(`Account ${accountNumber} was not found.`);
    }

    const next = mutator(current);
    const { error } = await supabase
        .from("customers")
        .update({
            current_balance: Number(next.currentBalance || 0),
            ledger_balance: Number(next.ledgerBalance || 0),
            available_balance: Number(next.availableBalance || 0),
            overdraft: Number(next.overdraft || 0),
            balance: Number(next.currentBalance || 0),
            statement_entries: normalizeStatementEntries(next.statementEntries)
        })
        .eq("business_id", session.businessId)
        .eq("account_number", String(accountNumber || "").trim());

    if (error) {
        if (isMissingTableError(error)
            || isMissingColumnError(error, "account_number")
            || isMissingColumnError(error, "statement_entries")
            || isMissingColumnError(error, "current_balance")) {
            throw buildAccountSchemaError(error);
        }
        throw error;
    }

    return await getOpenedAccountByNumber(accountNumber);
}

function applyCreditTransaction(current, { amount, postingDate, reference = "", postedBy = "", narration }) {
    const nextBalance = Number(current.currentBalance || 0) + amount;
    const ledgerBalance = Number(current.ledgerBalance || 0) + amount;
    const availableBalance = Number(current.availableBalance || 0) + amount;
    const statementEntries = Array.isArray(current.statementEntries) ? current.statementEntries.slice() : [];
    statementEntries.unshift(buildStatementEntry({
        date: postingDate,
        reference,
        postedBy,
        narration,
        debit: 0,
        credit: amount,
        balance: nextBalance
    }));
    return {
        ...current,
        currentBalance: nextBalance,
        ledgerBalance,
        availableBalance,
        statementEntries,
        updatedAt: new Date().toISOString()
    };
}

function applyDebitTransaction(current, { amount, postingDate, reference = "", postedBy = "", narration }) {
    const availableBalance = Number(current.availableBalance || 0);
    if (availableBalance < amount) {
        throw new Error("Insufficient available balance for this transaction.");
    }
    const nextBalance = Number(current.currentBalance || 0) - amount;
    const ledgerBalance = Number(current.ledgerBalance || 0) - amount;
    const nextAvailableBalance = availableBalance - amount;
    const statementEntries = Array.isArray(current.statementEntries) ? current.statementEntries.slice() : [];
    statementEntries.unshift(buildStatementEntry({
        date: postingDate,
        reference,
        postedBy,
        narration,
        debit: amount,
        credit: 0,
        balance: nextBalance
    }));
    return {
        ...current,
        currentBalance: nextBalance,
        ledgerBalance,
        availableBalance: nextAvailableBalance,
        statementEntries,
        updatedAt: new Date().toISOString()
    };
}

export async function postDepositToOpenedAccount(accountNumber, payload = {}) {
    const normalized = String(accountNumber || "").trim();
    if (!normalized) {
        throw new Error("Enter a valid account number.");
    }
    const amount = Number(payload?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Deposit amount must be greater than zero.");
    }
    const postingDate = String(payload?.postingDate || new Date().toISOString().slice(0, 10)).trim();
    const depositorName = String(payload?.narration || "").trim();
    const transactionReference = await generateTransactionReference("DEP", postingDate);

    const session = await getCurrentSessionContext();
    const postedBy = String(session?.fullName || session?.userEmail || "System User").trim();
    if (session?.mode === "live") {
        const updatedAccount = await saveLiveAccountTransaction(normalized, (current) => {
            const narration = `Deposit made by ${depositorName || current.name || "Depositor"}`;
            return applyCreditTransaction(current, { amount, postingDate, reference: transactionReference, postedBy, narration });
        });
        return { updatedAccount, transactionReference };
    }

    const records = readRecords();
    const index = records.findIndex((item) => String(item.accountNumber || "").trim() === normalized);
    if (index < 0) {
        throw new Error(`Account ${normalized} was not found.`);
    }
    const narration = `Deposit made by ${depositorName || records[index]?.name || "Depositor"}`;
    const next = applyCreditTransaction(records[index], { amount, postingDate, reference: transactionReference, postedBy, narration });
    records[index] = next;
    writeRecords(records);
    return { updatedAccount: next, transactionReference };
}

export async function postWithdrawalFromOpenedAccount(accountNumber, payload = {}) {
    const normalized = String(accountNumber || "").trim();
    if (!normalized) {
        throw new Error("Enter a valid account number.");
    }
    const amount = Number(payload?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Withdrawal amount must be greater than zero.");
    }
    const postingDate = String(payload?.postingDate || new Date().toISOString().slice(0, 10)).trim();
    const withdrawerName = String(payload?.narration || "").trim();
    const transactionReference = await generateTransactionReference("WDR", postingDate);

    const session = await getCurrentSessionContext();
    const postedBy = String(session?.fullName || session?.userEmail || "System User").trim();
    if (session?.mode === "live") {
        const updatedAccount = await saveLiveAccountTransaction(normalized, (current) => {
            const narration = `Withdrawal made by ${withdrawerName || current.name || "Customer"}`;
            return applyDebitTransaction(current, { amount, postingDate, reference: transactionReference, postedBy, narration });
        });
        return { updatedAccount, transactionReference };
    }

    const records = readRecords();
    const index = records.findIndex((item) => String(item.accountNumber || "").trim() === normalized);
    if (index < 0) {
        throw new Error(`Account ${normalized} was not found.`);
    }
    const narration = `Withdrawal made by ${withdrawerName || records[index]?.name || "Customer"}`;
    const next = applyDebitTransaction(records[index], { amount, postingDate, reference: transactionReference, postedBy, narration });
    records[index] = next;
    writeRecords(records);
    return { updatedAccount: next, transactionReference };
}

export async function postTransferBetweenOpenedAccounts(fromAccountNumber, toAccountNumber, payload = {}) {
    const fromAccount = String(fromAccountNumber || "").trim();
    const toAccount = String(toAccountNumber || "").trim();
    if (!fromAccount || !toAccount) {
        throw new Error("Enter both source and destination account numbers.");
    }
    if (fromAccount === toAccount) {
        throw new Error("Source and destination accounts must be different.");
    }
    const amount = Number(payload?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Transfer amount must be greater than zero.");
    }
    const postingDate = String(payload?.postingDate || new Date().toISOString().slice(0, 10)).trim();
    const transactionReference = await generateTransactionReference("TRF", postingDate);
    const source = await getOpenedAccountByNumber(fromAccount);
    const destination = await getOpenedAccountByNumber(toAccount);
    if (!source) {
        throw new Error(`Source account ${fromAccount} was not found.`);
    }
    if (!destination) {
        throw new Error(`Destination account ${toAccount} was not found.`);
    }

    const senderName = String(source.name || fromAccount).trim() || fromAccount;
    const receiverName = String(destination.name || toAccount).trim() || toAccount;
    const debitNarration = `Transfer to ${receiverName}`;
    const creditNarration = `Transfer from ${senderName}`;
    const session = await getCurrentSessionContext();
    const postedBy = String(session?.fullName || session?.userEmail || "System User").trim();

    if (session?.mode === "live") {
        await saveLiveAccountTransaction(fromAccount, (current) => applyDebitTransaction(current, {
            amount,
            postingDate,
            reference: transactionReference,
            postedBy,
            narration: debitNarration
        }));
        const destinationAccount = await saveLiveAccountTransaction(toAccount, (current) => applyCreditTransaction(current, {
            amount,
            postingDate,
            reference: transactionReference,
            postedBy,
            narration: creditNarration
        }));
        return { transactionReference, sourceAccount: await getOpenedAccountByNumber(fromAccount), destinationAccount };
    }

    const records = readRecords();
    const fromIndex = records.findIndex((item) => String(item.accountNumber || "").trim() === fromAccount);
    const toIndex = records.findIndex((item) => String(item.accountNumber || "").trim() === toAccount);
    if (fromIndex < 0) {
        throw new Error(`Source account ${fromAccount} was not found.`);
    }
    if (toIndex < 0) {
        throw new Error(`Destination account ${toAccount} was not found.`);
    }
    records[fromIndex] = applyDebitTransaction(records[fromIndex], { amount, postingDate, reference: transactionReference, postedBy, narration: debitNarration });
    records[toIndex] = applyCreditTransaction(records[toIndex], { amount, postingDate, reference: transactionReference, postedBy, narration: creditNarration });
    writeRecords(records);
    return { transactionReference, sourceAccount: records[fromIndex], destinationAccount: records[toIndex] };
}
