import {
    deleteBusinessBranch,
    getBusinessById,
    getBusinessBranches,
    getBusinesses,
    onboardBusinessClient,
    setBusinessBranchActive,
    updateBusinessDetails,
    updateBusinessSubscriptionState
} from "./businesses-service.js";
import { getOrganizationUsersForPlatform } from "../users/users-service.js";
import { createTable, formatRole, formatStatusTone } from "../../core/utils.js";

function showPageLoading() {
    window.TIA_PAGE_LOADING?.show?.();
}

function hidePageLoading() {
    window.TIA_PAGE_LOADING?.hide?.();
}

function setSubmittingState(button, isSubmitting) {
    if (!button) {
        return;
    }

    button.disabled = isSubmitting;
    button.classList.toggle("is-loading", isSubmitting);
    button.setAttribute("aria-busy", String(isSubmitting));
}

function openBusinessModal(modal) {
    if (!modal) {
        return;
    }

    modal.hidden = false;
    const firstInput = modal.querySelector("input, select, textarea");
    firstInput?.focus();
}

function closeBusinessModal(modal) {
    if (!modal) {
        return;
    }

    modal.hidden = true;
}

function populateBusinessDetailsForm(form, business) {
    if (!form || !business) {
        return;
    }

    const setValue = (name, value) => {
        const field = form.querySelector(`[name="${name}"]`);
        if (field) {
            field.value = value ?? "";
        }
    };

    setValue("business_id", business.id);
    setValue("name", business.name);
    setValue("email", business.email);
    setValue("phone", business.phone);
    setValue("country", business.country || "Nigeria");
    setValue("billing_cycle", business.billingCycle || "monthly");
    setValue("billing_months", business.billingMonths || "");
    setValue("subscription_status", business.status || "active");
    setValue("max_branches", business.maxBranches || "");

    const customMonthsWrap = form.querySelector("[data-details-custom-months-wrap]");
    const customMonthsInput = form.querySelector('input[name="billing_months"]');
    const billingCycleSelect = form.querySelector('select[name="billing_cycle"]');
    const isCustom = String(billingCycleSelect?.value || "").toLowerCase() === "custom";
    if (customMonthsWrap) {
        customMonthsWrap.hidden = !isCustom;
    }
    if (customMonthsInput) {
        customMonthsInput.required = isCustom;
    }
}

function formatBusinessPeriod(business) {
    const cycle = String(business.billingCycle || "monthly").toLowerCase();
    const cycleLabel = {
        monthly: "Monthly",
        quarterly: "Quarterly",
        yearly: "Yearly",
        custom: "Custom"
    }[cycle] || "Monthly";
    const months = Number(business.billingMonths || 0);

    if (cycle !== "custom") {
        return cycleLabel;
    }

    return months > 0 ? `${cycleLabel} (${months} month${months === 1 ? "" : "s"})` : cycleLabel;
}

function formatBusinessEndDate(value) {
    if (!value) {
        return "Open";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Open";
    }

    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    }).format(date);
}

function formatBusinessDateTime(value) {
    if (!value) {
        return "Unknown";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Unknown";
    }

    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function formatBranchUsage(business) {
    const used = Number(business?.usedBranches || 0);
    const allowed = business?.maxBranches || "Unlimited";
    return `${used} / ${allowed}`;
}

function resolvePeriodMonths(cycle, customMonths) {
    const normalizedCycle = String(cycle || "monthly").toLowerCase();
    if (normalizedCycle === "custom") {
        return Number(customMonths || 0);
    }

    return {
        monthly: 1,
        quarterly: 3,
        yearly: 12
    }[normalizedCycle] || 1;
}

function calculatePeriodEndDate(cycle, customMonths) {
    const months = resolvePeriodMonths(cycle, customMonths);
    if (!Number.isFinite(months) || months <= 0) {
        return "";
    }

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    }).format(endDate);
}

function syncPeriodPreview(container) {
    if (!container) {
        return;
    }

    const cycleSelect = container.querySelector('select[name="billing_cycle"], [data-business-period-cycle]');
    const monthsInput = container.querySelector('input[name="billing_months"], [data-business-period-months]');
    const customMonthsWrap = container.querySelector("[data-custom-months-wrap], [data-details-custom-months-wrap]");
    const preview = container.querySelector("[data-business-end-preview]");
    const endDisplay = container.querySelector("[data-business-end-display]");

    const refreshPreview = () => {
        const cycle = String(cycleSelect?.value || "monthly").toLowerCase();
        const isCustom = cycle === "custom";
        const monthValue = monthsInput?.value || "";

        if (customMonthsWrap) {
            customMonthsWrap.hidden = !isCustom;
        }
        if (monthsInput) {
            monthsInput.required = isCustom;
            monthsInput.disabled = !isCustom;
            if (!isCustom) {
                monthsInput.value = "";
            }
        }

        const endDate = calculatePeriodEndDate(cycle, monthValue);
        const message = endDate
            ? `End date updates to ${endDate}.`
            : isCustom
                ? "Custom period needs a valid total months value."
                : "End date will be calculated automatically.";

        if (preview) {
            preview.textContent = message;
        }
        if (endDisplay) {
            endDisplay.textContent = endDate || "Open";
        }
    };

    cycleSelect?.addEventListener("change", refreshPreview);
    monthsInput?.addEventListener("input", refreshPreview);
    refreshPreview();
}

function getToggleLabel(status) {
    return String(status || "").toLowerCase() === "active" ? "Deactivate" : "Activate";
}

function getNextStatus(status) {
    return String(status || "").toLowerCase() === "active" ? "deactivated" : "active";
}

function formatBusinessUserDate(value) {
    if (!value) {
        return "Unknown";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Unknown";
    }

    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    }).format(date);
}

function renderOrganizationUsersList(organizationName, users = []) {
    return `
        <div class="section-stack">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Organization Users</p>
                    <h3>${organizationName || "Organization"}</h3>
                </div>
                <span class="badge draft">${users.length} users</span>
            </div>
            ${createTable(
                ["User", "Email", "Role", "Branch", "Status", "Created"],
                users.map((user) => [
                    user.name || "User",
                    user.email || "-",
                    formatRole(user.role),
                    user.branchName || "-",
                    user.status || "-",
                    formatBusinessUserDate(user.createdAt)
                ])
            )}
        </div>
    `;
}

function renderBranchManagementSection(businessId, branches) {
    const rows = (branches || []).length
        ? (branches || []).map((branch) => `
            <tr>
                <td>${branch.name || "-"}</td>
                <td>${branch.code || "-"}</td>
                <td>${branch.isHeadOffice ? "Head Office" : "Branch"}</td>
                <td><span class="badge ${formatStatusTone(branch.isActive ? "active" : "deactivated")}">${branch.isActive ? "Active" : "Deactivated"}</span></td>
                <td>
                    <div class="button-row business-row-actions">
                        <button class="btn btn-secondary" type="button" data-branch-business-id="${businessId}" data-branch-id="${branch.id}" data-branch-active="${String(branch.isActive)}">
                            ${branch.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button class="btn btn-secondary" type="button" data-branch-delete-business-id="${businessId}" data-branch-delete-id="${branch.id}">
                            Delete
                        </button>
                    </div>
                </td>
            </tr>
        `).join("")
        : `<tr><td colspan="5">No branches available for this organization.</td></tr>`;

    return `
        <section class="panel mt-18">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Branch management</p>
                    <h3>Organization branches</h3>
                </div>
            </div>
            <div class="table-wrap mt-18">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Code</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <p class="muted mt-12" data-branch-action-status>Use activate, deactivate, or delete to manage organization branches.</p>
        </section>
    `;
}

function renderBusinessDetailsModalContent(business, branches = []) {
    if (!business) {
        return `
            <div class="business-details-empty">
                <p class="muted">No business selected.</p>
            </div>
        `;
    }

    return `
        <form class="form-grid business-details-form" data-business-details-form>
            <input type="hidden" name="business_id" value="${business.id}">
            <div class="business-details-grid">
                <label class="form-field">
                    <span>Business Name</span>
                    <input name="name" type="text" value="${business.name || ""}" required>
                </label>
                <label class="form-field">
                    <span>Email</span>
                    <input name="email" type="email" value="${business.email || ""}" readonly>
                </label>
                <label class="form-field">
                    <span>Phone</span>
                    <input name="phone" type="text" value="${business.phone || ""}">
                </label>
                <label class="form-field">
                    <span>Country</span>
                    <select name="country">
                        <option value="Nigeria" ${business.country === "Nigeria" ? "selected" : ""}>Nigeria</option>
                        <option value="Ghana" ${business.country === "Ghana" ? "selected" : ""}>Ghana</option>
                        <option value="Kenya" ${business.country === "Kenya" ? "selected" : ""}>Kenya</option>
                        <option value="South Africa" ${business.country === "South Africa" ? "selected" : ""}>South Africa</option>
                        <option value="United Kingdom" ${business.country === "United Kingdom" ? "selected" : ""}>United Kingdom</option>
                        <option value="United States" ${business.country === "United States" ? "selected" : ""}>United States</option>
                    </select>
                </label>
                <label class="form-field">
                    <span>Status</span>
                    <select name="subscription_status">
                        <option value="active" ${String(business.status).toLowerCase() === "active" ? "selected" : ""}>Active</option>
                        <option value="deactivated" ${String(business.status).toLowerCase() !== "active" ? "selected" : ""}>Deactivate</option>
                    </select>
                </label>
                <label class="form-field">
                    <span>Allowed Branches</span>
                    <input name="max_branches" type="number" min="1" step="1" value="${business.maxBranches || ""}" placeholder="Unlimited">
                </label>
                <label class="form-field">
                    <span>Billing Period</span>
                    <select name="billing_cycle" data-business-period-cycle>
                        <option value="monthly" ${String(business.billingCycle) === "monthly" ? "selected" : ""}>Monthly</option>
                        <option value="quarterly" ${String(business.billingCycle) === "quarterly" ? "selected" : ""}>Quarterly</option>
                        <option value="yearly" ${String(business.billingCycle) === "yearly" ? "selected" : ""}>Yearly</option>
                        <option value="custom" ${String(business.billingCycle) === "custom" ? "selected" : ""}>Custom</option>
                    </select>
                </label>
                <label class="form-field" data-details-custom-months-wrap ${String(business.billingCycle) === "custom" ? "" : "hidden"}>
                    <span>Total Months</span>
                    <input name="billing_months" type="number" min="1" step="1" value="${business.billingMonths || ""}" data-business-period-months>
                </label>
            </div>
            <div class="business-details-meta">
                <div class="business-detail-card">
                    <span>Ends On</span>
                    <strong data-business-end-display>${formatBusinessEndDate(business.endsAt)}</strong>
                </div>
                <div class="business-detail-card">
                    <span>Created</span>
                    <strong>${formatBusinessDateTime(business.createdAt)}</strong>
                </div>
            </div>
            <p class="muted business-details-end-preview" data-business-end-preview>
                End date updates automatically for monthly, quarterly, yearly, and custom periods.
            </p>
            <div class="button-row business-details-actions">
                <button class="btn btn-secondary business-detail-toggle-btn" type="button" data-business-id="${business.id}" data-business-status="${business.status}">
                    ${getToggleLabel(business.status)}
                </button>
                <button class="btn btn-primary" type="submit" data-business-details-save>
                    <span class="btn-label">Save Changes</span>
                    <span class="spinner" aria-hidden="true"></span>
                </button>
            </div>
            <p class="muted business-details-save-status">Edit the details and save your changes.</p>
        </form>
        ${renderBranchManagementSection(business.id, branches)}
    `;
}

export async function renderBusinesses() {
    let businesses = [];
    let loadError = "";

    try {
        businesses = await getBusinesses();
    } catch (error) {
        loadError = error?.message || "Unable to load registered clients right now.";
    }

    return {
        summary: [],
        content: `
            <div class="section-stack">
                <div class="module-header">
                    <div>
                        <p class="eyebrow">Platform control</p>
                        <h2>Registered Organizations</h2>
                    </div>
                    <button class="btn btn-primary" type="button" data-open-business-onboard>Onboard Organization</button>
                </div>
                ${loadError ? `<div class="panel"><p class="muted">${loadError}</p></div>` : ""}
                <section class="panel">
                    ${createTable(
                        ["Client", "Branches Used", "Period", "Ends", "Status", "Action"],
                        businesses.map((business) => [
                            business.name,
                            formatBranchUsage(business),
                            formatBusinessPeriod(business),
                            formatBusinessEndDate(business.endsAt),
                            `<span class="badge ${formatStatusTone(business.status)}">${business.status}</span>`,
                            `
                                <div class="button-row business-row-actions">
                                    <button class="btn btn-secondary business-view-btn" type="button" data-business-view-id="${business.id}">View</button>
                                    <button class="btn btn-secondary business-view-users-btn" type="button" data-business-users-id="${business.id}" data-business-users-name="${business.name || "Organization"}">View Users</button>
                                    <button class="btn btn-secondary business-toggle-btn" type="button" data-business-id="${business.id}" data-business-status="${business.status}">${getToggleLabel(business.status)}</button>
                                </div>
                            `
                        ])
                    )}
                </section>
                <div class="business-modal" data-business-modal hidden>
                    <div class="business-modal__backdrop" data-business-modal-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="businessOnboardTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Organization onboarding</p>
                                <h3 id="businessOnboardTitle">Onboard a new organization</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-business-modal-close>&times;</button>
                        </div>
                        <form id="businessOnboardForm" class="form-grid mt-18">
                            <div class="triple-grid">
                                <label class="form-field">
                                    <span>Organization Name</span>
                                    <input name="business_name" type="text" placeholder="Atlas Manufacturing" required>
                                </label>
                                <label class="form-field">
                                    <span>Organization Email</span>
                                    <input name="email" type="email" placeholder="finance@company.com">
                                </label>
                                <label class="form-field">
                                    <span>Phone</span>
                                    <input name="phone" type="text" placeholder="+234 800 000 0000">
                                </label>
                            </div>
                            <div class="triple-grid">
                                <label class="form-field">
                                    <span>Country</span>
                                    <select name="country">
                                        <option value="Nigeria" selected>Nigeria</option>
                                        <option value="Ghana">Ghana</option>
                                        <option value="Kenya">Kenya</option>
                                        <option value="South Africa">South Africa</option>
                                        <option value="United Kingdom">United Kingdom</option>
                                        <option value="United States">United States</option>
                                    </select>
                                </label>
                                <label class="form-field">
                                    <span>Allowed Branches</span>
                                    <input name="max_branches" type="number" min="1" step="1" placeholder="Unlimited">
                                </label>
                                <div></div>
                            </div>
                            <div class="triple-grid">
                                <label class="form-field">
                                    <span>Business Status</span>
                                    <select name="subscription_status">
                                        <option value="active" selected>Active</option>
                                        <option value="deactivated">Deactivate</option>
                                    </select>
                                </label>
                                <label class="form-field">
                                    <span>Billing Period</span>
                                    <select name="billing_cycle">
                                        <option value="monthly" selected>Monthly</option>
                                        <option value="quarterly">Quarterly</option>
                                        <option value="yearly">Yearly</option>
                                        <option value="custom">Custom</option>
                                    </select>
                                </label>
                                <label class="form-field" data-custom-months-wrap hidden>
                                    <span>Total Months</span>
                                    <input name="billing_months" type="number" min="1" step="1" placeholder="6">
                                </label>
                            </div>
                            <p class="muted business-details-end-preview" data-business-end-preview>
                                End date updates automatically for monthly, quarterly, yearly, and custom periods.
                            </p>
                            <div class="button-row">
                                <button class="btn btn-primary" type="submit" data-business-submit>
                                    <span class="btn-label">Create Organization</span>
                                    <span class="spinner" aria-hidden="true"></span>
                                </button>
                                <p class="muted" id="businessOnboardStatus">Fill in the organization details to create the organization.</p>
                            </div>
                        </form>
                    </div>
                </div>
                <div class="business-modal" data-business-details-modal hidden>
                    <div class="business-modal__backdrop" data-business-details-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="businessDetailsTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Registered organization</p>
                                <h3 id="businessDetailsTitle">Organization details</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-business-details-close>&times;</button>
                        </div>
                        <div class="business-details-body" data-business-details-body>
                            <p class="muted">Select an organization to view its details.</p>
                        </div>
                    </div>
                </div>
                <div class="business-modal" data-business-users-modal hidden>
                    <div class="business-modal__backdrop" data-business-users-close></div>
                    <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="businessUsersTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Organization Users</p>
                                <h3 id="businessUsersTitle">User list</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-business-users-close>&times;</button>
                        </div>
                        <div class="gl-statement-modal__content" data-business-users-body>
                            <p class="muted">Select an organization to view its users.</p>
                        </div>
                    </div>
                </div>
            </div>
        `,
        afterRender(pageContent, refresh) {
            const openButton = pageContent.querySelector("[data-open-business-onboard]");
            const modal = pageContent.querySelector("[data-business-modal]");
            const detailsModal = pageContent.querySelector("[data-business-details-modal]");
            const detailsBody = pageContent.querySelector("[data-business-details-body]");
            const usersModal = pageContent.querySelector("[data-business-users-modal]");
            const usersBody = pageContent.querySelector("[data-business-users-body]");
            const form = pageContent.querySelector("#businessOnboardForm");
            const status = pageContent.querySelector("#businessOnboardStatus");
            const submitButton = pageContent.querySelector("[data-business-submit]");
            const billingCycleSelect = pageContent.querySelector('select[name="billing_cycle"]');
            const customMonthsWrap = pageContent.querySelector("[data-custom-months-wrap]");
            const customMonthsInput = pageContent.querySelector('input[name="billing_months"]');

            const syncCustomMonthsVisibility = () => {
                const isCustom = String(billingCycleSelect?.value || "").toLowerCase() === "custom";
                if (customMonthsWrap) {
                    customMonthsWrap.hidden = !isCustom;
                }
                if (customMonthsInput) {
                    customMonthsInput.required = isCustom;
                    customMonthsInput.disabled = !isCustom;
                    if (!isCustom) {
                        customMonthsInput.value = "";
                    }
                }
            };

            const loadBusinessDetailsPanel = async (businessId) => {
                if (!businessId || !detailsBody) {
                    return;
                }

                const [business, branches] = await Promise.all([
                    getBusinessById(businessId),
                    getBusinessBranches(businessId)
                ]);

                detailsBody.innerHTML = renderBusinessDetailsModalContent(business, branches);
                const detailsForm = detailsBody.querySelector("[data-business-details-form]");
                if (detailsForm && business) {
                    populateBusinessDetailsForm(detailsForm, business);
                    syncPeriodPreview(detailsForm);
                }
            };

            openButton?.addEventListener("click", () => {
                showPageLoading();
                requestAnimationFrame(() => {
                    openBusinessModal(modal);
                    hidePageLoading();
                });
            });

            modal?.querySelectorAll(".business-modal__close[data-business-modal-close]").forEach((control) => {
                control.addEventListener("click", () => closeBusinessModal(modal));
            });

            detailsModal?.querySelectorAll(".business-modal__close[data-business-details-close]").forEach((control) => {
                control.addEventListener("click", () => closeBusinessModal(detailsModal));
            });

            usersModal?.querySelectorAll(".business-modal__close[data-business-users-close]").forEach((control) => {
                control.addEventListener("click", () => closeBusinessModal(usersModal));
            });

            billingCycleSelect?.addEventListener("change", syncCustomMonthsVisibility);
            syncCustomMonthsVisibility();
            syncPeriodPreview(form);

            pageContent.addEventListener("click", async (event) => {
                const viewButton = event.target.closest("[data-business-view-id]");
                if (viewButton) {
                    const businessId = viewButton.getAttribute("data-business-view-id");
                    if (!businessId || !detailsModal || !detailsBody) {
                        return;
                    }

                    detailsBody.innerHTML = `<p class="muted">Loading business details...</p>`;
                    showPageLoading();
                    openBusinessModal(detailsModal);

                    try {
                        await loadBusinessDetailsPanel(businessId);
                    } catch (error) {
                        detailsBody.innerHTML = `<p class="muted">${error.message || "Unable to load business details right now."}</p>`;
                    } finally {
                        hidePageLoading();
                    }

                    return;
                }

                const usersButton = event.target.closest("[data-business-users-id]");
                if (usersButton) {
                    const businessId = usersButton.getAttribute("data-business-users-id");
                    const businessName = usersButton.getAttribute("data-business-users-name") || "Organization";
                    if (!businessId || !usersModal || !usersBody) {
                        return;
                    }

                    usersBody.innerHTML = `<p class="muted">Loading organization users...</p>`;
                    showPageLoading();
                    openBusinessModal(usersModal);

                    try {
                        const users = await getOrganizationUsersForPlatform(businessId);
                        usersBody.innerHTML = renderOrganizationUsersList(businessName, users);
                    } catch (error) {
                        usersBody.innerHTML = `<p class="muted">${error?.message || "Unable to load organization users right now."}</p>`;
                    } finally {
                        hidePageLoading();
                    }

                    return;
                }

                const branchToggleButton = event.target.closest("[data-branch-id][data-branch-business-id][data-branch-active]");
                if (branchToggleButton) {
                    const businessId = branchToggleButton.getAttribute("data-branch-business-id");
                    const branchId = branchToggleButton.getAttribute("data-branch-id");
                    const currentActive = String(branchToggleButton.getAttribute("data-branch-active") || "true") === "true";
                    if (!businessId || !branchId) {
                        return;
                    }

                    const statusNode = detailsBody?.querySelector("[data-branch-action-status]");
                    const originalText = branchToggleButton.textContent;
                    branchToggleButton.disabled = true;
                    branchToggleButton.textContent = "Updating...";
                    showPageLoading();

                    try {
                        await setBusinessBranchActive(businessId, branchId, !currentActive);
                        if (statusNode) {
                            statusNode.textContent = "Branch status updated.";
                        }
                        await loadBusinessDetailsPanel(businessId);
                    } catch (error) {
                        if (statusNode) {
                            statusNode.textContent = error?.message || "Unable to update branch status.";
                        }
                        branchToggleButton.textContent = originalText;
                        branchToggleButton.disabled = false;
                    } finally {
                        hidePageLoading();
                    }

                    return;
                }

                const branchDeleteButton = event.target.closest("[data-branch-delete-id][data-branch-delete-business-id]");
                if (branchDeleteButton) {
                    const businessId = branchDeleteButton.getAttribute("data-branch-delete-business-id");
                    const branchId = branchDeleteButton.getAttribute("data-branch-delete-id");
                    if (!businessId || !branchId) {
                        return;
                    }

                    const statusNode = detailsBody?.querySelector("[data-branch-action-status]");
                    const originalText = branchDeleteButton.textContent;
                    branchDeleteButton.disabled = true;
                    branchDeleteButton.textContent = "Deleting...";
                    showPageLoading();

                    try {
                        await deleteBusinessBranch(businessId, branchId);
                        if (statusNode) {
                            statusNode.textContent = "Branch deleted.";
                        }
                        await loadBusinessDetailsPanel(businessId);
                    } catch (error) {
                        if (statusNode) {
                            statusNode.textContent = error?.message || "Unable to delete branch.";
                        }
                        branchDeleteButton.textContent = originalText;
                        branchDeleteButton.disabled = false;
                    } finally {
                        hidePageLoading();
                    }

                    return;
                }

                const button = event.target.closest("[data-business-id][data-business-status]");
                if (!button) {
                    return;
                }

                const businessId = button.getAttribute("data-business-id");
                const currentStatus = button.getAttribute("data-business-status");
                if (!businessId || !currentStatus) {
                    return;
                }

                const nextStatus = getNextStatus(currentStatus);
                button.disabled = true;
                const originalLabel = button.textContent;
                button.textContent = "Updating...";
                showPageLoading();

                try {
                    await updateBusinessSubscriptionState(businessId, nextStatus);
                    if (detailsModal && !detailsModal.hidden) {
                        await loadBusinessDetailsPanel(businessId);
                    }
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                } catch (error) {
                    button.textContent = originalLabel;
                    button.disabled = false;
                    status.textContent = error.message || "Unable to update the business right now.";
                } finally {
                    hidePageLoading();
                }
            });

            pageContent.addEventListener("submit", async (event) => {
                const detailsForm = event.target.closest("[data-business-details-form]");
                if (!detailsForm) {
                    return;
                }

                event.preventDefault();
                const detailsSaveButton = detailsForm.querySelector("[data-business-details-save]");
                if (!detailsSaveButton) {
                    return;
                }

                const saveStatus = detailsForm.querySelector(".business-details-save-status");
                const data = new FormData(detailsForm);
                const businessId = String(data.get("business_id") || "").trim();
                if (!businessId) {
                    return;
                }

                setSubmittingState(detailsSaveButton, true);
                if (saveStatus) {
                    saveStatus.textContent = "Saving changes...";
                }
                showPageLoading();

                try {
                    await updateBusinessDetails(businessId, {
                        name: String(data.get("name") || "").trim(),
                        phone: String(data.get("phone") || "").trim(),
                        country: String(data.get("country") || "").trim(),
                        max_branches: Number(data.get("max_branches") || 0),
                        billing_cycle: String(data.get("billing_cycle") || "monthly").trim(),
                        billing_months: Number(data.get("billing_months") || 0),
                        subscription_status: String(data.get("subscription_status") || "active").trim()
                    });

                    await loadBusinessDetailsPanel(businessId);

                    if (typeof refresh === "function") {
                        await refresh();
                    }
                    if (saveStatus) {
                        saveStatus.textContent = "Changes saved.";
                    }
                } catch (error) {
                    if (saveStatus) {
                        saveStatus.textContent = error.message || "Unable to save changes right now.";
                    }
                } finally {
                    setSubmittingState(detailsSaveButton, false);
                    hidePageLoading();
                }
            });

            form?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!form || !status || !submitButton) {
                    return;
                }

                const data = new FormData(form);
                status.textContent = "Creating organization...";
                setSubmittingState(submitButton, true);
                showPageLoading();

                try {
                    await onboardBusinessClient({
                        email: String(data.get("email") || "").trim().toLowerCase(),
                        business_name: String(data.get("business_name") || "").trim(),
                        phone: String(data.get("phone") || "").trim(),
                        country: String(data.get("country") || "Nigeria").trim(),
                        max_branches: Number(data.get("max_branches") || 0),
                        billing_cycle: String(data.get("billing_cycle") || "monthly").trim(),
                        billing_months: Number(data.get("billing_months") || 0),
                        subscription_status: String(data.get("subscription_status") || "active").trim()
                    });

                    form.reset();
                    closeBusinessModal(modal);
                    status.textContent = "Organization onboarded successfully.";
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                } catch (error) {
                    status.textContent = error.message || "Unable to onboard organization right now.";
                } finally {
                    setSubmittingState(submitButton, false);
                    hidePageLoading();
                }
            });
        }
    };
}
