import { getCurrentSessionContext } from "../../core/session.js";
import { getSupabaseClient } from "../../core/supabase-client.js";
import { getActiveBranchDetails } from "../../core/data-access.js";

const ALLOWED_ROLES = new Set(["staff", "manager", "business_admin"]);

function toAmount(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? amount : 0;
}

function toDateToken(value) {
    const source = String(value || "").trim();
    if (!source) {
        return "";
    }
    const compact = source.replaceAll("-", "");
    return compact.length === 8 ? compact : "";
}

function padNumber(value, size = 2) {
    return String(value).padStart(size, "0");
}

function generateAutoReference(entryDate = "") {
    const dateToken = toDateToken(entryDate) || (() => {
        const now = new Date();
        if (Number.isNaN(now.getTime())) {
            return "00000000";
        }
        return `${now.getUTCFullYear()}${padNumber(now.getUTCMonth() + 1)}${padNumber(now.getUTCDate())}`;
    })();

    const now = new Date();
    const timeToken = Number.isNaN(now.getTime())
        ? `${Date.now()}`
        : `${padNumber(now.getUTCHours())}${padNumber(now.getUTCMinutes())}${padNumber(now.getUTCSeconds())}`;

    return `JV-${dateToken}-${timeToken}`;
}

async function getContext() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    if (!supabase || !session?.businessId) {
        throw new Error("Business context is unavailable.");
    }
    if (!ALLOWED_ROLES.has(String(session.role || "").toLowerCase())) {
        throw new Error("You do not have access to post journal entries.");
    }
    return { supabase, session };
}

export async function getPostingSetupData() {
    const { supabase, session } = await getContext();

    const [accountsResult, activeBranch] = await Promise.all([
        supabase
            .from("chart_of_accounts")
            .select("id, code, name, is_active, parent_account_id")
            .eq("business_id", session.businessId)
            .eq("is_active", true)
            .order("code", { ascending: true }),
        getActiveBranchDetails(session.userId, session.businessId)
    ]);

    if (accountsResult.error) {
        throw accountsResult.error;
    }
    const allAccounts = accountsResult.data || [];
    const parentIds = new Set(
        allAccounts
            .map((account) => String(account.parent_account_id || "").trim())
            .filter(Boolean)
    );

    const accounts = allAccounts
        .filter((account) => !parentIds.has(String(account.id || "")))
        .map((account) => ({
            id: account.id,
            code: account.code || "",
            name: account.name || ""
        }));

    return { accounts, activeBranch };
}

export async function getRecentJournalPostings(limit = 10) {
    const { supabase, session } = await getContext();
    const safeLimit = Math.max(1, Math.min(Number(limit || 10), 30));

    const { data, error } = await supabase
        .from("journal_entries")
        .select(`
            id,
            entry_date,
            reference,
            memo,
            created_at,
            branches (
                name
            ),
            journal_entry_lines (
                debit,
                credit
            )
        `)
        .eq("business_id", session.businessId)
        .order("created_at", { ascending: false })
        .limit(safeLimit);

    if (error) {
        throw error;
    }

    return (data || []).map((entry) => {
        const lines = entry.journal_entry_lines || [];
        const totalDebit = lines.reduce((sum, line) => sum + toAmount(line.debit), 0);
        const totalCredit = lines.reduce((sum, line) => sum + toAmount(line.credit), 0);

        return {
            id: entry.id,
            entryDate: entry.entry_date || "",
            reference: entry.reference || "-",
            description: entry.memo || "-",
            branchName: entry.branches?.name || "-",
            totalDebit,
            totalCredit,
            createdAt: entry.created_at || ""
        };
    });
}

export async function createJournalPosting(payload) {
    const { supabase, session } = await getContext();

    const entryDate = String(payload.entry_date || "").trim();
    const description = String(payload.description ?? payload.memo ?? "").trim() || null;
    const reference = String(payload.reference || "").trim() || generateAutoReference(entryDate);
    const fallbackBranch = await getActiveBranchDetails(session.userId, session.businessId);
    const branchId = String(payload.branch_id || "").trim() || fallbackBranch.id || null;
    const debitAccountId = String(payload.debit_account_id || "").trim();
    const creditAccountId = String(payload.credit_account_id || "").trim();
    const amount = toAmount(payload.amount);

    if (!entryDate) {
        throw new Error("Posting date is required.");
    }
    if (!debitAccountId || !creditAccountId) {
        throw new Error("Select both debit and credit accounts.");
    }
    if (debitAccountId === creditAccountId) {
        throw new Error("Debit and credit accounts must be different.");
    }
    if (amount <= 0) {
        throw new Error("Enter a valid posting amount.");
    }

    const { data: entry, error: entryError } = await supabase
        .from("journal_entries")
        .insert({
            business_id: session.businessId,
            branch_id: branchId,
            entry_date: entryDate,
            reference,
            memo: description,
            source_type: "manual_posting",
            created_by: session.userId || null
        })
        .select("id, reference")
        .single();

    if (entryError) {
        throw entryError;
    }

    const linesPayload = [
        {
            journal_entry_id: entry.id,
            account_id: debitAccountId,
            description,
            debit: amount,
            credit: 0
        },
        {
            journal_entry_id: entry.id,
            account_id: creditAccountId,
            description,
            debit: 0,
            credit: amount
        }
    ];

    const { error: linesError } = await supabase
        .from("journal_entry_lines")
        .insert(linesPayload);

    if (linesError) {
        throw linesError;
    }

    return {
        id: entry.id,
        reference: entry.reference || reference
    };
}

function getTodayIso() {
    const now = new Date();
    if (Number.isNaN(now.getTime())) {
        return "";
    }
    return `${now.getUTCFullYear()}-${padNumber(now.getUTCMonth() + 1)}-${padNumber(now.getUTCDate())}`;
}

function generateReversalReference(entryDate = "") {
    const dateToken = toDateToken(entryDate) || toDateToken(getTodayIso()) || "00000000";
    const now = new Date();
    const timeToken = Number.isNaN(now.getTime())
        ? `${Date.now()}`
        : `${padNumber(now.getUTCHours())}${padNumber(now.getUTCMinutes())}${padNumber(now.getUTCSeconds())}`;
    return `RV-${dateToken}-${timeToken}`;
}

function mapEntryLines(lines) {
    return (lines || []).map((line) => ({
        id: line.id,
        accountId: line.account_id || "",
        accountCode: line.chart_of_accounts?.code || "-",
        accountName: line.chart_of_accounts?.name || "Unknown account",
        description: line.description || "-",
        debit: toAmount(line.debit),
        credit: toAmount(line.credit)
    }));
}

function escapeLikeValue(value) {
    return String(value || "").replace(/[%_]/g, "\\$&");
}

export async function getJournalEntryByReference(reference) {
    const { supabase, session } = await getContext();
    const normalizedReference = String(reference || "").trim();
    if (!normalizedReference) {
        throw new Error("Reference number is required.");
    }

    const { data: entry, error } = await supabase
        .from("journal_entries")
        .select(`
            id,
            entry_date,
            reference,
            memo,
            created_at,
            branch_id,
            branches (
                name
            ),
            journal_entry_lines (
                id,
                account_id,
                description,
                debit,
                credit,
                chart_of_accounts (
                    code,
                    name
                )
            )
        `)
        .eq("business_id", session.businessId)
        .ilike("reference", normalizedReference)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }
    if (!entry) {
        throw new Error("No journal entry found for this reference.");
    }
    if (String(entry.source_type || "").trim().toLowerCase() === "reversal_posting") {
        throw new Error("Reference number has been reversed earlier.");
    }

    const { data: existingReversal, error: existingReversalError } = await supabase
        .from("journal_entries")
        .select("id")
        .eq("business_id", session.businessId)
        .eq("source_type", "reversal_posting")
        .eq("source_id", entry.id)
        .limit(1)
        .maybeSingle();

    if (existingReversalError) {
        throw existingReversalError;
    }
    if (existingReversal?.id) {
        throw new Error("Reference number has been reversed earlier.");
    }

    const sourceReference = String(entry.reference || "").trim();
    if (sourceReference) {
        const quotedMemoPattern = `%Reversal of "${escapeLikeValue(sourceReference)}"%`;
        const unquotedMemoPattern = `%Reversal of ${escapeLikeValue(sourceReference)}%`;

        const { data: legacyQuoted, error: legacyQuotedError } = await supabase
            .from("journal_entries")
            .select("id")
            .eq("business_id", session.businessId)
            .eq("source_type", "reversal_posting")
            .ilike("memo", quotedMemoPattern)
            .limit(1)
            .maybeSingle();

        if (legacyQuotedError) {
            throw legacyQuotedError;
        }
        if (legacyQuoted?.id) {
            throw new Error("Reference number has been reversed earlier.");
        }

        const { data: legacyUnquoted, error: legacyUnquotedError } = await supabase
            .from("journal_entries")
            .select("id")
            .eq("business_id", session.businessId)
            .eq("source_type", "reversal_posting")
            .ilike("memo", unquotedMemoPattern)
            .limit(1)
            .maybeSingle();

        if (legacyUnquotedError) {
            throw legacyUnquotedError;
        }
        if (legacyUnquoted?.id) {
            throw new Error("Reference number has been reversed earlier.");
        }
    }

    return {
        id: entry.id,
        branchId: entry.branch_id || "",
        branchName: entry.branches?.name || "-",
        entryDate: entry.entry_date || "",
        reference: entry.reference || "-",
        description: entry.memo || "-",
        createdAt: entry.created_at || "",
        lines: mapEntryLines(entry.journal_entry_lines)
    };
}

export async function createJournalReversalPosting(payload) {
    const { supabase, session } = await getContext();
    const entryId = String(payload?.entry_id || "").trim();
    if (!entryId) {
        throw new Error("Original journal entry is required.");
    }

    const { data: sourceEntry, error: sourceError } = await supabase
        .from("journal_entries")
        .select(`
            id,
            entry_date,
            reference,
            source_type,
            memo,
            branch_id,
            journal_entry_lines (
                id,
                account_id,
                description,
                debit,
                credit
            )
        `)
        .eq("business_id", session.businessId)
        .eq("id", entryId)
        .maybeSingle();

    if (sourceError) {
        throw sourceError;
    }
    if (!sourceEntry) {
        throw new Error("Source journal entry was not found.");
    }
    if (String(sourceEntry.source_type || "").trim().toLowerCase() === "reversal_posting") {
        throw new Error("Reversal of a reversal entry is not allowed.");
    }

    const sourceLines = sourceEntry.journal_entry_lines || [];
    if (!sourceLines.length) {
        throw new Error("Source entry has no lines to reverse.");
    }

    const entryDate = String(payload?.entry_date || "").trim() || getTodayIso();
    const reference = String(payload?.reference || "").trim() || generateReversalReference(entryDate);
    const sourceReference = String(sourceEntry.reference || "").trim();
    const reversalDescription = String(payload?.description || "").trim()
        || `Reversal of "${sourceReference || "journal entry"}"`;

    {
        const { data: existingBySourceId, error: existingBySourceIdError } = await supabase
            .from("journal_entries")
            .select("id")
            .eq("business_id", session.businessId)
            .eq("source_type", "reversal_posting")
            .eq("source_id", sourceEntry.id)
            .limit(1)
            .maybeSingle();

        if (existingBySourceIdError) {
            throw existingBySourceIdError;
        }
        if (existingBySourceId?.id) {
            throw new Error(`Reference "${sourceReference || sourceEntry.id}" has already been reversed.`);
        }
    }

    if (sourceReference) {
        const { data: existingLegacy, error: existingLegacyError } = await supabase
            .from("journal_entries")
            .select("id")
            .eq("business_id", session.businessId)
            .eq("source_type", "reversal_posting")
            .eq("memo", `Reversal of "${sourceReference}"`)
            .limit(1)
            .maybeSingle();

        if (existingLegacyError) {
            throw existingLegacyError;
        }
        if (existingLegacy?.id) {
            throw new Error(`Reference "${sourceReference}" has already been reversed.`);
        }
    }

    const { data: reversalEntry, error: reversalEntryError } = await supabase
        .from("journal_entries")
        .insert({
            business_id: session.businessId,
            branch_id: sourceEntry.branch_id || null,
            entry_date: entryDate,
            reference,
            memo: reversalDescription,
            source_type: "reversal_posting",
            source_id: sourceEntry.id,
            created_by: session.userId || null
        })
        .select("id, reference")
        .single();

    if (reversalEntryError) {
        throw reversalEntryError;
    }

    const reversedLines = sourceLines.map((line) => ({
        journal_entry_id: reversalEntry.id,
        account_id: line.account_id,
        description: reversalDescription,
        debit: toAmount(line.credit),
        credit: toAmount(line.debit)
    }));

    const { error: linesError } = await supabase
        .from("journal_entry_lines")
        .insert(reversedLines);

    if (linesError) {
        throw linesError;
    }

    return {
        id: reversalEntry.id,
        reference: reversalEntry.reference || reference
    };
}

export async function getJournalEntryDetailsById(entryId) {
    const { supabase, session } = await getContext();
    const normalizedEntryId = String(entryId || "").trim();
    if (!normalizedEntryId) {
        throw new Error("Entry id is required.");
    }

    const { data: entry, error } = await supabase
        .from("journal_entries")
        .select(`
            id,
            entry_date,
            reference,
            memo,
            created_at,
            source_type,
            branch_id,
            branches (
                name
            ),
            journal_entry_lines (
                id,
                account_id,
                description,
                debit,
                credit,
                chart_of_accounts (
                    code,
                    name
                )
            )
        `)
        .eq("business_id", session.businessId)
        .eq("id", normalizedEntryId)
        .maybeSingle();

    if (error) {
        throw error;
    }
    if (!entry) {
        throw new Error("Journal entry was not found.");
    }

    return {
        id: entry.id,
        branchId: entry.branch_id || "",
        branchName: entry.branches?.name || "-",
        entryDate: entry.entry_date || "",
        reference: entry.reference || "-",
        sourceType: String(entry.source_type || "").trim(),
        description: entry.memo || "-",
        createdAt: entry.created_at || "",
        lines: mapEntryLines(entry.journal_entry_lines)
    };
}
