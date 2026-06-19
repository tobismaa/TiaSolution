import { createTable, formatCurrency } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import {
    createAssetWithCapitalization,
    disposeAsset,
    getAssetSetupData,
    getAssets,
    runMonthlyAssetCharge,
    updateAsset
} from "./assets-service.js";

let activeAssetTabState = "post";

function setSubmittingState(button, isSubmitting) {
    if (!button) {
        return;
    }
    button.disabled = isSubmitting;
    button.classList.toggle("is-loading", isSubmitting);
    button.setAttribute("aria-busy", String(isSubmitting));
}

function formatDate(value) {
    const text = String(value || "").trim();
    if (!text) return "-";
    const date = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return text;
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Africa/Lagos"
    }).format(date);
}

function normalizeBranchScopeId(branchScope) {
    return String(branchScope?.branchId || "").trim();
}

function buildAccountOptions(accounts, filterFn = null) {
    return (accounts || [])
        .filter((account) => (typeof filterFn === "function" ? filterFn(account) : true))
        .map((account) => `<option value="${account.id}">${account.code} - ${account.name}</option>`)
        .join("");
}

function buildAssetOptions(assets) {
    return (assets || [])
        .filter((asset) => String(asset.status || "").toLowerCase() === "active")
        .map((asset) => `<option value="${asset.id}">${asset.name} (${asset.branchName || "Head Office"})</option>`)
        .join("");
}

function renderAssetViewContent(asset) {
    if (!asset) {
        return `<p class="muted">No asset selected.</p>`;
    }
    return `
        <div class="stack-list">
            <div class="stack-item"><span>Asset Name</span><strong>${asset.name}</strong></div>
            <div class="stack-item"><span>Status</span><strong>${asset.status}</strong></div>
            <div class="stack-item"><span>Method</span><strong>${asset.method === "amortization" ? "Amortization" : "Depreciation"}</strong></div>
            <div class="stack-item"><span>Acquisition Date</span><strong>${formatDate(asset.acquisitionDate)}</strong></div>
            <div class="stack-item"><span>Depreciation End</span><strong>${formatDate(asset.depreciationEndDate)}</strong></div>
            <div class="stack-item"><span>Capitalization Amount</span><strong>${formatCurrency(asset.amount)}</strong></div>
            <div class="stack-item"><span>Monthly Charge</span><strong>${formatCurrency(asset.monthlyCharge)}</strong></div>
            <div class="stack-item"><span>Accumulated</span><strong>${formatCurrency(asset.accumulatedDepreciation)}</strong></div>
            <div class="stack-item"><span>Net Book Value</span><strong>${formatCurrency(asset.netBookValue)}</strong></div>
            <div class="stack-item"><span>Useful Life (Months)</span><strong>${asset.usefulLifeMonths}</strong></div>
            <div class="stack-item"><span>Posted Runs</span><strong>${asset.postedRunCount}</strong></div>
            <div class="stack-item"><span>Disposal Date</span><strong>${formatDate(asset.disposalDate)}</strong></div>
        </div>
    `;
}

export async function renderAssets(context = {}) {
    const setup = await getAssetSetupData();
    const branchScope = context?.branchScope || {};
    const scopeBranchId = normalizeBranchScopeId(branchScope);
    const selectedBranchId = String(branchScope?.selectedBranchId || "").trim();
    const assets = await getAssets({ branchId: scopeBranchId });
    const canSelectAllBranches = Boolean(branchScope?.canSelectAll);
    const headOfficeBranchId = String((setup.branches || []).find((branch) => branch.isHeadOffice)?.id || "").trim();

    const capitalizationOptions = buildAccountOptions(setup.accounts, (account) =>
        ["asset"].includes(String(account.type || "").toLowerCase())
    );
    const offsetOptions = buildAccountOptions(setup.accounts);
    const expenseOptions = buildAccountOptions(setup.accounts, (account) =>
        ["expense"].includes(String(account.type || "").toLowerCase())
    );
    const contraOptions = buildAccountOptions(setup.accounts, (account) =>
        ["asset", "liability"].includes(String(account.type || "").toLowerCase())
    );
    const proceedsOptions = buildAccountOptions(setup.accounts, (account) =>
        ["asset"].includes(String(account.type || "").toLowerCase())
    );
    const gainLossOptions = buildAccountOptions(setup.accounts, (account) =>
        ["revenue", "expense", "equity"].includes(String(account.type || "").toLowerCase())
    );
    const activeAssetOptions = buildAssetOptions(assets);
    const activeAssets = assets.filter((asset) => String(asset.status || "").toLowerCase() === "active");
    const disposedAssets = assets.filter((asset) => String(asset.status || "").toLowerCase() === "disposed");
    const totalAssetValue = assets.reduce((sum, asset) => sum + Number(asset.amount || 0), 0);
    const totalMonthlyCharge = activeAssets.reduce((sum, asset) => sum + Number(asset.monthlyCharge || 0), 0);

    return {
        summary: [],
        content: `
            <div class="section-stack">
                <div class="demo-tabbar" role="tablist" aria-label="Asset tabs">
                    <button class="btn btn-primary" type="button" data-assets-tab="post" aria-selected="true">Post Asset</button>
                    <button class="btn btn-secondary" type="button" data-assets-tab="management" aria-selected="false">Management</button>
                    <button class="btn btn-secondary" type="button" data-assets-tab="disposal" aria-selected="false">Disposal</button>
                    <button class="btn btn-secondary" type="button" data-assets-tab="report" aria-selected="false">Report</button>
                </div>

                <section class="panel" data-assets-panel="post">
                    <div class="module-header">
                        <div>
                            <p class="eyebrow">Asset capitalization</p>
                            <h2>Post Asset</h2>
                        </div>
                    </div>
                    <form class="form-grid mt-18" data-asset-form>
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Asset Name</span>
                                <input name="asset_name" type="text" maxlength="140" placeholder="Vehicle - Toyota Corolla" required>
                            </label>
                            <label class="form-field">
                                <span>Acquisition Date</span>
                                <input name="acquisition_date" type="date" required>
                            </label>
                            <label class="form-field">
                                <span>Asset Value</span>
                                <input name="capitalization_amount" type="number" min="0.01" step="0.01" placeholder="0.00" required>
                            </label>
                            <label class="form-field">
                                <span>Method</span>
                                <select name="depreciation_method" required>
                                    <option value="depreciation">Depreciation</option>
                                    <option value="amortization">Amortization</option>
                                </select>
                            </label>
                            <label class="form-field">
                                <span>Useful Life (Months)</span>
                                <input name="useful_life_months" type="number" min="1" step="1" placeholder="60" required>
                            </label>
                            <label class="form-field">
                                <span>Salvage Value</span>
                                <input name="salvage_value" type="number" min="0" step="0.01" value="0.00">
                            </label>
                            ${canSelectAllBranches ? `
                                <label class="form-field">
                                    <span>Branch Scope</span>
                                    <select name="branch_id">
                                        ${setup.branches.map((branch) => `<option value="${branch.id}" ${String(branch.id || "") === selectedBranchId ? "selected" : ""}>${branch.name}</option>`).join("")}
                                    </select>
                                </label>
                            ` : `
                                <label class="form-field">
                                    <span>Branch Scope</span>
                                    <input type="text" readonly value="${branchScope?.label || setup.activeBranch?.name || "Active Branch"}">
                                    <input name="branch_id" type="hidden" value="${scopeBranchId || setup.activeBranch?.id || ""}">
                                </label>
                            `}
                        </div>
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Capitalization GL (Asset)</span>
                                <select name="capitalization_account_id" required>
                                    <option value="">Select GL account</option>
                                    ${capitalizationOptions}
                                </select>
                            </label>
                            <label class="form-field">
                                <span>Offset GL (Credit)</span>
                                <select name="offset_account_id" required>
                                    <option value="">Select GL account</option>
                                    ${offsetOptions}
                                </select>
                            </label>
                            <label class="form-field">
                                <span>Expense GL (Monthly Charge)</span>
                                <select name="expense_account_id" required>
                                    <option value="">Select GL account</option>
                                    ${expenseOptions}
                                </select>
                            </label>
                            <label class="form-field">
                                <span>Accumulated GL (Contra)</span>
                                <select name="contra_account_id" required>
                                    <option value="">Select GL account</option>
                                    ${contraOptions}
                                </select>
                            </label>
                        </div>
                        <div class="button-row">
                            <button class="btn btn-primary" type="submit" data-asset-create-submit>
                                <span class="btn-label">Create Asset & Capitalize</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <p class="muted" data-asset-status>
                                Capitalization posts immediately to GL.
                            </p>
                        </div>
                    </form>
                </section>

                <section class="panel" data-assets-panel="management" hidden>
                    <div class="module-header">
                        <div>
                            <p class="eyebrow">Asset register</p>
                            <h3>Asset Management</h3>
                        </div>
                    </div>
                    <div class="button-row mt-18">
                        <button class="btn btn-secondary" type="button" data-asset-run-monthly>
                            <span class="btn-label">Run Monthly Auto ${" "}Depreciation / Amortization</span>
                            <span class="spinner" aria-hidden="true"></span>
                        </button>
                        <p class="muted" data-asset-management-status>
                            Monthly charges post automatically when due.
                        </p>
                    </div>
                    ${createTable(
                        ["Asset", "Status", "Method", "Acquired", "Amount", "Monthly", "Life (Months)", "Depreciation End", "Disposal Date", "Action"],
                        assets.map((asset) => [
                            asset.name,
                            asset.status || (asset.isActive ? "Active" : "Paused"),
                            asset.method === "amortization" ? "Amortization" : "Depreciation",
                            formatDate(asset.acquisitionDate),
                            formatCurrency(asset.amount),
                            formatCurrency(asset.monthlyCharge),
                            String(asset.usefulLifeMonths || 0),
                            formatDate(asset.depreciationEndDate),
                            formatDate(asset.disposalDate),
                            `<div class="button-row">
                                <button class="btn btn-secondary" type="button" data-asset-view="${asset.id}">View</button>
                                <button class="btn btn-secondary" type="button" data-asset-edit="${asset.id}" ${String(asset.status || "").toLowerCase() === "disposed" ? "disabled" : ""}>Edit</button>
                            </div>`
                        ])
                    )}
                </section>

                <section class="panel" data-assets-panel="disposal" hidden>
                    <div class="module-header">
                        <div>
                            <p class="eyebrow">Asset exit</p>
                            <h3>Disposal</h3>
                        </div>
                    </div>
                    <form class="form-grid mt-18" data-asset-disposal-form>
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Asset</span>
                                <select name="asset_id" required>
                                    <option value="">Select active asset</option>
                                    ${activeAssetOptions}
                                </select>
                            </label>
                            <label class="form-field">
                                <span>Disposal Date</span>
                                <input name="disposal_date" type="date" required>
                            </label>
                            <label class="form-field">
                                <span>Disposal Proceeds</span>
                                <input name="proceeds_amount" type="number" min="0" step="0.01" value="0.00" required>
                            </label>
                            <label class="form-field">
                                <span>Proceeds GL</span>
                                <select name="proceeds_account_id" required>
                                    <option value="">Select proceeds GL</option>
                                    ${proceedsOptions}
                                </select>
                            </label>
                            <label class="form-field">
                                <span>Gain/Loss GL</span>
                                <select name="gain_loss_account_id" required>
                                    <option value="">Select gain/loss GL</option>
                                    ${gainLossOptions}
                                </select>
                            </label>
                        </div>
                        <div class="button-row">
                            <button class="btn btn-primary" type="submit" data-asset-dispose-submit>
                                <span class="btn-label">Dispose Asset</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <p class="muted" data-asset-disposal-status>
                                Disposal posts GL entry automatically and closes the asset.
                            </p>
                        </div>
                    </form>
                </section>

                <section class="panel" data-assets-panel="report" hidden>
                    <div class="module-header">
                        <div>
                            <p class="eyebrow">Asset reporting</p>
                            <h3>Asset Report</h3>
                        </div>
                    </div>
                    <div class="summary-grid mt-18">
                        <article class="summary-card">
                            <p class="muted">Total Assets</p>
                            <h3>${assets.length}</h3>
                            <span class="trend up">Registered assets</span>
                        </article>
                        <article class="summary-card">
                            <p class="muted">Active Assets</p>
                            <h3>${activeAssets.length}</h3>
                            <span class="trend up">In service</span>
                        </article>
                        <article class="summary-card">
                            <p class="muted">Disposed Assets</p>
                            <h3>${disposedAssets.length}</h3>
                            <span class="trend warn">Archived</span>
                        </article>
                    </div>
                    <div class="summary-grid mt-18">
                        <article class="summary-card">
                            <p class="muted">Total Capitalized Value</p>
                            <h3>${formatCurrency(totalAssetValue)}</h3>
                            <span class="trend up">Asset base</span>
                        </article>
                        <article class="summary-card">
                            <p class="muted">Monthly Charge (Active)</p>
                            <h3>${formatCurrency(totalMonthlyCharge)}</h3>
                            <span class="trend down">Depreciation/Amortization</span>
                        </article>
                    </div>
                </section>

                <div class="business-modal" data-asset-view-modal hidden>
                    <div class="business-modal__backdrop" data-asset-view-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="assetViewTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Asset detail</p>
                                <h3 id="assetViewTitle">Asset Information</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-asset-view-close>&times;</button>
                        </div>
                        <div data-asset-view-content>
                            <p class="muted">No asset selected.</p>
                        </div>
                    </div>
                </div>

                <div class="business-modal" data-asset-edit-modal hidden>
                    <div class="business-modal__backdrop" data-asset-edit-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="assetEditTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Asset update</p>
                                <h3 id="assetEditTitle">Edit Asset</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-asset-edit-close>&times;</button>
                        </div>
                        <form class="form-grid" data-asset-edit-form>
                            <input type="hidden" name="asset_id">
                            <div class="triple-grid">
                                <label class="form-field">
                                    <span>Asset Name</span>
                                    <input name="asset_name" type="text" maxlength="140" required>
                                </label>
                                <label class="form-field">
                                    <span>Method</span>
                                    <select name="depreciation_method" required>
                                        <option value="depreciation">Depreciation</option>
                                        <option value="amortization">Amortization</option>
                                    </select>
                                </label>
                                <label class="form-field">
                                    <span>Useful Life (Months)</span>
                                    <input name="useful_life_months" type="number" min="1" step="1" required>
                                </label>
                                <label class="form-field">
                                    <span>Salvage Value</span>
                                    <input name="salvage_value" type="number" min="0" step="0.01" required>
                                </label>
                            </div>
                            <div class="button-row">
                                <button class="btn btn-primary" type="submit" data-asset-edit-submit>
                                    <span class="btn-label">Save Asset</span>
                                    <span class="spinner" aria-hidden="true"></span>
                                </button>
                                <p class="muted" data-asset-edit-status>Edit updates schedule values for future runs.</p>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `,
        afterRender(container, refresh) {
            const tabButtons = Array.from(container.querySelectorAll("[data-assets-tab]"));
            const tabPanels = Array.from(container.querySelectorAll("[data-assets-panel]"));
            const setActiveTab = (tabKey) => {
                tabButtons.forEach((button) => {
                    const isActive = String(button.getAttribute("data-assets-tab") || "") === tabKey;
                    button.classList.toggle("btn-primary", isActive);
                    button.classList.toggle("btn-secondary", !isActive);
                    button.setAttribute("aria-selected", String(isActive));
                });
                tabPanels.forEach((panel) => {
                    panel.hidden = String(panel.getAttribute("data-assets-panel") || "") !== tabKey;
                });
                activeAssetTabState = tabKey;
            };
            tabButtons.forEach((button) => {
                button.addEventListener("click", () => {
                    setActiveTab(String(button.getAttribute("data-assets-tab") || "post"));
                });
            });
            const savedTab = String(activeAssetTabState || "post").toLowerCase();
            const initialTab = ["post", "management", "disposal", "report"].includes(savedTab) ? savedTab : "post";
            setActiveTab(initialTab);

            const form = container.querySelector("[data-asset-form]");
            const statusNode = container.querySelector("[data-asset-status]");
            const createButton = container.querySelector("[data-asset-create-submit]");
            const runMonthlyButton = container.querySelector("[data-asset-run-monthly]");
            const managementStatusNode = container.querySelector("[data-asset-management-status]");
            const disposalForm = container.querySelector("[data-asset-disposal-form]");
            const disposalStatusNode = container.querySelector("[data-asset-disposal-status]");
            const disposeButton = container.querySelector("[data-asset-dispose-submit]");
            const viewModal = container.querySelector("[data-asset-view-modal]");
            const viewContent = container.querySelector("[data-asset-view-content]");
            const viewCloseControls = Array.from(container.querySelectorAll(".business-modal__close[data-asset-view-close]"));
            const editModal = container.querySelector("[data-asset-edit-modal]");
            const editForm = container.querySelector("[data-asset-edit-form]");
            const editSubmitButton = container.querySelector("[data-asset-edit-submit]");
            const editStatusNode = container.querySelector("[data-asset-edit-status]");
            const editCloseControls = Array.from(container.querySelectorAll(".business-modal__close[data-asset-edit-close]"));

            const openViewModal = (asset) => {
                if (viewContent) {
                    viewContent.innerHTML = renderAssetViewContent(asset);
                }
                if (viewModal) {
                    viewModal.hidden = false;
                }
            };
            const closeViewModal = () => {
                if (viewModal) {
                    viewModal.hidden = true;
                }
            };
            viewCloseControls.forEach((control) => control.addEventListener("click", closeViewModal));

            const openEditModal = (asset) => {
                if (!editForm || !asset) {
                    return;
                }
                const idInput = editForm.querySelector('input[name="asset_id"]');
                const nameInput = editForm.querySelector('input[name="asset_name"]');
                const methodInput = editForm.querySelector('select[name="depreciation_method"]');
                const lifeInput = editForm.querySelector('input[name="useful_life_months"]');
                const salvageInput = editForm.querySelector('input[name="salvage_value"]');
                if (idInput) idInput.value = asset.id || "";
                if (nameInput) nameInput.value = asset.name || "";
                if (methodInput) methodInput.value = asset.method || "depreciation";
                if (lifeInput) lifeInput.value = String(asset.usefulLifeMonths || 1);
                if (salvageInput) salvageInput.value = String(Number(asset.salvageValue || 0).toFixed(2));
                if (editStatusNode) {
                    editStatusNode.textContent = "Edit updates schedule values for future runs.";
                }
                if (editModal) {
                    editModal.hidden = false;
                }
            };
            const closeEditModal = () => {
                if (editModal) {
                    editModal.hidden = true;
                }
            };
            editCloseControls.forEach((control) => control.addEventListener("click", closeEditModal));

            container.addEventListener("click", (event) => {
                const viewBtn = event.target.closest("[data-asset-view]");
                if (viewBtn) {
                    const id = String(viewBtn.getAttribute("data-asset-view") || "").trim();
                    const target = assets.find((asset) => String(asset.id || "") === id);
                    openViewModal(target);
                    return;
                }
                const editBtn = event.target.closest("[data-asset-edit]");
                if (editBtn) {
                    const id = String(editBtn.getAttribute("data-asset-edit") || "").trim();
                    const target = assets.find((asset) => String(asset.id || "") === id);
                    if (!target || String(target.status || "").toLowerCase() === "disposed") {
                        showToast("Disposed asset cannot be edited.");
                        return;
                    }
                    openEditModal(target);
                }
            });

            form?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!form) {
                    return;
                }

                const data = new FormData(form);
                setSubmittingState(createButton, true);
                statusNode.textContent = "Creating asset and posting capitalization...";
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    const result = await createAssetWithCapitalization({
                        asset_name: String(data.get("asset_name") || ""),
                        acquisition_date: String(data.get("acquisition_date") || ""),
                        capitalization_amount: Number(data.get("capitalization_amount") || 0),
                        depreciation_method: String(data.get("depreciation_method") || ""),
                        useful_life_months: Number(data.get("useful_life_months") || 0),
                        salvage_value: Number(data.get("salvage_value") || 0),
                        branch_id: headOfficeBranchId && String(data.get("branch_id") || "").trim() === headOfficeBranchId
                            ? ""
                            : String(data.get("branch_id") || "").trim(),
                        capitalization_account_id: String(data.get("capitalization_account_id") || ""),
                        offset_account_id: String(data.get("offset_account_id") || ""),
                        expense_account_id: String(data.get("expense_account_id") || ""),
                        contra_account_id: String(data.get("contra_account_id") || "")
                    });

                    statusNode.textContent = `Asset created. Capitalization reference: ${result.capitalizationReference}.`;
                    showToast(`Asset capitalization posted: ${result.capitalizationReference}`);
                    activeAssetTabState = "management";
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                } catch (error) {
                    const message = error?.message || "Unable to create asset.";
                    statusNode.textContent = message;
                    showToast(message);
                } finally {
                    setSubmittingState(createButton, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });

            runMonthlyButton?.addEventListener("click", async () => {
                setSubmittingState(runMonthlyButton, true);
                if (managementStatusNode) {
                    managementStatusNode.textContent = "Running monthly auto charges...";
                }
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    const result = await runMonthlyAssetCharge({ branchId: scopeBranchId });
                    if (result.posted > 0) {
                        if (managementStatusNode) {
                            managementStatusNode.textContent = `${result.posted} monthly charge posting(s) created. Last reference: ${result.references[result.references.length - 1]}.`;
                        }
                        showToast(`${result.posted} monthly posting(s) completed.`);
                    } else {
                        if (managementStatusNode) {
                            managementStatusNode.textContent = "No monthly depreciation/amortization due for current period.";
                        }
                        showToast("No due monthly asset posting.");
                    }
                    activeAssetTabState = "management";
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                } catch (error) {
                    const message = error?.message || "Unable to run monthly asset posting.";
                    if (managementStatusNode) {
                        managementStatusNode.textContent = message;
                    }
                    showToast(message);
                } finally {
                    setSubmittingState(runMonthlyButton, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });

            disposalForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!disposalForm) {
                    return;
                }
                const data = new FormData(disposalForm);
                setSubmittingState(disposeButton, true);
                disposalStatusNode.textContent = "Posting asset disposal...";
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    const result = await disposeAsset({
                        asset_id: String(data.get("asset_id") || ""),
                        disposal_date: String(data.get("disposal_date") || ""),
                        proceeds_amount: Number(data.get("proceeds_amount") || 0),
                        proceeds_account_id: String(data.get("proceeds_account_id") || ""),
                        gain_loss_account_id: String(data.get("gain_loss_account_id") || "")
                    });
                    disposalStatusNode.textContent = `Disposed successfully. Reference: ${result.reference}.`;
                    showToast(`Asset disposed. Ref: ${result.reference}`);
                    activeAssetTabState = "management";
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                } catch (error) {
                    const message = error?.message || "Unable to dispose asset.";
                    disposalStatusNode.textContent = message;
                    showToast(message);
                } finally {
                    setSubmittingState(disposeButton, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });

            editForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!editForm) {
                    return;
                }
                const data = new FormData(editForm);
                setSubmittingState(editSubmitButton, true);
                if (editStatusNode) {
                    editStatusNode.textContent = "Saving asset changes...";
                }
                window.TIA_PAGE_LOADING?.show?.();
                try {
                    const targetId = String(data.get("asset_id") || "");
                    const existing = assets.find((asset) => String(asset.id || "") === targetId);
                    await updateAsset(targetId, {
                        asset_name: String(data.get("asset_name") || ""),
                        depreciation_method: String(data.get("depreciation_method") || ""),
                        useful_life_months: Number(data.get("useful_life_months") || 1),
                        salvage_value: Number(data.get("salvage_value") || 0),
                        capitalization_amount: Number(existing?.amount || 0)
                    });
                    if (editStatusNode) {
                        editStatusNode.textContent = "Asset updated successfully.";
                    }
                    showToast("Asset updated.");
                    closeEditModal();
                    activeAssetTabState = "management";
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                } catch (error) {
                    const message = error?.message || "Unable to update asset.";
                    if (editStatusNode) {
                        editStatusNode.textContent = message;
                    }
                    showToast(message);
                } finally {
                    setSubmittingState(editSubmitButton, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });
        }
    };
}
