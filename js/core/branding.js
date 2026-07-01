import { getSupabaseClient } from "./supabase-client.js";

export const BRANDING_THEMES = [
    { key: "green", label: "Green", accent: "#15803d", accentDeep: "#065f46", accentSoft: "#dcfce7", line: "#bbf7d0", documentSoft: "#f0fdf4" },
    { key: "blue", label: "Blue", accent: "#2563eb", accentDeep: "#1e3a8a", accentSoft: "#dbeafe", line: "#bfdbfe", documentSoft: "#eff6ff" },
    { key: "red", label: "Red", accent: "#dc2626", accentDeep: "#991b1b", accentSoft: "#fee2e2", line: "#fecaca", documentSoft: "#fff1f2" },
    { key: "purple", label: "Purple", accent: "#7c3aed", accentDeep: "#4c1d95", accentSoft: "#ede9fe", line: "#ddd6fe", documentSoft: "#f5f3ff" },
    { key: "teal", label: "Teal", accent: "#0f766e", accentDeep: "#134e4a", accentSoft: "#ccfbf1", line: "#99f6e4", documentSoft: "#f0fdfa" },
    { key: "gold", label: "Gold", accent: "#b7791f", accentDeep: "#7c4a03", accentSoft: "#fef3c7", line: "#fde68a", documentSoft: "#fffbeb" }
];

const DEFAULT_THEME_KEY = "green";
let brandingCache = new Map();

function isMissingBrandingColumnError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();
    const details = String(error?.details || "").toLowerCase();
    return code === "PGRST204"
        || message.includes("theme_color")
        || message.includes("logo_url")
        || details.includes("theme_color")
        || details.includes("logo_url");
}

export function getThemeByKey(themeKey) {
    const normalized = String(themeKey || "").trim().toLowerCase();
    return BRANDING_THEMES.find((theme) => theme.key === normalized) || BRANDING_THEMES.find((theme) => theme.key === DEFAULT_THEME_KEY);
}

export function normalizeBranding(row = {}) {
    const theme = getThemeByKey(row.theme_color || row.themeColor);
    return {
        themeColor: theme.key,
        logoUrl: String(row.logo_url || row.logoUrl || "").trim(),
        theme
    };
}

export async function getOrganizationBranding(businessId, options = {}) {
    const normalizedBusinessId = String(businessId || "").trim();
    if (!normalizedBusinessId) {
        return normalizeBranding();
    }

    if (!options.refresh && brandingCache.has(normalizedBusinessId)) {
        return brandingCache.get(normalizedBusinessId);
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        return normalizeBranding();
    }

    let { data, error } = await supabase
        .from("business_settings")
        .select("theme_color, logo_url")
        .eq("business_id", normalizedBusinessId)
        .maybeSingle();

    if (error && isMissingBrandingColumnError(error)) {
        data = null;
        error = null;
    }

    if (error) {
        return normalizeBranding();
    }

    const branding = normalizeBranding(data || {});
    brandingCache.set(normalizedBusinessId, branding);
    return branding;
}

export async function saveOrganizationBranding(businessId, branding) {
    const normalizedBusinessId = String(businessId || "").trim();
    if (!normalizedBusinessId) {
        throw new Error("Business context is unavailable.");
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const theme = getThemeByKey(branding?.themeColor);
    const payload = {
        business_id: normalizedBusinessId,
        theme_color: theme.key,
        logo_url: String(branding?.logoUrl || "").trim() || null
    };

    const { error } = await supabase
        .from("business_settings")
        .upsert(payload, { onConflict: "business_id" });

    if (error) {
        if (isMissingBrandingColumnError(error)) {
            throw new Error("Branding columns are missing. Run sql/add-business-branding.sql in Supabase.");
        }
        throw error;
    }

    const normalized = normalizeBranding(payload);
    brandingCache.set(normalizedBusinessId, normalized);
    return normalized;
}

export function applyBrandingToDocument(branding = normalizeBranding()) {
    const normalized = normalizeBranding(branding);
    return {
        ...normalized,
        cssVars: `--brand: ${normalized.theme.accent}; --brand-2: ${normalized.theme.accentDeep}; --brand-soft: ${normalized.theme.documentSoft}; --line: ${normalized.theme.line};`
    };
}

export function getAppliedBranding() {
    return normalizeBranding(window.TIA_ORGANIZATION_BRANDING || {});
}

export async function applyOrganizationBranding(session, options = {}) {
    const branding = await getOrganizationBranding(session?.businessId, options);
    const root = document.documentElement;
    const { theme, logoUrl } = branding;

    root.style.setProperty("--accent", theme.accent);
    root.style.setProperty("--accent-deep", theme.accentDeep);
    root.style.setProperty("--accent-soft", theme.accentSoft);
    root.style.setProperty("--line", theme.line);
    root.style.setProperty("--brand-document-soft", theme.documentSoft);
    document.body.dataset.brandTheme = theme.key;
    window.TIA_ORGANIZATION_BRANDING = branding;

    document.querySelectorAll(".brand-mark").forEach((mark) => {
        if (logoUrl) {
            mark.innerHTML = `<img src="${logoUrl}" alt="">`;
            mark.classList.add("has-logo");
        } else {
            mark.textContent = "T";
            mark.classList.remove("has-logo");
        }
    });

    return branding;
}

export function clearBrandingCache(businessId = "") {
    if (businessId) {
        brandingCache.delete(String(businessId));
        return;
    }
    brandingCache = new Map();
}
