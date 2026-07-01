import { getSupabaseStatus } from "../../core/supabase-client.js";
import { getBillingStatus } from "../../trial/billing-status.js";
import { applyOrganizationBranding, BRANDING_THEMES } from "../../core/branding.js";
import { showToast } from "../../shared/toast.js";
import { getCurrentOrganizationBranding, readLogoFileAsDataUrl, saveCurrentOrganizationBranding } from "./settings-service.js";

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderThemeOptions(activeTheme = "green") {
    return BRANDING_THEMES.map((theme) => `
        <label class="theme-choice ${theme.key === activeTheme ? "is-selected" : ""}" style="--choice-color: ${theme.accent}; --choice-color-deep: ${theme.accentDeep};">
            <input type="radio" name="themeColor" value="${theme.key}" ${theme.key === activeTheme ? "checked" : ""}>
            <span class="theme-choice__swatch" aria-hidden="true"></span>
            <span>${escapeHtml(theme.label)}</span>
        </label>
    `).join("");
}

function renderBrandingSection(session, branding) {
    if (!session?.businessId) {
        return "";
    }

    const logoUrl = branding?.logoUrl || "";
    const activeTheme = branding?.themeColor || "green";
    return `
        <section class="panel branding-settings-panel">
            <div class="panel-head">
                <div>
                    <p class="eyebrow">Organization branding</p>
                    <h3>Theme & Logo</h3>
                </div>
                <span class="badge paid">Organization-wide</span>
            </div>
            <form class="branding-settings-form" data-branding-settings-form>
                <div class="branding-preview">
                    <div class="branding-preview__logo" data-branding-logo-preview>
                        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="">` : `<span>${escapeHtml((session.businessName || "Tia").slice(0, 1).toUpperCase())}</span>`}
                    </div>
                    <div>
                        <p class="sidebar-card-label">Current Brand</p>
                        <h4>${escapeHtml(session.businessName || "Organization")}</h4>
                        <p class="muted">This logo and theme will appear across dashboards, reports, invoices, receipts, and printable documents.</p>
                    </div>
                </div>

                <label class="form-field">
                    <span>Company Logo</span>
                    <input type="file" accept="image/*" data-branding-logo-input>
                    <small>Use PNG, JPG, or SVG. Maximum 300KB.</small>
                </label>

                <input type="hidden" name="logoUrl" value="${escapeHtml(logoUrl)}" data-branding-logo-url>

                <div class="form-field">
                    <span>Color Theme</span>
                    <div class="theme-choice-grid" data-theme-choice-grid>
                        ${renderThemeOptions(activeTheme)}
                    </div>
                </div>

                <div class="button-row">
                    <button class="btn btn-secondary" type="button" data-branding-remove-logo ${logoUrl ? "" : "disabled"}>Remove Logo</button>
                    <button class="btn btn-primary" type="submit" data-branding-save>
                        <span class="btn-label">Save Branding</span>
                        <span class="spinner" aria-hidden="true"></span>
                    </button>
                </div>
                <p class="muted" data-branding-status></p>
            </form>
        </section>
    `;
}

export async function renderSettings(session) {
    const [status, brandingResult] = await Promise.all([
        getSupabaseStatus(),
        getCurrentOrganizationBranding()
    ]);
    const branding = brandingResult.branding;
    return `
        <div class="section-stack">
            ${renderBrandingSection(session, branding)}
            <div class="content-grid">
                <section class="panel">
                    <div class="panel-head">
                        <h3>Supabase Connection</h3>
                        <span class="badge ${status.tone}">${status.status}</span>
                    </div>
                    <p class="muted mt-18">${status.message}</p>
                    <div class="stack-list mt-18">
                        <div class="stack-item"><span>Project URL</span><strong>${status.projectUrl}</strong></div>
                        <div class="stack-item"><span>Project Host</span><strong>${status.projectHost}</strong></div>
                        <div class="stack-item"><span>Auth Session</span><strong>${status.session}</strong></div>
                    </div>
                </section>
                <section class="panel">
                    <h3>ERP Setup Roadmap</h3>
                    <p class="muted mt-18">This workspace is structured for businesses, demo access, and trial conversion on Supabase.</p>
                    <div class="stack-list mt-18">
                        <div class="stack-item"><span>Database engine</span><strong>Supabase Postgres</strong></div>
                        <div class="stack-item"><span>Security model</span><strong>Row Level Security</strong></div>
                        <div class="stack-item"><span>Billing state</span><strong>${getBillingStatus(session)}</strong></div>
                    </div>
                </section>
            </div>
        </div>
    `;
}

export function bindSettingsActions(container, refresh) {
    const form = container.querySelector("[data-branding-settings-form]");
    if (!form) {
        return;
    }

    const logoInput = form.querySelector("[data-branding-logo-input]");
    const logoUrlInput = form.querySelector("[data-branding-logo-url]");
    const logoPreview = form.querySelector("[data-branding-logo-preview]");
    const removeLogoButton = form.querySelector("[data-branding-remove-logo]");
    const status = form.querySelector("[data-branding-status]");
    const saveButton = form.querySelector("[data-branding-save]");

    const setStatus = (message) => {
        if (status) {
            status.textContent = message || "";
        }
    };

    const setLogoPreview = (logoUrl) => {
        if (!logoPreview) {
            return;
        }
        logoPreview.innerHTML = logoUrl
            ? `<img src="${escapeHtml(logoUrl)}" alt="">`
            : "<span>T</span>";
        if (removeLogoButton) {
            removeLogoButton.disabled = !logoUrl;
        }
    };

    form.querySelectorAll('input[name="themeColor"]').forEach((input) => {
        input.addEventListener("change", () => {
            form.querySelectorAll(".theme-choice").forEach((choice) => {
                choice.classList.toggle("is-selected", choice.contains(input) && input.checked);
            });
        });
    });

    logoInput?.addEventListener("change", async () => {
        const file = logoInput.files?.[0];
        if (!file) {
            return;
        }

        try {
            const dataUrl = await readLogoFileAsDataUrl(file);
            logoUrlInput.value = dataUrl;
            setLogoPreview(dataUrl);
            setStatus("Logo ready to save.");
        } catch (error) {
            logoInput.value = "";
            setStatus(error?.message || "Unable to load logo.");
        }
    });

    removeLogoButton?.addEventListener("click", () => {
        logoUrlInput.value = "";
        if (logoInput) {
            logoInput.value = "";
        }
        setLogoPreview("");
        setStatus("Logo will be removed when you save.");
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const selectedTheme = form.querySelector('input[name="themeColor"]:checked')?.value || "green";
        saveButton?.classList.add("is-loading");
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.setAttribute("aria-busy", "true");
        }
        setStatus("Saving branding...");

        try {
            await saveCurrentOrganizationBranding({
                themeColor: selectedTheme,
                logoUrl: logoUrlInput?.value || ""
            });
            const { session } = await getCurrentOrganizationBranding({ refresh: true });
            await applyOrganizationBranding(session, { refresh: true });
            showToast("Branding saved.");
            setStatus("Branding saved.");
            if (typeof refresh === "function") {
                await refresh();
            }
        } catch (error) {
            showToast(error?.message || "Unable to save branding.", { tone: "error" });
            setStatus(error?.message || "Unable to save branding.");
        } finally {
            saveButton?.classList.remove("is-loading");
            if (saveButton) {
                saveButton.disabled = false;
                saveButton.setAttribute("aria-busy", "false");
            }
        }
    });
}
