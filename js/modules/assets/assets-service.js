import { getCurrentSessionContext } from "../../core/session.js";
import { ROLES } from "../../core/roles.js";
import { getSupabaseClient } from "../../core/supabase-client.js";
import { getActiveBranchDetails } from "../../core/data-access.js";

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);
const ALLOWED_ASSET_ROLES = new Set([ROLES.STAFF]);

function toAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
}

function round2(value) {
    return Math.round((toAmount(value) + Number.EPSILON) * 100) / 100;
}

function isMissingTableError(error, tableName = "fixed_assets") {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return MISSING_TABLE_CODES.has(code) || message.includes(tableName) || details.includes(tableName);
}

function isMissingColumnError(error, columnName = "is_active") {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "PGRST204" || message.includes(columnName) || details.includes(columnName);
}

function toIsoDate(value) {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function monthStartIso(dateLike) {
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${year}-${month}-01`;
}

function addMonths(isoMonthStart, delta) {
    const base = new Date(`${isoMonthStart}T00:00:00Z`);
    if (Number.isNaN(base.getTime())) {
        return "";
    }
    base.setUTCMonth(base.getUTCMonth() + Number(delta || 0));
    return monthStartIso(base.toISOString());
}

function monthToken(isoMonthStart) {
    return String(isoMonthStart || "").slice(0, 7).replace("-", "");
}

async function getContext() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    const role = String(session.role || "").trim().toLowerCase();
    if (!ALLOWED_ASSET_ROLES.has(role)) {
        throw new Error("Only Operations role can manage assets.");
    }
    return { supabase, session };
}

async function resolveBranchScope(session, payloadBranchId) {
    const explicitBranchId = String(payloadBranchId || "").trim();
    if (explicitBranchId) {
        return explicitBranchId;
    }
    const activeBranch = await getActiveBranchDetails(session.userId, session.businessId);
    return String(activeBranch?.id || "").trim() || null;
}

export async function getAssetSetupData() {
    const { supabase, session } = await getContext();

    const [accountsResult, branchesResult, activeBranch] = await Promise.all([
        supabase
            .from("chart_of_accounts")
            .select("id, code, name, account_type, is_active")
            .eq("business_id", session.businessId)
            .eq("is_active", true)
            .order("code", { ascending: true }),
        supabase
            .from("branches")
            .select("id, name, is_head_office, is_active")
            .eq("business_id", session.businessId)
            .order("name", { ascending: true }),
        getActiveBranchDetails(session.userId, session.businessId)
    ]);

    if (accountsResult.error) {
        throw accountsResult.error;
    }
    if (branchesResult.error) {
        throw branchesResult.error;
    }

    return {
        accounts: (accountsResult.data || []).map((account) => ({
            id: account.id,
            code: account.code || "",
            name: account.name || "",
            type: String(account.account_type || "").trim().toLowerCase()
        })),
        branches: (branchesResult.data || [])
            .filter((branch) => branch.is_active !== false || branch.is_head_office)
            .map((branch) => ({
                id: branch.id,
                name: branch.name || "",
                isHeadOffice: Boolean(branch.is_head_office)
            })),
        activeBranch: {
            id: String(activeBranch?.id || "").trim(),
            name: String(activeBranch?.name || "Active Branch").trim() || "Active Branch"
        }
    };
}

export async function getAssets(options = {}) {
    const { supabase, session } = await getContext();
    const branchId = String(options?.branchId || "").trim();

    const baseSelect = `
        id,
        branch_id,
        asset_name,
        acquisition_date,
        capitalization_amount,
        useful_life_months,
        depreciation_method,
        monthly_charge,
        salvage_value,
        capitalization_account_id,
        offset_account_id,
        expense_account_id,
        contra_account_id,
        is_active,
        created_at,
        branches (
            name
        ),
        chart_of_accounts!fixed_assets_capitalization_account_id_fkey (
            code,
            name
        )
    `;

    let request = supabase
        .from("fixed_assets")
        .select(baseSelect)
        .eq("business_id", session.businessId)
        .order("created_at", { ascending: false });

    if (branchId) {
        request = request.eq("branch_id", branchId);
    }

    let { data, error } = await request;
    if (error && isMissingColumnError(error, "is_active")) {
        let fallback = supabase
            .from("fixed_assets")
            .select(baseSelect.replace(",\n        is_active", ""))
            .eq("business_id", session.businessId)
            .order("created_at", { ascending: false });
        if (branchId) {
            fallback = fallback.eq("branch_id", branchId);
        }
        const retry = await fallback;
        data = (retry.data || []).map((item) => ({ ...item, is_active: true }));
        error = retry.error;
    }
    if (error) {
        if (isMissingTableError(error, "fixed_assets")) {
            throw new Error("Asset tables are not set up yet. Run sql/add-asset-management.sql first.");
        }
        throw error;
    }

    const assetIds = (data || []).map((asset) => String(asset.id || "")).filter(Boolean);
    let disposalMap = new Map();
    let runCountMap = new Map();
    if (assetIds.length) {
        const { data: disposals, error: disposalError } = await supabase
            .from("asset_disposals")
            .select("asset_id, disposal_date, journal_entry_id, proceeds_amount")
            .eq("business_id", session.businessId)
            .in("asset_id", assetIds);
        if (!disposalError && Array.isArray(disposals)) {
            disposalMap = new Map(
                disposals.map((item) => [String(item.asset_id || ""), item])
            );
        }

        const { data: runs, error: runsError } = await supabase
            .from("asset_depreciation_runs")
            .select("asset_id")
            .eq("business_id", session.businessId)
            .in("asset_id", assetIds);
        if (!runsError && Array.isArray(runs)) {
            runCountMap = runs.reduce((map, row) => {
                const key = String(row.asset_id || "");
                const current = Number(map.get(key) || 0);
                map.set(key, current + 1);
                return map;
            }, new Map());
        }
    }

    return (data || []).map((asset) => ({
        ...(() => {
            const disposal = disposalMap.get(String(asset.id || ""));
            const isDisposed = Boolean(disposal?.asset_id);
            const postedRuns = Math.max(0, Number(runCountMap.get(String(asset.id || "")) || 0));
            const usefulLifeMonths = Math.max(1, Number(asset.useful_life_months || 0));
            const amount = toAmount(asset.capitalization_amount);
            const salvage = toAmount(asset.salvage_value);
            const base = round2(Math.max(amount - salvage, 0));
            const monthly = round2(asset.monthly_charge || (base / usefulLifeMonths));
            const accumulated = round2(Math.min(base, monthly * postedRuns));
            const netBookValue = round2(Math.max(amount - accumulated, 0));
            const endDate = (() => {
                const start = monthStartIso(asset.acquisition_date || "");
                if (!start) return "";
                return addMonths(start, usefulLifeMonths - 1);
            })();
            return {
                status: isDisposed ? "Disposed" : (asset.is_active !== false ? "Active" : "Paused"),
                disposalDate: disposal?.disposal_date || "",
                disposalJournalEntryId: disposal?.journal_entry_id || "",
                disposalProceeds: toAmount(disposal?.proceeds_amount),
                postedRunCount: postedRuns,
                accumulatedDepreciation: accumulated,
                netBookValue,
                depreciationEndDate: endDate
            };
        })(),
        id: asset.id,
        branchId: asset.branch_id || "",
        branchName: asset.branches?.name || "Head Office",
        name: asset.asset_name || "",
        acquisitionDate: asset.acquisition_date || "",
        amount: toAmount(asset.capitalization_amount),
        usefulLifeMonths: Number(asset.useful_life_months || 0),
        method: String(asset.depreciation_method || "").trim().toLowerCase(),
        monthlyCharge: toAmount(asset.monthly_charge),
        salvageValue: toAmount(asset.salvage_value),
        capitalizationAccountId: asset.capitalization_account_id || "",
        offsetAccountId: asset.offset_account_id || "",
        expenseAccountId: asset.expense_account_id || "",
        contraAccountId: asset.contra_account_id || "",
        capitalizationAccountLabel: asset.chart_of_accounts
            ? `${asset.chart_of_accounts.code || ""} - ${asset.chart_of_accounts.name || ""}`.trim()
            : "-",
        isActive: asset.is_active !== false,
        createdAt: asset.created_at || ""
    }));
}

export async function createAssetWithCapitalization(payload) {
    const { supabase, session } = await getContext();

    const assetName = String(payload?.asset_name || "").trim();
    const acquisitionDate = toIsoDate(payload?.acquisition_date);
    const method = String(payload?.depreciation_method || "").trim().toLowerCase();
    const capitalizationAccountId = String(payload?.capitalization_account_id || "").trim();
    const offsetAccountId = String(payload?.offset_account_id || "").trim();
    const expenseAccountId = String(payload?.expense_account_id || "").trim();
    const contraAccountId = String(payload?.contra_account_id || "").trim();
    const usefulLifeMonths = Math.max(1, Number(payload?.useful_life_months || 0));
    const amount = round2(payload?.capitalization_amount);
    const salvageValue = round2(payload?.salvage_value);
    const branchId = await resolveBranchScope(session, payload?.branch_id);

    if (!assetName) {
        throw new Error("Asset name is required.");
    }
    if (!acquisitionDate) {
        throw new Error("Acquisition date is required.");
    }
    if (!["depreciation", "amortization"].includes(method)) {
        throw new Error("Pick either depreciation or amortization.");
    }
    if (!capitalizationAccountId || !offsetAccountId || !expenseAccountId || !contraAccountId) {
        throw new Error("Select all required GL accounts.");
    }
    if (amount <= 0) {
        throw new Error("Capitalization amount must be greater than zero.");
    }
    if (salvageValue < 0 || salvageValue >= amount) {
        throw new Error("Salvage value must be zero or less than capitalization amount.");
    }

    const depreciableBase = round2(amount - salvageValue);
    const monthlyCharge = round2(depreciableBase / usefulLifeMonths);
    const capRef = `FA-CAP-${monthToken(monthStartIso(acquisitionDate))}-${Date.now().toString().slice(-6)}`;

    const { data: capEntry, error: capEntryError } = await supabase
        .from("journal_entries")
        .insert({
            business_id: session.businessId,
            branch_id: branchId,
            entry_date: acquisitionDate,
            reference: capRef,
            memo: `Asset capitalization: ${assetName}`,
            source_type: "asset_capitalization",
            created_by: session.userId || null
        })
        .select("id, reference")
        .single();

    if (capEntryError) {
        throw capEntryError;
    }

    const capLines = [
        {
            journal_entry_id: capEntry.id,
            account_id: capitalizationAccountId,
            description: `Asset capitalization: ${assetName}`,
            debit: amount,
            credit: 0
        },
        {
            journal_entry_id: capEntry.id,
            account_id: offsetAccountId,
            description: `Asset capitalization offset: ${assetName}`,
            debit: 0,
            credit: amount
        }
    ];

    const { error: capLinesError } = await supabase
        .from("journal_entry_lines")
        .insert(capLines);

    if (capLinesError) {
        throw capLinesError;
    }

    const { data: createdAsset, error: assetError } = await supabase
        .from("fixed_assets")
        .insert({
            business_id: session.businessId,
            branch_id: branchId,
            asset_name: assetName,
            acquisition_date: acquisitionDate,
            capitalization_amount: amount,
            useful_life_months: usefulLifeMonths,
            depreciation_method: method,
            monthly_charge: monthlyCharge,
            salvage_value: salvageValue,
            capitalization_account_id: capitalizationAccountId,
            offset_account_id: offsetAccountId,
            expense_account_id: expenseAccountId,
            contra_account_id: contraAccountId,
            is_active: true,
            created_by: session.userId || null
        })
        .select("id")
        .single();

    if (assetError) {
        if (isMissingTableError(assetError, "fixed_assets")) {
            throw new Error("Asset tables are not set up yet. Run sql/add-asset-management.sql first.");
        }
        throw assetError;
    }

    return {
        assetId: createdAsset.id,
        capitalizationReference: capEntry.reference || capRef
    };
}

export async function runMonthlyAssetCharge(options = {}) {
    const { supabase, session } = await getContext();
    const scopedBranchId = String(options?.branchId || "").trim();
    const today = new Date();
    const currentMonth = monthStartIso(today.toISOString());

    let assetRequest = supabase
        .from("fixed_assets")
        .select("id, asset_name, branch_id, acquisition_date, useful_life_months, depreciation_method, monthly_charge, capitalization_amount, salvage_value, expense_account_id, contra_account_id, is_active")
        .eq("business_id", session.businessId)
        .eq("is_active", true);

    if (scopedBranchId) {
        assetRequest = assetRequest.eq("branch_id", scopedBranchId);
    }

    const { data: assets, error: assetsError } = await assetRequest;
    if (assetsError) {
        if (isMissingTableError(assetsError, "fixed_assets")) {
            throw new Error("Asset tables are not set up yet. Run sql/add-asset-management.sql first.");
        }
        throw assetsError;
    }

    if (!assets?.length) {
        return { posted: 0, references: [] };
    }

    const assetIds = assets.map((asset) => asset.id);
    const { data: runs, error: runsError } = await supabase
        .from("asset_depreciation_runs")
        .select("asset_id, period_month")
        .in("asset_id", assetIds);

    if (runsError) {
        if (isMissingTableError(runsError, "asset_depreciation_runs")) {
            throw new Error("Asset depreciation table is not set up yet. Run sql/add-asset-management.sql first.");
        }
        throw runsError;
    }

    const postedMap = new Map();
    (runs || []).forEach((run) => {
        const key = String(run.asset_id || "");
        const list = postedMap.get(key) || [];
        list.push(String(run.period_month || ""));
        postedMap.set(key, list);
    });

    let posted = 0;
    const references = [];

    for (const asset of assets) {
        const assetId = String(asset.id || "");
        const startMonth = monthStartIso(asset.acquisition_date || "");
        if (!assetId || !startMonth) {
            continue;
        }

        const lifeMonths = Math.max(1, Number(asset.useful_life_months || 0));
        const alreadyPosted = new Set(postedMap.get(assetId) || []);
        const method = String(asset.depreciation_method || "depreciation").toLowerCase();
        const amount = round2(asset.capitalization_amount);
        const salvage = round2(asset.salvage_value);
        const depreciableBase = round2(Math.max(amount - salvage, 0));
        const monthly = round2(asset.monthly_charge || (depreciableBase / lifeMonths));
        const expenseAccountId = String(asset.expense_account_id || "").trim();
        const contraAccountId = String(asset.contra_account_id || "").trim();
        if (!expenseAccountId || !contraAccountId) {
            continue;
        }

        for (let index = 0; index < lifeMonths; index += 1) {
            const periodMonth = addMonths(startMonth, index);
            if (!periodMonth || periodMonth > currentMonth) {
                break;
            }
            if (alreadyPosted.has(periodMonth)) {
                continue;
            }

            const isLast = index === lifeMonths - 1;
            const chargeAmount = isLast
                ? round2(depreciableBase - round2(monthly * (lifeMonths - 1)))
                : monthly;
            if (chargeAmount <= 0) {
                continue;
            }

            const periodToken = monthToken(periodMonth);
            const chargeRef = `FA-${method === "amortization" ? "AM" : "DP"}-${periodToken}-${assetId.slice(0, 6)}`;
            const methodLabel = method === "amortization" ? "Amortization" : "Depreciation";
            const memo = `${methodLabel} of "${asset.asset_name || "Asset"}" for ${periodMonth.slice(0, 7)}`;

            const { data: entry, error: entryError } = await supabase
                .from("journal_entries")
                .insert({
                    business_id: session.businessId,
                    branch_id: asset.branch_id || null,
                    entry_date: periodMonth,
                    reference: chargeRef,
                    memo,
                    source_type: method === "amortization" ? "asset_amortization" : "asset_depreciation",
                    source_id: assetId,
                    created_by: session.userId || null
                })
                .select("id, reference")
                .single();

            if (entryError) {
                throw entryError;
            }

            const { error: linesError } = await supabase
                .from("journal_entry_lines")
                .insert([
                    {
                        journal_entry_id: entry.id,
                        account_id: expenseAccountId,
                        description: memo,
                        debit: chargeAmount,
                        credit: 0
                    },
                    {
                        journal_entry_id: entry.id,
                        account_id: contraAccountId,
                        description: memo,
                        debit: 0,
                        credit: chargeAmount
                    }
                ]);

            if (linesError) {
                throw linesError;
            }

            const { error: runInsertError } = await supabase
                .from("asset_depreciation_runs")
                .insert({
                    business_id: session.businessId,
                    asset_id: assetId,
                    period_month: periodMonth,
                    journal_entry_id: entry.id
                });

            if (runInsertError) {
                throw runInsertError;
            }

            posted += 1;
            references.push(entry.reference || chargeRef);
            alreadyPosted.add(periodMonth);
        }
    }

    return { posted, references };
}

function getIsoToday() {
    const now = new Date();
    if (Number.isNaN(now.getTime())) {
        return "";
    }
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export async function disposeAsset(payload) {
    const { supabase, session } = await getContext();
    const assetId = String(payload?.asset_id || "").trim();
    const disposalDate = toIsoDate(payload?.disposal_date) || getIsoToday();
    const proceedsAmount = round2(payload?.proceeds_amount);
    const proceedsAccountId = String(payload?.proceeds_account_id || "").trim();
    const gainLossAccountId = String(payload?.gain_loss_account_id || "").trim();

    if (!assetId) {
        throw new Error("Select an asset to dispose.");
    }
    if (!disposalDate) {
        throw new Error("Disposal date is required.");
    }
    if (proceedsAmount < 0) {
        throw new Error("Proceeds cannot be negative.");
    }
    if (!proceedsAccountId || !gainLossAccountId) {
        throw new Error("Select proceeds and gain/loss GL accounts.");
    }

    const { data: existingDisposal, error: existingDisposalError } = await supabase
        .from("asset_disposals")
        .select("id")
        .eq("business_id", session.businessId)
        .eq("asset_id", assetId)
        .limit(1)
        .maybeSingle();

    if (existingDisposalError && !isMissingTableError(existingDisposalError, "asset_disposals")) {
        throw existingDisposalError;
    }
    if (existingDisposal?.id) {
        throw new Error("This asset has already been disposed.");
    }

    const { data: asset, error: assetError } = await supabase
        .from("fixed_assets")
        .select("id, asset_name, branch_id, capitalization_amount, useful_life_months, monthly_charge, salvage_value, capitalization_account_id, contra_account_id")
        .eq("business_id", session.businessId)
        .eq("id", assetId)
        .maybeSingle();

    if (assetError) {
        throw assetError;
    }
    if (!asset) {
        throw new Error("Asset was not found.");
    }

    const { data: runs, error: runsError } = await supabase
        .from("asset_depreciation_runs")
        .select("period_month")
        .eq("business_id", session.businessId)
        .eq("asset_id", assetId);

    if (runsError && !isMissingTableError(runsError, "asset_depreciation_runs")) {
        throw runsError;
    }

    const lifeMonths = Math.max(1, Number(asset.useful_life_months || 0));
    const depreciationBase = round2(Math.max(toAmount(asset.capitalization_amount) - toAmount(asset.salvage_value), 0));
    const postedRunCount = Math.min((runs || []).length, lifeMonths);
    const monthlyCharge = round2(asset.monthly_charge || (depreciationBase / lifeMonths));
    const accumulated = round2(Math.min(monthlyCharge * postedRunCount, depreciationBase));
    const carryingValue = round2(toAmount(asset.capitalization_amount) - accumulated);

    const disposalRef = `FA-DSP-${monthToken(monthStartIso(disposalDate))}-${Date.now().toString().slice(-6)}`;
    const memo = `Asset disposal: ${asset.asset_name || "Asset"}`;

    const { data: entry, error: entryError } = await supabase
        .from("journal_entries")
        .insert({
            business_id: session.businessId,
            branch_id: asset.branch_id || null,
            entry_date: disposalDate,
            reference: disposalRef,
            memo,
            source_type: "asset_disposal",
            source_id: assetId,
            created_by: session.userId || null
        })
        .select("id, reference")
        .single();

    if (entryError) {
        throw entryError;
    }

    const lines = [
        {
            journal_entry_id: entry.id,
            account_id: asset.contra_account_id,
            description: `${memo} - reverse accumulated`,
            debit: accumulated,
            credit: 0
        },
        {
            journal_entry_id: entry.id,
            account_id: proceedsAccountId,
            description: `${memo} - proceeds`,
            debit: proceedsAmount,
            credit: 0
        },
        {
            journal_entry_id: entry.id,
            account_id: asset.capitalization_account_id,
            description: `${memo} - remove asset cost`,
            debit: 0,
            credit: toAmount(asset.capitalization_amount)
        }
    ];

    const debitTotal = round2(accumulated + proceedsAmount);
    const creditTotal = round2(toAmount(asset.capitalization_amount));
    const difference = round2(Math.abs(debitTotal - creditTotal));
    if (difference > 0) {
        if (debitTotal > creditTotal) {
            lines.push({
                journal_entry_id: entry.id,
                account_id: gainLossAccountId,
                description: `${memo} - gain on disposal`,
                debit: 0,
                credit: difference
            });
        } else {
            lines.push({
                journal_entry_id: entry.id,
                account_id: gainLossAccountId,
                description: `${memo} - loss on disposal`,
                debit: difference,
                credit: 0
            });
        }
    }

    const { error: linesError } = await supabase
        .from("journal_entry_lines")
        .insert(lines);

    if (linesError) {
        throw linesError;
    }

    const { error: disposalError } = await supabase
        .from("asset_disposals")
        .insert({
            business_id: session.businessId,
            asset_id: assetId,
            disposal_date: disposalDate,
            proceeds_amount: proceedsAmount,
            journal_entry_id: entry.id
        });

    if (disposalError) {
        if (isMissingTableError(disposalError, "asset_disposals")) {
            throw new Error("Asset disposal table is not set up yet. Run sql/add-asset-management.sql.");
        }
        throw disposalError;
    }

    const { error: deactivateError } = await supabase
        .from("fixed_assets")
        .update({ is_active: false })
        .eq("business_id", session.businessId)
        .eq("id", assetId);

    if (deactivateError && !isMissingColumnError(deactivateError, "is_active")) {
        throw deactivateError;
    }

    return {
        reference: entry.reference || disposalRef,
        carryingValue,
        accumulated,
        proceedsAmount
    };
}

export async function updateAsset(assetId, payload) {
    const { supabase, session } = await getContext();
    const id = String(assetId || "").trim();
    if (!id) {
        throw new Error("Asset id is required.");
    }

    const { data: existingDisposal } = await supabase
        .from("asset_disposals")
        .select("id")
        .eq("business_id", session.businessId)
        .eq("asset_id", id)
        .limit(1)
        .maybeSingle();
    if (existingDisposal?.id) {
        throw new Error("Disposed asset cannot be edited.");
    }

    const assetName = String(payload?.asset_name || "").trim();
    const method = String(payload?.depreciation_method || "").trim().toLowerCase();
    const usefulLifeMonths = Math.max(1, Number(payload?.useful_life_months || 0));
    const salvageValue = round2(payload?.salvage_value);
    const amount = round2(payload?.capitalization_amount);

    if (!assetName) {
        throw new Error("Asset name is required.");
    }
    if (!["depreciation", "amortization"].includes(method)) {
        throw new Error("Pick either depreciation or amortization.");
    }
    if (amount <= 0) {
        throw new Error("Capitalization amount must be greater than zero.");
    }
    if (salvageValue < 0 || salvageValue >= amount) {
        throw new Error("Salvage value must be zero or less than capitalization amount.");
    }

    const base = round2(amount - salvageValue);
    const monthlyCharge = round2(base / usefulLifeMonths);

    const { error } = await supabase
        .from("fixed_assets")
        .update({
            asset_name: assetName,
            depreciation_method: method,
            useful_life_months: usefulLifeMonths,
            salvage_value: salvageValue,
            monthly_charge: monthlyCharge
        })
        .eq("business_id", session.businessId)
        .eq("id", id);

    if (error) {
        throw error;
    }

    return true;
}
