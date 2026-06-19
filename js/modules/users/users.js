import {
    createOrganizationUser,
    createPlatformUser,
    getBranchesForUserOnboarding,
    getBusinessUserById,
    getOrganizationsForUserOnboarding,
    getPlatformUserById,
    getUsers,
    ORGANIZATION_USER_ROLES,
    PLATFORM_USER_ROLES,
    updateBusinessUserDetails,
    updatePlatformUserDetails
} from "./users-service.js";
import { createTable, formatRole } from "../../core/utils.js";

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

function openModal(modal) {
    if (!modal) {
        return;
    }

    modal.hidden = false;
    modal.querySelector("input, select, textarea")?.focus();
}

function closeModal(modal) {
    if (!modal) {
        return;
    }

    modal.hidden = true;
}

function formatDateTime(value) {
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

function renderPlatformUserDetails(user, organizations = []) {
    if (!user) {
        return `<p class="muted">No platform user selected.</p>`;
    }

    const nextState = String(user.status || "").toLowerCase() === "active" ? "false" : "true";
    const actionLabel = String(user.status || "").toLowerCase() === "active" ? "Deactivate" : "Activate";

    return `
        <form class="form-grid business-details-form" data-platform-user-details-form>
            <input type="hidden" name="user_id" value="${user.id}">
            <div class="business-details-grid">
                <label class="form-field">
                    <span>Full Name</span>
                    <input name="full_name" type="text" value="${user.name || ""}" required>
                </label>
                <label class="form-field">
                    <span>Email</span>
                    <input name="email" type="email" value="${user.email || ""}" readonly>
                </label>
                <label class="form-field">
                    <span>Role</span>
                    <select name="role">
                        ${PLATFORM_USER_ROLES.map((role) => `<option value="${role.value}" ${String(user.role || "super_admin") === role.value ? "selected" : ""}>${role.label}</option>`).join("")}
                    </select>
                </label>
                <label class="form-field">
                    <span>Organization</span>
                    <select name="business_id">
                        <option value="">No organization</option>
                        ${organizations.map((org) => `<option value="${org.id}" ${String(user.businessId || "") === String(org.id) ? "selected" : ""}>${org.name}</option>`).join("")}
                    </select>
                </label>
                <label class="form-field">
                    <span>Status</span>
                    <select name="is_active">
                        <option value="true" ${String(user.status || "").toLowerCase() === "active" ? "selected" : ""}>Active</option>
                        <option value="false" ${String(user.status || "").toLowerCase() !== "active" ? "selected" : ""}>Inactive</option>
                    </select>
                </label>
            </div>
            <div class="business-details-meta">
                <div class="business-detail-card">
                    <span>Created</span>
                    <strong>${formatDateTime(user.createdAt)}</strong>
                </div>
            </div>
            <p class="muted" data-platform-user-details-status>Update the name, role, or status, then save changes.</p>
            <div class="button-row business-details-actions">
                <button class="btn btn-primary" type="submit" data-platform-user-details-submit>
                    <span class="btn-label">Save Changes</span>
                    <span class="spinner" aria-hidden="true"></span>
                </button>
                <button class="btn btn-secondary" type="button" data-platform-user-toggle data-user-id="${user.id}" data-user-active="${nextState}">
                    ${actionLabel}
                </button>
            </div>
        </form>
    `;
}

function renderBusinessUserDetails(user, branches = []) {
    if (!user) {
        return `<p class="muted">No user selected.</p>`;
    }

    const nextState = String(user.status || "").toLowerCase() === "active" ? "false" : "true";
    const actionLabel = String(user.status || "").toLowerCase() === "active" ? "Deactivate" : "Activate";

    return `
        <form class="form-grid business-details-form" data-business-user-details-form>
            <input type="hidden" name="user_id" value="${user.id}">
            <div class="business-details-grid">
                <label class="form-field">
                    <span>Full Name</span>
                    <input name="full_name" type="text" value="${user.name || ""}" required>
                </label>
                <label class="form-field">
                    <span>Email</span>
                    <input name="email" type="email" value="${user.email || ""}" readonly>
                </label>
                <label class="form-field">
                    <span>Role</span>
                    <select name="role">
                        ${ORGANIZATION_USER_ROLES.map((role) => `<option value="${role.value}" ${String(user.role || "staff") === role.value ? "selected" : ""}>${role.label}</option>`).join("")}
                    </select>
                </label>
                <label class="form-field">
                    <span>Branch</span>
                    <select name="branch_id">
                        ${branches.map((branch) => `<option value="${branch.id}" ${String(user.branchId || "") === String(branch.id) ? "selected" : ""}>${branch.name}</option>`).join("")}
                    </select>
                </label>
                <label class="form-field">
                    <span>Status</span>
                    <select name="is_active">
                        <option value="true" ${String(user.status || "").toLowerCase() === "active" ? "selected" : ""}>Active</option>
                        <option value="false" ${String(user.status || "").toLowerCase() !== "active" ? "selected" : ""}>Inactive</option>
                    </select>
                </label>
            </div>
            <div class="business-details-meta">
                <div class="business-detail-card">
                    <span>Created</span>
                    <strong>${formatDateTime(user.createdAt)}</strong>
                </div>
            </div>
            <p class="muted" data-business-user-details-status>Update role, branch, or status, then save changes.</p>
            <div class="button-row business-details-actions">
                <button class="btn btn-primary" type="submit" data-business-user-details-submit>
                    <span class="btn-label">Save Changes</span>
                    <span class="spinner" aria-hidden="true"></span>
                </button>
                <button class="btn btn-secondary" type="button" data-business-user-toggle data-user-id="${user.id}" data-user-active="${nextState}">
                    ${actionLabel}
                </button>
            </div>
        </form>
    `;
}

export async function renderUsers(context = {}) {
    const scopedBranchId = String(context.branchId ?? "").trim();
    const users = await getUsers({ branchId: scopedBranchId });
    const organizations = context.platform ? await getOrganizationsForUserOnboarding() : [];
    const branches = context.platform ? [] : await getBranchesForUserOnboarding({ branchId: scopedBranchId });
    const title = context.platform ? "Platform Users" : "Users";
    const eyebrow = context.platform ? "Tenant administration" : "User administration";
    const buttonLabel = context.platform ? "Create Platform User" : "Create User";
    const roleOptions = context.platform ? PLATFORM_USER_ROLES : ORGANIZATION_USER_ROLES;

    return {
        summary: [],
        content: `
            <div class="section-stack">
                <div class="module-header">
                    <div>
                        <p class="eyebrow">${eyebrow}</p>
                        <h2>${title}</h2>
                    </div>
                    <button class="btn btn-primary" type="button" data-open-platform-user-modal>${buttonLabel}</button>
                </div>
                <section class="panel">
                    ${createTable(
                        context.platform ? ["User", "Email", "Organization", "Role", "Status", "Action"] : ["User", "Email", "Role", "Branch", "Status", "Action"],
                        users.map((user) => {
                            const baseCells = [
                                user.name,
                                user.email || "-",
                                formatRole(user.role),
                                user.branchName || "-",
                                user.status,
                                `
                                    <div class="button-row business-row-actions">
                                        <button class="btn btn-secondary business-user-view-btn" type="button" data-business-user-view-id="${user.id}">View</button>
                                        <button class="btn btn-secondary business-user-toggle-btn" type="button" data-business-user-id="${user.id}" data-business-user-active="${String(user.status || "").toLowerCase() === "active" ? "false" : "true"}">
                                            ${String(user.status || "").toLowerCase() === "active" ? "Deactivate" : "Activate"}
                                        </button>
                                    </div>
                                `
                            ];
                            if (!context.platform) {
                                return baseCells;
                            }

                            return [
                                user.name,
                                user.email || "-",
                                user.organizationName || "-",
                                formatRole(user.role),
                                user.status,
                                `
                                    <div class="button-row business-row-actions">
                                        <button class="btn btn-secondary platform-user-view-btn" type="button" data-platform-user-view-id="${user.id}">View</button>
                                        <button class="btn btn-secondary platform-user-toggle-btn" type="button" data-platform-user-id="${user.id}" data-platform-user-active="${String(user.status || "").toLowerCase() === "active" ? "false" : "true"}">
                                            ${String(user.status || "").toLowerCase() === "active" ? "Deactivate" : "Activate"}
                                        </button>
                                    </div>
                                `
                            ];
                        })
                    )}
                </section>
                <div class="business-modal" data-platform-user-modal hidden>
                        <div class="business-modal__backdrop" data-platform-user-modal-close></div>
                        <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="platformUserTitle">
                            <div class="business-modal__head">
                                <div>
                                    <p class="eyebrow">${context.platform ? "Platform administration" : "User administration"}</p>
                                    <h3 id="platformUserTitle">${context.platform ? "Create platform user" : "Create organization user"}</h3>
                                </div>
                                <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-platform-user-modal-close>&times;</button>
                            </div>
                            <form id="platformUserForm" class="form-grid mt-18">
                                <div class="triple-grid">
                                    <label class="form-field">
                                        <span>Full Name</span>
                                        <input name="full_name" type="text" placeholder="Amina Yusuf" required>
                                    </label>
                                    <label class="form-field">
                                        <span>Email</span>
                                        <input name="email" type="email" placeholder="amina@tia.com" required>
                                    </label>
                                    <label class="form-field">
                                        <span>Password</span>
                                        <input name="password" type="password" placeholder="Create a secure password" required>
                                    </label>
                                </div>
                                <div class="triple-grid">
                                    <label class="form-field">
                                        <span>Status</span>
                                        <select name="is_active">
                                            <option value="true" selected>Active</option>
                                            <option value="false">Inactive</option>
                                        </select>
                                    </label>
                                    <label class="form-field">
                                        <span>Role</span>
                                        <select name="role">
                                            ${roleOptions.map((role) => `<option value="${role.value}">${role.label}</option>`).join("")}
                                        </select>
                                    </label>
                                    ${context.platform ? `
                                        <label class="form-field">
                                            <span>Organization</span>
                                            <select name="business_id">
                                                <option value="">No organization</option>
                                                ${organizations.map((org) => `<option value="${org.id}">${org.name}</option>`).join("")}
                                            </select>
                                        </label>
                                    ` : `
                                        <label class="form-field">
                                            <span>Branch</span>
                                            <select name="branch_id">
                                                ${branches.map((branch) => `<option value="${branch.id}">${branch.name}</option>`).join("")}
                                            </select>
                                        </label>
                                    `}
                                </div>
                                <div class="button-row">
                                    <button class="btn btn-primary" type="submit" data-platform-user-submit>
                                        <span class="btn-label">Create User</span>
                                        <span class="spinner" aria-hidden="true"></span>
                                    </button>
                                    <p class="muted" id="platformUserStatus">${context.platform ? "Fill in the user details to create the platform account." : "Fill in the user details to create the organization user."}</p>
                                </div>
                            </form>
                        </div>
                    </div>
                <div class="business-modal" data-platform-user-details-modal hidden>
                        <div class="business-modal__backdrop" data-platform-user-details-close></div>
                        <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="platformUserDetailsTitle">
                            <div class="business-modal__head">
                                <div>
                                    <p class="eyebrow">${context.platform ? "Platform user" : "Organization user"}</p>
                                    <h3 id="platformUserDetailsTitle">User details</h3>
                                </div>
                                <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-platform-user-details-close>&times;</button>
                            </div>
                            <div class="business-details-body" data-platform-user-details-body>
                                <p class="muted">Select a user to view their details.</p>
                            </div>
                        </div>
                    </div>
            </div>
        `,
        afterRender(pageContent, refresh) {
            const openButton = pageContent.querySelector("[data-open-platform-user-modal]");
            const modal = pageContent.querySelector("[data-platform-user-modal]");
            const detailsModal = pageContent.querySelector("[data-platform-user-details-modal]");
            const detailsBody = pageContent.querySelector("[data-platform-user-details-body]");
            const form = pageContent.querySelector("#platformUserForm");
            const status = pageContent.querySelector("#platformUserStatus");
            const submitButton = pageContent.querySelector("[data-platform-user-submit]");
            const roleSelect = form?.querySelector('select[name="role"]');
            const organizationSelect = form?.querySelector('select[name="business_id"]');
            const branchSelect = form?.querySelector('select[name="branch_id"]');
            let selectedUserId = null;
            const bindDetailsRoleRules = () => {
                const detailsForm = detailsBody?.querySelector("[data-platform-user-details-form]");
                const detailsRoleSelect = detailsForm?.querySelector('select[name="role"]');
                const detailsOrgSelect = detailsForm?.querySelector('select[name="business_id"]');
                if (!detailsRoleSelect || !detailsOrgSelect) {
                    return;
                }

                const syncDetailsOrganizationRequirement = () => {
                    const selectedRole = String(detailsRoleSelect.value || "").toLowerCase();
                    detailsOrgSelect.required = selectedRole !== "super_admin";
                };

                detailsRoleSelect.addEventListener("change", syncDetailsOrganizationRequirement);
                syncDetailsOrganizationRequirement();
            };

            const bindBusinessDetailsRoleRules = () => {
                const detailsForm = detailsBody?.querySelector("[data-business-user-details-form]");
                const detailsRoleSelect = detailsForm?.querySelector('select[name="role"]');
                const detailsBranchSelect = detailsForm?.querySelector('select[name="branch_id"]');
                if (!detailsRoleSelect || !detailsBranchSelect) {
                    return;
                }

                const pickHeadOffice = () => {
                    const options = Array.from(detailsBranchSelect.options || []);
                    const preferred = options.find((option) => /head\s*office/i.test(String(option.text || ""))) || options[0];
                    if (preferred) {
                        detailsBranchSelect.value = preferred.value;
                    }
                };

                const syncBusinessBranchRule = () => {
                    const selectedRole = String(detailsRoleSelect.value || "").toLowerCase();
                    const isAdminRole = selectedRole === "business_admin";
                    detailsBranchSelect.required = true;
                    if (!detailsBranchSelect.value) {
                        pickHeadOffice();
                    }
                    detailsBranchSelect.disabled = isAdminRole;
                    if (isAdminRole) {
                        pickHeadOffice();
                    }
                };

                detailsRoleSelect.addEventListener("change", syncBusinessBranchRule);
                syncBusinessBranchRule();
            };

            const syncOrganizationRequirement = () => {
                if (!context.platform || !roleSelect || !organizationSelect) {
                    return;
                }

                const role = String(roleSelect.value || "").toLowerCase();
                const needsOrganization = role !== "super_admin";
                organizationSelect.required = needsOrganization;
            };

            const syncCreateBranchRule = () => {
                if (context.platform || !roleSelect || !branchSelect) {
                    return;
                }
                const selectedRole = String(roleSelect.value || "").toLowerCase();
                const isAdminRole = selectedRole === "business_admin";
                const options = Array.from(branchSelect.options || []);
                const preferred = options.find((option) => /head\s*office/i.test(String(option.text || ""))) || options[0];
                branchSelect.required = true;
                if (!branchSelect.value && preferred) {
                    branchSelect.value = preferred.value;
                }
                branchSelect.disabled = isAdminRole;
                if (isAdminRole) {
                    if (preferred) {
                        branchSelect.value = preferred.value;
                    }
                }
            };

            roleSelect?.addEventListener("change", syncOrganizationRequirement);
            roleSelect?.addEventListener("change", syncCreateBranchRule);
            syncOrganizationRequirement();
            syncCreateBranchRule();

            openButton?.addEventListener("click", () => {
                showPageLoading();
                requestAnimationFrame(() => {
                    openModal(modal);
                    hidePageLoading();
                });
            });

            modal?.querySelectorAll(".business-modal__close[data-platform-user-modal-close]").forEach((control) => {
                control.addEventListener("click", () => closeModal(modal));
            });

            detailsModal?.querySelectorAll(".business-modal__close[data-platform-user-details-close]").forEach((control) => {
                control.addEventListener("click", () => closeModal(detailsModal));
            });

            pageContent.addEventListener("click", async (event) => {
                const viewButton = event.target.closest("[data-platform-user-view-id], [data-business-user-view-id]");
                if (viewButton) {
                    const userId = viewButton.getAttribute("data-platform-user-view-id") || viewButton.getAttribute("data-business-user-view-id");
                    if (!userId || !detailsModal || !detailsBody) {
                        return;
                    }

                    selectedUserId = userId;
                    detailsBody.innerHTML = `<p class="muted">${context.platform ? "Loading platform user..." : "Loading organization user..."}</p>`;
                    showPageLoading();
                    openModal(detailsModal);

                    try {
                        if (context.platform) {
                            const user = await getPlatformUserById(userId);
                            detailsBody.innerHTML = renderPlatformUserDetails(user, organizations);
                            bindDetailsRoleRules();
                        } else {
                            const user = await getBusinessUserById(userId);
                            detailsBody.innerHTML = renderBusinessUserDetails(user, branches);
                            bindBusinessDetailsRoleRules();
                        }
                    } catch (error) {
                        detailsBody.innerHTML = `<p class="muted">${error.message || (context.platform
                            ? "Unable to load the platform user right now."
                            : "Unable to load the organization user right now.")}</p>`;
                    } finally {
                        hidePageLoading();
                    }

                    return;
                }

                const toggleButton = event.target.closest("[data-platform-user-toggle], [data-platform-user-id], [data-business-user-toggle], [data-business-user-id]");
                if (!toggleButton) {
                    return;
                }

                const userId = toggleButton.getAttribute("data-user-id")
                    || toggleButton.getAttribute("data-platform-user-id")
                    || toggleButton.getAttribute("data-business-user-id");
                const isActive = String(
                    toggleButton.getAttribute("data-user-active")
                    || toggleButton.getAttribute("data-platform-user-active")
                    || toggleButton.getAttribute("data-business-user-active")
                    || "true"
                ).toLowerCase() === "true";
                if (!userId) {
                    return;
                }

                const originalLabel = toggleButton.textContent;
                toggleButton.disabled = true;
                toggleButton.textContent = "Updating...";
                showPageLoading();

                try {
                    if (context.platform) {
                        const currentUser = await getPlatformUserById(userId);
                        await updatePlatformUserDetails(userId, {
                            full_name: currentUser?.name || "",
                            role: currentUser?.role || "super_admin",
                            business_id: currentUser?.businessId || "",
                            is_active: isActive
                        });
                    } else {
                        const currentUser = await getBusinessUserById(userId);
                        await updateBusinessUserDetails(userId, {
                            full_name: currentUser?.name || "",
                            role: currentUser?.role || "staff",
                            branch_id: currentUser?.branchId || "",
                            is_active: isActive
                        });
                    }
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                    if (detailsModal && !detailsModal.hidden && detailsBody) {
                        if (context.platform) {
                            const user = await getPlatformUserById(userId);
                            detailsBody.innerHTML = renderPlatformUserDetails(user, organizations);
                            bindDetailsRoleRules();
                        } else {
                            const user = await getBusinessUserById(userId);
                            detailsBody.innerHTML = renderBusinessUserDetails(user, branches);
                            bindBusinessDetailsRoleRules();
                        }
                    }
                } catch (error) {
                    toggleButton.textContent = originalLabel;
                    toggleButton.disabled = false;
                    if (status) {
                        status.textContent = error.message || (context.platform
                            ? "Unable to update the platform user right now."
                            : "Unable to update the organization user right now.");
                    }
                } finally {
                    hidePageLoading();
                }
            });

            detailsModal?.addEventListener("submit", async (event) => {
                const detailsForm = event.target.closest("[data-platform-user-details-form], [data-business-user-details-form]");
                if (!detailsForm) {
                    return;
                }

                event.preventDefault();
                const submit = detailsForm.querySelector("[data-platform-user-details-submit], [data-business-user-details-submit]");
                const detailsStatus = detailsModal.querySelector("[data-platform-user-details-status], [data-business-user-details-status]");
                if (!submit) {
                    return;
                }

                const data = new FormData(detailsForm);
                const userId = String(data.get("user_id") || selectedUserId || "");
                if (!userId) {
                    return;
                }

                setSubmittingState(submit, true);
                if (detailsStatus) {
                    detailsStatus.textContent = "Saving changes...";
                }

                try {
                    if (context.platform) {
                        await updatePlatformUserDetails(userId, {
                            full_name: String(data.get("full_name") || "").trim(),
                            role: String(data.get("role") || "super_admin"),
                            business_id: String(data.get("business_id") || "").trim(),
                            is_active: String(data.get("is_active") || "true").toLowerCase() === "true"
                        });
                    } else {
                        await updateBusinessUserDetails(userId, {
                            full_name: String(data.get("full_name") || "").trim(),
                            role: String(data.get("role") || "staff"),
                            branch_id: String(data.get("branch_id") || "").trim(),
                            is_active: String(data.get("is_active") || "true").toLowerCase() === "true"
                        });
                    }

                    if (detailsStatus) {
                        detailsStatus.textContent = context.platform
                            ? "Platform user updated successfully."
                            : "Organization user updated successfully.";
                    }

                    if (typeof refresh === "function") {
                        await refresh();
                    }
                } catch (error) {
                    if (detailsStatus) {
                        detailsStatus.textContent = error.message || (context.platform
                            ? "Unable to update the platform user right now."
                            : "Unable to update the organization user right now.");
                    }
                } finally {
                    setSubmittingState(submit, false);
                }
            });

            form?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!form || !status || !submitButton) {
                    return;
                }

                const data = new FormData(form);
                status.textContent = context.platform ? "Creating platform user..." : "Creating organization user...";
                setSubmittingState(submitButton, true);
                showPageLoading();

                try {
                    const chosenRole = String(data.get("role") || (context.platform ? "super_admin" : "staff"));
                    const chosenOrganizationId = String(data.get("business_id") || "").trim();
                    if (context.platform && chosenRole !== "super_admin" && !chosenOrganizationId) {
                        status.textContent = "Select an organization for this role.";
                        return;
                    }

                    if (context.platform) {
                        await createPlatformUser({
                            full_name: String(data.get("full_name") || "").trim(),
                            email: String(data.get("email") || "").trim().toLowerCase(),
                            password: String(data.get("password") || ""),
                            is_active: String(data.get("is_active") || "true").toLowerCase() === "true",
                            role: chosenRole,
                            business_id: chosenOrganizationId
                        });
                    } else {
                        await createOrganizationUser({
                            full_name: String(data.get("full_name") || "").trim(),
                            email: String(data.get("email") || "").trim().toLowerCase(),
                            password: String(data.get("password") || ""),
                            is_active: String(data.get("is_active") || "true").toLowerCase() === "true",
                            role: chosenRole,
                            branch_id: String(data.get("branch_id") || "").trim()
                        });
                    }

                    form.reset();
                    syncOrganizationRequirement();
                    closeModal(modal);
                    status.textContent = context.platform ? "Platform user created successfully." : "Organization user created successfully.";
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                } catch (error) {
                    status.textContent = error.message || (context.platform
                        ? "Unable to create the platform user right now."
                        : "Unable to create the organization user right now.");
                } finally {
                    setSubmittingState(submitButton, false);
                    hidePageLoading();
                }
            });
        }
    };
}
