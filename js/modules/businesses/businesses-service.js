import { getSupabaseClient } from "../../core/supabase-client.js";

function slugify(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "business";
}

function addMonths(date, months) {
    const next = new Date(date.getTime());
    next.setMonth(next.getMonth() + months);
    return next;
}

function resolveBillingMonths(billingCycle, billingMonths) {
    const normalizedCycle = String(billingCycle || "monthly").trim().toLowerCase();

    if (normalizedCycle === "custom") {
        return Number(billingMonths || 0);
    }

    return {
        monthly: 1,
        quarterly: 3,
        yearly: 12
    }[normalizedCycle] || 1;
}

function resolveSubscriptionEndsAt(status, billingCycle, billingMonths) {
    const normalizedStatus = String(status || "active").trim().toLowerCase();
    if (normalizedStatus !== "active") {
        return new Date().toISOString();
    }

    const months = resolveBillingMonths(billingCycle, billingMonths);
    if (!Number.isFinite(months) || months <= 0) {
        throw new Error("Please enter a valid total months value for the selected period.");
    }

    return addMonths(new Date(), months).toISOString();
}

function parseDate(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isMissingColumnError(error, columnName) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "PGRST204" || message.includes(columnName) || details.includes(columnName);
}

function normalizeMaxBranches(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    const rounded = Math.floor(parsed);
    if (rounded <= 0) {
        return null;
    }

    return rounded;
}

function toBranchSequence(code) {
    const text = String(code || "").trim().toUpperCase();
    const match = text.match(/(\d+)$/);
    if (!match) {
        return 0;
    }
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatBranchCode(sequence) {
    return `BR-${String(sequence).padStart(3, "0")}`;
}

async function ensureHeadOfficeBranch(supabase, businessId) {
    let { data: branches, error } = await supabase
        .from("branches")
        .select("id, name, code, is_head_office")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true });

    if (error) {
        throw error;
    }

    const rows = branches || [];
    const existingHeadOffice = rows.find((branch) => Boolean(branch.is_head_office));
    if (existingHeadOffice?.id) {
        return existingHeadOffice.id;
    }

    const namedHeadOffice = rows.find((branch) => String(branch.name || "").trim().toLowerCase() === "head office");
    if (namedHeadOffice?.id) {
        const { error: updateError } = await supabase
            .from("branches")
            .update({ is_head_office: true })
            .eq("business_id", businessId)
            .eq("id", namedHeadOffice.id);
        if (updateError) {
            throw updateError;
        }
        return namedHeadOffice.id;
    }

    const maxSequence = rows.reduce((max, row) => {
        const sequence = toBranchSequence(row.code);
        return sequence > max ? sequence : max;
    }, 0);
    const nextCode = formatBranchCode(maxSequence + 1);

    let { data: inserted, error: insertError } = await supabase
        .from("branches")
        .insert({
            business_id: businessId,
            name: "Head Office",
            code: nextCode,
            is_head_office: true,
            is_active: true
        })
        .select("id")
        .single();

    if (insertError && isMissingColumnError(insertError, "is_active")) {
        const fallback = await supabase
            .from("branches")
            .insert({
                business_id: businessId,
                name: "Head Office",
                code: nextCode,
                is_head_office: true
            })
            .select("id")
            .single();
        inserted = fallback.data;
        insertError = fallback.error;
    }

    if (insertError) {
        throw insertError;
    }

    return inserted?.id || null;
}

function mapBranchRow(branch) {
    return {
        id: branch.id,
        businessId: branch.business_id,
        name: branch.name || "",
        code: branch.code || "",
        isHeadOffice: Boolean(branch.is_head_office),
        isActive: branch.is_active === undefined ? true : Boolean(branch.is_active),
        createdAt: branch.created_at || null
    };
}

function resolveBusinessStatus(status, endsAt) {
    const normalizedStatus = String(status || "trial").trim().toLowerCase();
    if (normalizedStatus === "cancelled") {
        return "deactivated";
    }
    if (normalizedStatus === "active") {
        const endDate = parseDate(endsAt);
        if (endDate && endDate.getTime() <= Date.now()) {
            return "expired";
        }
    }

    return normalizedStatus;
}

async function buildUniqueSlug(supabase, businessName) {
    const baseSlug = slugify(businessName);
    let candidate = baseSlug;
    let suffix = 2;

    while (true) {
        const { data, error } = await supabase
            .from("businesses")
            .select("id")
            .eq("slug", candidate)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            return candidate;
        }

        candidate = `${baseSlug}-${suffix}`;
        suffix += 1;
    }
}

function mapBusinessRow(business, subscription) {
    const billingCycle = subscription?.billing_cycle || "monthly";
    return {
        id: business.id,
        name: business.name,
        email: business.email || "",
        phone: business.phone || "",
        country: business.country || "",
        createdAt: business.created_at || null,
        billingCycle,
        billingMonths: billingCycle === "custom" ? 0 : resolveBillingMonths(billingCycle, 0),
        endsAt: subscription?.ends_at || null,
        status: resolveBusinessStatus(business.subscription_status || "trial", subscription?.ends_at || null),
        planName: subscription?.plan_name || "subscription",
        maxBranches: normalizeMaxBranches(business.max_branches)
    };
}

function attachBranchUsage(businesses, branches = []) {
    const branchCountByBusinessId = new Map();
    (branches || []).forEach((branch) => {
        const businessId = String(branch.business_id || "").trim();
        if (!businessId) {
            return;
        }

        branchCountByBusinessId.set(businessId, (branchCountByBusinessId.get(businessId) || 0) + 1);
    });

    return businesses.map((business) => ({
        ...business,
        usedBranches: branchCountByBusinessId.get(String(business.id || "").trim()) || 0
    }));
}

async function fetchSubscriptionsByBusinessIds(supabase, businessIds) {
    if (!businessIds.length) {
        return [];
    }

    const withMonths = await supabase
        .from("subscriptions")
        .select("business_id, plan_name, status, billing_cycle, ends_at")
        .in("business_id", businessIds);

    if (!withMonths.error) {
        return withMonths.data || [];
    }

    if (withMonths.error) {
        throw withMonths.error;
    }

    return withMonths.data || [];
}

export async function getBusinessById(businessId) {
    const supabase = getSupabaseClient();
    if (!supabase || !businessId) {
        return null;
    }

    let { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("id, name, email, phone, country, created_at, subscription_status, max_branches")
        .eq("id", businessId)
        .maybeSingle();

    if (businessError && isMissingColumnError(businessError, "max_branches")) {
        const fallback = await supabase
            .from("businesses")
            .select("id, name, email, phone, country, created_at, subscription_status")
            .eq("id", businessId)
            .maybeSingle();

        business = fallback.data ? { ...fallback.data, max_branches: null } : fallback.data;
        businessError = fallback.error;
    }

    if (businessError) {
        throw businessError;
    }

    if (!business) {
        return null;
    }

    const subscriptions = await fetchSubscriptionsByBusinessIds(supabase, [business.id]);
    return mapBusinessRow(business, subscriptions[0]);
}

export async function getBusinesses() {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return [];
    }

    let { data: businesses, error } = await supabase
        .from("businesses")
        .select("id, name, email, phone, country, created_at, subscription_status, max_branches")
        .order("created_at", { ascending: false });

    if (error && isMissingColumnError(error, "max_branches")) {
        const fallback = await supabase
            .from("businesses")
            .select("id, name, email, phone, country, created_at, subscription_status")
            .order("created_at", { ascending: false });
        businesses = (fallback.data || []).map((item) => ({ ...item, max_branches: null }));
        error = fallback.error;
    }

    if (error) {
        throw error;
    }

    const rows = businesses || [];
    const subscriptions = await fetchSubscriptionsByBusinessIds(supabase, rows.map((business) => business.id));
    const subscriptionByBusinessId = new Map(subscriptions.map((subscription) => [subscription.business_id, subscription]));
    const mappedBusinesses = rows.map((business) => mapBusinessRow(business, subscriptionByBusinessId.get(business.id)));

    let branches = [];
    if (rows.length) {
        let branchQuery = await supabase
            .from("branches")
            .select("business_id")
            .in("business_id", rows.map((business) => business.id));

        if (branchQuery.error && isMissingColumnError(branchQuery.error, "business_id")) {
            branchQuery = { data: [], error: null };
        }

        if (branchQuery.error) {
            throw branchQuery.error;
        }

        branches = branchQuery.data || [];
    }

    return attachBranchUsage(mappedBusinesses, branches);
}

export async function onboardBusinessClient(payload) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const businessName = String(payload.business_name || "").trim();
    const email = String(payload.email || "").trim().toLowerCase() || null;
    const billingCycle = String(payload.billing_cycle || "monthly").trim().toLowerCase() || "monthly";
    const billingMonths = Number(payload.billing_months || 0);
    const maxBranches = normalizeMaxBranches(payload.max_branches);
    const subscriptionStatus = String(payload.subscription_status || "active").trim().toLowerCase() || "active";
    const dbSubscriptionStatus = subscriptionStatus === "deactivated" ? "cancelled" : subscriptionStatus;

    if (!businessName) {
        throw new Error("Please complete the required onboarding fields.");
    }

    if (billingCycle === "custom" && (!Number.isFinite(billingMonths) || billingMonths <= 0)) {
        throw new Error("Please enter a valid total months value for the custom period.");
    }

    const endsAt = resolveSubscriptionEndsAt(dbSubscriptionStatus, billingCycle, billingMonths);
    const slug = await buildUniqueSlug(supabase, businessName);

    let { data: business, error: businessError } = await supabase
        .from("businesses")
        .insert({
            name: businessName,
            slug,
            email,
            phone: String(payload.phone || "").trim() || null,
            country: String(payload.country || "").trim() || null,
            is_demo: false,
            subscription_status: dbSubscriptionStatus,
            max_branches: maxBranches
        })
        .select("id, name, slug, subscription_status")
        .single();

    if (businessError && isMissingColumnError(businessError, "max_branches")) {
        const fallback = await supabase
            .from("businesses")
            .insert({
                name: businessName,
                slug,
                email,
                phone: String(payload.phone || "").trim() || null,
                country: String(payload.country || "").trim() || null,
                is_demo: false,
                subscription_status: dbSubscriptionStatus
            })
            .select("id, name, slug, subscription_status")
            .single();

        business = fallback.data;
        businessError = fallback.error;
    }

    if (businessError) {
        throw businessError;
    }

    await ensureHeadOfficeBranch(supabase, business.id);

    const { error: subscriptionError } = await supabase
        .from("subscriptions")
        .insert({
            business_id: business.id,
            plan_name: "subscription",
            status: dbSubscriptionStatus,
            amount: 0,
            billing_cycle: billingCycle,
            ends_at: endsAt
        });

    if (subscriptionError) {
        throw subscriptionError;
    }

    return { business };
}

export async function updateBusinessSubscriptionState(businessId, nextStatus) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const normalizedStatus = String(nextStatus || "").trim().toLowerCase();
    if (!businessId || !["active", "deactivated"].includes(normalizedStatus)) {
        throw new Error("Unable to update the business status.");
    }

    const dbStatus = normalizedStatus === "deactivated" ? "cancelled" : normalizedStatus;

    const { data: subscription, error: subscriptionFetchError } = await supabase
        .from("subscriptions")
        .select("billing_cycle, ends_at")
        .eq("business_id", businessId)
        .maybeSingle();

    if (subscriptionFetchError) {
        throw subscriptionFetchError;
    }

    const billingCycle = subscription?.billing_cycle || "monthly";
    const currentEndsAt = parseDate(subscription?.ends_at);
    let endsAt;

    if (normalizedStatus !== "active") {
        endsAt = new Date().toISOString();
    } else if (billingCycle === "custom" && currentEndsAt && currentEndsAt > new Date()) {
        endsAt = currentEndsAt.toISOString();
    } else if (billingCycle === "custom") {
        endsAt = addMonths(new Date(), 1).toISOString();
    } else {
        endsAt = resolveSubscriptionEndsAt(normalizedStatus, billingCycle, 1);
    }

    const { error: businessError } = await supabase
        .from("businesses")
        .update({
            subscription_status: dbStatus
        })
        .eq("id", businessId);

    if (businessError) {
        throw businessError;
    }

    const { error: updateError } = await supabase
        .from("subscriptions")
        .update({
            status: dbStatus,
            ends_at: endsAt
        })
        .eq("business_id", businessId);

    if (updateError) {
        throw updateError;
    }

    return true;
}

export async function updateBusinessDetails(businessId, payload) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const businessName = String(payload.name || "").trim();
    const phone = String(payload.phone || "").trim() || null;
    const country = String(payload.country || "").trim() || null;
    const billingCycle = String(payload.billing_cycle || "monthly").trim().toLowerCase() || "monthly";
    const billingMonths = Number(payload.billing_months || 0);
    const status = String(payload.subscription_status || "active").trim().toLowerCase() || "active";
    const dbStatus = status === "deactivated" ? "cancelled" : status;
    const maxBranches = normalizeMaxBranches(payload.max_branches);

    if (!businessId || !businessName) {
        throw new Error("Please complete the required business fields.");
    }

    if (billingCycle === "custom" && (!Number.isFinite(billingMonths) || billingMonths <= 0)) {
        throw new Error("Please enter a valid total months value for the custom period.");
    }

    const endsAt = resolveSubscriptionEndsAt(dbStatus, billingCycle, billingMonths);

    let { error: businessError } = await supabase
        .from("businesses")
        .update({
            name: businessName,
            phone,
            country,
            subscription_status: dbStatus,
            max_branches: maxBranches
        })
        .eq("id", businessId);

    if (businessError && isMissingColumnError(businessError, "max_branches")) {
        const fallback = await supabase
            .from("businesses")
            .update({
                name: businessName,
                phone,
                country,
                subscription_status: dbStatus
            })
            .eq("id", businessId);
        businessError = fallback.error;
    }

    if (businessError) {
        throw businessError;
    }

    const { error: subscriptionError } = await supabase
        .from("subscriptions")
        .update({
            status: dbStatus,
            billing_cycle: billingCycle,
            ends_at: endsAt
        })
        .eq("business_id", businessId);

    if (subscriptionError) {
        throw subscriptionError;
    }

    return true;
}

export async function getBusinessBranches(businessId) {
    const supabase = getSupabaseClient();
    if (!supabase || !businessId) {
        return [];
    }

    let { data, error } = await supabase
        .from("branches")
        .select("id, business_id, name, code, is_head_office, is_active, created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });

    if (error && isMissingColumnError(error, "is_active")) {
        const fallback = await supabase
            .from("branches")
            .select("id, business_id, name, code, is_head_office, created_at")
            .eq("business_id", businessId)
            .order("created_at", { ascending: false });
        data = (fallback.data || []).map((item) => ({ ...item, is_active: true }));
        error = fallback.error;
    }

    if (error) {
        throw error;
    }

    return (data || []).map(mapBranchRow);
}

export async function setBusinessBranchActive(businessId, branchId, isActive) {
    const supabase = getSupabaseClient();
    if (!supabase || !businessId || !branchId) {
        throw new Error("Branch context is unavailable.");
    }

    let { error } = await supabase
        .from("branches")
        .update({ is_active: Boolean(isActive) })
        .eq("business_id", businessId)
        .eq("id", branchId);

    if (error && isMissingColumnError(error, "is_active")) {
        throw new Error("Branch status column is missing. Run sql/add-branch-status-and-super-admin-policy.sql.");
    }

    if (error) {
        throw error;
    }

    return true;
}

export async function deleteBusinessBranch(businessId, branchId) {
    const supabase = getSupabaseClient();
    if (!supabase || !businessId || !branchId) {
        throw new Error("Branch context is unavailable.");
    }

    const { error } = await supabase
        .from("branches")
        .delete()
        .eq("business_id", businessId)
        .eq("id", branchId);

    if (error) {
        throw error;
    }

    return true;
}
