import { createTable } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import { getBranchesForCurrentBusiness } from "../branches/branches-service.js";
import {
    createGeneralLedgerCategory,
    createGeneralLedgerAccount,
    createAccountProduct,
    GENERAL_LEDGER_TYPES,
    getAccountProducts,
    getGeneralLedgerAccounts,
    getGeneralLedgerCategories,
    getNextGeneralLedgerCode
} from "./general-ledgers-service.js";

function formatType(type) {
    const value = String(type || "").trim().toLowerCase();
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : "-";
}

function formatDateTime(value) {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "-";
    }

    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function setSubmittingState(button, isSubmitting) {
    if (!button) {
        return;
    }

    button.disabled = isSubmitting;
    button.classList.toggle("is-loading", isSubmitting);
    button.setAttribute("aria-busy", String(isSubmitting));
}

function getNormalSideFromType(type) {
    const normalized = String(type || "").trim().toLowerCase();
    return normalized === "asset" || normalized === "expense" ? "debit" : "credit";
}

export async function renderGeneralLedgers(context = {}) {
    const scopeBranchId = String(context?.branchScope?.branchId || "").trim();
    const selectedBranchId = String(context?.branchScope?.selectedBranchId || "").trim();
    const canSelectAll = Boolean(context?.branchScope?.canSelectAll);
    const [accounts, branches, accountProducts] = await Promise.all([
        getGeneralLedgerAccounts(),
        getBranchesForCurrentBusiness(),
        getAccountProducts()
    ]);
    const headOfficeBranchId = String((branches || []).find((branch) => branch.isHeadOffice)?.id || "").trim();
    const scopedAccounts = scopeBranchId
        ? accounts.filter((account) => !account.branchId || String(account.branchId) === scopeBranchId)
        : accounts;
    const recentAccounts = scopedAccounts.slice(0, 10);
    const productRows = accountProducts.slice(0, 10);

    return {
        summary: [],
        content: `
            <div class="section-stack">
                <div class="module-header">
                    <div>
                        <p class="eyebrow">Account structure</p>
                        <h2>Chart of Accounts</h2>
                    </div>
                </div>
                <div class="button-row demo-tabbar gl-overview-actions mt-18">
                    <button class="btn btn-primary" type="button" data-open-ledger-workspace="ledger">General Ledger Management</button>
                    <button class="btn btn-secondary" type="button" data-open-ledger-workspace="product">Product GL Setup</button>
                </div>

                <section class="panel">
                    <div class="module-header">
                        <div>
                            <p class="eyebrow">Chart overview</p>
                            <h3>Chart of Accounts Summary</h3>
                        </div>
                    </div>
                    <div class="gl-overview-cards mt-18">
                        <article class="gl-summary-card gl-overview-card">
                            <span>Total GL</span>
                            <strong data-ledger-total-gl>${scopedAccounts.length}</strong>
                        </article>
                        <article class="gl-summary-card gl-overview-card">
                            <span>Total Product Account</span>
                            <strong data-ledger-total-product>${accountProducts.length}</strong>
                        </article>
                    </div>
                </section>

                <div class="business-modal" data-ledger-workspace-modal="ledger" hidden>
                    <div class="business-modal__backdrop" data-ledger-workspace-close></div>
                    <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="generalLedgerWorkspaceTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Account structure</p>
                                <h3 id="generalLedgerWorkspaceTitle">General Ledger Management</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-ledger-workspace-close>&times;</button>
                        </div>
                        <div class="gl-statement-modal__content">
                            <section class="panel">
                                <form class="form-grid" id="generalLedgerForm">
                                    <div class="triple-grid">
                                        <label class="form-field">
                                            <span>Account Type</span>
                                            <select name="account_type" required>
                                                ${GENERAL_LEDGER_TYPES.map((type) => `<option value="${type.value}">${type.label}</option>`).join("")}
                                            </select>
                                        </label>
                                        ${canSelectAll ? `
                                            <label class="form-field">
                                                <span>Branch Scope</span>
                                                <select name="branch_id">
                                                    ${branches.map((branch) => `<option value="${branch.id}" ${String(branch.id || "") === selectedBranchId ? "selected" : ""}>${branch.name}</option>`).join("")}
                                                </select>
                                            </label>
                                        ` : `
                                            <label class="form-field">
                                                <span>Branch Scope</span>
                                                <input type="text" value="${context?.branchScope?.label || "Active Branch"}" readonly>
                                                <input name="branch_id" type="hidden" value="${scopeBranchId}">
                                            </label>
                                        `}
                                        <label class="form-field">
                                            <span>Normal Side</span>
                                            <input name="normal_side_display" type="text" value="Debit" readonly>
                                        </label>
                                        <label class="form-field">
                                            <span>Category</span>
                                            <select name="category_name" data-ledger-category-select required>
                                                <option value="">Select category</option>
                                            </select>
                                            <button class="text-btn" type="button" data-open-category-modal>Add New Category</button>
                                        </label>
                                        <label class="form-field">
                                            <span>Account Name</span>
                                            <input name="account_name" type="text" maxlength="120" placeholder="GTBank Current Account" required>
                                        </label>
                                        <label class="form-field">
                                            <span>Account Code</span>
                                            <input name="account_code" type="text" value="" placeholder="Auto-generated" readonly>
                                        </label>
                                    </div>
                                    <div class="button-row">
                                        <button class="btn btn-primary" type="submit" data-ledger-submit>
                                            <span class="btn-label">Create Ledger</span>
                                            <span class="spinner" aria-hidden="true"></span>
                                        </button>
                                        <p class="muted" id="generalLedgerStatus">Select an account type and category. Ledger code and normal side are auto-generated.</p>
                                    </div>
                                </form>
                            </section>
                            <section class="panel">
                                <div class="module-header">
                                    <div>
                                        <p class="eyebrow">Recent GL created</p>
                                        <h3>General Ledger Management</h3>
                                    </div>
                                </div>
                                ${createTable(
                                    ["Code", "Ledger Account", "Category", "Branch Scope", "Type", "Normal Side", "Status", "Created"],
                                    recentAccounts.map((account) => [
                                        account.code,
                                        account.name,
                                        account.categoryName || "-",
                                        account.branchName || "Head Office",
                                        formatType(account.type),
                                        formatType(account.normalSide),
                                        account.status,
                                        formatDateTime(account.createdAt)
                                    ])
                                )}
                            </section>
                        </div>
                    </div>
                </div>

                <div class="business-modal" data-ledger-workspace-modal="product" hidden>
                    <div class="business-modal__backdrop" data-ledger-workspace-close></div>
                    <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="productGlWorkspaceTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Account structure</p>
                                <h3 id="productGlWorkspaceTitle">Product GL Setup</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-ledger-workspace-close>&times;</button>
                        </div>
                        <div class="gl-statement-modal__content">
                            <section class="panel">
                                <form class="form-grid" id="accountProductForm">
                                    <div class="triple-grid">
                                        <label class="form-field">
                                            <span>Product Name</span>
                                            <input name="product_name" type="text" maxlength="120" placeholder="Savings Account" required>
                                        </label>
                                        <label class="form-field">
                                            <span>Generated GL Name</span>
                                            <input name="generated_gl_name" type="text" value="" placeholder="Product name appears automatically" readonly>
                                        </label>
                                        <label class="form-field">
                                            <span>Generated GO Name</span>
                                            <input name="generated_go_name" type="text" value="" placeholder="GO - Product name appears automatically" readonly>
                                        </label>
                                    </div>
                                    <div class="button-row">
                                        <button class="btn btn-primary" type="submit" data-account-product-submit>
                                            <span class="btn-label">Create Product</span>
                                            <span class="spinner" aria-hidden="true"></span>
                                        </button>
                                        <p class="muted" data-account-product-status">Create a product type and let the system generate separate GL and GO accounts for it.</p>
                                    </div>
                                </form>
                            </section>
                            <section class="panel">
                                <div class="module-header">
                                    <div>
                                        <p class="eyebrow">Recent products</p>
                                        <h3>Product GL Setup</h3>
                                    </div>
                                </div>
                                <div data-ledger-product-table>
                                    ${createTable(
                                        ["Product Type", "Generated GL", "Generated GO", "Status", "Created"],
                                        productRows.map((product) => [
                                            product.name,
                                            product.productGlCode ? `${product.productGlCode} - ${product.productGlName || product.name}` : "-",
                                            product.generalOverdraftLabel || "-",
                                            product.status,
                                            formatDateTime(product.createdAt)
                                        ])
                                    )}
                                </div>
                            </section>
                        </div>
                    </div>
                </div>

                <div class="business-modal" data-ledger-category-modal hidden>
                    <div class="business-modal__backdrop" data-ledger-category-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="ledgerCategoryTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Chart setup</p>
                                <h3 id="ledgerCategoryTitle">Add New Category</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-ledger-category-close>&times;</button>
                        </div>
                        <form class="form-grid" data-ledger-category-form>
                            <div class="dual-grid">
                                <label class="form-field">
                                    <span>GL Type</span>
                                    <select name="account_type" required>
                                        ${GENERAL_LEDGER_TYPES.map((type) => `<option value="${type.value}">${type.label}</option>`).join("")}
                                    </select>
                                </label>
                                <label class="form-field">
                                    <span>Category Name</span>
                                    <input name="category_name" type="text" maxlength="120" placeholder="e.g. Bank, Receivables" required>
                                </label>
                            </div>
                            <div class="button-row">
                                <button class="btn btn-primary" type="submit" data-ledger-category-submit>
                                    <span class="btn-label">Save Category</span>
                                    <span class="spinner" aria-hidden="true"></span>
                                </button>
                                <p class="muted" data-ledger-category-status>Create category and use it in GL creation.</p>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `,
        afterRender(container, refresh) {
            const workspaceButtons = Array.from(container.querySelectorAll("[data-open-ledger-workspace]"));
            const workspaceModals = Array.from(container.querySelectorAll("[data-ledger-workspace-modal]"));
            const form = container.querySelector("#generalLedgerForm");
            const status = container.querySelector("#generalLedgerStatus");
            const submitButton = container.querySelector("[data-ledger-submit]");
            const createCodeInput = form?.querySelector('input[name="account_code"]');
            const createTypeSelect = form?.querySelector('select[name="account_type"]');
            const createSideInput = form?.querySelector('input[name="normal_side_display"]');
            const categorySelect = form?.querySelector("[data-ledger-category-select]");
            const openCategoryModalButton = form?.querySelector("[data-open-category-modal]");
            const categoryModal = container.querySelector("[data-ledger-category-modal]");
            const categoryModalForm = container.querySelector("[data-ledger-category-form]");
            const categoryModalStatus = container.querySelector("[data-ledger-category-status]");
            const categoryModalSubmit = container.querySelector("[data-ledger-category-submit]");
            const categoryModalTypeSelect = categoryModalForm?.querySelector('select[name="account_type"]');
            const accountProductForm = container.querySelector("#accountProductForm");
            const accountProductStatus = container.querySelector("[data-account-product-status]");
            const accountProductSubmit = container.querySelector("[data-account-product-submit]");
            const productNameInput = accountProductForm?.querySelector('input[name="product_name"]');
            const generatedGlNameInput = accountProductForm?.querySelector('input[name="generated_gl_name"]');
            const generatedGoNameInput = accountProductForm?.querySelector('input[name="generated_go_name"]');
            const overviewTotalGlNode = container.querySelector("[data-ledger-total-gl]");
            const overviewTotalProductNode = container.querySelector("[data-ledger-total-product]");
            const recentProductTableWrap = container.querySelector("[data-ledger-product-table]");

            const openWorkspaceModal = (modalKey) => {
                workspaceModals.forEach((modal) => {
                    const isTarget = String(modal.getAttribute("data-ledger-workspace-modal") || "") === modalKey;
                    modal.hidden = !isTarget;
                });
            };

            const closeWorkspaceModal = (modal) => {
                if (!modal) {
                    return;
                }
                modal.hidden = true;
            };

            workspaceButtons.forEach((button) => {
                button.addEventListener("click", () => {
                    openWorkspaceModal(String(button.getAttribute("data-open-ledger-workspace") || "ledger"));
                });
            });
            workspaceModals.forEach((modal) => {
                modal.querySelectorAll(".business-modal__close[data-ledger-workspace-close]").forEach((control) => {
                    control.addEventListener("click", () => closeWorkspaceModal(modal));
                });
            });

            const syncCreateAutoFields = async () => {
                if (!createTypeSelect || !createSideInput) {
                    return;
                }

                const type = createTypeSelect.value;
                createSideInput.value = formatType(getNormalSideFromType(type));

                if (categorySelect) {
                    try {
                        const categories = await getGeneralLedgerCategories(type);
                        const optionNodes = categories.map((item) => {
                            const option = document.createElement("option");
                            option.value = item.name;
                            option.textContent = item.code ? `${item.code} - ${item.name}` : item.name;
                            return option;
                        });
                        const defaultOption = document.createElement("option");
                        defaultOption.value = "";
                        defaultOption.textContent = "Select category";
                        categorySelect.replaceChildren(defaultOption, ...optionNodes);
                    } catch {
                        const defaultOption = document.createElement("option");
                        defaultOption.value = "";
                        defaultOption.textContent = "Select category";
                        categorySelect.replaceChildren(defaultOption);
                    }
                    categorySelect.value = "";
                }

                if (createCodeInput) {
                    createCodeInput.value = "";
                    createCodeInput.placeholder = "Select category first";
                }
            };

            const syncCreateCodePreview = async () => {
                if (!createTypeSelect || !createCodeInput) {
                    return;
                }

                const categoryName = String(categorySelect?.value || "").trim();
                if (!categoryName) {
                    createCodeInput.value = "";
                    createCodeInput.placeholder = "Select category first";
                    return;
                }

                try {
                    const code = await getNextGeneralLedgerCode(createTypeSelect.value, categoryName);
                    createCodeInput.value = code || "";
                    createCodeInput.placeholder = "Auto-generated";
                } catch {
                    createCodeInput.value = "";
                    createCodeInput.placeholder = "Auto-generated";
                }
            };

            createTypeSelect?.addEventListener("change", () => {
                void syncCreateAutoFields();
            });
            categorySelect?.addEventListener("change", () => {
                void syncCreateCodePreview();
            });
            void syncCreateAutoFields();

            const syncProductNamePreview = () => {
                const productName = String(productNameInput?.value || "").trim();
                if (generatedGlNameInput) {
                    generatedGlNameInput.value = productName;
                }
                if (generatedGoNameInput) {
                    generatedGoNameInput.value = productName ? `GO - ${productName}` : "";
                }
            };

            productNameInput?.addEventListener("input", syncProductNamePreview);
            syncProductNamePreview();

            const renderProductTableMarkup = (products = []) => createTable(
                ["Product Type", "Generated GL", "Generated GO", "Status", "Created"],
                products.map((product) => [
                    product.name,
                    product.productGlCode ? `${product.productGlCode} - ${product.productGlName || product.name}` : "-",
                    product.generalOverdraftLabel || "-",
                    product.status,
                    formatDateTime(product.createdAt)
                ])
            );

            const refreshProductOverview = async () => {
                const [latestAccounts, latestProducts] = await Promise.all([
                    getGeneralLedgerAccounts(),
                    getAccountProducts()
                ]);
                const latestScopedAccounts = scopeBranchId
                    ? latestAccounts.filter((account) => !account.branchId || String(account.branchId) === scopeBranchId)
                    : latestAccounts;
                if (overviewTotalGlNode) {
                    overviewTotalGlNode.textContent = String(latestScopedAccounts.length);
                }
                if (overviewTotalProductNode) {
                    overviewTotalProductNode.textContent = String(latestProducts.length);
                }
                if (recentProductTableWrap) {
                    recentProductTableWrap.innerHTML = renderProductTableMarkup(latestProducts.slice(0, 10));
                }
            };

            const openCategoryModal = () => {
                if (!categoryModal) {
                    return;
                }
                categoryModal.hidden = false;
                if (categoryModalTypeSelect && createTypeSelect) {
                    categoryModalTypeSelect.value = String(createTypeSelect.value || "asset");
                }
                categoryModalForm?.querySelector('input[name="category_name"]')?.focus();
            };

            const closeCategoryModal = () => {
                if (!categoryModal) {
                    return;
                }
                categoryModal.hidden = true;
            };

            openCategoryModalButton?.addEventListener("click", openCategoryModal);
            categoryModal?.querySelectorAll(".business-modal__close[data-ledger-category-close]").forEach((control) => {
                control.addEventListener("click", closeCategoryModal);
            });

            categoryModalForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!categoryModalForm) {
                    return;
                }

                const formData = new FormData(categoryModalForm);
                const modalType = String(formData.get("account_type") || "").trim();
                const modalCategory = String(formData.get("category_name") || "").trim();

                if (categoryModalStatus) {
                    categoryModalStatus.textContent = "Saving category...";
                }
                setSubmittingState(categoryModalSubmit, true);
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    await createGeneralLedgerCategory({
                        account_type: modalType,
                        category_name: modalCategory
                    });

                    if (categoryModalStatus) {
                        categoryModalStatus.textContent = "Category saved.";
                    }
                    showToast("Category created.");

                    if (createTypeSelect) {
                        createTypeSelect.value = modalType;
                    }
                    await syncCreateAutoFields();
                    if (categorySelect) {
                        categorySelect.value = modalCategory;
                    }
                    await syncCreateCodePreview();

                    categoryModalForm.reset();
                    closeCategoryModal();
                } catch (error) {
                    const message = error?.message || "Unable to create category.";
                    if (categoryModalStatus) {
                        categoryModalStatus.textContent = message;
                    }
                    showToast(message);
                } finally {
                    setSubmittingState(categoryModalSubmit, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });

            form?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!form) {
                    return;
                }

                const data = new FormData(form);
                const resolvedCategory = String(data.get("category_name") || "").trim();

                status.textContent = "Creating ledger...";
                setSubmittingState(submitButton, true);
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    await createGeneralLedgerAccount({
                        account_name: String(data.get("account_name") || ""),
                        account_type: String(data.get("account_type") || ""),
                        category_name: resolvedCategory,
                        branch_id: canSelectAll
                            ? (headOfficeBranchId && String(data.get("branch_id") || "").trim() === headOfficeBranchId
                                ? ""
                                : String(data.get("branch_id") || "").trim())
                            : scopeBranchId
                    });

                    status.textContent = "Ledger created successfully.";
                    showToast("General ledger created.");
                    form.reset();
                    void syncCreateAutoFields();
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                } catch (error) {
                    const message = error?.message || "Unable to create ledger.";
                    status.textContent = message;
                    showToast(message);
                } finally {
                    setSubmittingState(submitButton, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });

            accountProductForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!accountProductForm) {
                    return;
                }

                const data = new FormData(accountProductForm);
                if (accountProductStatus) {
                    accountProductStatus.textContent = "Creating product...";
                }
                setSubmittingState(accountProductSubmit, true);
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    await createAccountProduct({
                        product_name: String(data.get("product_name") || "").trim()
                    });

                    if (accountProductStatus) {
                        accountProductStatus.textContent = "Product created successfully.";
                    }
                    showToast("Account product created.");
                    accountProductForm.reset();
                    syncProductNamePreview();
                    await refreshProductOverview();
                } catch (error) {
                    const message = error?.message || "Unable to create account product.";
                    if (accountProductStatus) {
                        accountProductStatus.textContent = message;
                    }
                    showToast(message);
                } finally {
                    setSubmittingState(accountProductSubmit, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });

        }
    };
}
