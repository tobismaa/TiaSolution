import { createTable, formatStatusTone } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import {
    createBranchForCurrentBusiness,
    getBranchCapacityForCurrentBusiness,
    getBranchesForCurrentBusinessByScope,
    getNextBranchCodeForCurrentBusiness
} from "./branches-service.js";

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

export async function renderBranches(options = {}) {
    const scopeBranchId = String(options.branchId || "").trim();
    const selectedBranchId = String(options.selectedBranchId || "").trim();
    const isAllBranchesScope = Boolean(options.appliesToAll);
    const [branches, capacity, nextCode] = await Promise.all([
        getBranchesForCurrentBusinessByScope(scopeBranchId),
        getBranchCapacityForCurrentBusiness(),
        getNextBranchCodeForCurrentBusiness()
    ]);
    const hasHeadOffice = branches.some((branch) => branch.isHeadOffice);

    const limitLabel = Number.isFinite(capacity.limit) ? String(capacity.limit) : "Unlimited";
    const remainingLabel = Number.isFinite(capacity.remaining) ? String(capacity.remaining) : "Unlimited";

    return {
        summary: [],
        content: `
            <div class="section-stack">
                <div class="module-header">
                    <div>
                        <p class="eyebrow">Organization structure</p>
                        <h2>Branches</h2>
                    </div>
                    <button class="btn btn-primary" type="button" data-open-branch-create-modal ${isAllBranchesScope ? "" : "disabled"}>
                        Create Branch
                    </button>
                </div>
                <section class="panel">
                    <div class="summary-grid branch-capacity-grid">
                        <article class="summary-card branch-capacity-card">
                            <p class="muted">Used Branches</p>
                            <h3>${capacity.used}</h3>
                        </article>
                        <article class="summary-card branch-capacity-card">
                            <p class="muted">Allowed Branches</p>
                            <h3>${limitLabel}</h3>
                        </article>
                        <article class="summary-card branch-capacity-card">
                            <p class="muted">Remaining</p>
                            <h3>${remainingLabel}</h3>
                        </article>
                    </div>
                </section>
                <section class="panel">
                    ${createTable(
                        ["Name", "Code", "Type", "Status", "Created"],
                        branches.map((branch) => [
                            branch.name,
                            branch.code || "-",
                            branch.isHeadOffice ? "Head Office" : "Branch",
                            `<span class="badge ${formatStatusTone(branch.isActive ? "active" : "deactivated")}">${branch.isActive ? "Active" : "Deactivated"}</span>`,
                            formatDateTime(branch.createdAt)
                        ])
                    )}
                </section>
                <div class="business-modal" data-branch-create-modal hidden>
                    <div class="business-modal__backdrop" data-branch-create-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="branchCreateTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Organization structure</p>
                                <h3 id="branchCreateTitle">Create Branch</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-branch-create-close>&times;</button>
                        </div>
                        <form class="form-grid" id="branchCreateForm">
                            <div class="triple-grid">
                                <label class="form-field">
                                    <span>Branch Name</span>
                                    <input name="name" type="text" maxlength="120" placeholder="Lagos Island Branch" required>
                                </label>
                                <label class="form-field">
                                    <span>Branch Code</span>
                                    <input name="code" type="text" maxlength="20" value="${nextCode}" readonly>
                                </label>
                                <label class="form-field">
                                    <span>Type</span>
                                    <select name="is_head_office">
                                        <option value="false" selected>Branch</option>
                                        <option value="true" ${hasHeadOffice ? "disabled" : ""}>Head Office</option>
                                    </select>
                                </label>
                            </div>
                            <div class="button-row">
                                <button class="btn btn-primary" type="submit" data-branch-submit>
                                    <span class="btn-label">Create Branch</span>
                                    <span class="spinner" aria-hidden="true"></span>
                                </button>
                                <p class="muted" data-branch-status>${isAllBranchesScope
                                    ? hasHeadOffice
                                        ? "Head Office already exists. New entries will be created as branches."
                                        : "Create branches within your allowed branch count."
                                    : "Switch scope to Head Office to create a new branch."}</p>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `,
        afterRender(container, refresh) {
            const openButton = container.querySelector("[data-open-branch-create-modal]");
            const modal = container.querySelector("[data-branch-create-modal]");
            const form = container.querySelector("#branchCreateForm");
            const statusNode = container.querySelector("[data-branch-status]");
            const submitButton = container.querySelector("[data-branch-submit]");

            const openModal = () => {
                if (!modal || !isAllBranchesScope) {
                    return;
                }
                modal.hidden = false;
                modal.querySelector("input, select")?.focus();
            };

            const closeModal = () => {
                if (!modal) {
                    return;
                }
                modal.hidden = true;
            };

            openButton?.addEventListener("click", openModal);
            modal?.querySelectorAll(".business-modal__close[data-branch-create-close]").forEach((control) => {
                control.addEventListener("click", closeModal);
            });

            form?.addEventListener("submit", async (event) => {
                event.preventDefault();
                if (!form) {
                    return;
                }
                if (!isAllBranchesScope) {
                    if (statusNode) {
                        statusNode.textContent = "Switch scope to Head Office to create a new branch.";
                    }
                    return;
                }

                const formData = new FormData(form);
                setSubmittingState(submitButton, true);
                if (statusNode) {
                    statusNode.textContent = "Creating branch...";
                }
                window.TIA_PAGE_LOADING?.show?.();

                try {
                    await createBranchForCurrentBusiness({
                        name: String(formData.get("name") || ""),
                        is_head_office: String(formData.get("is_head_office") || "false") === "true"
                    });

                    showToast("Branch created.");
                    form.reset();
                    const codeInput = form.querySelector('input[name="code"]');
                    if (codeInput) {
                        codeInput.value = nextCode;
                    }
                    if (statusNode) {
                        statusNode.textContent = "Branch created successfully.";
                    }
                    closeModal();
                    if (typeof refresh === "function") {
                        await refresh();
                    }
                } catch (error) {
                    const message = error?.message || "Unable to create branch.";
                    if (statusNode) {
                        statusNode.textContent = message;
                    }
                    showToast(message);
                } finally {
                    setSubmittingState(submitButton, false);
                    window.TIA_PAGE_LOADING?.hide?.();
                }
            });
        }
    };
}
