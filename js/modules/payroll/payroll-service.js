import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { getActiveBranchDetails } from "../../core/data-access.js";
import { postNetSalaryToOpenedAccount } from "../account-management/account-management-service.js";

const LOCAL_LEVELS_KEY = "tia_payroll_levels_v2";
const LOCAL_RUNS_KEY = "tia_payroll_runs_v2";
const LOCAL_SETTINGS_KEY = "tia_payroll_settings_v2";
const LOCAL_STAFF_KEY = "tia_payroll_staff_v2";
const LOCAL_COMPONENTS_KEY = "tia_payroll_components_v2";
const LOCAL_LEVEL_STRUCTURES_KEY = "tia_payroll_level_structures_v2";
const LOCAL_POSTED_MONTHS_KEY = "tia_payroll_posted_months_v1";
const payrollMemoryStore = {
    levels: null,
    runs: [],
    settings: null,
    staff: [],
    components: null,
    levelStructures: {},
    postedMonths: []
};

const DEFAULT_LEVELS = [
    { level: "Entry Level", amount: 120000 },
    { level: "Officer", amount: 220000 },
    { level: "Senior Officer", amount: 320000 },
    { level: "Managerial", amount: 480000 }
];

const DEFAULT_SETTINGS = {
    frequency: "Monthly",
    cutoffDay: 25,
    postingDay: 28,
    paydayRule: "Last working day",
    taxMethod: "PAYE",
    pensionEmployeeRate: 8,
    pensionEmployerRate: 10,
    currencyCode: "NGN",
    include13thMonth: false,
    payrollControlAccountId: "",
    payrollControlAccountCode: "",
    payrollControlAccountName: ""
};

const DEFAULT_COMPONENTS = [
    { id: "basic-pay", name: "Basic Pay", type: "earning", basis: "fixed", isActive: true },
    { id: "housing-allowance", name: "House", type: "earning", basis: "fixed", isActive: true },
    { id: "child-education", name: "Child Education", type: "earning", basis: "fixed", isActive: true },
    { id: "transport", name: "Transport", type: "earning", basis: "fixed", isActive: true },
    { id: "entertainment", name: "Entertainment", type: "earning", basis: "fixed", isActive: true },
    { id: "utility", name: "Utility", type: "earning", basis: "fixed", isActive: true },
    { id: "domestic", name: "Domestic", type: "earning", basis: "fixed", isActive: true },
    { id: "wardrobe", name: "Wardrobe", type: "earning", basis: "fixed", isActive: true },
    { id: "nhf", name: "NHF", type: "deduction", basis: "fixed", isActive: true },
    { id: "pension", name: "Pension", type: "deduction", basis: "fixed", isActive: true },
    { id: "tax", name: "Tax", type: "deduction", basis: "fixed", isActive: true }
];

function normalizePayrollComponentName(name) {
    const normalized = String(name || "").trim();
    if (!normalized) {
        return "";
    }
    if (normalized.toLowerCase() === "housing allowance") {
        return "House";
    }
    if (normalized.toLowerCase() === "national housing fund") {
        return "NHF";
    }
    return normalized;
}

function normalizeRole(role) {
    return String(role || "").trim().toLowerCase();
}

function canPostPayroll(role) {
    return normalizeRole(role) === "business_admin";
}

function canManageSetup(role) {
    return normalizeRole(role) === "business_admin";
}

function canManageProfiles(role) {
    const normalized = normalizeRole(role);
    return normalized === "staff" || normalized === "manager" || normalized === "business_admin";
}

function canMapGl(role) {
    const normalized = normalizeRole(role);
    return normalized === "account" || normalized === "business_admin";
}

function readLocalJson(key, fallback) {
    if (key === LOCAL_LEVELS_KEY) {
        return payrollMemoryStore.levels ?? fallback;
    }
    if (key === LOCAL_RUNS_KEY) {
        return payrollMemoryStore.runs ?? fallback;
    }
    if (key === LOCAL_SETTINGS_KEY) {
        return payrollMemoryStore.settings ?? fallback;
    }
    if (key === LOCAL_STAFF_KEY) {
        return payrollMemoryStore.staff ?? fallback;
    }
    if (key === LOCAL_COMPONENTS_KEY) {
        return payrollMemoryStore.components ?? fallback;
    }
    if (key === LOCAL_LEVEL_STRUCTURES_KEY) {
        return payrollMemoryStore.levelStructures ?? fallback;
    }
    if (key === LOCAL_POSTED_MONTHS_KEY) {
        return payrollMemoryStore.postedMonths ?? fallback;
    }
    return fallback;
}

function writeLocalJson(key, value) {
    if (key === LOCAL_LEVELS_KEY) {
        payrollMemoryStore.levels = value;
        return;
    }
    if (key === LOCAL_RUNS_KEY) {
        payrollMemoryStore.runs = value;
        return;
    }
    if (key === LOCAL_SETTINGS_KEY) {
        payrollMemoryStore.settings = value;
        return;
    }
    if (key === LOCAL_STAFF_KEY) {
        payrollMemoryStore.staff = value;
        return;
    }
    if (key === LOCAL_COMPONENTS_KEY) {
        payrollMemoryStore.components = value;
        return;
    }
    if (key === LOCAL_LEVEL_STRUCTURES_KEY) {
        payrollMemoryStore.levelStructures = value;
        return;
    }
    if (key === LOCAL_POSTED_MONTHS_KEY) {
        payrollMemoryStore.postedMonths = value;
    }
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
    if (code === "PGRST204" || code === "42703") {
        return true;
    }
    if (!normalizedColumn) {
        return false;
    }
    return message.includes(`column "${normalizedColumn}" does not exist`)
        || message.includes(`could not find the '${normalizedColumn}' column`)
        || details.includes(`could not find the '${normalizedColumn}' column`);
}

function normalizeAccountCode(value) {
    return String(value || "").trim().toUpperCase();
}

function toAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
}

function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function dedupeComponentsByName(components = []) {
    const ranked = new Map();
    (components || []).forEach((item) => {
        const key = String(item?.name || "").trim().toLowerCase();
        if (!key) {
            return;
        }
        const existing = ranked.get(key);
        const currentScore = ((item?.debitAccountId || item?.creditAccountId) ? 2 : 0) + (item?.isActive === false ? 0 : 1);
        const existingScore = existing
            ? (((existing?.debitAccountId || existing?.creditAccountId) ? 2 : 0) + (existing?.isActive === false ? 0 : 1))
            : -1;
        if (!existing || currentScore >= existingScore) {
            ranked.set(key, item);
        }
    });
    return Array.from(ranked.values());
}

function assertLivePayrollDatabase(session, supabase) {
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!supabase || session.mode !== "live") {
        throw new Error("Payroll is database-only. Sign in to the live system to continue.");
    }
}

function getLevelStructureItems(levelStructures, levelName) {
    return Array.isArray(levelStructures?.[levelName]) ? levelStructures[levelName] : [];
}

function getStaffGrossSalary(levelStructures, levelName) {
    return getLevelStructureItems(levelStructures, levelName)
        .filter((item) => item.componentType === "earning" && item.isEnabled)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function getStaffNetSalary(levelStructures, levelName) {
    const items = getLevelStructureItems(levelStructures, levelName);
    const earnings = items
        .filter((item) => item.componentType === "earning" && item.isEnabled)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const deductions = items
        .filter((item) => item.componentType === "deduction" && item.isEnabled)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return earnings - deductions;
}

function getTodayIso() {
    const now = new Date();
    if (Number.isNaN(now.getTime())) {
        return "";
    }
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatPayrollMonthLabel(monthValue, fallbackDate = "") {
    const normalizedMonth = String(monthValue || "").trim();
    const baseValue = normalizedMonth || String(fallbackDate || "").trim().slice(0, 7);
    const [yearRaw, monthRaw] = baseValue.split("-");
    const year = Number(yearRaw || 0);
    const month = Number(monthRaw || 0);
    if (!year || !month) {
        return "";
    }
    const date = new Date(Date.UTC(year, month - 1, 1));
    return new Intl.DateTimeFormat("en", {
        month: "long",
        year: "numeric",
        timeZone: "UTC"
    }).format(date);
}

function getMonthValue(dateValue = "") {
    return String(dateValue || "").trim().slice(0, 7);
}

function sanitizePostedMonth(item) {
    return {
        month: getMonthValue(item?.month || item?.postingDate || item?.postedAt || ""),
        branchId: String(item?.branchId || "").trim(),
        postedAt: String(item?.postedAt || new Date().toISOString()).trim()
    };
}

function sanitizeSettings(input) {
    return {
        frequency: String(input?.frequency || DEFAULT_SETTINGS.frequency).trim() || DEFAULT_SETTINGS.frequency,
        cutoffDay: Math.min(31, Math.max(1, Number(input?.cutoffDay || DEFAULT_SETTINGS.cutoffDay))),
        postingDay: Math.min(31, Math.max(1, Number(input?.postingDay || DEFAULT_SETTINGS.postingDay))),
        paydayRule: String(input?.paydayRule || DEFAULT_SETTINGS.paydayRule).trim() || DEFAULT_SETTINGS.paydayRule,
        taxMethod: String(input?.taxMethod || DEFAULT_SETTINGS.taxMethod).trim() || DEFAULT_SETTINGS.taxMethod,
        pensionEmployeeRate: Math.max(0, Number(input?.pensionEmployeeRate || 0)),
        pensionEmployerRate: Math.max(0, Number(input?.pensionEmployerRate || 0)),
        currencyCode: String(input?.currencyCode || DEFAULT_SETTINGS.currencyCode).trim().toUpperCase() || "NGN",
        include13thMonth: Boolean(input?.include13thMonth),
        payrollControlAccountId: String(input?.payrollControlAccountId || "").trim(),
        payrollControlAccountCode: String(input?.payrollControlAccountCode || "").trim(),
        payrollControlAccountName: String(input?.payrollControlAccountName || "").trim()
    };
}

function sanitizeLevel(item) {
    return {
        level: String(item?.level || "").trim(),
        amount: toAmount(item?.amount)
    };
}

function sanitizeStaff(item) {
    return {
        id: String(item?.id || crypto.randomUUID()),
        employeeCode: String(item?.employeeCode || "").trim(),
        fullName: String(item?.fullName || "").trim(),
        branchId: String(item?.branchId || "").trim(),
        branchName: String(item?.branchName || "").trim(),
        salaryLevel: String(item?.salaryLevel || "").trim(),
        grossSalary: toAmount(item?.grossSalary),
        debitAccountId: String(item?.debitAccountId || "").trim(),
        debitAccountCode: String(item?.debitAccountCode || "").trim(),
        debitAccountName: String(item?.debitAccountName || "").trim(),
        creditAccountId: String(item?.creditAccountId || "").trim(),
        creditAccountCode: String(item?.creditAccountCode || "").trim(),
        creditAccountName: String(item?.creditAccountName || "").trim(),
        isActive: item?.isActive !== false
    };
}

function sanitizeComponent(item) {
    return {
        id: String(item?.id || crypto.randomUUID()),
        name: normalizePayrollComponentName(item?.name),
        type: String(item?.type || "").trim().toLowerCase() === "deduction" ? "deduction" : "earning",
        basis: String(item?.basis || "fixed").trim().toLowerCase() || "fixed",
        debitAccountId: String(item?.debitAccountId || "").trim(),
        debitAccountCode: String(item?.debitAccountCode || "").trim(),
        debitAccountName: String(item?.debitAccountName || "").trim(),
        creditAccountId: String(item?.creditAccountId || "").trim(),
        creditAccountCode: String(item?.creditAccountCode || "").trim(),
        creditAccountName: String(item?.creditAccountName || "").trim(),
        isActive: item?.isActive !== false
    };
}

function sanitizeLevelStructureItem(item) {
    return {
        componentId: String(item?.componentId || "").trim(),
        componentName: normalizePayrollComponentName(item?.componentName),
        componentType: String(item?.componentType || "").trim().toLowerCase() === "deduction" ? "deduction" : "earning",
        amount: toAmount(item?.amount),
        isEnabled: item?.isEnabled !== false
    };
}

function getUniqueEmployeeCode(existingStaff) {
    const max = (existingStaff || []).reduce((highest, row) => {
        const match = String(row?.employeeCode || "").match(/(\d+)$/);
        const value = match ? Number(match[1]) : 0;
        return Number.isFinite(value) && value > highest ? value : highest;
    }, 0);
    return `EMP-${String(max + 1).padStart(4, "0")}`;
}

async function getLocalLevels() {
    const rows = readLocalJson(LOCAL_LEVELS_KEY, DEFAULT_LEVELS).map(sanitizeLevel)
        .filter((item) => item.level && item.amount > 0);
    if (!rows.length) {
        writeLocalJson(LOCAL_LEVELS_KEY, DEFAULT_LEVELS);
        return DEFAULT_LEVELS;
    }
    return rows;
}

async function getLocalSettings() {
    return sanitizeSettings(readLocalJson(LOCAL_SETTINGS_KEY, DEFAULT_SETTINGS));
}

async function getLocalRuns() {
    return readLocalJson(LOCAL_RUNS_KEY, []);
}

async function getLocalPostedMonths() {
    return readLocalJson(LOCAL_POSTED_MONTHS_KEY, [])
        .map(sanitizePostedMonth)
        .filter((item) => item.month);
}

async function saveLocalPostedMonths(rows) {
    writeLocalJson(LOCAL_POSTED_MONTHS_KEY, rows.map(sanitizePostedMonth));
}

async function recordPostedPayrollMonth(month, branchId = "") {
    const normalizedMonth = getMonthValue(month);
    const normalizedBranchId = String(branchId || "").trim();
    if (!normalizedMonth) {
        return;
    }
    const existing = await getLocalPostedMonths();
    const alreadyExists = existing.some((item) => item.month === normalizedMonth && String(item.branchId || "").trim() === normalizedBranchId);
    if (alreadyExists) {
        return;
    }
    existing.unshift(sanitizePostedMonth({
        month: normalizedMonth,
        branchId: normalizedBranchId,
        postedAt: new Date().toISOString()
    }));
    await saveLocalPostedMonths(existing);
}

async function getLocalStaff() {
    return readLocalJson(LOCAL_STAFF_KEY, []).map(sanitizeStaff);
}

async function saveLocalStaff(rows) {
    writeLocalJson(LOCAL_STAFF_KEY, rows.map(sanitizeStaff));
}

async function getLocalComponents() {
    const rows = readLocalJson(LOCAL_COMPONENTS_KEY, DEFAULT_COMPONENTS).map(sanitizeComponent)
        .filter((item) => item.name);
    if (!rows.length) {
        writeLocalJson(LOCAL_COMPONENTS_KEY, DEFAULT_COMPONENTS);
        return DEFAULT_COMPONENTS;
    }
    return rows;
}

async function saveLocalComponents(rows) {
    writeLocalJson(LOCAL_COMPONENTS_KEY, rows.map(sanitizeComponent));
}

async function getLocalLevelStructures() {
    const raw = readLocalJson(LOCAL_LEVEL_STRUCTURES_KEY, {});
    return Object.fromEntries(
        Object.entries(raw || {}).map(([levelName, items]) => [
            levelName,
            Array.isArray(items) ? items.map(sanitizeLevelStructureItem) : []
        ])
    );
}

async function saveLocalLevelStructures(structures) {
    const normalized = Object.fromEntries(
        Object.entries(structures || {}).map(([levelName, items]) => [
            levelName,
            Array.isArray(items) ? items.map(sanitizeLevelStructureItem) : []
        ])
    );
    writeLocalJson(LOCAL_LEVEL_STRUCTURES_KEY, normalized);
}

async function addLocalRun(payload) {
    const runs = await getLocalRuns();
    const next = [
        {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            ...payload
        },
        ...runs
    ];
    writeLocalJson(LOCAL_RUNS_KEY, next);
}

async function seedDefaultPayrollComponents(supabase, businessId) {
    const { error } = await supabase
        .from("payroll_components")
        .insert(DEFAULT_COMPONENTS.map((item) => ({
            business_id: businessId,
            component_name: item.name,
            component_type: item.type,
            calculation_basis: item.basis,
            is_active: item.isActive !== false
        })));

    if (error && !String(error.message || "").toLowerCase().includes("duplicate")) {
        throw error;
    }
}

async function getReferenceData(session) {
    const supabase = getSupabaseClient();
    const activeBranch = await getActiveBranchDetails(session.userId, session.businessId);

    if (!supabase || session.mode !== "live") {
        return {
            branches: [],
            accounts: [],
            activeBranch
        };
    }

    const [branchesResult, chartAccountsResult] = await Promise.all([
        supabase
            .from("branches")
            .select("id, name, code, is_head_office, is_active")
            .eq("business_id", session.businessId)
            .order("created_at", { ascending: true }),
        supabase
            .from("chart_of_accounts")
            .select("id, code, name, parent_account_id, is_active")
            .eq("business_id", session.businessId)
            .eq("is_active", true)
            .order("code", { ascending: true }),
    ]);

    if (branchesResult.error) {
        throw branchesResult.error;
    }
    if (chartAccountsResult.error) {
        throw chartAccountsResult.error;
    }

    const chartRows = (chartAccountsResult.data || []).map((item) => ({
        id: String(item.id || ""),
        code: String(item.code || ""),
        name: String(item.name || ""),
        parentAccountId: String(item.parent_account_id || "").trim()
    }));
    const parentIds = new Set(
        chartRows
            .map((item) => item.parentAccountId)
            .filter(Boolean)
    );
    const leafChartAccounts = chartRows.filter((account) => !parentIds.has(String(account.id || "")));

    const accountRows = leafChartAccounts.map((account) => ({
        id: String(account.id || ""),
        code: String(account.code || ""),
        name: String(account.name || "")
    }));

    return {
        activeBranch,
        branches: (branchesResult.data || []).map((branch) => ({
            id: String(branch.id || ""),
            name: String(branch.name || ""),
            code: String(branch.code || ""),
            isHeadOffice: Boolean(branch.is_head_office),
            isActive: branch.is_active !== false
        })),
        accounts: accountRows
    };
}

export async function getPayrollData() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        return {
            role: "",
            runs: [],
            levels: DEFAULT_LEVELS,
            settings: DEFAULT_SETTINGS,
            components: DEFAULT_COMPONENTS,
            levelStructures: {},
            staff: [],
            branches: [],
            accounts: [],
            activeBranch: { id: "", name: "Head Office", isHeadOffice: true, canAccessAllBranches: true },
            postableStaff: [],
            suggestedEmployeeCode: "EMP-0001"
        };
    }

    const role = normalizeRole(session.role);
    const refs = await getReferenceData(session);
    const accountMap = new Map(refs.accounts.map((item) => [item.id, item]));
    const branchMap = new Map(refs.branches.map((item) => [item.id, item]));

    const liveReady = Boolean(supabase && session.mode === "live");
    let levels = DEFAULT_LEVELS;
    let settings = DEFAULT_SETTINGS;
    let components = DEFAULT_COMPONENTS;
    let levelStructures = {};
    let staff = [];
    let runs = [];
    let postedMonths = [];

    if (liveReady) {
        const [levelsRes, settingsRes, componentsRes, structuresRes, staffRes, runsRes] = await Promise.all([
            supabase
                .from("payroll_levels")
                .select("id, level_name, default_amount")
                .eq("business_id", session.businessId)
                .order("level_name", { ascending: true }),
            supabase
                .from("payroll_settings")
                .select("frequency, cutoff_day, posting_day, payday_rule, tax_method, pension_employee_rate, pension_employer_rate, currency_code, include_13th_month, payroll_control_account_id")
                .eq("business_id", session.businessId)
                .limit(1)
                .maybeSingle(),
            supabase
                .from("payroll_components")
                .select("id, component_name, component_type, calculation_basis, is_active, debit_account_id, credit_account_id")
                .eq("business_id", session.businessId)
                .order("component_type", { ascending: true })
                .order("component_name", { ascending: true }),
            supabase
                .from("payroll_level_components")
                .select("level_name, component_name, component_type, amount, is_enabled")
                .eq("business_id", session.businessId)
                .order("level_name", { ascending: true }),
            supabase
                .from("payroll_staff")
                .select("id, employee_code, full_name, branch_id, salary_level, gross_salary, debit_account_id, credit_account_id, is_active")
                .eq("business_id", session.businessId)
                .order("full_name", { ascending: true }),
            supabase
                .from("payroll_runs")
                .select("id, payroll_staff_id, staff_name, staff_level, amount, status, created_at, branch_id, posting_date, journal_entry_id")
                .eq("business_id", session.businessId)
                .order("created_at", { ascending: false })
        ]);

        if (!levelsRes.error) {
            const liveLevels = (levelsRes.data || []).map((item) => ({
                level: String(item.level_name || "").trim(),
                amount: toAmount(item.default_amount)
            })).filter((item) => item.level && item.amount > 0);
            if (liveLevels.length) {
                levels = liveLevels;
            }
        } else if (!isMissingTableError(levelsRes.error)) {
            throw levelsRes.error;
        }

        if (!settingsRes.error && settingsRes.data) {
            const controlAccount = accountMap.get(String(settingsRes.data.payroll_control_account_id || "").trim());
            settings = sanitizeSettings({
                ...settings,
                frequency: settingsRes.data.frequency,
                cutoffDay: settingsRes.data.cutoff_day,
                postingDay: settingsRes.data.posting_day,
                paydayRule: settingsRes.data.payday_rule,
                taxMethod: settingsRes.data.tax_method,
                pensionEmployeeRate: settingsRes.data.pension_employee_rate,
                pensionEmployerRate: settingsRes.data.pension_employer_rate,
                currencyCode: settingsRes.data.currency_code,
                include13thMonth: settingsRes.data.include_13th_month,
                payrollControlAccountId: settingsRes.data.payroll_control_account_id,
                payrollControlAccountCode: controlAccount?.code || settings.payrollControlAccountCode || "",
                payrollControlAccountName: controlAccount?.name || settings.payrollControlAccountName || ""
            });
        } else if (settingsRes.error && !isMissingTableError(settingsRes.error) && !isMissingColumnError(settingsRes.error, "posting_day") && !isMissingColumnError(settingsRes.error, "payroll_control_account_id")) {
            throw settingsRes.error;
        }

        if (!componentsRes.error) {
            let componentRows = componentsRes.data || [];
            if (!componentRows.length) {
                await seedDefaultPayrollComponents(supabase, session.businessId);
                const seededComponents = await supabase
                    .from("payroll_components")
                    .select("id, component_name, component_type, calculation_basis, is_active, debit_account_id, credit_account_id")
                    .eq("business_id", session.businessId)
                    .order("component_type", { ascending: true })
                    .order("component_name", { ascending: true });
                if (seededComponents.error) {
                    throw seededComponents.error;
                }
                componentRows = seededComponents.data || [];
            }
            const liveComponents = dedupeComponentsByName(componentRows.map((item) => sanitizeComponent({
                id: item.id,
                name: item.component_name,
                type: item.component_type,
                basis: item.calculation_basis,
                debitAccountId: item.debit_account_id,
                debitAccountCode: accountMap.get(String(item.debit_account_id || "").trim())?.code || "",
                debitAccountName: accountMap.get(String(item.debit_account_id || "").trim())?.name || "",
                creditAccountId: item.credit_account_id,
                creditAccountCode: accountMap.get(String(item.credit_account_id || "").trim())?.code || "",
                creditAccountName: accountMap.get(String(item.credit_account_id || "").trim())?.name || "",
                isActive: item.is_active
            })).filter((item) => item.name));
            if (liveComponents.length) {
                components = liveComponents;
            }
        } else if (isMissingColumnError(componentsRes.error, "debit_account_id") || isMissingColumnError(componentsRes.error, "credit_account_id")) {
            throw new Error("Payroll component GL mapping columns are missing. Run sql/add-payroll-tables.sql first.");
        } else if (!isMissingTableError(componentsRes.error)) {
            throw componentsRes.error;
        } else {
            throw new Error("Payroll components table is not set up yet. Run sql/add-payroll-tables.sql first.");
        }

        if (!structuresRes.error) {
            levelStructures = (structuresRes.data || []).reduce((acc, item) => {
                const levelName = String(item.level_name || "").trim();
                if (!levelName) {
                    return acc;
                }
                if (!acc[levelName]) {
                    acc[levelName] = [];
                }
                acc[levelName].push(sanitizeLevelStructureItem({
                    componentName: item.component_name,
                    componentType: item.component_type,
                    amount: item.amount,
                    isEnabled: item.is_enabled
                }));
                return acc;
            }, {});
        } else if (!isMissingTableError(structuresRes.error)) {
            throw structuresRes.error;
        }

        if (!staffRes.error) {
            staff = (staffRes.data || []).map((item) => {
                const branch = branchMap.get(String(item.branch_id || "").trim());
                const debit = accountMap.get(String(item.debit_account_id || "").trim());
                const credit = accountMap.get(String(item.credit_account_id || "").trim());
                return sanitizeStaff({
                    id: item.id,
                    employeeCode: item.employee_code,
                    fullName: item.full_name,
                    branchId: item.branch_id,
                    branchName: branch?.name || "",
                    salaryLevel: item.salary_level,
                    grossSalary: item.gross_salary,
                    debitAccountId: item.debit_account_id,
                    debitAccountCode: debit?.code || "",
                    debitAccountName: debit?.name || "",
                    creditAccountId: item.credit_account_id,
                    creditAccountCode: credit?.code || "",
                    creditAccountName: credit?.name || "",
                    isActive: item.is_active
                });
            });
        } else if (!isMissingTableError(staffRes.error)) {
            throw staffRes.error;
        }

        if (!runsRes.error) {
            runs = (runsRes.data || []).map((item) => {
                const branch = branchMap.get(String(item.branch_id || "").trim());
                return {
                    id: item.id,
                    staffId: String(item.payroll_staff_id || "").trim(),
                    staffName: String(item.staff_name || ""),
                    staffLevel: String(item.staff_level || ""),
                    amount: toAmount(item.amount),
                    status: String(item.status || "approved"),
                    createdAt: item.created_at,
                    branchId: String(item.branch_id || "").trim(),
                    branchName: branch?.name || "",
                    postingDate: String(item.posting_date || item.created_at || ""),
                    journalEntryId: String(item.journal_entry_id || "")
                };
            });
        } else if (isMissingColumnError(runsRes.error, "payroll_staff_id")
            || isMissingColumnError(runsRes.error, "branch_id")
            || isMissingColumnError(runsRes.error, "posting_date")
            || isMissingColumnError(runsRes.error, "journal_entry_id")) {
            throw new Error("Payroll run columns are incomplete. Run sql/add-payroll-tables.sql first.");
        } else if (!isMissingTableError(runsRes.error)) {
            throw runsRes.error;
        } else {
            throw new Error("Payroll runs table is not set up yet. Run sql/add-payroll-tables.sql first.");
        }

        postedMonths = runs
            .map((item) => sanitizePostedMonth({
                month: item.postingDate,
                branchId: item.branchId,
                postedAt: item.createdAt
            }))
            .filter((item) => item.month);
    }

    const postableStaff = staff.filter((item) => {
        if (!item.isActive) {
            return false;
        }
        if (refs.activeBranch.canAccessAllBranches) {
            return true;
        }
        return String(item.branchId || "") === String(refs.activeBranch.id || "");
    });

    const normalizedLevelStructures = Object.fromEntries(
        levels.map((level) => {
            const assigned = Array.isArray(levelStructures[level.level]) ? levelStructures[level.level] : [];
            const merged = components.map((component) => {
                const match = assigned.find((item) => String(item.componentName || "").trim().toLowerCase() === component.name.trim().toLowerCase());
                return sanitizeLevelStructureItem({
                    componentId: component.id,
                    componentName: component.name,
                    componentType: component.type,
                    amount: match?.amount || 0,
                    isEnabled: match ? match.isEnabled : component.type === "earning"
                });
            });
            return [level.level, merged];
        })
    );

    return {
        role,
        runs,
        levels,
        settings,
        components,
        levelStructures: normalizedLevelStructures,
        staff,
        branches: refs.branches,
        accounts: refs.accounts,
        activeBranch: refs.activeBranch,
        postableStaff,
        postedMonths,
        suggestedEmployeeCode: getUniqueEmployeeCode(staff)
    };
}

export async function updatePayrollSettings(settings) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canManageSetup(session.role)) {
        throw new Error("Only Head Office Admin can configure payroll setup.");
    }

    const sanitized = sanitizeSettings(settings);
    assertLivePayrollDatabase(session, supabase);

    const { error } = await supabase
        .from("payroll_settings")
        .upsert({
            business_id: session.businessId,
            frequency: sanitized.frequency,
            cutoff_day: sanitized.cutoffDay,
            posting_day: sanitized.postingDay,
            payday_rule: sanitized.paydayRule,
            tax_method: sanitized.taxMethod,
            pension_employee_rate: sanitized.pensionEmployeeRate,
            pension_employer_rate: sanitized.pensionEmployerRate,
            currency_code: sanitized.currencyCode,
            include_13th_month: sanitized.include13thMonth
        }, { onConflict: "business_id" });

    if (error) {
        if (isMissingTableError(error) || isMissingColumnError(error, "posting_day") || isMissingColumnError(error, "payroll_control_account_id")) {
            throw new Error("Payroll settings table or required columns are missing. Run sql/add-payroll-tables.sql first.");
        }
        throw error;
    }
}

export async function updatePayrollControlAccount(payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canMapGl(session.role)) {
        throw new Error("Only Account or Admin can configure the payroll control account.");
    }

    const accountId = String(payload?.accountId || "").trim();
    const accountCode = String(payload?.accountCode || "").trim();
    const accountName = String(payload?.accountName || "").trim();
    if (!accountId) {
        throw new Error("Select a payroll control account.");
    }

    const refs = await getReferenceData(session);
    const selectedAccount = (refs.accounts || []).find((item) => String(item.id || "").trim() === accountId);
    if (!selectedAccount) {
        throw new Error("Selected payroll control account is not available. Refresh GL setup and try again.");
    }

    assertLivePayrollDatabase(session, supabase);

    const { error } = await supabase
        .from("payroll_settings")
        .upsert({
            business_id: session.businessId,
            payroll_control_account_id: accountId
        }, { onConflict: "business_id" });

    if (error) {
        if (isMissingTableError(error) || isMissingColumnError(error, "payroll_control_account_id")) {
            throw new Error("Payroll settings control-account column is missing. Run sql/add-payroll-tables.sql first.");
        }
        throw error;
    }
}

export async function updatePayrollLevels(levels) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canManageSetup(session.role)) {
        throw new Error("Only Head Office Admin can configure salary bands.");
    }

    const sanitized = (levels || []).map(sanitizeLevel)
        .filter((item) => item.level && item.amount > 0);
    if (!sanitized.length) {
        throw new Error("Please provide at least one salary band.");
    }

    assertLivePayrollDatabase(session, supabase);

    const { error: deleteError } = await supabase
        .from("payroll_levels")
        .delete()
        .eq("business_id", session.businessId);
    if (deleteError && !isMissingTableError(deleteError)) {
        throw deleteError;
    }

    const { error } = await supabase
        .from("payroll_levels")
        .insert(sanitized.map((item) => ({
            business_id: session.businessId,
            level_name: item.level,
            default_amount: item.amount
        })));

    if (error) {
        if (isMissingTableError(error)) {
            throw new Error("Payroll levels table is not set up yet. Run sql/add-payroll-tables.sql first.");
        }
        throw error;
    }
}

export async function updatePayrollComponents(components) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canManageSetup(session.role)) {
        throw new Error("Only Head Office Admin can configure payroll components.");
    }

    const existingComponents = await getPayrollData().then((data) => data.components || []).catch(() => []);
    const existingById = new Map(existingComponents.map((item) => [String(item.id || ""), item]));
    const sanitized = (components || []).map((item) => {
        const normalized = sanitizeComponent(item);
        const previous = existingById.get(String(normalized.id || ""));
        return {
            ...normalized,
            debitAccountId: normalized.debitAccountId || previous?.debitAccountId || "",
            debitAccountCode: normalized.debitAccountCode || previous?.debitAccountCode || "",
            debitAccountName: normalized.debitAccountName || previous?.debitAccountName || "",
            creditAccountId: normalized.creditAccountId || previous?.creditAccountId || "",
            creditAccountCode: normalized.creditAccountCode || previous?.creditAccountCode || "",
            creditAccountName: normalized.creditAccountName || previous?.creditAccountName || ""
        };
    }).filter((item) => item.name);
    if (!sanitized.length) {
        throw new Error("Please provide at least one payroll component.");
    }

    assertLivePayrollDatabase(session, supabase);

    const { error: deleteError } = await supabase
        .from("payroll_components")
        .delete()
        .eq("business_id", session.businessId);
    if (deleteError && !isMissingTableError(deleteError)) {
        throw deleteError;
    }

    const { error } = await supabase
        .from("payroll_components")
        .insert(sanitized.map((item) => ({
            business_id: session.businessId,
            component_name: item.name,
            component_type: item.type,
            calculation_basis: item.basis,
            debit_account_id: item.debitAccountId || null,
            credit_account_id: item.creditAccountId || null,
            is_active: item.isActive
        })));

    if (error) {
        if (isMissingColumnError(error, "debit_account_id") || isMissingColumnError(error, "credit_account_id")) {
            throw new Error("Payroll component GL mapping columns are missing. Run sql/add-payroll-tables.sql first.");
        }
        if (isMissingTableError(error)) {
            throw new Error("Payroll components table is not set up yet. Run sql/add-payroll-tables.sql first.");
        }
        throw error;
    }
}

export async function updatePayrollComponentGlMapping(componentId, payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canMapGl(session.role)) {
        throw new Error("Only Account or Admin can map payroll component GLs.");
    }

    let id = String(componentId || "").trim();
    const mappedAccountId = String(payload?.mappedAccountId || "").trim();
    if (!id) {
        throw new Error("Payroll component id is required.");
    }
    if (!mappedAccountId) {
        throw new Error("Select a GL account for this payroll component.");
    }

    const existingComponents = await getPayrollData().then((data) => data.components || []).catch(() => []);
    const currentComponent = existingComponents.find((item) => String(item.id || "").trim() === id);
    if (!currentComponent?.id) {
        throw new Error("Payroll component was not found.");
    }

    if (supabase && session.mode === "live" && !isUuidLike(id)) {
        await seedDefaultPayrollComponents(supabase, session.businessId);
        const componentLookup = await supabase
            .from("payroll_components")
            .select("id")
            .eq("business_id", session.businessId)
            .ilike("component_name", String(currentComponent.name || "").trim())
            .limit(1)
            .maybeSingle();

        if (componentLookup.error) {
            throw componentLookup.error;
        }
        if (!componentLookup.data?.id) {
            throw new Error("Payroll component database record was not found. Please reload and try again.");
        }
        id = String(componentLookup.data.id || "").trim();
    }

    const refs = await getReferenceData(session);
    const accountMap = new Map((refs.accounts || []).map((item) => [String(item.id || "").trim(), item]));
    const mappedAccount = accountMap.get(mappedAccountId);
    if (!mappedAccount) {
        throw new Error("Selected GL account is not available. Refresh GL setup and try again.");
    }
    const isDeduction = currentComponent.type === "deduction";
    const debitAccountId = isDeduction ? null : mappedAccountId;
    const creditAccountId = isDeduction ? mappedAccountId : null;
    const debitAccountCode = !isDeduction ? String(mappedAccount?.code || "").trim() : "";
    const debitAccountName = !isDeduction ? String(mappedAccount?.name || "").trim() : "";
    const creditAccountCode = isDeduction ? String(mappedAccount?.code || "").trim() : "";
    const creditAccountName = isDeduction ? String(mappedAccount?.name || "").trim() : "";

    assertLivePayrollDatabase(session, supabase);

    const { error } = await supabase
        .from("payroll_components")
        .update({
            debit_account_id: debitAccountId,
            credit_account_id: creditAccountId
        })
        .eq("id", id)
        .eq("business_id", session.businessId);

    if (error) {
        if (isMissingTableError(error) || isMissingColumnError(error, "debit_account_id") || isMissingColumnError(error, "credit_account_id")) {
            throw new Error("Payroll component GL mapping columns are missing. Run sql/add-payroll-tables.sql first.");
        }
        throw error;
    }
}

export async function updatePayrollLevelStructure(levelName, items) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canManageSetup(session.role)) {
        throw new Error("Only Head Office Admin can configure level components.");
    }

    const normalizedLevelName = String(levelName || "").trim();
    const sanitized = (items || []).map(sanitizeLevelStructureItem).filter((item) => item.componentName);
    if (!normalizedLevelName) {
        throw new Error("Level name is required.");
    }
    if (!sanitized.length) {
        throw new Error("Please provide at least one component line.");
    }

    if (!supabase || session.mode !== "live") {
        const structures = await getLocalLevelStructures();
        structures[normalizedLevelName] = sanitized;
        await saveLocalLevelStructures(structures);
        return;
    }

    const { error: deleteError } = await supabase
        .from("payroll_level_components")
        .delete()
        .eq("business_id", session.businessId)
        .eq("level_name", normalizedLevelName);
    if (deleteError && !isMissingTableError(deleteError)) {
        throw deleteError;
    }

    const { error } = await supabase
        .from("payroll_level_components")
        .insert(sanitized.map((item) => ({
            business_id: session.businessId,
            level_name: normalizedLevelName,
            component_name: item.componentName,
            component_type: item.componentType,
            amount: item.amount,
            is_enabled: item.isEnabled
        })));

    if (error) {
        if (isMissingTableError(error)) {
            const structures = await getLocalLevelStructures();
            structures[normalizedLevelName] = sanitized;
            await saveLocalLevelStructures(structures);
            return;
        }
        throw error;
    }
}

export async function upsertPayrollStaff(payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canManageProfiles(session.role)) {
        throw new Error("Only Operations or Admin can manage payroll staff profiles.");
    }

    const record = sanitizeStaff(payload);
    const normalizedEmployeeCode = String(record.employeeCode || "").trim().toUpperCase();
    if (!record.employeeCode || !record.fullName || !record.salaryLevel || record.grossSalary <= 0) {
        throw new Error("Complete employee code, name, salary band, and gross salary.");
    }
    if (!record.branchId) {
        throw new Error("Select the staff branch.");
    }
    if (record.debitAccountId && record.creditAccountId && record.debitAccountId === record.creditAccountId) {
        throw new Error("Debit and credit GL accounts must be different.");
    }

    const branchContext = await getActiveBranchDetails(session.userId, session.businessId);
    if (!branchContext.canAccessAllBranches && String(record.branchId || "") !== String(branchContext.id || "")) {
        throw new Error("You can only create payroll staff profiles for your branch.");
    }

    if (!supabase || session.mode !== "live") {
        const existing = await getLocalStaff();
        const duplicate = existing.find((item) =>
            String(item.employeeCode || "").trim().toUpperCase() === normalizedEmployeeCode
            && String(item.id || "").trim() !== String(record.id || "").trim()
        );
        if (duplicate) {
            throw new Error("This account number has already been registered in payroll.");
        }
        const previous = existing.find((item) => item.id === record.id);
        const next = existing.filter((item) => item.id !== record.id);
        next.push({
            ...record,
            debitAccountId: record.debitAccountId || previous?.debitAccountId || "",
            debitAccountCode: record.debitAccountCode || previous?.debitAccountCode || "",
            debitAccountName: record.debitAccountName || previous?.debitAccountName || "",
            creditAccountId: record.creditAccountId || previous?.creditAccountId || "",
            creditAccountCode: record.creditAccountCode || previous?.creditAccountCode || "",
            creditAccountName: record.creditAccountName || previous?.creditAccountName || ""
        });
        await saveLocalStaff(next);
        return;
    }

    const duplicateCheck = await supabase
        .from("payroll_staff")
        .select("id")
        .eq("business_id", session.businessId)
        .eq("employee_code", record.employeeCode)
        .neq("id", record.id)
        .limit(1);

    if (duplicateCheck.error && !isMissingTableError(duplicateCheck.error)) {
        throw duplicateCheck.error;
    }
    if ((duplicateCheck.data || []).length > 0) {
        throw new Error("This account number has already been registered in payroll.");
    }

    const { error } = await supabase
        .from("payroll_staff")
        .upsert({
            id: record.id,
            business_id: session.businessId,
            employee_code: record.employeeCode,
            full_name: record.fullName,
            branch_id: record.branchId,
            salary_level: record.salaryLevel,
            gross_salary: record.grossSalary,
            debit_account_id: record.debitAccountId || null,
            credit_account_id: record.creditAccountId || null,
            is_active: record.isActive
        }, { onConflict: "id" });

    if (error) {
        if (isMissingTableError(error)) {
            const existing = await getLocalStaff();
            const previous = existing.find((item) => item.id === record.id);
            const next = existing.filter((item) => item.id !== record.id);
            next.push({
                ...record,
                debitAccountId: record.debitAccountId || previous?.debitAccountId || "",
                debitAccountCode: record.debitAccountCode || previous?.debitAccountCode || "",
                debitAccountName: record.debitAccountName || previous?.debitAccountName || "",
                creditAccountId: record.creditAccountId || previous?.creditAccountId || "",
                creditAccountCode: record.creditAccountCode || previous?.creditAccountCode || "",
                creditAccountName: record.creditAccountName || previous?.creditAccountName || ""
            });
            await saveLocalStaff(next);
            return;
        }
        throw error;
    }
}

export async function updatePayrollStaffGlMapping(staffId, payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canMapGl(session.role)) {
        throw new Error("Only Account or Admin can map payroll GLs.");
    }

    const id = String(staffId || "").trim();
    const debitAccountId = String(payload?.debitAccountId || "").trim();
    const creditAccountId = String(payload?.creditAccountId || "").trim();

    if (!id) {
        throw new Error("Payroll staff id is required.");
    }
    if (!debitAccountId || !creditAccountId) {
        throw new Error("Select both debit and credit GL accounts.");
    }
    if (debitAccountId === creditAccountId) {
        throw new Error("Debit and credit GL accounts must be different.");
    }

    if (!supabase || session.mode !== "live") {
        const existing = await getLocalStaff();
        await saveLocalStaff(existing.map((item) => item.id === id ? {
            ...item,
            debitAccountId,
            creditAccountId
        } : item));
        return;
    }

    const { error } = await supabase
        .from("payroll_staff")
        .update({
            debit_account_id: debitAccountId,
            credit_account_id: creditAccountId
        })
        .eq("id", id)
        .eq("business_id", session.businessId);

    if (error) {
        if (isMissingTableError(error)) {
            const existing = await getLocalStaff();
            await saveLocalStaff(existing.map((item) => item.id === id ? {
                ...item,
                debitAccountId,
                creditAccountId
            } : item));
            return;
        }
        throw error;
    }
}

export async function setPayrollStaffActive(staffId, isActive) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canManageSetup(session.role)) {
        throw new Error("Only Head Office Admin can update payroll staff.");
    }

    const id = String(staffId || "").trim();
    if (!id) {
        throw new Error("Payroll staff id is required.");
    }

    if (!supabase || session.mode !== "live") {
        const existing = await getLocalStaff();
        await saveLocalStaff(existing.map((item) => item.id === id ? { ...item, isActive: Boolean(isActive) } : item));
        return;
    }

    const { error } = await supabase
        .from("payroll_staff")
        .update({ is_active: Boolean(isActive) })
        .eq("id", id)
        .eq("business_id", session.businessId);

    if (error) {
        if (isMissingTableError(error)) {
            const existing = await getLocalStaff();
            await saveLocalStaff(existing.map((item) => item.id === id ? { ...item, isActive: Boolean(isActive) } : item));
            return;
        }
        throw error;
    }
}

export async function deletePayrollStaff(staffId) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canManageSetup(session.role)) {
        throw new Error("Only Head Office Admin can delete payroll staff.");
    }

    const id = String(staffId || "").trim();
    if (!id) {
        throw new Error("Payroll staff id is required.");
    }

    if (!supabase || session.mode !== "live") {
        const existing = await getLocalStaff();
        await saveLocalStaff(existing.filter((item) => String(item.id || "").trim() !== id));
        return;
    }

    const { error } = await supabase
        .from("payroll_staff")
        .delete()
        .eq("id", id)
        .eq("business_id", session.businessId);

    if (error) {
        if (isMissingTableError(error)) {
            const existing = await getLocalStaff();
            await saveLocalStaff(existing.filter((item) => String(item.id || "").trim() !== id));
            return;
        }
        throw error;
    }
}

async function createPayrollJournalEntry({ supabase, session, postingDate, branchId, description, lines }) {
    const reference = `PAY-${String(postingDate || getTodayIso()).replaceAll("-", "")}-${String(Date.now()).slice(-6)}`;

    const { data: entry, error: entryError } = await supabase
        .from("journal_entries")
        .insert({
            business_id: session.businessId,
            branch_id: branchId || null,
            entry_date: postingDate,
            reference,
            memo: description,
            source_type: "payroll_posting",
            created_by: session.userId || null
        })
        .select("id, reference")
        .single();

    if (entryError) {
        throw entryError;
    }

    const { error: linesError } = await supabase
        .from("journal_entry_lines")
        .insert((lines || []).map((line) => ({
            journal_entry_id: entry.id,
            account_id: line.accountId,
            description: line.description || description,
            debit: Number(line.debit || 0),
            credit: Number(line.credit || 0)
        })));

    if (linesError) {
        throw linesError;
    }

    return {
        id: entry.id,
        reference: entry.reference || reference
    };
}

function getMappedPayrollLines({ staff, data }) {
    const componentMap = new Map((data.components || []).map((component) => [String(component.name || "").trim().toLowerCase(), component]));
    const structureItems = Array.isArray(data.levelStructures?.[staff.salaryLevel]) ? data.levelStructures[staff.salaryLevel] : [];
    const controlAccountId = String(data.settings?.payrollControlAccountId || "").trim();
    const controlAccountLabel = String(data.settings?.payrollControlAccountName || "").trim() || "Salary Payable";
    if (!controlAccountId) {
        throw new Error("Payroll control account has not been configured.");
    }
    const rawLines = [];

    for (const item of structureItems) {
        if (!item.isEnabled || Number(item.amount || 0) <= 0) {
            continue;
        }
        const component = componentMap.get(String(item.componentName || "").trim().toLowerCase());
        const amount = Number(item.amount || 0);
        const isDeduction = component?.type === "deduction";
        const mappedAccountId = isDeduction
            ? String(component?.creditAccountId || "").trim()
            : String(component?.debitAccountId || "").trim();
        if (!mappedAccountId) {
            throw new Error(`Payroll component "${item.componentName}" is missing GL mapping.`);
        }
        rawLines.push(
            {
                accountId: isDeduction ? controlAccountId : mappedAccountId,
                description: isDeduction
                    ? `Payroll Control - ${controlAccountLabel} - ${staff.fullName}`
                    : `${item.componentName} - ${staff.fullName}`,
                debit: amount,
                credit: 0
            },
            {
                accountId: isDeduction ? mappedAccountId : controlAccountId,
                description: isDeduction
                    ? `${item.componentName} - ${staff.fullName}`
                    : `Payroll Control - ${controlAccountLabel} - ${staff.fullName}`,
                debit: 0,
                credit: amount
            }
        );
    }

    const merged = new Map();
    for (const line of rawLines) {
        const side = Number(line.debit || 0) > 0 ? "DR" : "CR";
        const key = `${String(line.accountId || "")}::${side}::${String(line.description || "").trim()}`;
        const current = merged.get(key) || { ...line, debit: 0, credit: 0 };
        current.debit += Number(line.debit || 0);
        current.credit += Number(line.credit || 0);
        merged.set(key, current);
    }
    return Array.from(merged.values()).filter((line) => line.accountId && (line.debit > 0 || line.credit > 0));
}

export async function createPayrollRun(payload) {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!canPostPayroll(session.role)) {
        throw new Error("Only Branch Accountant or Head Office Admin can post payroll.");
    }

    const data = await getPayrollData();
    const staffId = String(payload.staffId || "").trim();
    const postingDate = String(payload.postingDate || getTodayIso()).trim();
    const postingMonth = String(payload.postingMonth || "").trim();
    const payrollMonthLabel = formatPayrollMonthLabel(postingMonth, postingDate);
    const narration = payrollMonthLabel ? `Salary - ${payrollMonthLabel}` : "Salary";
    const staff = data.staff.find((item) => item.id === staffId);

    if (!staff?.id) {
        throw new Error("Select a valid payroll staff.");
    }
    if (!staff.isActive) {
        throw new Error("Selected payroll staff is inactive.");
    }
    if (!data.activeBranch.canAccessAllBranches && String(staff.branchId || "") !== String(data.activeBranch.id || "")) {
        throw new Error("You can only post payroll for staff in your branch.");
    }

    const amount = Number(getStaffGrossSalary(data.levelStructures, staff.salaryLevel) || staff.grossSalary || 0);
    const netAmount = Number(getStaffNetSalary(data.levelStructures, staff.salaryLevel) || 0);
    const journalLines = getMappedPayrollLines({ staff, data });
    if (!journalLines.length) {
        throw new Error("This staff salary level has no mapped payroll component lines.");
    }
    if (netAmount <= 0) {
        throw new Error("Net salary must be greater than zero before posting.");
    }
    const description = payrollMonthLabel
        ? `Salary - ${payrollMonthLabel} - ${staff.fullName}`
        : `Salary - ${staff.fullName}`;
    const runPayload = {
        staffId: staff.id,
        staffName: staff.fullName,
        staffLevel: staff.salaryLevel,
        amount,
        netAmount,
        status: "approved",
        branchId: staff.branchId,
        branchName: staff.branchName,
        postingDate,
        journalEntryId: ""
    };

    if (!supabase || session.mode !== "live") {
        await postNetSalaryToOpenedAccount(staff.employeeCode, {
            amount: netAmount,
            postingDate,
            narration
        });
        await addLocalRun(runPayload);
        await recordPostedPayrollMonth(postingMonth || postingDate, staff.branchId);
        return;
    }

    const journal = await createPayrollJournalEntry({
        supabase,
        session,
        postingDate,
        branchId: staff.branchId,
        description,
        lines: journalLines
    });

    let insertResult = await supabase
        .from("payroll_runs")
        .insert({
            business_id: session.businessId,
            payroll_staff_id: staff.id,
            staff_name: staff.fullName,
            staff_level: staff.salaryLevel,
            amount,
            status: "approved",
            branch_id: staff.branchId || null,
            posting_date: postingDate,
            journal_entry_id: journal.id,
            posted_by: session.userId || null
        });

    if (insertResult.error
        && (isMissingColumnError(insertResult.error, "payroll_staff_id")
            || isMissingColumnError(insertResult.error, "branch_id")
            || isMissingColumnError(insertResult.error, "posting_date")
            || isMissingColumnError(insertResult.error, "journal_entry_id")
            || isMissingColumnError(insertResult.error, "posted_by"))) {
        insertResult = await supabase
            .from("payroll_runs")
            .insert({
                business_id: session.businessId,
                staff_name: staff.fullName,
                staff_level: staff.salaryLevel,
                amount,
                status: "approved"
            });
    }

    if (insertResult.error) {
        throw insertResult.error;
    }

    await postNetSalaryToOpenedAccount(staff.employeeCode, {
        amount: netAmount,
        postingDate,
        narration
    });
}

export async function createPayrollBatchRun(payload) {
    const staffIds = Array.isArray(payload?.staffIds)
        ? payload.staffIds.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
    const postingDate = String(payload?.postingDate || getTodayIso()).trim();
    const postingMonth = String(payload?.postingMonth || "").trim();
    const effectiveMonth = postingMonth || getMonthValue(postingDate);

    if (!staffIds.length) {
        throw new Error("There are no payroll staff to process.");
    }

    const data = await getPayrollData();
    const monthAlreadyPosted = (data.runs || []).some((run) => {
        const runMonth = getMonthValue(run?.postingDate);
        if (runMonth !== effectiveMonth) {
            return false;
        }
        if (data.activeBranch.canAccessAllBranches) {
            return true;
        }
        return String(run?.branchId || "").trim() === String(data.activeBranch.id || "").trim();
    });

    const localMonthAlreadyPosted = (data.postedMonths || []).some((item) => {
        if (String(item?.month || "").trim() !== effectiveMonth) {
            return false;
        }
        if (data.activeBranch.canAccessAllBranches) {
            return true;
        }
        return String(item?.branchId || "").trim() === String(data.activeBranch.id || "").trim();
    });

    if (monthAlreadyPosted || localMonthAlreadyPosted) {
        throw new Error("Payroll has already been posted for that month.");
    }

    for (const staffId of staffIds) {
        await createPayrollRun({ staffId, postingDate, postingMonth });
    }
}

export function getPayrollCapabilities(role) {
    return {
        canPost: canPostPayroll(role),
        canManageSetup: canManageSetup(role),
        canManageProfiles: canManageProfiles(role),
        canMapGl: canMapGl(role)
    };
}
