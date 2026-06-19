import { createTable, formatCurrency, formatStatusTone } from "../../core/utils.js";
import { showToast } from "../../shared/toast.js";
import { getOpenedAccountsDirectory } from "../account-management/account-management-service.js";
import { getUsers } from "../users/users-service.js";
import {
    createPayrollBatchRun,
    deletePayrollStaff,
    getPayrollCapabilities,
    getPayrollData,
    setPayrollStaffActive,
    updatePayrollControlAccount,
    updatePayrollComponentGlMapping,
    updatePayrollComponents,
    updatePayrollLevelStructure,
    updatePayrollLevels,
    upsertPayrollStaff
} from "./payroll-service.js";

let payrollModalRestoreState = "";
let payrollModalZIndex = 60;

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
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
    payrollModalZIndex += 1;
    modal.style.zIndex = String(payrollModalZIndex);
    modal.hidden = false;
    modal.querySelector("input, select, button")?.focus();
}

function closeModal(modal) {
    if (!modal) {
        return;
    }
    modal.hidden = true;
}

function getMonthOptions() {
    const formatter = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
    const today = new Date();
    const currentYear = today.getUTCFullYear();
    return Array.from({ length: 12 }, (_, index) => {
        const date = new Date(Date.UTC(currentYear, index, 1));
        return {
            value: `${currentYear}-${String(index + 1).padStart(2, "0")}`,
            label: formatter.format(date)
        };
    });
}

function getPostingDateForMonth(monthValue, postingDay) {
    const [yearRaw, monthRaw] = String(monthValue || "").split("-");
    const year = Number(yearRaw || 0);
    const month = Number(monthRaw || 0);
    if (!year || !month) {
        return "";
    }
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(Math.max(1, Number(postingDay || 1)), lastDay);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getMonthValueFromDate(dateValue) {
    return String(dateValue || "").trim().slice(0, 7);
}

function getPostedPayrollMonths(runs, branchId = "", canAccessAllBranches = false) {
    return new Set(
        (runs || [])
            .filter((run) => {
                if (canAccessAllBranches) {
                    return true;
                }
                return String(run?.branchId || "").trim() === String(branchId || "").trim();
            })
            .map((run) => getMonthValueFromDate(run?.postingDate))
            .filter(Boolean)
    );
}

function getLockedPayrollMonths(postedMonths, branchId = "", canAccessAllBranches = false) {
    return new Set(
        (postedMonths || [])
            .filter((item) => {
                if (canAccessAllBranches) {
                    return true;
                }
                return String(item?.branchId || "").trim() === String(branchId || "").trim();
            })
            .map((item) => String(item?.month || "").trim())
            .filter(Boolean)
    );
}

function resolveDefaultPayrollMonth(monthOptions, lockedMonths, fallbackMonth = "") {
    const fallback = String(fallbackMonth || "").trim();
    if (fallback && !lockedMonths.has(fallback)) {
        return fallback;
    }
    return monthOptions.find((item) => !lockedMonths.has(String(item.value || "")))?.value || "";
}

function renderPayrollMonthOptions(monthOptions, lockedMonths, selectedValue = "") {
    return monthOptions.map((item) => {
        const value = String(item.value || "");
        const isLocked = lockedMonths.has(value);
        return `
            <option value="${escapeHtml(value)}" ${value === String(selectedValue || "") ? "selected" : ""} ${isLocked ? "disabled" : ""}>
                ${escapeHtml(item.label)}${isLocked ? " (Posted)" : ""}
            </option>
        `;
    }).join("");
}

function renderPayrollPostingPreview(rows, postingDate, monthLabel, skippedCount = 0) {
    const totalGross = rows.reduce((sum, row) => sum + Number(row.grossSalary || 0), 0);
    const totalNet = rows.reduce((sum, row) => sum + Number(row.netSalary || 0), 0);
    const readyCount = rows.filter((row) => row.isReady).length;
    return `
        <div class="section-stack">
            <div class="gl-summary-grid">
                <article class="gl-summary-card"><span>Month</span><strong>${escapeHtml(monthLabel || "-")}</strong></article>
                <article class="gl-summary-card"><span>Posting Date</span><strong>${escapeHtml(postingDate || "-")}</strong></article>
                <article class="gl-summary-card"><span>Staff Count</span><strong>${rows.length}</strong></article>
                <article class="gl-summary-card"><span>Ready To Post</span><strong>${readyCount}</strong></article>
                <article class="gl-summary-card"><span>Total Gross</span><strong>${formatCurrency(totalGross)}</strong></article>
                <article class="gl-summary-card"><span>Total Net</span><strong>${formatCurrency(totalNet)}</strong></article>
            </div>
            ${skippedCount > 0 ? `<div class="notice-banner">Some staff were skipped because their payroll GL mapping is incomplete: ${skippedCount}</div>` : ""}
            <div class="table-wrap">
                ${createTable(
                    ["Account No", "Name", "Branch", "Level", "Gross", "Net", "Status"],
                    rows.map((row) => [
                        escapeHtml(row.employeeCode),
                        escapeHtml(row.fullName),
                        escapeHtml(row.branchName || "-"),
                        escapeHtml(row.salaryLevel || "-"),
                        formatCurrency(row.grossSalary || 0),
                        formatCurrency(row.netSalary || 0),
                        row.isReady
                            ? `<span class="badge paid">Ready</span>`
                            : `<span class="badge due">${escapeHtml(row.readinessReason || "Pending Setup")}</span>`
                    ])
                )}
            </div>
        </div>
    `;
}

function buildPayrollComputedRows(staff, levelStructures, components, controlAccountId = "") {
    return (staff || []).map((item) => {
        const grossSalary = Number(item.grossSalary || getStaffGrossSalary(levelStructures, item.salaryLevel) || getLevelAmount([], item.salaryLevel) || 0);
        const netSalary = Number(getStaffNetSalary(levelStructures, item.salaryLevel) || 0);
        const deductions = Math.max(0, grossSalary - netSalary);
        const readiness = getPayrollReadinessState(levelStructures, components, item.salaryLevel, controlAccountId);
        return {
            ...item,
            grossSalary,
            deductions,
            netSalary,
            isReady: readiness.ready,
            readinessReason: readiness.reason
        };
    });
}

function renderPayrollComputePreview(rows, monthLabel) {
    const totalGross = rows.reduce((sum, row) => sum + Number(row.grossSalary || 0), 0);
    const totalDeductions = rows.reduce((sum, row) => sum + Number(row.deductions || 0), 0);
    const totalNet = rows.reduce((sum, row) => sum + Number(row.netSalary || 0), 0);
    const readyCount = rows.filter((row) => row.isReady).length;

    return `
        <div class="section-stack">
            <div class="gl-summary-grid">
                <article class="gl-summary-card"><span>Payroll Month</span><strong>${escapeHtml(monthLabel || "-")}</strong></article>
                <article class="gl-summary-card"><span>Payroll Staff</span><strong>${rows.length}</strong></article>
                <article class="gl-summary-card"><span>Ready Staff</span><strong>${readyCount}</strong></article>
                <article class="gl-summary-card"><span>Total Gross</span><strong>${formatCurrency(totalGross)}</strong></article>
                <article class="gl-summary-card"><span>Total Deductions</span><strong>${formatCurrency(totalDeductions)}</strong></article>
                <article class="gl-summary-card"><span>Total Net</span><strong>${formatCurrency(totalNet)}</strong></article>
            </div>
            <div class="table-wrap">
                ${createTable(
                    ["Account No", "Name", "Branch", "Level", "Gross", "Deductions", "Net", "Status"],
                    rows.map((row) => [
                        escapeHtml(row.employeeCode || "-"),
                        escapeHtml(row.fullName || "-"),
                        escapeHtml(row.branchName || "-"),
                        escapeHtml(row.salaryLevel || "-"),
                        formatCurrency(row.grossSalary || 0),
                        formatCurrency(row.deductions || 0),
                        formatCurrency(row.netSalary || 0),
                        row.isReady
                            ? `<span class="badge paid">Ready</span>`
                            : `<span class="badge due">${escapeHtml(row.readinessReason || "Pending Setup")}</span>`
                    ])
                )}
            </div>
        </div>
    `;
}

function getStaffAccountNumber(user, index) {
    const rawId = String(user?.id || "").replaceAll("-", "").toUpperCase();
    if (rawId.length >= 6) {
        return `STF-${rawId.slice(-6)}`;
    }
    return `STF-${String(index + 1).padStart(4, "0")}`;
}

function buildStaffDirectory(users) {
    return (users || [])
        .filter((user) => String(user?.status || "").toLowerCase() === "active")
        .filter((user) => String(user?.role || "").toLowerCase() !== "business_admin")
        .map((user, index) => ({
            accountNumber: getStaffAccountNumber(user, index),
            fullName: String(user?.name || "").trim(),
            branchId: String(user?.branchId || "").trim(),
            branchName: String(user?.branchName || "").trim(),
            rawUserId: String(user?.id || "").trim()
        }))
        .filter((item) => item.accountNumber && item.fullName);
}

function buildPayrollAccountDirectory(openedAccounts, users) {
    const directory = new Map();

    (openedAccounts || []).forEach((item) => {
        const accountNumber = String(item?.accountNumber || "").trim().toUpperCase();
        if (!accountNumber) {
            return;
        }
        directory.set(accountNumber, {
            accountNumber,
            fullName: String(item?.fullName || "").trim(),
            branchId: String(item?.branchId || "").trim(),
            branchName: String(item?.branchName || "").trim(),
            rawUserId: String(item?.id || "").trim()
        });
    });

    buildStaffDirectory(users).forEach((item) => {
        const accountNumber = String(item?.accountNumber || "").trim().toUpperCase();
        if (!accountNumber || directory.has(accountNumber)) {
            return;
        }
        directory.set(accountNumber, item);
    });

    return Array.from(directory.values());
}

function renderComponentRows(components) {
    return components.map((component, index) => `
        <div class="payroll-component-grid payroll-level-row">
            <label class="form-field">
                <span>Component Name</span>
                <input name="component_name_${index}" type="text" value="${escapeHtml(component.name)}" required>
            </label>
            <label class="form-field">
                <span>Type</span>
                <select name="component_type_${index}">
                    <option value="earning" ${component.type === "earning" ? "selected" : ""}>Earning</option>
                    <option value="deduction" ${component.type === "deduction" ? "selected" : ""}>Deduction</option>
                </select>
            </label>
            <div class="payroll-row-actions">
                <button class="btn btn-secondary" type="button" data-remove-component-row>Remove</button>
            </div>
        </div>
    `).join("");
}

function renderLevelStructureRows(levelName, items) {
    return `
        <div class="payroll-structure-grid">
            ${items.map((item, index) => `
                <div class="payroll-structure-card">
                    <div class="button-row">
                        <strong>${escapeHtml(item.componentName)}</strong>
                        <span class="badge ${item.componentType === "deduction" ? "due" : "paid"}">${escapeHtml(item.componentType)}</span>
                    </div>
                    <input type="hidden" name="structure_component_name_${index}" value="${escapeHtml(item.componentName)}">
                    <input type="hidden" name="structure_component_type_${index}" value="${escapeHtml(item.componentType)}">
                    <label class="form-check">
                        <input name="structure_enabled_${index}" type="checkbox" ${item.isEnabled ? "checked" : ""}>
                        <span>Use in ${escapeHtml(levelName)}</span>
                    </label>
                    <label class="form-field">
                        <span>Amount</span>
                        <input name="structure_amount_${index}" type="number" min="0" step="0.01" value="${Number(item.amount || 0)}">
                    </label>
                </div>
            `).join("")}
        </div>
    `;
}

function renderLevelTable(levels, levelStructures) {
    if (!levels.length) {
        return `
            <div class="payroll-level-table">
                <div class="payroll-level-table__empty">No salary levels have been created yet.</div>
            </div>
        `;
    }

    return `
        <div class="payroll-level-table">
            <table>
                <thead>
                    <tr>
                        <th>Level</th>
                        <th>Gross Amount</th>
                        <th>Earning Lines</th>
                        <th>Deduction Lines</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${levels.map((level) => {
                        const items = Array.isArray(levelStructures[level.level]) ? levelStructures[level.level] : [];
                        const earningCount = items.filter((item) => item.componentType === "earning" && item.isEnabled).length;
                        const deductionCount = items.filter((item) => item.componentType === "deduction" && item.isEnabled).length;
                        return `
                            <tr>
                                <td>
                                    <div class="payroll-level-table__level">
                                        <strong>${escapeHtml(level.level)}</strong>
                                        <span>Salary level</span>
                                    </div>
                                </td>
                                <td><strong>${formatCurrency(level.amount || 0)}</strong></td>
                                <td><span class="payroll-level-table__count">${earningCount}</span></td>
                                <td><span class="payroll-level-table__count">${deductionCount}</span></td>
                                <td>
                                    <div class="button-row business-row-actions">
                                        <button class="btn btn-secondary" type="button" data-view-salary-level="${escapeHtml(level.level)}">View</button>
                                        <button class="btn btn-secondary" type="button" data-edit-salary-level="${escapeHtml(level.level)}">Edit</button>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function renderLevelSelectOptions(levels) {
    return levels.map((level) => `<option value="${escapeHtml(level.level)}">${escapeHtml(level.level)}</option>`).join("");
}

function renderSalaryLevelEditorRows(items) {
    return `
        <div class="payroll-structure-grid">
            ${items.map((item, index) => `
                <div class="payroll-structure-card">
                    <div class="button-row">
                        <strong>${escapeHtml(item.componentName)}</strong>
                        <span class="badge ${item.componentType === "deduction" ? "due" : "paid"}">${escapeHtml(item.componentType)}</span>
                    </div>
                    <input type="hidden" name="editor_component_name_${index}" value="${escapeHtml(item.componentName)}">
                    <input type="hidden" name="editor_component_type_${index}" value="${escapeHtml(item.componentType)}">
                    <label class="form-check">
                        <input name="editor_component_enabled_${index}" type="checkbox" ${item.isEnabled ? "checked" : ""}>
                        <span>Use component</span>
                    </label>
                    <label class="form-field">
                        <span>Amount</span>
                        <input name="editor_component_amount_${index}" type="number" min="0" step="0.01" value="${Number(item.amount || 0)}">
                    </label>
                </div>
            `).join("")}
        </div>
    `;
}

function renderSalaryLevelView(levelName, grossAmount, items) {
    const earnings = items.filter((item) => item.componentType === "earning" && item.isEnabled);
    const deductions = items.filter((item) => item.componentType === "deduction" && item.isEnabled);

    const renderList = (rows, emptyLabel) => rows.length
        ? rows.map((item) => `
            <div class="payroll-level-view__item">
                <strong>${escapeHtml(item.componentName)}</strong>
                <span>${formatCurrency(item.amount || 0)}</span>
            </div>
        `).join("")
        : `<p class="muted">${emptyLabel}</p>`;

    return `
        <div class="trial-balance-modal-view payroll-level-view">
            <div class="trial-balance-modal-view__head">
                <div>
                    <h3>${escapeHtml(levelName)}</h3>
                    <p>Gross Amount: ${formatCurrency(grossAmount || 0)}</p>
                </div>
                <div class="trial-balance-modal-view__meta">
                    <span>${earnings.length} Earnings</span>
                    <span>${deductions.length} Deductions</span>
                </div>
            </div>
            <div class="dual-grid">
                <section class="panel">
                    <div class="panel-head">
                        <h3>Earnings</h3>
                    </div>
                    <div class="payroll-level-view__list mt-18">
                        ${renderList(earnings, "No earning components enabled for this level.")}
                    </div>
                </section>
                <section class="panel">
                    <div class="panel-head">
                        <h3>Deductions</h3>
                    </div>
                    <div class="payroll-level-view__list mt-18">
                        ${renderList(deductions, "No deduction components enabled for this level.")}
                    </div>
                </section>
            </div>
        </div>
    `;
}

function renderAccountLabel(staff, prefix) {
    const code = prefix === "debit" ? staff.debitAccountCode : staff.creditAccountCode;
    const name = prefix === "debit" ? staff.debitAccountName : staff.creditAccountName;
    return code || name ? `${code ? `${code} - ` : ""}${name}` : "-";
}

function getNamedFieldValue(row, prefix) {
    return row.querySelector(`[name^="${prefix}"]`)?.value || "";
}

function getLevelStructureItems(levelStructures, levelName) {
    return Array.isArray(levelStructures?.[levelName]) ? levelStructures[levelName] : [];
}

function getStaffComponentAmount(levelStructures, levelName, componentName) {
    const items = getLevelStructureItems(levelStructures, levelName);
    const match = items.find((item) => String(item.componentName || "").trim().toLowerCase() === String(componentName || "").trim().toLowerCase());
    return match?.isEnabled ? Number(match.amount || 0) : 0;
}

function getStaffNetSalary(levelStructures, levelName) {
    const items = getLevelStructureItems(levelStructures, levelName);
    const earnings = items
        .filter((item) => item.componentType === "earning" && item.isEnabled)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const deductions = items
        .filter((item) => item.componentType === "deduction" && item.isEnabled)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return earnings - deductions;
}

function getStaffGrossSalary(levelStructures, levelName) {
    const items = getLevelStructureItems(levelStructures, levelName);
    return items
        .filter((item) => item.componentType === "earning" && item.isEnabled)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function getLevelAmount(levels, levelName) {
    const match = (levels || []).find((item) => String(item?.level || "").trim() === String(levelName || "").trim());
    return Number(match?.amount || 0);
}

function getPayrollReadinessState(levelStructures, components, levelName, controlAccountId = "") {
    const structureItems = getLevelStructureItems(levelStructures, levelName)
        .filter((item) => item.isEnabled && Number(item.amount || 0) > 0);

    if (!structureItems.length) {
        return { ready: false, reason: "No Active Components" };
    }

    if (!String(controlAccountId || "").trim()) {
        return { ready: false, reason: "Control Account Not Set" };
    }

    const componentMap = new Map((components || []).map((item) => [String(item.name || "").trim().toLowerCase(), item]));

    for (const item of structureItems) {
        const component = componentMap.get(String(item.componentName || "").trim().toLowerCase());
        if (!component) {
            return { ready: false, reason: `${String(item.componentName || "Component").trim()} Missing` };
        }
        const isMapped = component.type === "deduction"
            ? Boolean(component.creditAccountId)
            : Boolean(component.debitAccountId);
        if (!isMapped) {
            return { ready: false, reason: `${String(item.componentName || "Component").trim()} GL Missing` };
        }
    }

    return { ready: true, reason: "Ready" };
}

function hasMappedLevelComponents(levelStructures, components, levelName, controlAccountId = "") {
    return getPayrollReadinessState(levelStructures, components, levelName, controlAccountId).ready;
}

function renderStaffTable(staff, canManageSetup, components, levelStructures) {
    const headers = [
        "Account No",
        "Name",
        "Branch",
        "Level",
        "Gross",
        "Net",
        "Status",
        "Action"
    ];

    const rows = staff.map((row) => [
        escapeHtml(row.employeeCode),
        escapeHtml(row.fullName),
        escapeHtml(row.branchName || "-"),
        escapeHtml(row.salaryLevel),
        formatCurrency(getStaffGrossSalary(levelStructures, row.salaryLevel)),
        formatCurrency(getStaffNetSalary(levelStructures, row.salaryLevel)),
        `<span class="badge ${formatStatusTone(row.isActive ? "active" : "deactivated")}">${row.isActive ? "Active" : "Removed"}</span>`,
        canManageSetup
            ? `
                <div class="button-row business-row-actions">
                    <button class="btn btn-secondary" type="button" data-upgrade-payroll-staff="${row.id}">Change Level</button>
                    <button class="btn btn-secondary" type="button" data-view-payroll-staff="${row.id}">View</button>
                    <button class="btn btn-secondary" type="button" data-toggle-payroll-staff="${row.id}" data-next-active="${row.isActive ? "false" : "true"}">${row.isActive ? "Remove" : "Restore"}</button>
                    <button class="btn btn-secondary" type="button" data-delete-payroll-staff="${row.id}">Delete</button>
                </div>
            `
            : "-"
    ]);

    return createTable(headers, rows);
}

function renderPayrollStaffSalaryView(record, levelStructures) {
    const items = getLevelStructureItems(levelStructures, record?.salaryLevel || "");
    const earnings = items.filter((item) => item.componentType === "earning" && item.isEnabled);
    const deductions = items.filter((item) => item.componentType === "deduction" && item.isEnabled);
    const gross = getStaffGrossSalary(levelStructures, record?.salaryLevel || "");
    const net = getStaffNetSalary(levelStructures, record?.salaryLevel || "");

    return `
        <div class="payroll-level-view">
            <div class="gl-summary-grid">
                <article class="gl-summary-card"><span>Account No</span><strong>${escapeHtml(record?.employeeCode || "-")}</strong></article>
                <article class="gl-summary-card"><span>Name</span><strong>${escapeHtml(record?.fullName || "-")}</strong></article>
                <article class="gl-summary-card"><span>Branch</span><strong>${escapeHtml(record?.branchName || "-")}</strong></article>
                <article class="gl-summary-card"><span>Level</span><strong>${escapeHtml(record?.salaryLevel || "-")}</strong></article>
                <article class="gl-summary-card"><span>Gross</span><strong>${formatCurrency(gross)}</strong></article>
                <article class="gl-summary-card"><span>Net</span><strong>${formatCurrency(net)}</strong></article>
            </div>
            <div class="payroll-structure-grid mt-18">
                <section class="payroll-structure-card">
                    <div class="panel-head">
                        <h4>Earnings</h4>
                    </div>
                    <div class="payroll-level-view__list">
                        ${earnings.length ? earnings.map((item) => `
                            <div class="payroll-level-view__item">
                                <span>${escapeHtml(item.componentName)}</span>
                                <strong>${formatCurrency(item.amount)}</strong>
                            </div>
                        `).join("") : `<p class="empty-state">No earnings configured.</p>`}
                    </div>
                </section>
                <section class="payroll-structure-card">
                    <div class="panel-head">
                        <h4>Deductions</h4>
                    </div>
                    <div class="payroll-level-view__list">
                        ${deductions.length ? deductions.map((item) => `
                            <div class="payroll-level-view__item">
                                <span>${escapeHtml(item.componentName)}</span>
                                <strong>${formatCurrency(item.amount)}</strong>
                            </div>
                        `).join("") : `<p class="empty-state">No deductions configured.</p>`}
                    </div>
                </section>
            </div>
        </div>
    `;
}

function renderOperationsStaffTable(staff, canManageProfiles, levelStructures, components, controlAccountId = "") {
    return createTable(
        ["Code", "Staff", "Branch", "Salary Band", "Gross Salary", "GL Mapping", "Status", "Action"],
        staff.map((row) => {
            const readiness = getPayrollReadinessState(levelStructures, components, row.salaryLevel, controlAccountId);
            return [
                escapeHtml(row.employeeCode),
                escapeHtml(row.fullName),
                escapeHtml(row.branchName || "-"),
                escapeHtml(row.salaryLevel),
                formatCurrency(row.grossSalary),
                readiness.ready ? "Mapped" : escapeHtml(readiness.reason),
                `<span class="badge ${formatStatusTone(row.isActive ? "active" : "deactivated")}">${row.isActive ? "Active" : "Inactive"}</span>`,
                canManageProfiles
                    ? `
                        <div class="button-row business-row-actions">
                            <button class="btn btn-secondary" type="button" data-edit-payroll-staff="${row.id}">Edit</button>
                        </div>
                    `
                    : "-"
            ];
        })
    );
}

function renderGlMappingTable(components, canMapGl) {
    return createTable(
        ["Component", "Type", "Mapped GL", "Status", "Action"],
        components.map((row) => [
            escapeHtml(row.name),
            escapeHtml(row.type === "deduction" ? "Deduction" : "Earning"),
            escapeHtml(
                row.type === "deduction"
                    ? (row.creditAccountCode || row.creditAccountName ? `${row.creditAccountCode ? `${row.creditAccountCode} - ` : ""}${row.creditAccountName}` : "-")
                    : (row.debitAccountCode || row.debitAccountName ? `${row.debitAccountCode ? `${row.debitAccountCode} - ` : ""}${row.debitAccountName}` : "-")
            ),
            (row.type === "deduction" ? row.creditAccountId : row.debitAccountId)
                ? `<span class="badge paid">Mapped</span>`
                : `<span class="badge due">Pending</span>`,
            canMapGl
                ? `
                    <div class="button-row business-row-actions">
                        <button class="btn btn-secondary" type="button" data-map-payroll-component-gl="${row.id}">Map GL</button>
                    </div>
                `
                : "-"
        ])
    );
}

export async function renderPayroll(role) {
    const organizationUsers = await getUsers({ branchId: "" }).catch(() => []);
    const openedAccountsDirectory = await getOpenedAccountsDirectory().catch(() => []);
    const {
        runs,
        levels,
        settings,
        components,
        levelStructures,
        staff,
        branches,
        accounts,
        activeBranch,
        postableStaff,
        postedMonths,
        suggestedEmployeeCode
    } = await getPayrollData();
    const caps = getPayrollCapabilities(role);
    const isAdminSetupView = caps.canManageSetup;
    const isOperationsView = caps.canManageProfiles && !caps.canManageSetup;
    const isAccountView = caps.canMapGl && !caps.canManageSetup;
    const visibleStaff = isOperationsView ? postableStaff : staff;
    const computedRows = buildPayrollComputedRows(postableStaff, levelStructures, components, settings.payrollControlAccountId);
    const staffDirectory = buildPayrollAccountDirectory(openedAccountsDirectory, organizationUsers);
    const monthOptions = getMonthOptions();
    const lockedPayrollMonths = getLockedPayrollMonths(postedMonths, activeBranch.id, activeBranch.canAccessAllBranches);
    const defaultPostingMonth = resolveDefaultPayrollMonth(monthOptions, lockedPayrollMonths, new Date().toISOString().slice(0, 7));
    const defaultPostingDate = new Date().toISOString().slice(0, 10);

    const branchOptions = branches
        .filter((branch) => branch.isActive)
        .map((branch) => `<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`)
        .join("");

    const staffDirectoryOptions = staffDirectory
        .map((item) => `<option value="${escapeHtml(item.accountNumber)}">${escapeHtml(item.accountNumber)} - ${escapeHtml(item.fullName)}</option>`)
        .join("");

    const accountOptions = accounts
        .map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.code)} - ${escapeHtml(account.name)}</option>`)
        .join("");

    return {
        summary: [],
        content: `
                <div class="section-stack payroll-module">
                ${isAdminSetupView ? `
                    <div class="payroll-subtabs">
                        <button class="btn btn-primary" type="button" data-payroll-tab="setup">Payroll Setup</button>
                        <button class="btn btn-secondary" type="button" data-payroll-tab="compute">Compute Payroll</button>
                        <button class="btn btn-secondary" type="button" data-payroll-tab="post" ${caps.canPost ? "" : "disabled"}>Post Payroll</button>
                    </div>
                ` : ""}

                <div data-payroll-panel="setup" ${isAdminSetupView ? "" : "hidden"}>
                      <section class="panel">
                          <div class="panel-head">
                              <h3>Setup Actions</h3>
                          </div>
                          <div class="button-row mt-18 payroll-setup-actions">
                              <button class="btn btn-secondary" type="button" data-open-payroll-components-modal>
                                  Payroll Components
                              </button>
                              <button class="btn btn-secondary" type="button" data-open-payroll-band-modal>
                                  Salary Levels
                              </button>
                          </div>
                    </section>

                        <section class="panel">
                            <div class="panel-head">
                                <h3>Payroll Staff Master</h3>
                                <div class="button-row">
                                    <button class="btn btn-secondary" type="button" data-open-payroll-staff-list-modal>View Payroll Staff</button>
                                    <button class="btn btn-primary" type="button" data-open-payroll-staff-modal-from-setup>Add Staff to Payroll</button>
                                </div>
                            </div>
                        <div class="gl-summary-grid mt-18">
                            <article class="gl-summary-card"><span>Total Staff</span><strong>${staff.length}</strong></article>
                            <article class="gl-summary-card"><span>Active Staff</span><strong>${staff.filter((item) => item.isActive).length}</strong></article>
                            <article class="gl-summary-card"><span>Branches Covered</span><strong>${new Set(staff.map((item) => item.branchId).filter(Boolean)).size}</strong></article>
                        </div>
                        <div class="mt-18 table-wrap">
                            ${renderStaffTable(staff.slice(0, 6), caps.canManageSetup, components, levelStructures)}
                        </div>
                    </section>
                </div>

                ${isAdminSetupView ? `
                    <div data-payroll-panel="compute" hidden>
                        <section class="panel">
                            <div class="panel-head">
                                <h3>Compute Payroll</h3>
                                <span class="badge paid">Admin Review</span>
                            </div>
                            <div class="dual-grid mt-18">
                                <label class="form-field">
                                    <span>Payroll Month</span>
                                    <select data-payroll-compute-month>
                                        ${renderPayrollMonthOptions(monthOptions, lockedPayrollMonths, defaultPostingMonth)}
                                    </select>
                                </label>
                                <div class="payroll-note-card">
                                    <strong>Compute before posting</strong>
                                    <span>Review gross pay, deductions, net pay, and readiness before moving to post payroll.</span>
                                </div>
                            </div>
                            <div class="button-row mt-18">
                                <button class="btn btn-primary" type="button" data-payroll-compute-run>Compute Payroll</button>
                                <button class="btn btn-secondary" type="button" data-payroll-go-post>Go To Post Payroll</button>
                            </div>
                            <p class="muted mt-18" data-payroll-compute-status>Select a payroll month and compute payroll for all active payroll staff.</p>
                            <div class="mt-18" data-payroll-compute-preview>
                                ${renderPayrollComputePreview(computedRows, monthOptions.find((item) => item.value === defaultPostingMonth)?.label || defaultPostingMonth)}
                            </div>
                        </section>
                    </div>

                    <div data-payroll-panel="post" hidden>
                        <section class="panel">
                            <div class="panel-head">
                                <h3>Post Payroll</h3>
                                <span class="badge draft">Final Step</span>
                            </div>
                            <div class="gl-summary-grid mt-18">
                                <article class="gl-summary-card"><span>Branch Scope</span><strong>${escapeHtml(activeBranch.name || "Head Office")}</strong></article>
                                <article class="gl-summary-card"><span>Payroll Staff</span><strong>${postableStaff.length}</strong></article>
                            <article class="gl-summary-card"><span>Ready To Post</span><strong>${computedRows.filter((item) => item.isReady).length}</strong></article>
                            </div>
                            <div class="button-row mt-18">
                                <button class="btn btn-primary" type="button" data-open-payroll-post ${caps.canPost ? "" : "disabled"}>Open Posting Window</button>
                            </div>
                            <p class="muted mt-18">Post payroll after reviewing the computed payroll output.</p>
                        </section>
                    </div>
                ` : ""}

                ${isOperationsView ? `
                    <section class="panel">
                        <div class="panel-head">
                            <h3>Staff Payroll Profiles</h3>
                            <button class="btn btn-primary" type="button" data-open-payroll-staff-modal>New Staff Profile</button>
                        </div>
                        <div class="gl-summary-grid mt-18">
                            <article class="gl-summary-card"><span>Branch</span><strong>${escapeHtml(activeBranch.name || "-")}</strong></article>
                            <article class="gl-summary-card"><span>Profiles</span><strong>${visibleStaff.length}</strong></article>
                            <article class="gl-summary-card"><span>Ready</span><strong>${visibleStaff.filter((item) => hasMappedLevelComponents(levelStructures, components, item.salaryLevel, settings.payrollControlAccountId)).length}</strong></article>
                        </div>
                        <div class="mt-18 table-wrap">
                            ${renderOperationsStaffTable(visibleStaff, caps.canManageProfiles, levelStructures, components, settings.payrollControlAccountId)}
                        </div>
                    </section>
                ` : ""}

                ${isAccountView ? `
                          <section class="panel">
                          <div class="panel-head">
                              <h3>Map Payroll</h3>
                              <span class="badge paid">Account Control</span>
                        </div>
                        <div class="gl-summary-grid mt-18">
                            <article class="gl-summary-card"><span>Total Components</span><strong>${components.length}</strong></article>
                            <article class="gl-summary-card"><span>Mapped Components</span><strong>${components.filter((item) => item.type === "deduction" ? item.creditAccountId : item.debitAccountId).length}</strong></article>
                            <article class="gl-summary-card"><span>Pending Mapping</span><strong>${components.filter((item) => !(item.type === "deduction" ? item.creditAccountId : item.debitAccountId)).length}</strong></article>
                            <article class="gl-summary-card"><span>Payroll Control</span><strong>${escapeHtml(settings.payrollControlAccountCode ? `${settings.payrollControlAccountCode} - ${settings.payrollControlAccountName}` : "Not Set")}</strong></article>
                        </div>
                          <div class="button-row mt-18">
                              <button class="btn btn-secondary" type="button" data-open-payroll-control-modal>Set Payroll Control Account</button>
                          </div>
                          <div class="mt-18 table-wrap">
                              ${renderGlMappingTable(components, caps.canMapGl)}
                          </div>
                      </section>
                  ` : ""}

                <div class="business-modal" data-payroll-staff-modal hidden>
                    <div class="business-modal__backdrop" data-payroll-staff-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="payrollStaffTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Payroll master</p>
                                <h3 id="payrollStaffTitle">Add Staff</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-payroll-staff-close>&times;</button>
                        </div>
                        <form class="form-grid" data-payroll-staff-form>
                            <input type="hidden" name="id">
                            <input type="hidden" name="branchId">
                            <input type="hidden" name="returnToList" value="no">
                            <input type="hidden" name="isActive" value="true">
                            <input type="hidden" name="debitAccountId" value="">
                            <input type="hidden" name="creditAccountId" value="">
                            <input type="hidden" name="sourceUserId" value="">
                            <div class="quad-grid">
                                <label class="form-field">
                                    <span>Staff Account No</span>
                                    <input name="employeeCode" type="text" value="" list="payrollStaffDirectory" placeholder="Enter staff account no" required>
                                    <datalist id="payrollStaffDirectory">
                                        ${staffDirectoryOptions}
                                    </datalist>
                                    <small class="helper-text" data-payroll-staff-lookup-hint>Select a valid staff account number from the suggestions.</small>
                                </label>
                                <label class="form-field">
                                    <span>Staff Name</span>
                                    <input name="fullName" type="text" placeholder="Staff name will appear here" readonly>
                                </label>
                                <label class="form-field">
                                    <span>Branch</span>
                                    <input name="branchName" type="text" placeholder="Branch will appear here" readonly>
                                </label>
                                <label class="form-field">
                                    <span>Salary Level</span>
                                    <select name="salaryLevel" required>
                                        <option value="">Select salary level</option>
                                        ${levels.map((level) => `<option value="${escapeHtml(level.level)}" data-band-amount="${Math.round(Number(level.amount || 0))}">${escapeHtml(level.level)} - ${formatCurrency(level.amount)}</option>`).join("")}
                                    </select>
                                </label>
                            </div>
                            <div class="button-row">
                                <button class="btn btn-primary" type="submit" data-payroll-staff-submit>
                                    <span class="btn-label">Add Staff</span>
                                    <span class="spinner" aria-hidden="true"></span>
                                </button>
                                <button class="btn btn-secondary" type="button" data-payroll-staff-close>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>

                <div class="business-modal" data-payroll-band-modal hidden>
                    <div class="business-modal__backdrop" data-payroll-band-close></div>
                    <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="payrollBandTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Salary structure</p>
                                <h3 id="payrollBandTitle">Salary Bands</h3>
                            </div>
                            <div class="button-row">
                                <button class="btn btn-primary" type="button" data-open-salary-level-editor>Add Level</button>
                                <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-payroll-band-close>&times;</button>
                            </div>
                        </div>
                        <div class="section-stack">
                            <form data-payroll-levels-form class="form-grid">
                                <div class="table-wrap mt-18">
                                    ${renderLevelTable(levels, levelStructures)}
                                </div>
                            </form>
                        </div>
                    </div>
                </div>

                <div class="business-modal" data-payroll-components-modal hidden>
                    <div class="business-modal__backdrop" data-payroll-components-close></div>
                    <div class="business-modal__dialog gl-statement-modal__dialog payroll-components-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="payrollComponentsTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Components</p>
                                <h3 id="payrollComponentsTitle">Payroll Components</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-payroll-components-close>&times;</button>
                        </div>
                        <form data-payroll-components-form class="form-grid">
                            <div data-payroll-components-list>
                                ${renderComponentRows(components)}
                            </div>
                            <div class="button-row">
                                <button class="btn btn-secondary" type="button" data-add-payroll-component ${caps.canManageSetup ? "" : "disabled"}>Add Component</button>
                                <button class="btn btn-primary" type="submit" ${caps.canManageSetup ? "" : "disabled"}>Save Components</button>
                                <button class="btn btn-secondary" type="button" data-payroll-components-close>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>

                <div class="business-modal" data-salary-level-editor-modal hidden>
                    <div class="business-modal__backdrop" data-salary-level-editor-close></div>
                    <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="salaryLevelEditorTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Salary structure</p>
                                <h3 id="salaryLevelEditorTitle">Salary Level Setup</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-salary-level-editor-close>&times;</button>
                        </div>
                        <form class="form-grid" data-salary-level-editor-form>
                            <input type="hidden" name="originalLevelName">
                            <div class="dual-grid">
                                <label class="form-field">
                                    <span>Level Name</span>
                                    <input name="levelName" type="text" placeholder="Senior Staff" required>
                                </label>
                                <label class="form-field">
                                    <span>Gross Amount</span>
                                    <input name="grossAmount" type="number" min="1" step="1" required>
                                </label>
                            </div>
                            <div data-salary-level-components-body></div>
                            <div class="button-row">
                                <button class="btn btn-primary" type="submit" data-salary-level-editor-submit>
                                    <span class="btn-label">Save Level</span>
                                    <span class="spinner" aria-hidden="true"></span>
                                </button>
                                <button class="btn btn-secondary" type="button" data-salary-level-editor-close>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>

                <div class="business-modal" data-salary-level-view-modal hidden>
                    <div class="business-modal__backdrop" data-salary-level-view-close></div>
                    <div class="business-modal__dialog payroll-level-view-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="salaryLevelViewTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Salary structure</p>
                                <h3 id="salaryLevelViewTitle">Salary Level Details</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-salary-level-view-close>&times;</button>
                        </div>
                        <div class="gl-statement-modal__content" data-salary-level-view-body></div>
                    </div>
                </div>

                <div class="business-modal" data-payroll-staff-list-modal hidden>
                    <div class="business-modal__backdrop" data-payroll-staff-list-close></div>
                    <div class="business-modal__dialog payroll-staff-list-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="payrollStaffListTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Payroll master</p>
                                <h3 id="payrollStaffListTitle">Payroll Staff Master</h3>
                            </div>
                            <div class="button-row">
                                ${caps.canManageSetup ? `<button class="btn btn-primary" type="button" data-open-payroll-staff-modal-from-list>Add Staff</button>` : ""}
                                <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-payroll-staff-list-close>&times;</button>
                            </div>
                        </div>
                        <div class="gl-statement-modal__content">
                            <div class="table-wrap">
                                ${renderStaffTable(staff, caps.canManageSetup, components, levelStructures)}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="business-modal" data-payroll-level-structure-modal hidden>
                    <div class="business-modal__backdrop" data-payroll-level-structure-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="payrollLevelStructureTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Payroll setup</p>
                                <h3 id="payrollLevelStructureTitle">Level Component Structure</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-payroll-level-structure-close>&times;</button>
                        </div>
                        <form class="form-grid" data-payroll-level-structure-form>
                            <input type="hidden" name="levelName">
                            <div data-payroll-level-structure-body></div>
                            <div class="button-row">
                                <button class="btn btn-primary" type="submit" data-payroll-level-structure-submit>
                                    <span class="btn-label">Save Level Structure</span>
                                    <span class="spinner" aria-hidden="true"></span>
                                </button>
                                <button class="btn btn-secondary" type="button" data-payroll-level-structure-close>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>

                <div class="business-modal" data-payroll-gl-modal hidden>
                    <div class="business-modal__backdrop" data-payroll-gl-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="payrollGlTitle">
                        <div class="business-modal__head">
                                <div>
                                    <p class="eyebrow">Payroll GL mapping</p>
                                    <h3 id="payrollGlTitle">Map Payroll Component GL</h3>
                                </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-payroll-gl-close>&times;</button>
                        </div>
                        <form class="form-grid" data-payroll-gl-form>
                            <input type="hidden" name="componentId">
                            <div class="quad-grid">
                                <label class="form-field">
                                    <span>Component</span>
                                    <input name="componentName" type="text" readonly>
                                </label>
                                <label class="form-field">
                                    <span>Type</span>
                                    <input name="componentType" type="text" readonly>
                                </label>
                                <label class="form-field">
                                    <span>Status</span>
                                    <input name="mappingStatus" type="text" readonly>
                                </label>
                            </div>
                            <div class="dual-grid">
                                <label class="form-field">
                                    <span>Mapped GL</span>
                                    <select name="mappedAccountId" required>
                                        <option value="">Select GL account</option>
                                        ${accountOptions}
                                    </select>
                                </label>
                                <div class="payroll-note-card">
                                    <strong>System-controlled side</strong>
                                    <span>${escapeHtml(settings.payrollControlAccountCode ? `${settings.payrollControlAccountCode} - ${settings.payrollControlAccountName}` : "Set payroll control account first.")}</span>
                                </div>
                            </div>
                            <div class="button-row">
                                <button class="btn btn-primary" type="submit" data-payroll-gl-submit>
                                    <span class="btn-label">Save GL Mapping</span>
                                    <span class="spinner" aria-hidden="true"></span>
                                </button>
                                <button class="btn btn-secondary" type="button" data-payroll-gl-close>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>

                <div class="business-modal" data-payroll-control-modal hidden>
                    <div class="business-modal__backdrop" data-payroll-control-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="payrollControlTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Payroll control</p>
                                <h3 id="payrollControlTitle">Set Payroll Control Account</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-payroll-control-close>&times;</button>
                        </div>
                        <form class="form-grid" data-payroll-control-form>
                            <label class="form-field">
                                <span>Payroll Control Account</span>
                                <select name="payrollControlAccountId" required>
                                    <option value="">Select control account</option>
                                    ${accountOptions}
                                </select>
                            </label>
                            <div class="button-row">
                                <button class="btn btn-primary" type="submit" data-payroll-control-submit>
                                    <span class="btn-label">Save Control Account</span>
                                    <span class="spinner" aria-hidden="true"></span>
                                </button>
                                <button class="btn btn-secondary" type="button" data-payroll-control-close>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>

                <div class="business-modal" data-payroll-post-modal hidden>
                    <div class="business-modal__backdrop" data-payroll-post-close></div>
                    <div class="business-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="payrollPostTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Payroll posting</p>
                                <h3 id="payrollPostTitle">Post Payroll</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-payroll-post-close>&times;</button>
                        </div>
                        <form class="form-grid" data-payroll-post-form>
                            <div class="dual-grid">
                                <label class="form-field">
                                    <span>Posting Date</span>
                                    <input name="postingDate" type="date" value="${escapeHtml(defaultPostingDate)}" readonly>
                                </label>
                                <label class="form-field">
                                    <span>Month</span>
                                    <select name="postingMonth" required>
                                        <option value="">Select month</option>
                                        ${renderPayrollMonthOptions(monthOptions, lockedPayrollMonths, defaultPostingMonth)}
                                    </select>
                                </label>
                            </div>
                            <div class="dual-grid">
                                <label class="form-field">
                                    <span>Branch Scope</span>
                                    <input name="branchScope" type="text" value="${escapeHtml(activeBranch.name || "Head Office")}" readonly>
                                </label>
                                <label class="form-field">
                                    <span>Payroll Staff</span>
                                    <input name="staffCountPreview" type="text" value="${postableStaff.length}" readonly>
                                </label>
                            </div>
                            <div class="button-row">
                                <button class="btn btn-primary" type="submit" data-payroll-post-submit>
                                    <span class="btn-label">Post</span>
                                    <span class="spinner" aria-hidden="true"></span>
                                </button>
                                <button class="btn btn-secondary" type="button" data-payroll-post-close>Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>

                <div class="business-modal" data-payroll-post-confirm-modal hidden>
                    <div class="business-modal__backdrop" data-payroll-post-confirm-close></div>
                    <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="payrollPostConfirmTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Payroll confirmation</p>
                                <h3 id="payrollPostConfirmTitle">Confirm Payroll Processing</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-payroll-post-confirm-close>&times;</button>
                        </div>
                        <div class="gl-statement-modal__content" data-payroll-post-confirm-body></div>
                        <div class="button-row">
                            <button class="btn btn-primary" type="button" data-payroll-post-process>
                                <span class="btn-label">Okay To Process</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <button class="btn btn-secondary" type="button" data-payroll-post-confirm-close>Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        `,
          afterRender(container, refresh) {
              const staffById = new Map(staff.map((item) => [item.id, item]));
              const payrollStaffByCode = new Map(staff.map((item) => [String(item.employeeCode || "").trim().toUpperCase(), item]));
              const componentById = new Map(components.map((item) => [item.id, item]));
              const staffDirectoryByCode = new Map(staffDirectory.map((item) => [String(item.accountNumber || "").trim().toUpperCase(), item]));
            const componentsModal = container.querySelector("[data-payroll-components-modal]");
            const bandModal = container.querySelector("[data-payroll-band-modal]");
            const staffListModal = container.querySelector("[data-payroll-staff-list-modal]");
            const staffModal = container.querySelector("[data-payroll-staff-modal]");
            const staffForm = container.querySelector("[data-payroll-staff-form]");
            const staffSubmitButton = container.querySelector("[data-payroll-staff-submit]");
            const salaryLevelEditorModal = container.querySelector("[data-salary-level-editor-modal]");
            const salaryLevelEditorForm = container.querySelector("[data-salary-level-editor-form]");
            const salaryLevelComponentsBody = container.querySelector("[data-salary-level-components-body]");
            const salaryLevelEditorSubmitButton = container.querySelector("[data-salary-level-editor-submit]");
            const salaryLevelViewModal = container.querySelector("[data-salary-level-view-modal]");
            const salaryLevelViewBody = container.querySelector("[data-salary-level-view-body]");
            const levelStructureModal = container.querySelector("[data-payroll-level-structure-modal]");
            const levelStructureForm = container.querySelector("[data-payroll-level-structure-form]");
            const levelStructureBody = container.querySelector("[data-payroll-level-structure-body]");
            const levelStructureSubmitButton = container.querySelector("[data-payroll-level-structure-submit]");
              const glModal = container.querySelector("[data-payroll-gl-modal]");
              const glForm = container.querySelector("[data-payroll-gl-form]");
              const glSubmitButton = container.querySelector("[data-payroll-gl-submit]");
              const controlModal = container.querySelector("[data-payroll-control-modal]");
              const controlForm = container.querySelector("[data-payroll-control-form]");
              const controlSubmitButton = container.querySelector("[data-payroll-control-submit]");
              const postModal = container.querySelector("[data-payroll-post-modal]");
              const postForm = container.querySelector("[data-payroll-post-form]");
              const postSubmitButton = container.querySelector("[data-payroll-post-submit]");
              const postConfirmModal = container.querySelector("[data-payroll-post-confirm-modal]");
              const postConfirmBody = container.querySelector("[data-payroll-post-confirm-body]");
              const postProcessButton = container.querySelector("[data-payroll-post-process]");
              const levelsForm = container.querySelector("[data-payroll-levels-form]");
              const levelsList = container.querySelector("[data-payroll-levels-list]");
              const componentsForm = container.querySelector("[data-payroll-components-form]");
              const componentsList = container.querySelector("[data-payroll-components-list]");
              const tabButtons = Array.from(container.querySelectorAll("[data-payroll-tab]"));
              const panels = Array.from(container.querySelectorAll("[data-payroll-panel]"));
              let pendingPayrollBatch = null;
              const restoreModal = () => {
                  const restoreKey = payrollModalRestoreState;
                  if (!restoreKey) {
                      return;
                  }
                  payrollModalRestoreState = "";
                  if (restoreKey === "staff-list") {
                      openModal(staffListModal);
                  }
              };

              const setActiveTab = (tabKey) => {
                tabButtons.forEach((button) => {
                    const isActive = String(button.getAttribute("data-payroll-tab") || "") === tabKey;
                    button.classList.toggle("btn-primary", isActive);
                    button.classList.toggle("btn-secondary", !isActive);
                });
                panels.forEach((panel) => {
                    panel.hidden = String(panel.getAttribute("data-payroll-panel") || "") !== tabKey;
                });
            };

            tabButtons.forEach((button) => {
                button.addEventListener("click", () => setActiveTab(String(button.getAttribute("data-payroll-tab") || "setup")));
            });

            container.querySelector("[data-open-payroll-components-modal]")?.addEventListener("click", () => openModal(componentsModal));
              container.querySelector("[data-open-payroll-band-modal]")?.addEventListener("click", () => openModal(bandModal));
              container.querySelector("[data-open-payroll-control-modal]")?.addEventListener("click", () => {
                  controlForm?.querySelector('select[name="payrollControlAccountId"]')?.setAttribute("data-current", settings.payrollControlAccountId || "");
                  if (controlForm) {
                      controlForm.querySelector('select[name="payrollControlAccountId"]').value = settings.payrollControlAccountId || "";
                  }
                  openModal(controlModal);
              });
              container.querySelector("[data-open-salary-level-editor]")?.addEventListener("click", () => openSalaryLevelEditor(""));

              function fillStaffLookupFields(accountNumber, fallbackRecord = null) {
                  if (!staffForm) {
                      return false;
                  }
                  const normalizedCode = String(accountNumber || "").trim().toUpperCase();
                  const match = staffDirectoryByCode.get(normalizedCode);
                  const currentId = String(staffForm.querySelector('input[name="id"]')?.value || "").trim();
                  const existingPayrollRecord = payrollStaffByCode.get(normalizedCode);
                  const fullNameInput = staffForm.querySelector('input[name="fullName"]');
                  const branchNameInput = staffForm.querySelector('input[name="branchName"]');
                  const branchIdInput = staffForm.querySelector('input[name="branchId"]');
                  const sourceUserIdInput = staffForm.querySelector('input[name="sourceUserId"]');
                  const hintNode = staffForm.querySelector("[data-payroll-staff-lookup-hint]");
                  if (match) {
                      if (fullNameInput) {
                          fullNameInput.value = match.fullName || "";
                      }
                      if (branchNameInput) {
                          branchNameInput.value = match.branchName || "";
                      }
                      if (branchIdInput) {
                          branchIdInput.value = match.branchId || "";
                      }
                      if (sourceUserIdInput) {
                          sourceUserIdInput.value = match.rawUserId || "";
                      }
                      if (hintNode) {
                          hintNode.textContent = existingPayrollRecord && String(existingPayrollRecord.id || "").trim() !== currentId
                              ? "This account number has already been registered in payroll."
                              : "Staff account found.";
                      }
                      return true;
                  }
                  if (fullNameInput) {
                      fullNameInput.value = fallbackRecord?.fullName || "";
                  }
                  if (branchNameInput) {
                      branchNameInput.value = fallbackRecord?.branchName || "";
                  }
                  if (branchIdInput) {
                      branchIdInput.value = fallbackRecord?.branchId || "";
                  }
                  if (sourceUserIdInput) {
                      sourceUserIdInput.value = fallbackRecord?.sourceUserId || "";
                  }
                  if (hintNode) {
                      hintNode.textContent = normalizedCode
                          ? "Staff account number not found. Choose one from the suggestions."
                          : "Select a valid staff account number from the suggestions.";
                  }
                  return Boolean(fallbackRecord);
              }

              function resetStaffForm(record = null, options = {}) {
                  if (!staffForm) {
                      return;
                  }
                  staffForm.reset();
                  staffForm.querySelector('input[name="id"]').value = record?.id || "";
                  staffForm.querySelector('input[name="employeeCode"]').value = record?.employeeCode || "";
                  staffForm.querySelector('input[name="returnToList"]').value = options.returnToList ? "yes" : "no";
                  staffForm.querySelector('input[name="isActive"]').value = record ? String(record.isActive !== false) : "true";
                  staffForm.querySelector('input[name="debitAccountId"]').value = record?.debitAccountId || "";
                  staffForm.querySelector('input[name="creditAccountId"]').value = record?.creditAccountId || "";
                  staffForm.querySelector('input[name="sourceUserId"]').value = record?.sourceUserId || "";
                  fillStaffLookupFields(record?.employeeCode || "", record);
                  staffForm.querySelector('select[name="salaryLevel"]').value = record?.salaryLevel || "";
              }

              function openStaffEditor(record = null, mode = "edit", options = {}) {
                  if (!record) {
                      resetStaffForm(null, options);
                  } else {
                      resetStaffForm(record, options);
                  }
                  const titleNode = container.querySelector("#payrollStaffTitle");
                  const submitLabelNode = container.querySelector('[data-payroll-staff-submit] .btn-label');
                  const employeeCodeInput = staffForm?.querySelector('input[name="employeeCode"]');
                  if (titleNode) {
                      titleNode.textContent = mode === "upgrade" ? "Upgrade Staff Salary" : "Add Staff";
                  }
                  if (submitLabelNode) {
                      submitLabelNode.textContent = mode === "upgrade" ? "Save Changes" : "Add Staff";
                  }
                  if (employeeCodeInput) {
                      employeeCodeInput.readOnly = mode === "upgrade";
                  }
                  openModal(staffModal);
              }

            function resetGlForm(record) {
                if (!glForm || !record) {
                    return;
                }
                glForm.querySelector('input[name="componentId"]').value = record.id || "";
                glForm.querySelector('input[name="componentName"]').value = record.name || "";
                glForm.querySelector('input[name="componentType"]').value = record.type === "deduction" ? "Deduction" : "Earning";
                glForm.querySelector('input[name="mappingStatus"]').value = (record.type === "deduction" ? record.creditAccountId : record.debitAccountId) ? "Mapped" : "Pending";
                glForm.querySelector('select[name="mappedAccountId"]').value = record.type === "deduction" ? (record.creditAccountId || "") : (record.debitAccountId || "");
            }

            function appendComponentRow(component = { name: "", type: "earning" }) {
                if (!componentsList) {
                    return;
                }
                const index = Date.now() + componentsList.querySelectorAll(".payroll-level-row").length;
                componentsList.insertAdjacentHTML("beforeend", renderComponentRows([component]).replaceAll("_0", `_${index}`));
            }

            function buildLevelItems(levelName = "") {
                const assigned = Array.isArray(levelStructures[levelName]) ? levelStructures[levelName] : [];
                return components.map((component) => {
                    const match = assigned.find((item) => String(item.componentName || "").trim().toLowerCase() === component.name.trim().toLowerCase());
                    return {
                        componentName: component.name,
                        componentType: component.type,
                        amount: match?.amount || 0,
                        isEnabled: match ? match.isEnabled : component.type === "earning"
                    };
                });
            }

            function openSalaryLevelEditor(levelName = "") {
                if (!salaryLevelEditorForm || !salaryLevelComponentsBody) {
                    return;
                }
                const current = levels.find((item) => item.level === levelName);
                salaryLevelEditorForm.reset();
                salaryLevelEditorForm.querySelector('input[name="originalLevelName"]').value = current?.level || "";
                salaryLevelEditorForm.querySelector('input[name="levelName"]').value = current?.level || "";
                salaryLevelEditorForm.querySelector('input[name="grossAmount"]').value = current?.amount ? String(Math.round(Number(current.amount))) : "";
                salaryLevelComponentsBody.innerHTML = renderSalaryLevelEditorRows(buildLevelItems(levelName));
                openModal(salaryLevelEditorModal);
            }

            function openSalaryLevelView(levelName = "") {
                if (!salaryLevelViewBody) {
                    return;
                }
                const current = levels.find((item) => item.level === levelName);
                const items = buildLevelItems(levelName);
                const titleNode = container.querySelector("#salaryLevelViewTitle");
                if (titleNode) {
                    titleNode.textContent = "Salary Level Details";
                }
                salaryLevelViewBody.innerHTML = renderSalaryLevelView(levelName, current?.amount || 0, items);
                openModal(salaryLevelViewModal);
            }

            function openPayrollStaffView(record) {
                if (!salaryLevelViewBody || !record) {
                    return;
                }
                const titleNode = container.querySelector("#salaryLevelViewTitle");
                if (titleNode) {
                    titleNode.textContent = "Staff Salary Details";
                }
                salaryLevelViewBody.innerHTML = renderPayrollStaffSalaryView(record, levelStructures);
                openModal(salaryLevelViewModal);
            }

              const openStaffFormModal = (options = {}) => {
                  openStaffEditor(null, "create", options);
              };

              container.querySelector("[data-open-payroll-staff-modal]")?.addEventListener("click", openStaffFormModal);
              container.querySelector("[data-open-payroll-staff-modal-from-setup]")?.addEventListener("click", () => {
                  openStaffFormModal({ returnToList: true });
              });

              container.querySelectorAll("[data-open-payroll-staff-list-modal]").forEach((control) => {
                  control.addEventListener("click", () => openModal(staffListModal));
              });

              container.querySelector("[data-open-payroll-staff-modal-from-list]")?.addEventListener("click", () => {
                  openStaffFormModal({ returnToList: true });
              });

              const bindModalClose = (selector, modal) => {
                  container.querySelectorAll(selector).forEach((control) => {
                      control.addEventListener("click", () => {
                          if (!control.classList.contains("business-modal__close")) {
                              return;
                          }
                          closeModal(modal);
                      });
                  });
              };

              bindModalClose("[data-payroll-staff-close]", staffModal);
              bindModalClose("[data-payroll-components-close]", componentsModal);
              bindModalClose("[data-payroll-band-close]", bandModal);
              bindModalClose("[data-payroll-control-close]", controlModal);
              bindModalClose("[data-salary-level-editor-close]", salaryLevelEditorModal);
              bindModalClose("[data-salary-level-view-close]", salaryLevelViewModal);
              bindModalClose("[data-payroll-staff-list-close]", staffListModal);
              bindModalClose("[data-payroll-post-close]", postModal);
              bindModalClose("[data-payroll-post-confirm-close]", postConfirmModal);
              bindModalClose("[data-payroll-level-structure-close]", levelStructureModal);
              bindModalClose("[data-payroll-gl-close]", glModal);

            container.querySelector("[data-open-payroll-post]")?.addEventListener("click", () => openModal(postModal));
            container.querySelector("[data-payroll-go-post]")?.addEventListener("click", () => setActiveTab("post"));
            container.querySelector("[data-add-payroll-component]")?.addEventListener("click", () => appendComponentRow());

              const computeMonthSelect = container.querySelector("[data-payroll-compute-month]");
              const computePreviewNode = container.querySelector("[data-payroll-compute-preview]");
              const computeStatusNode = container.querySelector("[data-payroll-compute-status]");
              const renderComputedPreview = () => {
                  if (!computePreviewNode) {
                      return;
                  }
                  const monthValue = String(computeMonthSelect?.value || defaultPostingMonth || "");
                  const monthLabel = monthOptions.find((item) => item.value === monthValue)?.label || monthValue;
                  computePreviewNode.innerHTML = renderPayrollComputePreview(computedRows, monthLabel);
                  if (computeStatusNode) {
                      computeStatusNode.textContent = lockedPayrollMonths.has(monthValue)
                          ? `${monthLabel} has already been posted and is locked for payroll posting.`
                          : `Payroll computed for ${monthLabel}. Review the rows before posting.`;
                  }
              };

              container.querySelector("[data-payroll-compute-run]")?.addEventListener("click", renderComputedPreview);
              computeMonthSelect?.addEventListener("change", renderComputedPreview);

              staffForm?.querySelector('select[name="salaryLevel"]')?.addEventListener("change", (event) => {
                const option = event.currentTarget.selectedOptions?.[0];
                const selectedLevel = String(event.currentTarget.value || "");
                const structureTotal = (levelStructures[selectedLevel] || [])
                    .filter((item) => item.componentType === "earning" && item.isEnabled)
                    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
                const amount = Number(structureTotal || option?.dataset?.bandAmount || 0);
                const grossSalaryInput = staffForm.querySelector('input[name="grossSalary"]');
                if (grossSalaryInput && amount > 0 && !grossSalaryInput.value) {
                    grossSalaryInput.value = String(amount);
                  }
              });

              staffForm?.querySelector('input[name="employeeCode"]')?.addEventListener("input", (event) => {
                  fillStaffLookupFields(event.currentTarget.value);
              });

            levelsForm?.addEventListener("submit", (event) => {
                event.preventDefault();
            });

            componentsForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                const payload = Array.from(event.currentTarget.querySelectorAll(".payroll-level-row")).map((row) => ({
                    name: getNamedFieldValue(row, "component_name_"),
                    type: getNamedFieldValue(row, "component_type_"),
                    basis: "fixed"
                }));
                try {
                    await updatePayrollComponents(payload);
                    showToast("Payroll components updated.");
                    closeModal(componentsModal);
                    await refresh();
                } catch (error) {
                    showToast(error.message || "Unable to update payroll components.");
                }
            });

              staffForm?.addEventListener("submit", async (event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  const employeeCode = String(formData.get("employeeCode") || "").trim();
                  const normalizedEmployeeCode = employeeCode.toUpperCase();
                  const fullName = String(formData.get("fullName") || "").trim();
                  const branchId = String(formData.get("branchId") || "").trim();
                  const branchName = String(formData.get("branchName") || "").trim();
                  const currentId = String(formData.get("id") || "").trim();
                  const duplicatePayrollRecord = payrollStaffByCode.get(normalizedEmployeeCode);
                  const selectedLevel = String(formData.get("salaryLevel") || "");
                  const grossSalary = Number(
                      formData.get("grossSalary")
                      || getStaffGrossSalary(levelStructures, selectedLevel)
                      || getLevelAmount(levels, selectedLevel)
                      || 0
                  );
                  if (!employeeCode || !fullName || !branchId || !branchName) {
                      showToast("Select a valid staff account number from the suggestions.");
                      return;
                  }
                  if (duplicatePayrollRecord && String(duplicatePayrollRecord.id || "").trim() !== currentId) {
                      showToast("This account number has already been registered in payroll.");
                      return;
                  }
                  if (!selectedLevel) {
                      showToast("Select a salary level.");
                      return;
                  }
                  setSubmittingState(staffSubmitButton, true);
                  try {
                      await upsertPayrollStaff({
                          id: String(formData.get("id") || ""),
                          employeeCode,
                          fullName,
                          branchId,
                          branchName,
                          salaryLevel: selectedLevel,
                          grossSalary,
                          debitAccountId: String(formData.get("debitAccountId") || ""),
                          creditAccountId: String(formData.get("creditAccountId") || ""),
                          isActive: String(formData.get("isActive") || "true") === "true"
                      });
                      showToast("Payroll staff saved.");
                      resetStaffForm(null, { returnToList: true });
                      closeModal(staffModal);
                      payrollModalRestoreState = "staff-list";
                      await refresh();
                  } catch (error) {
                      showToast(error.message || "Unable to save payroll staff.");
                  } finally {
                      setSubmittingState(staffSubmitButton, false);
                }
            });

            glForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                setSubmittingState(glSubmitButton, true);
                try {
                    await updatePayrollComponentGlMapping(String(formData.get("componentId") || ""), {
                        mappedAccountId: String(formData.get("mappedAccountId") || "")
                    });
                    showToast("Payroll GL mapping updated.");
                    closeModal(glModal);
                    await refresh();
                } catch (error) {
                    showToast(error.message || "Unable to update payroll GL mapping.");
                } finally {
                    setSubmittingState(glSubmitButton, false);
                }
            });

            controlForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const selectedId = String(formData.get("payrollControlAccountId") || "").trim();
                const selectedAccount = accounts.find((item) => String(item.id || "").trim() === selectedId);
                setSubmittingState(controlSubmitButton, true);
                try {
                    await updatePayrollControlAccount({
                        accountId: selectedId,
                        accountCode: selectedAccount?.code || "",
                        accountName: selectedAccount?.name || ""
                    });
                    showToast("Payroll control account saved.");
                    closeModal(controlModal);
                    await refresh();
                } catch (error) {
                    showToast(error.message || "Unable to save payroll control account.");
                } finally {
                    setSubmittingState(controlSubmitButton, false);
                }
            });

            levelStructureForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const levelName = String(formData.get("levelName") || "");
                const payload = Array.from(levelStructureBody.querySelectorAll(".payroll-structure-card")).map((card, index) => ({
                    componentName: getNamedFieldValue(card, "structure_component_name_"),
                    componentType: getNamedFieldValue(card, "structure_component_type_"),
                    amount: getNamedFieldValue(card, "structure_amount_"),
                    isEnabled: Boolean(card.querySelector(`[name="structure_enabled_${index}"]`)?.checked)
                }));
                setSubmittingState(levelStructureSubmitButton, true);
                try {
                    await updatePayrollLevelStructure(levelName, payload);
                    showToast("Level structure updated.");
                    closeModal(levelStructureModal);
                    await refresh();
                } catch (error) {
                    showToast(error.message || "Unable to update level structure.");
                } finally {
                    setSubmittingState(levelStructureSubmitButton, false);
                }
            });

            salaryLevelEditorForm?.addEventListener("submit", async (event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const originalLevelName = String(formData.get("originalLevelName") || "");
                const levelName = String(formData.get("levelName") || "").trim();
                const grossAmount = Number(formData.get("grossAmount") || 0);
                const payload = Array.from(salaryLevelComponentsBody.querySelectorAll(".payroll-structure-card")).map((card, index) => ({
                    componentName: getNamedFieldValue(card, "editor_component_name_"),
                    componentType: getNamedFieldValue(card, "editor_component_type_"),
                    amount: getNamedFieldValue(card, "editor_component_amount_"),
                    isEnabled: Boolean(card.querySelector(`[name="editor_component_enabled_${index}"]`)?.checked)
                }));
                setSubmittingState(salaryLevelEditorSubmitButton, true);
                try {
                    const nextLevels = levels.filter((item) => item.level !== originalLevelName && item.level !== levelName);
                    nextLevels.push({ level: levelName, amount: grossAmount });
                    await updatePayrollLevels(nextLevels);
                    await updatePayrollLevelStructure(levelName, payload);
                    showToast("Salary level saved.");
                    closeModal(salaryLevelEditorModal);
                    await refresh();
                } catch (error) {
                    showToast(error.message || "Unable to save salary level.");
                } finally {
                    setSubmittingState(salaryLevelEditorSubmitButton, false);
                }
            });

              postForm?.addEventListener("submit", async (event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  const postingMonth = String(formData.get("postingMonth") || "").trim();
                  const postingDate = String(formData.get("postingDate") || "").trim();
                  if (lockedPayrollMonths.has(postingMonth)) {
                      showToast("Payroll has already been posted for that month.");
                      return;
                  }
                  const monthLabel = monthOptions.find((item) => item.value === postingMonth)?.label || postingMonth;
                  const scopedRows = postableStaff
                      .map((item) => {
                          const readiness = getPayrollReadinessState(levelStructures, components, item.salaryLevel, settings.payrollControlAccountId);
                          return {
                              ...item,
                              grossSalary: Number(item.grossSalary || getStaffGrossSalary(levelStructures, item.salaryLevel) || getLevelAmount(levels, item.salaryLevel) || 0),
                              netSalary: Number(getStaffNetSalary(levelStructures, item.salaryLevel) || 0),
                              isReady: readiness.ready,
                              readinessReason: readiness.reason
                          };
                      });
                  const eligibleRows = scopedRows.filter((item) => item.isReady);
                  const skippedCount = scopedRows.length - eligibleRows.length;
                  if (!postingMonth || !postingDate) {
                      showToast("Select the payroll month.");
                      return;
                  }
                  if (!scopedRows.length) {
                      showToast("There are no registered payroll staff for this branch.");
                      return;
                  }
                  if (!eligibleRows.length) {
                      showToast("Registered staff were found, but none is ready for posting yet.");
                      return;
                  }
                  pendingPayrollBatch = {
                      postingDate,
                      postingMonth,
                      monthLabel,
                      staffIds: eligibleRows.map((item) => item.id),
                      skippedCount
                  };
                  if (postConfirmBody) {
                      postConfirmBody.innerHTML = renderPayrollPostingPreview(scopedRows, postingDate, monthLabel, skippedCount);
                  }
                  openModal(postConfirmModal);
              });

              postProcessButton?.addEventListener("click", async () => {
                  if (!pendingPayrollBatch) {
                      showToast("No payroll batch is ready for processing.");
                      return;
                  }
                  setSubmittingState(postProcessButton, true);
                  try {
                      await createPayrollBatchRun({
                          staffIds: pendingPayrollBatch.staffIds,
                          postingDate: pendingPayrollBatch.postingDate,
                          postingMonth: pendingPayrollBatch.postingMonth
                      });
                      showToast("Payroll posted to journal.");
                      pendingPayrollBatch = null;
                      closeModal(postConfirmModal);
                      closeModal(postModal);
                      await refresh();
                  } catch (error) {
                      showToast(error.message || "Unable to process payroll.");
                  } finally {
                      setSubmittingState(postProcessButton, false);
                  }
              });

              container.addEventListener("click", async (event) => {
                const removeComponent = event.target.closest("[data-remove-component-row]");
                if (removeComponent) {
                    removeComponent.closest(".payroll-level-row")?.remove();
                    return;
                }

                const editStaffId = event.target.closest("[data-edit-payroll-staff]")?.getAttribute("data-edit-payroll-staff");
                if (editStaffId) {
                    const record = staffById.get(editStaffId);
                    if (record) {
                        closeModal(staffListModal);
                        openStaffEditor(record, "edit");
                    }
                    return;
                }

                  const upgradeStaffId = event.target.closest("[data-upgrade-payroll-staff]")?.getAttribute("data-upgrade-payroll-staff");
                  if (upgradeStaffId) {
                      const record = staffById.get(upgradeStaffId);
                      if (record) {
                          openStaffEditor(record, "upgrade", { returnToList: true });
                      }
                      return;
                  }

                const viewStaffId = event.target.closest("[data-view-payroll-staff]")?.getAttribute("data-view-payroll-staff");
                if (viewStaffId) {
                    const record = staffById.get(viewStaffId);
                    if (record) {
                        openPayrollStaffView(record);
                    }
                    return;
                }

                const toggleStaffButton = event.target.closest("[data-toggle-payroll-staff]");
                if (toggleStaffButton) {
                    const staffId = String(toggleStaffButton.getAttribute("data-toggle-payroll-staff") || "");
                    const nextActive = String(toggleStaffButton.getAttribute("data-next-active") || "false") === "true";
                    try {
                        await setPayrollStaffActive(staffId, nextActive);
                        showToast(nextActive ? "Payroll staff activated." : "Payroll staff deactivated.");
                        await refresh();
                    } catch (error) {
                        showToast(error.message || "Unable to update payroll staff.");
                    }
                    return;
                }

                const deleteStaffButton = event.target.closest("[data-delete-payroll-staff]");
                if (deleteStaffButton) {
                    const staffId = String(deleteStaffButton.getAttribute("data-delete-payroll-staff") || "");
                    const staffRecord = staffById.get(staffId);
                    const shouldDelete = window.confirm(`Delete ${staffRecord?.fullName || "this payroll staff"} from payroll?`);
                    if (!shouldDelete) {
                        return;
                    }
                    try {
                        await deletePayrollStaff(staffId);
                        showToast("Payroll staff deleted.");
                        await refresh();
                    } catch (error) {
                        showToast(error.message || "Unable to delete payroll staff.");
                    }
                    return;
                }

                const mapGlId = event.target.closest("[data-map-payroll-component-gl]")?.getAttribute("data-map-payroll-component-gl");
                if (mapGlId) {
                    const record = componentById.get(mapGlId);
                    if (record) {
                        resetGlForm(record);
                        openModal(glModal);
                    }
                    return;
                }

                const editLevel = event.target.closest("[data-edit-salary-level]")?.getAttribute("data-edit-salary-level");
                if (editLevel) {
                    openSalaryLevelEditor(editLevel);
                    return;
                }

                const viewLevel = event.target.closest("[data-view-salary-level]")?.getAttribute("data-view-salary-level");
                if (viewLevel) {
                    openSalaryLevelView(viewLevel);
                    return;
                }

                const structureLevel = event.target.closest("[data-open-level-structure]")?.getAttribute("data-open-level-structure");
                  if (structureLevel && levelStructureForm && levelStructureBody) {
                      levelStructureForm.querySelector('input[name="levelName"]').value = structureLevel;
                      levelStructureBody.innerHTML = renderLevelStructureRows(structureLevel, levelStructures[structureLevel] || []);
                      openModal(levelStructureModal);
                  }
              });

              restoreModal();
          }
      };
  }
