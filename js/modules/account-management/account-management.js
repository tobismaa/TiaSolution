import { createTable } from "../../core/utils.js";
import { getActiveBranchDetails } from "../../core/data-access.js";
import { getCurrentSessionContext } from "../../core/session.js";
import {
    getOpenedAccounts,
    getOpenedAccountByNumber,
    getExistingAccountOpeningRecords,
    openAccount,
    openAccountFromExistingAccount,
    openAccountFromExistingRecord,
    updateOpenedAccount,
    generateAccountNumberForType
} from "./account-management-service.js";
import { getAccountProductsCatalog } from "../general-ledgers/general-ledgers-service.js";
import { showToast } from "../../shared/toast.js";
import { applyBrandingToDocument, getAppliedBranding } from "../../core/branding.js";

let accountOpeningModalTab = "personal";

function setSubmittingState(button, isSubmitting) {
    if (!button) {
        return;
    }
    button.disabled = isSubmitting;
    button.classList.toggle("is-loading", isSubmitting);
    button.setAttribute("aria-busy", String(isSubmitting));
}

function renderAccountProductOptions(accountProducts = []) {
    if (!Array.isArray(accountProducts) || accountProducts.length === 0) {
        return `<option value="">No account products available</option>`;
    }

    return [
        `<option value="">Select account type</option>`,
        ...accountProducts.map((product) => `<option value="${product.name}">${product.name}</option>`)
    ].join("");
}

function renderNewAccountModal(branchScope, accountProducts = []) {
    const branchLabel = branchScope?.name || "Active Branch";
    const branchId = branchScope?.id || "";

    return `
        <div class="business-modal" data-account-management-modal="new" hidden>
            <div class="business-modal__backdrop" data-account-management-close></div>
            <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="accountManagementNewTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Account opening</p>
                        <h3 id="accountManagementNewTitle">New Account</h3>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-account-management-close>&times;</button>
                </div>
                <section class="panel">
                    <div class="panel-head">
                        <h3>Open Account</h3>
                        <span class="badge paid">Operations</span>
                    </div>
                    <p class="mini-insight mt-18">Capture the customer record, review core details, and prepare the account for number generation.</p>
                    <form class="form-grid mt-18" data-open-account-form>
                        <div class="button-row demo-tabbar mt-18" role="tablist" aria-label="Open account steps">
                            <button class="btn btn-primary" type="button" data-account-opening-tab="personal" aria-selected="true">Personal Details</button>
                            <button class="btn btn-secondary" type="button" data-account-opening-tab="kin" aria-selected="false">Next of Kin Details</button>
                            <button class="btn btn-secondary" type="button" data-account-opening-tab="documents" aria-selected="false">Supporting Documents</button>
                        </div>

                        <div data-account-opening-panel="personal">
                            <div class="triple-grid">
                                <label class="form-field">
                                    <span>First Name</span>
                                    <input type="text" placeholder="Enter first name" data-auto-capitalize="words" name="firstName">
                                </label>
                                <label class="form-field">
                                    <span>Last Name</span>
                                    <input type="text" placeholder="Enter last name" data-auto-capitalize="words" name="lastName">
                                </label>
                                <label class="form-field">
                                    <span>Other Name</span>
                                    <input type="text" placeholder="Optional middle name" data-auto-capitalize="words" name="otherName">
                                </label>
                            </div>
                            <div class="triple-grid mt-18">
                                <label class="form-field">
                                    <span>Phone Number</span>
                                    <input type="tel" placeholder="+234..." data-phone-input="true" inputmode="numeric" name="phone">
                                </label>
                                <label class="form-field">
                                    <span>Email Address</span>
                                    <input type="email" placeholder="customer@email.com" name="email">
                                </label>
                                <label class="form-field">
                                    <span>Date of Birth</span>
                                    <input type="date" data-date-of-birth name="dob">
                                    <small class="helper-text account-age-display" data-age-display>Age will appear here.</small>
                                </label>
                            </div>
                            <div class="triple-grid mt-18">
                                <label class="form-field">
                                    <span>Gender</span>
                                    <select>
                                        <option value="">Select gender</option>
                                        <option>Male</option>
                                        <option>Female</option>
                                    </select>
                                </label>
                                <label class="form-field">
                                    <span>Record Source</span>
                                    <select>
                                        <option>Customer Submission</option>
                                        <option>Branch Walk-in</option>
                                        <option>Manual Capture</option>
                                    </select>
                                </label>
                                <label class="form-field">
                                    <span>Account Type</span>
                                    <select name="accountType">
                                        ${renderAccountProductOptions(accountProducts)}
                                    </select>
                                </label>
                            </div>
                            <div class="triple-grid mt-18">
                                <label class="form-field">
                                    <span>Means of ID</span>
                                    <select>
                                        <option value="">Select means of identification</option>
                                        <option>National ID</option>
                                        <option>Voter Card</option>
                                        <option>Driver License</option>
                                        <option>International Passport</option>
                                    </select>
                                </label>
                                <label class="form-field">
                                    <span>ID Number</span>
                                    <input type="text" placeholder="Enter identification number">
                                </label>
                                <label class="form-field">
                                    <span>BVN / NIN</span>
                                    <input type="text" placeholder="Enter BVN or NIN">
                                </label>
                            </div>
                            <div class="triple-grid mt-18">
                                <label class="form-field">
                                    <span>Domiciled Branch</span>
                                    <input type="text" value="${branchLabel}" readonly>
                                    <input type="hidden" value="${branchId}" name="branchId">
                                    <input type="hidden" value="${branchLabel}" name="branchName">
                                </label>
                                <label class="form-field">
                                    <span>Account Number</span>
                                    <input type="text" placeholder="Auto-generated after approval" readonly name="accountNumber" data-account-number-preview>
                                </label>
                            </div>
                            <div class="dual-grid mt-18">
                                <label class="form-field">
                                    <span>Residential Address</span>
                                    <textarea rows="4" placeholder="Enter residential address" name="residentialAddress"></textarea>
                                </label>
                                <label class="form-field">
                                    <span>Office / Contact Address</span>
                                    <textarea rows="4" placeholder="Enter office or alternate contact address"></textarea>
                                </label>
                            </div>
                        </div>

                        <div data-account-opening-panel="kin" hidden>
                            <div class="triple-grid">
                                <label class="form-field">
                                    <span>Next of Kin Name</span>
                                    <input type="text" placeholder="Enter next of kin full name" data-auto-capitalize="words">
                                </label>
                                <label class="form-field">
                                    <span>Next of Kin Phone</span>
                                    <input type="tel" placeholder="+234..." data-phone-input="true" inputmode="numeric">
                                </label>
                                <label class="form-field">
                                    <span>Relationship</span>
                                    <input type="text" placeholder="Brother, Sister, Spouse..." data-auto-capitalize="words">
                                </label>
                            </div>
                            <div class="dual-grid mt-18">
                                <label class="form-field">
                                    <span>Next of Kin Address</span>
                                    <textarea rows="4" placeholder="Enter next of kin address"></textarea>
                                </label>
                                <label class="form-field">
                                    <span>Operations Note</span>
                                    <textarea rows="4" placeholder="Add onboarding note, exception note, or KYC comment"></textarea>
                                </label>
                            </div>
                        </div>

                        <div data-account-opening-panel="documents" hidden>
                            <p class="muted mt-18">Supporting documents are optional for now and can be added later.</p>
                            <div class="triple-grid">
                                <label class="form-field">
                                    <span>Passport Photograph (Optional)</span>
                                    <input type="file" accept="image/*" name="passportFile">
                                </label>
                                <label class="form-field">
                                    <span>Utility Bill (Optional)</span>
                                    <input type="file" accept=".pdf,image/*">
                                </label>
                                <label class="form-field">
                                    <span>Means of ID Upload (Optional)</span>
                                    <input type="file" accept=".pdf,image/*">
                                </label>
                            </div>
                            <div class="triple-grid mt-18">
                                <label class="form-field">
                                    <span>Signature Upload (Optional)</span>
                                    <input type="file" accept="image/*,.pdf">
                                </label>
                                <label class="form-field">
                                    <span>Additional Document (Optional)</span>
                                    <input type="file" accept=".pdf,image/*">
                                </label>
                                <label class="form-field">
                                    <span>Document Note</span>
                                    <input type="text" placeholder="Optional note about uploaded files">
                                </label>
                            </div>
                            <label class="form-field mt-18">
                                <span>Document Review Note</span>
                                <textarea rows="4" placeholder="Add any comment about passport, utility bill, or missing files"></textarea>
                            </label>
                        </div>

                        <div class="button-row">
                            <button class="btn btn-primary" type="submit" data-open-account-submit>
                                <span class="btn-label">Open Account</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <p class="muted" data-open-account-status>Fill the required customer information before opening the account.</p>
                        </div>
                    </form>
                </section>
            </div>
        </div>
    `;
}

function renderUpdateAccountModal(branchScope) {
    const branchLabel = branchScope?.name || "Active Branch";

    return `
        <div class="business-modal" data-account-management-modal="update" hidden>
            <div class="business-modal__backdrop" data-account-management-close></div>
            <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="accountManagementUpdateTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Account maintenance</p>
                        <h3 id="accountManagementUpdateTitle">Update Account</h3>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-account-management-close>&times;</button>
                </div>
                <section class="panel">
                    <div class="panel-head">
                        <h3>Update Account</h3>
                        <span class="badge draft">Maintenance</span>
                    </div>
                    <p class="mini-insight mt-18">Find an existing account and update profile, contact, or branch-related details.</p>
                    <form class="form-grid mt-18" data-update-account-form>
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Account Number</span>
                                <input type="text" placeholder="Search by account number" name="accountNumber" data-update-account-number>
                            </label>
                            <label class="form-field">
                                <span>Customer Name</span>
                                <input type="text" placeholder="Customer name will appear here" name="customerName" data-update-customer-name readonly>
                            </label>
                            <label class="form-field">
                                <span>Domiciled Branch</span>
                                <input type="text" value="${branchLabel}" readonly name="branchName" data-update-branch-name>
                            </label>
                        </div>
                        <div class="triple-grid mt-18">
                            <label class="form-field">
                                <span>Phone Number</span>
                                <input type="tel" placeholder="Update phone number" data-phone-input="true" inputmode="numeric" name="phone">
                            </label>
                            <label class="form-field">
                                <span>Email Address</span>
                                <input type="email" placeholder="Update email address" name="email">
                            </label>
                            <label class="form-field">
                                <span>Status</span>
                                <select name="status">
                                    <option>Active</option>
                                    <option>Pending Review</option>
                                    <option>Suspended</option>
                                    <option>Closed</option>
                                </select>
                            </label>
                        </div>
                        <div class="dual-grid mt-18">
                            <label class="form-field">
                                <span>Residential Address</span>
                                <textarea rows="4" placeholder="Update residential address" name="residentialAddress"></textarea>
                            </label>
                            <label class="form-field">
                                <span>Operations Note</span>
                                <textarea rows="4" placeholder="Reason for update or follow-up note" name="operationsNote"></textarea>
                            </label>
                        </div>
                        <div class="dual-grid mt-18">
                            <label class="form-field">
                                <span>Passport Update</span>
                                <input type="file" accept="image/*,.pdf" name="passportFile">
                                <small class="helper-text" data-update-passport-name>No passport uploaded yet.</small>
                            </label>
                            <label class="form-field">
                                <span>Signature Update</span>
                                <input type="file" accept="image/*,.pdf" name="signatureFile">
                                <small class="helper-text" data-update-signature-name>No signature uploaded yet.</small>
                            </label>
                        </div>
                        <div class="button-row">
                            <button class="btn btn-primary" type="submit" data-update-account-submit>
                                <span class="btn-label">Update Account</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <p class="muted" data-update-account-status>Enter an account number to load existing account details.</p>
                        </div>
                    </form>
                </section>
            </div>
        </div>
    `;
}

function renderExistingRecordModal(branchScope, accountProducts = [], existingRecords = []) {
    const branchLabel = branchScope?.name || "Active Branch";
    const branchId = branchScope?.id || "";

    return `
        <div class="business-modal" data-account-management-modal="existing" hidden>
            <div class="business-modal__backdrop" data-account-management-close></div>
            <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="accountManagementExistingTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Existing records</p>
                        <h3 id="accountManagementExistingTitle">Open Account With Existing Records</h3>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-account-management-close>&times;</button>
                </div>
                <section class="panel">
                    <div class="panel-head">
                        <h3>Open Account With Existing Records</h3>
                        <span class="badge pink">Assisted Opening</span>
                    </div>
                    <p class="mini-insight mt-18">Enter an existing customer account number, load the saved profile, then open another account using the same customer details and documents.</p>
                    <form class="form-grid mt-18" data-existing-record-form>
                        <div class="dual-grid">
                            <label class="form-field">
                                <span>Existing Account Number</span>
                                <input type="text" name="recordReference" placeholder="Enter 10-digit number" maxlength="10" inputmode="numeric" data-existing-record-reference>
                                <input type="hidden" name="recordId" data-existing-record-id>
                            </label>
                            <label class="form-field">
                                <span>Domiciled Branch</span>
                                <input type="text" value="${branchLabel}" readonly>
                                <input type="hidden" name="branchId" value="${branchId}">
                                <input type="hidden" name="branchName" value="${branchLabel}">
                            </label>
                        </div>
                        <div class="button-row">
                            <button class="btn btn-secondary" type="button" data-existing-record-fetch>Fetch Details</button>
                            <p class="muted">Enter the 10-digit existing customer account number and the profile will load automatically.</p>
                        </div>
                        <div class="dual-grid">
                            <label class="form-field">
                                <span>Account Product</span>
                                <select name="accountType">
                                    ${renderAccountProductOptions(accountProducts)}
                                </select>
                            </label>
                            <label class="form-field">
                                <span>Record Preview</span>
                                <input type="text" value="Select an existing record to preview details." readonly data-existing-record-preview>
                            </label>
                        </div>
                        <div class="triple-grid">
                            <div class="statement-detail-card statement-detail-card--compact">
                                <span>Existing Account Number</span>
                                <strong data-existing-record-reference-display>-</strong>
                            </div>
                            <div class="statement-detail-card statement-detail-card--compact">
                                <span>Customer Name</span>
                                <strong data-existing-record-name>-</strong>
                            </div>
                            <div class="statement-detail-card statement-detail-card--compact">
                                <span>Email Address</span>
                                <strong data-existing-record-email>-</strong>
                            </div>
                        </div>
                        <div class="dual-grid">
                            <div class="statement-detail-card statement-detail-card--compact">
                                <span>Phone Number</span>
                                <strong data-existing-record-phone>-</strong>
                            </div>
                            <div class="statement-detail-card statement-detail-card--compact">
                                <span>Customer Type</span>
                                <strong data-existing-record-industry>-</strong>
                            </div>
                            <div class="statement-detail-card statement-detail-card--compact">
                                <span>Captured On</span>
                                <strong data-existing-record-created-at>-</strong>
                            </div>
                        </div>
                        <div class="dual-grid">
                            <section class="panel statement-doc-panel">
                                <div class="panel-head statement-doc-panel__head">
                                    <h3>Passport</h3>
                                </div>
                                <div class="statement-preview-box statement-preview-box--compact statement-preview-box--square mt-18" data-existing-record-passport-preview>
                                    No passport uploaded.
                                </div>
                            </section>
                            <section class="panel statement-doc-panel">
                                <div class="panel-head statement-doc-panel__head">
                                    <h3>Signature</h3>
                                </div>
                                <div class="statement-preview-box statement-preview-box--compact statement-preview-box--square mt-18" data-existing-record-signature-preview>
                                    No signature uploaded.
                                </div>
                            </section>
                        </div>
                        <div class="button-row">
                            <button class="btn btn-primary" type="submit" data-existing-record-submit>
                                <span class="btn-label">Open Account From Existing Record</span>
                                <span class="spinner" aria-hidden="true"></span>
                            </button>
                            <p class="muted" data-existing-record-status>Enter a 10-digit existing account number to fetch the customer profile and continue.</p>
                        </div>
                    </form>
                </section>
            </div>
        </div>
    `;
}

function isSameCalendarDay(baseDate, targetDate) {
    return baseDate.getFullYear() === targetDate.getFullYear()
        && baseDate.getMonth() === targetDate.getMonth()
        && baseDate.getDate() === targetDate.getDate();
}

function isSameCalendarMonth(baseDate, targetDate) {
    return baseDate.getFullYear() === targetDate.getFullYear()
        && baseDate.getMonth() === targetDate.getMonth();
}

function isSameCalendarYear(baseDate, targetDate) {
    return baseDate.getFullYear() === targetDate.getFullYear();
}

function buildAccountActivityStats(accounts = []) {
    const now = new Date();
    const validAccounts = Array.isArray(accounts) ? accounts : [];
    const openedRecords = validAccounts.filter((item) => {
        const createdAt = new Date(String(item?.createdAt || ""));
        return !Number.isNaN(createdAt.getTime());
    });
    const openedDates = openedRecords
        .map((item) => new Date(String(item?.createdAt || "")))
        .filter((date) => !Number.isNaN(date.getTime()));
    const updatedDates = validAccounts
        .filter((item) => {
            const createdAt = new Date(String(item?.createdAt || ""));
            const updatedAt = new Date(String(item?.updatedAt || ""));
            return !Number.isNaN(updatedAt.getTime())
                && (Number.isNaN(createdAt.getTime()) || updatedAt.getTime() > createdAt.getTime());
        })
        .map((item) => new Date(String(item?.updatedAt || "")))
        .filter((date) => !Number.isNaN(date.getTime()));

    const summarize = (dates) => ({
        today: dates.filter((date) => isSameCalendarDay(now, date)).length,
        month: dates.filter((date) => isSameCalendarMonth(now, date)).length,
        year: dates.filter((date) => isSameCalendarYear(now, date)).length,
        total: dates.length
    });

    return {
        opened: summarize(openedDates),
        updated: summarize(updatedDates),
        openedTodayRecords: openedRecords.filter((item) => {
            const createdAt = new Date(String(item?.createdAt || ""));
            return isSameCalendarDay(now, createdAt);
        })
    };
}

function renderActivityCards(items = [], toneClass = "") {
    return `
        <div class="summary-grid account-management-summary-grid">
            ${items.map((item) => `
                <article class="summary-card account-management-summary-card ${toneClass} ${item.actionKey ? "is-clickable" : ""}" ${item.actionKey ? `data-account-stats-action="${escapeHtml(item.actionKey)}"` : ""}>
                    <p class="muted">${item.label}</p>
                    <h3>${item.value}</h3>
                    <span class="trend ${item.tone}">${item.note}</span>
                </article>
            `).join("")}
        </div>
    `;
}

function renderOpenAccountMainTab(accountStats) {
    const openedCards = [
        { label: "Opened Today", value: String(accountStats?.opened?.today || 0), note: "accounts created today", tone: "up", actionKey: "opened-today" },
        { label: "Opened This Month", value: String(accountStats?.opened?.month || 0), note: "accounts created this month", tone: "up" },
        { label: "Opened This Year", value: String(accountStats?.opened?.year || 0), note: "accounts created this year", tone: "up" },
        { label: "Total Opened", value: String(accountStats?.opened?.total || 0), note: "all opened accounts", tone: "warn" }
    ];
    const updatedCards = [
        { label: "Updated Today", value: String(accountStats?.updated?.today || 0), note: "accounts updated today", tone: "warn" },
        { label: "Updated This Month", value: String(accountStats?.updated?.month || 0), note: "accounts updated this month", tone: "warn" },
        { label: "Updated This Year", value: String(accountStats?.updated?.year || 0), note: "accounts updated this year", tone: "warn" },
        { label: "Total Updated", value: String(accountStats?.updated?.total || 0), note: "accounts updated at least once", tone: "down" }
    ];

    return `
        <div class="section-stack">
            <section class="panel">
                <div class="panel-head">
                    <h3>Account Opening Overview</h3>
                </div>
                <p class="mini-insight mt-18">Track how many customer accounts were opened across today, this month, this year, and overall.</p>
                <div class="mt-18">
                    ${renderActivityCards(openedCards, "is-opened")}
                </div>
            </section>

            <section class="panel">
                <div class="panel-head">
                    <h3>Account Update Overview</h3>
                </div>
                <p class="mini-insight mt-18">See how often existing customer accounts have been updated over the same periods.</p>
                <div class="mt-18">
                    ${renderActivityCards(updatedCards, "is-updated")}
                </div>
            </section>
        </div>
    `;
}

function renderOpenedTodayModal(records = []) {
    const content = records.length
        ? records.map((record) => `
            <article class="statement-detail-card account-management-opened-record-card">
                <span>${escapeHtml(record.name || "Customer")}</span>
                <strong>${escapeHtml(record.accountNumber || "-")}</strong>
                <p class="muted">${escapeHtml(record.accountType || "-")} | ${escapeHtml(record.branchName || "-")}</p>
            </article>
        `).join("")
        : `<p class="muted">No accounts were opened today.</p>`;

    return `
        <div class="business-modal" data-account-management-modal="opened-today" hidden>
            <div class="business-modal__backdrop" data-account-management-close></div>
            <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="accountManagementOpenedTodayTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Opened Today</p>
                        <h3 id="accountManagementOpenedTodayTitle">Accounts Opened Today</h3>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-account-management-close>&times;</button>
                </div>
                <section class="panel">
                    <div class="panel-head">
                        <h3>Opened Accounts</h3>
                        <span class="badge paid">${records.length}</span>
                    </div>
                    <div class="section-stack mt-18">
                        ${content}
                    </div>
                </section>
            </div>
        </div>
    `;
}

function renderStatementOfAccountTab() {
    return `
        <section class="panel">
            <p class="muted">Click Statement of Account to open the account inquiry workspace.</p>
        </section>
    `;
}

function renderStatementModal() {
    return `
        <div class="business-modal" data-account-management-modal="statement" hidden>
            <div class="business-modal__backdrop" data-account-management-close></div>
            <div class="business-modal__dialog gl-statement-modal__dialog statement-inquiry-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="statementOfAccountTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Statement workspace</p>
                        <h3 id="statementOfAccountTitle">Statement of Account</h3>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-account-management-close>&times;</button>
                </div>
                <section class="panel">
                    <div class="account-management-alert" data-statement-alert hidden></div>
                    <div class="statement-account-layout">
                        <div class="statement-account-layout__main">
                            <form class="form-grid statement-inquiry-form" data-statement-account-form>
                                <section class="statement-inquiry-hero">
                                    <div>
                                        <p class="statement-inquiry-hero__eyebrow">Account inquiry</p>
                                        <h4>Fetch account details</h4>
                                        <p class="statement-inquiry-hero__copy">Enter the 10-digit account number to load balances, passport, signature, and statement access.</p>
                                    </div>
                                    <div class="statement-inquiry-hero__controls">
                                        <label class="form-field statement-inquiry-form__field">
                                            <span>Account Number</span>
                                            <input
                                                type="text"
                                                placeholder="Enter 10-digit account number"
                                                maxlength="10"
                                                inputmode="numeric"
                                                data-statement-account-number
                                            >
                                        </label>
                                        <div class="button-row statement-inquiry-form__actions">
                                            <button class="btn btn-secondary" type="button" data-statement-fetch>Fetch Account</button>
                                            <button class="btn btn-primary" type="button" data-statement-view>View Account Statement</button>
                                        </div>
                                    </div>
                                </section>

                                <p class="muted statement-inquiry-status" data-statement-status>Enter account number to fetch account details.</p>

                                <div class="dual-grid statement-inquiry-grid">
                                    <div class="statement-detail-card statement-detail-card--compact">
                                        <span>Customer Name</span>
                                        <strong data-statement-customer-name></strong>
                                    </div>
                                    <div class="statement-detail-card statement-detail-card--compact">
                                        <span>Domiciled Branch</span>
                                        <strong data-statement-branch-name></strong>
                                    </div>
                                </div>

                                <div class="dual-grid statement-inquiry-grid">
                                    <div class="statement-detail-card statement-detail-card--compact statement-detail-card--balance">
                                        <span>Ledger Balance</span>
                                        <strong data-statement-ledger-balance></strong>
                                    </div>
                                    <div class="statement-detail-card statement-detail-card--compact statement-detail-card--balance">
                                        <span>Available Balance</span>
                                        <strong data-statement-available-balance></strong>
                                    </div>
                                </div>

                                <div class="dual-grid statement-inquiry-grid">
                                    <div class="statement-detail-card statement-detail-card--compact statement-detail-card--balance">
                                        <span>Current Balance</span>
                                        <strong data-statement-current-balance></strong>
                                    </div>
                                    <div class="statement-detail-card statement-detail-card--compact statement-detail-card--balance">
                                        <span>Overdraft</span>
                                        <strong data-statement-overdraft></strong>
                                    </div>
                                </div>
                            </form>
                        </div>

                        <aside class="statement-account-layout__preview">
                            <section class="panel statement-doc-panel">
                                <div class="panel-head statement-doc-panel__head">
                                    <h3>Passport Specimen</h3>
                                </div>
                                <div class="statement-preview-box statement-preview-box--compact statement-preview-box--square mt-18" data-statement-passport-preview>
                                    No passport uploaded.
                                </div>
                            </section>
                            <section class="panel mt-18 statement-doc-panel">
                                <div class="panel-head statement-doc-panel__head">
                                    <h3>Signature Specimen</h3>
                                </div>
                                <div class="statement-preview-box statement-preview-box--compact mt-18" data-statement-signature-preview>
                                    No signature uploaded.
                                </div>
                            </section>
                        </aside>
                    </div>
                </section>
            </div>
        </div>
    `;
}

function renderStatementPreviewModal() {
    return `
        <div class="business-modal" data-account-management-modal="statement-preview" hidden>
            <div class="business-modal__backdrop" data-account-management-close></div>
            <div class="business-modal__dialog gl-statement-modal__dialog statement-preview-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="statementPreviewTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Statement preview</p>
                        <h3 id="statementPreviewTitle">Statement of Account</h3>
                    </div>
                    <div class="button-row">
                        <button class="btn btn-secondary" type="button" data-statement-export-excel>Export Excel</button>
                        <button class="btn btn-secondary" type="button" data-statement-export-pdf>Export PDF</button>
                        <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-account-management-close>&times;</button>
                    </div>
                </div>
                <div data-statement-preview-content></div>
            </div>
        </div>
    `;
}

function renderStatementEntryDetailModal() {
    return `
        <div class="business-modal" data-account-management-modal="statement-entry-detail" hidden>
            <div class="business-modal__backdrop" data-account-management-close></div>
            <div class="business-modal__dialog gl-statement-modal__dialog statement-entry-detail-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="statementEntryDetailTitle">
                <div class="business-modal__head">
                    <div>
                        <p class="eyebrow">Reference details</p>
                        <h3 id="statementEntryDetailTitle">Transaction Details</h3>
                    </div>
                    <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-account-management-close>&times;</button>
                </div>
                <div data-statement-entry-detail-content></div>
            </div>
        </div>
    `;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;");
}

function formatMoney(value) {
    const amount = Number(value || 0);
    return `N ${amount.toLocaleString("en-NG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function isRenderableImage(source) {
    const value = String(source || "").trim().toLowerCase();
    return value.startsWith("data:image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(value);
}

function buildDocumentPreviewMarkup(source, fileName, emptyText, options = {}) {
    const resolvedSource = String(source || "").trim();
    const resolvedName = String(fileName || "").trim();
    const showImageName = options.showImageName !== false;
    if (resolvedSource && isRenderableImage(resolvedSource)) {
        return `
            <div class="statement-preview-media">
                <img src="${escapeHtml(resolvedSource)}" alt="${escapeHtml(resolvedName || "Customer document")}">
                ${resolvedName && showImageName ? `<span>${escapeHtml(resolvedName)}</span>` : ""}
            </div>
        `;
    }

    if (resolvedName) {
        return `<div class="statement-preview-file">${escapeHtml(resolvedName)}</div>`;
    }

    return `<div class="statement-preview-file">${escapeHtml(emptyText)}</div>`;
}

function readFileAsDataUrl(file) {
    if (!(file instanceof File) || !file.size) {
        return Promise.resolve("");
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
        reader.readAsDataURL(file);
    });
}

function buildLocalPassportFileName(file, accountNumber = "", customerName = "") {
    const originalName = String(file?.name || "passport").trim() || "passport";
    const extensionMatch = originalName.match(/(\.[a-z0-9]+)$/i);
    const extension = extensionMatch ? extensionMatch[1] : "";
    const baseName = extension ? originalName.slice(0, -extension.length) : originalName;
    const normalizedAccountNumber = String(accountNumber || "").trim().replace(/[^\dA-Za-z_-]/g, "");
    const normalizedCustomerName = String(customerName || "")
        .trim()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();

    return [
        normalizedAccountNumber || "account",
        normalizedCustomerName || "customer",
        `${baseName}-passport${extension}`
    ].join("_");
}

function saveFileToLaptop(file, suggestedFileName) {
    if (!(file instanceof File) || !file.size) {
        return;
    }

    const objectUrl = URL.createObjectURL(file);
    const downloadLink = document.createElement("a");
    downloadLink.href = objectUrl;
    downloadLink.download = String(suggestedFileName || file.name || "passport").trim() || "passport";
    downloadLink.rel = "noopener";
    downloadLink.style.display = "none";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
    }, 1000);
}

function getStatementEntries(record) {
    if (!Array.isArray(record?.statementEntries)) {
        return [];
    }

    return record.statementEntries.map((entry) => ({
        date: String(entry?.date || "").trim(),
        reference: String(entry?.reference || "").trim(),
        postedBy: String(entry?.postedBy || entry?.posted_by || "").trim(),
        narration: String(entry?.narration || "").trim(),
        debit: Number(entry?.debit || 0),
        credit: Number(entry?.credit || 0),
        balance: Number(entry?.balance || 0)
    }));
}

function buildStatementAmountCell(value, tone) {
    return `<span class="statement-amount ${tone}">${escapeHtml(formatMoney(value || 0))}</span>`;
}

function buildStatementReferenceButton(entry, index) {
    const reference = String(entry?.reference || "").trim();
    if (!reference) {
        return "-";
    }

    return `<button class="statement-ref-button" type="button" data-statement-entry-index="${index}">${escapeHtml(reference)}</button>`;
}

function buildStatementEntryDetailHtml(record, entry = {}, options = {}) {
    const debitTone = Number(entry?.debit || 0) > 0 ? "is-debit" : "is-neutral";
    const creditTone = Number(entry?.credit || 0) > 0 ? "is-credit" : "is-neutral";
    const balanceAmount = Number(entry?.balance || 0);
    const balanceTone = balanceAmount < 0 ? "is-debit" : (balanceAmount > 0 ? "is-credit" : "is-neutral");
    const postedBy = String(entry?.postedBy || options?.fallbackPostedBy || "").trim();

    return `
        <section class="statement-transaction-sheet">
            <div class="statement-transaction-sheet__hero">
                <div>
                    <p class="statement-sheet__eyebrow">Transaction details</p>
                    <h3>Statement Transaction</h3>
                    <p class="statement-sheet__meta">Details for the selected statement entry.</p>
                </div>
                <div class="statement-sheet__badge">${escapeHtml(record?.accountType || "-")}</div>
            </div>

            <div class="statement-transaction-sheet__grid">
                <div class="statement-detail-card">
                    <span>Reference No</span>
                    <strong>${escapeHtml(entry?.reference || "-")}</strong>
                </div>
                <div class="statement-detail-card">
                    <span>Transaction Date</span>
                    <strong>${escapeHtml(entry?.date || "-")}</strong>
                </div>
                <div class="statement-detail-card">
                    <span>Posted By</span>
                    <strong>${escapeHtml(postedBy || "-")}</strong>
                </div>
                <div class="statement-detail-card statement-transaction-sheet__wide">
                    <span>Narration</span>
                    <strong>${escapeHtml(entry?.narration || "-")}</strong>
                </div>
                <div class="statement-detail-card">
                    <span>Account Number</span>
                    <strong>${escapeHtml(record?.accountNumber || "-")}</strong>
                </div>
                <div class="statement-detail-card">
                    <span>Customer Name</span>
                    <strong>${escapeHtml(record?.name || "-")}</strong>
                </div>
                <div class="statement-detail-card">
                    <span>Debit</span>
                    <strong class="${debitTone}">${escapeHtml(formatMoney(entry?.debit || 0))}</strong>
                </div>
                <div class="statement-detail-card">
                    <span>Credit</span>
                    <strong class="${creditTone}">${escapeHtml(formatMoney(entry?.credit || 0))}</strong>
                </div>
                <div class="statement-detail-card">
                    <span>Running Balance</span>
                    <strong class="${balanceTone}">${escapeHtml(formatMoney(entry?.balance || 0))}</strong>
                </div>
                <div class="statement-detail-card">
                    <span>Domiciled Branch</span>
                    <strong>${escapeHtml(record?.branchName || "-")}</strong>
                </div>
            </div>
        </section>
    `;
}

function buildStatementPreviewHtml(record) {
    const branding = applyBrandingToDocument(getAppliedBranding());
    const entries = getStatementEntries(record);
    const statementRows = entries.map((entry, index) => ([
        escapeHtml(entry.date || "-"),
        buildStatementReferenceButton(entry, index),
        escapeHtml(entry.narration || "-"),
        buildStatementAmountCell(entry.debit, "statement-amount--debit"),
        buildStatementAmountCell(entry.credit, "statement-amount--credit"),
        buildStatementAmountCell(entry.balance, "statement-amount--balance")
    ]));
    const generatedOn = new Date().toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short"
    });
    const accountType = escapeHtml(record?.accountType || "-");
    const customerName = escapeHtml(record?.name || "-");
    const accountNumber = escapeHtml(record?.accountNumber || "-");
    const branchName = escapeHtml(record?.branchName || "-");
    const passportMarkup = buildDocumentPreviewMarkup(
        record?.passportFileUrl,
        record?.passportFileName,
        "No passport uploaded.",
        { showImageName: false }
    );

    return `
        <section class="statement-sheet">
            <div class="statement-sheet__hero">
                <div>
                    <p class="statement-sheet__eyebrow">Account statement</p>
                    <h2>Statement of Account</h2>
                    <p class="statement-sheet__meta">Generated ${escapeHtml(generatedOn)}</p>
                </div>
                <div class="statement-sheet__badge">${accountType}</div>
            </div>

            <div class="statement-sheet__summary">
                <div class="statement-sheet__profile">
                    <div class="statement-sheet__identity">
                        <div class="statement-sheet__identity-row">
                            <span>Customer Name</span>
                            <strong>${customerName}</strong>
                        </div>
                        <div class="statement-sheet__identity-row">
                            <span>Account Number</span>
                            <strong>${accountNumber}</strong>
                        </div>
                        <div class="statement-sheet__identity-row">
                            <span>Domiciled Branch</span>
                            <strong>${branchName}</strong>
                        </div>
                    </div>
                    <div class="statement-sheet__passport">
                        <span>Customer Passport</span>
                        <div class="statement-sheet__passport-frame">
                            ${passportMarkup}
                        </div>
                    </div>
                </div>

                <div class="statement-sheet__balances">
                    <div class="statement-sheet__balance-card">
                        <span>Ledger Balance</span>
                        <strong class="${Number(record?.ledgerBalance || 0) < 0 ? "is-debit" : "is-credit"}">${escapeHtml(formatMoney(record?.ledgerBalance || 0))}</strong>
                    </div>
                    <div class="statement-sheet__balance-card">
                        <span>Available Balance</span>
                        <strong class="${Number(record?.availableBalance || 0) < 0 ? "is-debit" : "is-credit"}">${escapeHtml(formatMoney(record?.availableBalance || 0))}</strong>
                    </div>
                    <div class="statement-sheet__balance-card">
                        <span>Current Balance</span>
                        <strong class="${Number(record?.currentBalance || 0) < 0 ? "is-debit" : "is-credit"}">${escapeHtml(formatMoney(record?.currentBalance || 0))}</strong>
                    </div>
                    <div class="statement-sheet__balance-card">
                        <span>Overdraft</span>
                        <strong class="${Number(record?.overdraft || 0) < 0 ? "is-debit" : (Number(record?.overdraft || 0) > 0 ? "is-credit" : "is-neutral")}">${escapeHtml(formatMoney(record?.overdraft || 0))}</strong>
                    </div>
                </div>
            </div>

            <div class="statement-sheet__table mt-18 table-wrap">
                ${createTable(
                    ["Date", "Reference No", "Narration", "Debit", "Credit", "Balance"],
                    statementRows
                )}
            </div>
            ${entries.length ? "" : "<p class=\"statement-sheet__empty mt-18\">No statement transactions available yet for this account.</p>"}
        </section>
    `;
}

function downloadStatementExcel(record) {
    const entries = getStatementEntries(record);
    const generatedOn = new Date().toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short"
    });
    const passportMarkup = isRenderableImage(record?.passportFileUrl)
        ? `<img src="${escapeHtml(record.passportFileUrl)}" alt="${escapeHtml(record?.passportFileName || "Customer passport")}">`
        : `<div class="passport-empty">${escapeHtml(record?.passportFileName || "No passport uploaded.")}</div>`;
    const transactionRows = entries.length
        ? entries.map((entry) => `
            <tr>
                <td>${escapeHtml(entry.date || "-")}</td>
                <td>${escapeHtml(entry.reference || "-")}</td>
                <td>${escapeHtml(entry.narration || "-")}</td>
                <td>${escapeHtml(formatMoney(entry.debit || 0))}</td>
                <td>${escapeHtml(formatMoney(entry.credit || 0))}</td>
                <td>${escapeHtml(formatMoney(entry.balance || 0))}</td>
            </tr>
        `).join("")
        : `<tr><td colspan="6" class="empty-row">No statement transactions available yet for this account.</td></tr>`;

    const workbook = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
        <head>
            <meta charset="utf-8">
            <style>
                :root { ${branding.cssVars} }
                body { font-family: Segoe UI, Arial, sans-serif; color: #1d2a36; }
                .sheet { padding: 24px; background: #fffdf9; }
                .hero { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
                .hero h1 { margin: 0 0 8px; font-size: 24px; }
                .meta { color: #6b7785; font-size: 12px; }
                .badge { padding: 8px 12px; background: var(--brand); color: #fff; font-weight: 700; border-radius: 999px; font-size: 11px; }
                .summary { width: 100%; margin-bottom: 18px; }
                .summary td { vertical-align: top; padding: 0; }
                .identity { width: 68%; padding-right: 18px; }
                .identity-card, .passport-card, .balance-card { border: 1px solid #d8e0e8; border-radius: 16px; padding: 16px; background: #ffffff; }
                .identity-row { margin-bottom: 12px; }
                .label { color: #758292; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; display: block; margin-bottom: 4px; }
                .value { font-size: 18px; font-weight: 700; }
                .passport-card { text-align: center; min-height: 140px; }
                .passport-card img { max-width: 130px; max-height: 130px; border-radius: 12px; display: block; margin: 10px auto 0; object-fit: cover; }
                .passport-empty { margin-top: 10px; color: #6b7785; font-size: 12px; }
                .balances { width: 100%; margin: 0 0 20px; }
                .balances td { width: 50%; padding: 0 10px 10px 0; }
                .balance-card .amount { font-size: 19px; font-weight: 800; margin-top: 6px; }
                .credit { color: #157347; }
                .debit { color: #b54545; }
                .neutral { color: #1d2a36; }
                .tx-table { width: 100%; border-collapse: collapse; }
                .tx-table th { background: var(--brand); color: #fff; text-align: left; padding: 12px 10px; font-size: 11px; text-transform: uppercase; }
                .tx-table td { border-bottom: 1px solid #e7edf3; padding: 11px 10px; font-size: 12px; }
                .empty-row { text-align: center; color: #6b7785; background: #f7fafc; }
            </style>
        </head>
        <body>
            <div class="sheet">
                <div class="hero">
                    <div>
                        <h1>Statement of Account</h1>
                        <div class="meta">Generated ${escapeHtml(generatedOn)}</div>
                    </div>
                    <div class="badge">${escapeHtml(record?.accountType || "-")}</div>
                </div>
                <table class="summary" cellspacing="0" cellpadding="0">
                    <tr>
                        <td class="identity">
                            <div class="identity-card">
                                <div class="identity-row">
                                    <span class="label">Customer Name</span>
                                    <div class="value">${escapeHtml(record?.name || "-")}</div>
                                </div>
                                <div class="identity-row">
                                    <span class="label">Account Number</span>
                                    <div class="value">${escapeHtml(record?.accountNumber || "-")}</div>
                                </div>
                                <div class="identity-row">
                                    <span class="label">Domiciled Branch</span>
                                    <div class="value">${escapeHtml(record?.branchName || "-")}</div>
                                </div>
                            </div>
                        </td>
                        <td>
                            <div class="passport-card">
                                <span class="label">Customer Passport</span>
                                ${passportMarkup}
                            </div>
                        </td>
                    </tr>
                </table>
                <table class="balances" cellspacing="0" cellpadding="0">
                    <tr>
                        <td><div class="balance-card"><span class="label">Ledger Balance</span><div class="amount ${Number(record?.ledgerBalance || 0) < 0 ? "debit" : "credit"}">${escapeHtml(formatMoney(record?.ledgerBalance || 0))}</div></div></td>
                        <td><div class="balance-card"><span class="label">Available Balance</span><div class="amount ${Number(record?.availableBalance || 0) < 0 ? "debit" : "credit"}">${escapeHtml(formatMoney(record?.availableBalance || 0))}</div></div></td>
                    </tr>
                    <tr>
                        <td><div class="balance-card"><span class="label">Current Balance</span><div class="amount ${Number(record?.currentBalance || 0) < 0 ? "debit" : "credit"}">${escapeHtml(formatMoney(record?.currentBalance || 0))}</div></div></td>
                        <td><div class="balance-card"><span class="label">Overdraft</span><div class="amount ${Number(record?.overdraft || 0) < 0 ? "debit" : (Number(record?.overdraft || 0) > 0 ? "credit" : "neutral")}">${escapeHtml(formatMoney(record?.overdraft || 0))}</div></div></td>
                    </tr>
                </table>
                <table class="tx-table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Reference No</th>
                            <th>Narration</th>
                            <th>Debit</th>
                            <th>Credit</th>
                            <th>Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${transactionRows}
                    </tbody>
                </table>
            </div>
        </body>
        </html>
    `;

    const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `statement-of-account-${record?.accountNumber || "account"}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
}

function downloadStatementPdf(record) {
    const branding = applyBrandingToDocument(getAppliedBranding());
    const entries = getStatementEntries(record);
    const generatedOn = new Date().toLocaleString("en-NG", {
        dateStyle: "medium",
        timeStyle: "short"
    });
    const transactionHtml = entries.length
        ? entries.map((entry) => `
            <tr>
                <td>${escapeHtml(entry.date || "-")}</td>
                <td>${escapeHtml(entry.reference || "-")}</td>
                <td>${escapeHtml(entry.narration || "-")}</td>
                <td>${escapeHtml(formatMoney(entry.debit || 0))}</td>
                <td>${escapeHtml(formatMoney(entry.credit || 0))}</td>
                <td>${escapeHtml(formatMoney(entry.balance || 0))}</td>
            </tr>
        `).join("")
        : `
            <tr>
                <td colspan="6">No statement transactions available yet for this account.</td>
            </tr>
        `;
    const passportHtml = isRenderableImage(record?.passportFileUrl)
        ? `<img src="${escapeHtml(record.passportFileUrl)}" alt="${escapeHtml(record?.passportFileName || "Customer passport")}">`
        : `<div class="passport-empty">${escapeHtml(record?.passportFileName || "No passport uploaded.")}</div>`;

    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);

    const doc = frame.contentWindow?.document;
    if (!doc) {
        frame.remove();
        return;
    }

    doc.open();
    doc.write(`
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Statement of Account</title>
            <style>
                :root { ${branding.cssVars} }
                body { font-family: "Segoe UI", Arial, sans-serif; padding: 20px; color: #13212b; background: #f6f1e8; }
                .sheet { padding: 22px; border-radius: 24px; background: linear-gradient(180deg, #fffdfa, #f7efe3); border: 1px solid #e5d8c6; }
                .hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid #e6d8c6; }
                h1 { margin: 0 0 6px; font-size: 23px; color: var(--brand); }
                .meta { color: #6b7785; font-size: 11px; }
                .badge { padding: 8px 12px; border-radius: 999px; background: linear-gradient(135deg, var(--brand-2), var(--brand)); color: #fff; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
                .summary { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 14px; margin-bottom: 14px; }
                .identity, .passport, .balance-card { border: 1px solid #ddd6ca; border-radius: 16px; padding: 14px; background: rgba(255, 255, 255, 0.96); }
                .identity { background: linear-gradient(180deg, #ffffff, #faf6ef); }
                .identity-row { margin-bottom: 9px; }
                .identity-row:last-child { margin-bottom: 0; }
                .label { display: block; margin-bottom: 4px; color: #7b8795; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
                .value { font-size: 15px; font-weight: 700; color: #203142; }
                .passport { text-align: center; background: linear-gradient(180deg, #fff, #f7f2e9); }
                .passport img { max-width: 110px; max-height: 110px; object-fit: cover; border-radius: 10px; margin-top: 10px; box-shadow: 0 8px 18px rgba(19, 33, 43, 0.12); }
                .passport-empty { margin-top: 10px; color: #6b7785; font-size: 11px; }
                .balances { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 18px; }
                .balance-card { background: linear-gradient(180deg, #f4f8fc, #ffffff); border-color: #d5e0ec; }
                .amount { margin-top: 6px; font-size: 17px; font-weight: 800; }
                .credit { color: #157347; }
                .debit { color: #b54545; }
                .neutral { color: #13212b; }
                .table-wrap { border: 1px solid #d9e3ee; border-radius: 18px; overflow: hidden; background: #fff; }
                table { width: 100%; border-collapse: collapse; margin-top: 0; }
                td, th { border-bottom: 1px solid #d9e0e7; padding: 9px 10px; text-align: left; font-size: 11px; }
                th { background: linear-gradient(135deg, var(--brand-2), var(--brand)); color: #fff; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
                tbody tr:nth-child(even) td { background: #f8fbfe; }
                tbody tr:last-child td { border-bottom: 0; }
            </style>
        </head>
        <body>
            <div class="sheet">
                <div class="hero">
                    <div>
                        <h1>Statement of Account</h1>
                        <div class="meta">Generated ${escapeHtml(generatedOn)}</div>
                    </div>
                    <div class="badge">${escapeHtml(record?.accountType || "-")}</div>
                </div>
                <section class="summary">
                    <div class="identity">
                        <div class="identity-row"><span class="label">Customer Name</span><div class="value">${escapeHtml(record?.name || "-")}</div></div>
                        <div class="identity-row"><span class="label">Account Number</span><div class="value">${escapeHtml(record?.accountNumber || "-")}</div></div>
                        <div class="identity-row"><span class="label">Domiciled Branch</span><div class="value">${escapeHtml(record?.branchName || "-")}</div></div>
                    </div>
                    <div class="passport">
                        <span class="label">Customer Passport</span>
                        ${passportHtml}
                    </div>
                </section>
                <section class="balances">
                    <div class="balance-card"><span class="label">Ledger Balance</span><div class="amount ${Number(record?.ledgerBalance || 0) < 0 ? "debit" : "credit"}">${escapeHtml(formatMoney(record?.ledgerBalance || 0))}</div></div>
                    <div class="balance-card"><span class="label">Available Balance</span><div class="amount ${Number(record?.availableBalance || 0) < 0 ? "debit" : "credit"}">${escapeHtml(formatMoney(record?.availableBalance || 0))}</div></div>
                    <div class="balance-card"><span class="label">Current Balance</span><div class="amount ${Number(record?.currentBalance || 0) < 0 ? "debit" : "credit"}">${escapeHtml(formatMoney(record?.currentBalance || 0))}</div></div>
                    <div class="balance-card"><span class="label">Overdraft</span><div class="amount ${Number(record?.overdraft || 0) < 0 ? "debit" : (Number(record?.overdraft || 0) > 0 ? "credit" : "neutral")}">${escapeHtml(formatMoney(record?.overdraft || 0))}</div></div>
                </section>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Reference No</th>
                                <th>Narration</th>
                                <th>Debit</th>
                                <th>Credit</th>
                                <th>Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${transactionHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        </body>
        </html>
    `);
    doc.close();
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 1000);
}

function renderMainPanel(tabKey, accountStats) {
    return renderOpenAccountMainTab(accountStats);
}

export async function renderAccountManagement() {
    const session = await getCurrentSessionContext();
    const branchScope = session?.userId && session?.businessId
        ? await getActiveBranchDetails(session.userId, session.businessId)
        : { id: "", name: "Active Branch" };
    const [accountRecords, accountProducts, existingRecords] = await Promise.all([
        getOpenedAccounts(),
        getAccountProductsCatalog(),
        getExistingAccountOpeningRecords()
    ]);
    const accountStats = buildAccountActivityStats(accountRecords);

    return {
        summary: [],
        content: `
            <div class="section-stack">
                <section class="panel account-management-toolbar-panel">
                    <div class="panel-head">
                        <h3>Account Management</h3>
                    </div>
                    <div class="button-row demo-tabbar account-management-actions mt-18" aria-label="Account management actions">
                        <div class="account-management-dropdown">
                            <button class="btn btn-primary" type="button" data-open-account-menu-trigger aria-expanded="false">
                                Open Account
                            </button>
                            <div class="account-management-dropdown__menu panel" data-open-account-menu hidden>
                                <button class="account-management-dropdown__item" type="button" data-open-account-action="new">
                                    <strong>New Account</strong>
                                </button>
                                <button class="account-management-dropdown__item" type="button" data-open-account-action="update">
                                    <strong>Update Account</strong>
                                </button>
                                <button class="account-management-dropdown__item" type="button" data-open-account-action="existing">
                                    <strong>Open Existing Record</strong>
                                </button>
                            </div>
                        </div>
                        <button class="btn btn-secondary" type="button" data-open-statement-modal>Statement of Account</button>
                    </div>
                </section>

                <div data-account-management-main-panel>
                    ${renderMainPanel("open", accountStats)}
                </div>
            </div>

            ${renderNewAccountModal(branchScope, accountProducts)}
            ${renderUpdateAccountModal(branchScope)}
            ${renderExistingRecordModal(branchScope, accountProducts, existingRecords)}
            ${renderStatementModal()}
            ${renderStatementPreviewModal()}
            ${renderStatementEntryDetailModal()}
            ${renderOpenedTodayModal(accountStats.openedTodayRecords)}
        `,
        afterRender(container, refresh) {
            const mainPanel = container.querySelector("[data-account-management-main-panel]");
            const modals = Array.from(container.querySelectorAll("[data-account-management-modal]"));
            const openAccountMenuTrigger = container.querySelector("[data-open-account-menu-trigger]");
            const openAccountMenu = container.querySelector("[data-open-account-menu]");
            const statementPreviewContent = container.querySelector("[data-statement-preview-content]");
            const statementEntryDetailContent = container.querySelector("[data-statement-entry-detail-content]");
            let activeStatementRecord = null;
            let resetOpenAccountForm = () => {};
            let resetUpdateAccountForm = () => {};
            let resetExistingRecordForm = () => {};
            let resetStatementModal = () => {};

            const resetModalState = (modalKey) => {
                const modal = container.querySelector(`[data-account-management-modal="${String(modalKey || "")}"]`);
                modal?.querySelector("form")?.reset();
                switch (String(modalKey || "")) {
                    case "new":
                        resetOpenAccountForm();
                        break;
                    case "update":
                        resetUpdateAccountForm();
                        break;
                    case "existing":
                        resetExistingRecordForm();
                        break;
                    case "statement":
                        resetStatementModal();
                        break;
                    case "statement-preview":
                        activeStatementRecord = null;
                        if (statementPreviewContent) {
                            statementPreviewContent.innerHTML = "";
                        }
                        break;
                    case "statement-entry-detail":
                        if (statementEntryDetailContent) {
                            statementEntryDetailContent.innerHTML = "";
                        }
                        break;
                    default:
                        break;
                }
            };

            const closeModal = (modal) => {
                if (!modal) {
                    return;
                }
                resetModalState(modal.getAttribute("data-account-management-modal"));
                modal.hidden = true;
            };

            const closeOpenAccountMenu = () => {
                if (openAccountMenu) {
                    openAccountMenu.hidden = true;
                }
                openAccountMenuTrigger?.setAttribute("aria-expanded", "false");
            };

            const toggleOpenAccountMenu = () => {
                if (!openAccountMenu) {
                    return;
                }
                const willOpen = openAccountMenu.hidden;
                openAccountMenu.hidden = !willOpen;
                openAccountMenuTrigger?.setAttribute("aria-expanded", willOpen ? "true" : "false");
            };

            const setMainTab = (tabKey) => {
                if (mainPanel) {
                    mainPanel.innerHTML = renderMainPanel(tabKey, accountStats);
                }
                closeOpenAccountMenu();
            };

            const setOpeningTab = (tabKey) => {
                const currentOpeningButtons = Array.from(container.querySelectorAll("[data-account-opening-tab]"));
                const currentOpeningPanels = Array.from(container.querySelectorAll("[data-account-opening-panel]"));
                currentOpeningButtons.forEach((button) => {
                    const isActive = String(button.getAttribute("data-account-opening-tab") || "") === tabKey;
                    button.classList.toggle("btn-primary", isActive);
                    button.classList.toggle("btn-secondary", !isActive);
                    button.setAttribute("aria-selected", String(isActive));
                });
                currentOpeningPanels.forEach((panel) => {
                    panel.hidden = String(panel.getAttribute("data-account-opening-panel") || "") !== tabKey;
                });
                accountOpeningModalTab = tabKey;
            };

            const openModal = (modalKey, options = {}) => {
                const { stack = false } = options;
                modals.forEach((modal) => {
                    const isTarget = String(modal.getAttribute("data-account-management-modal") || "") === modalKey;
                    if (stack) {
                        if (isTarget) {
                            modal.hidden = false;
                        }
                        return;
                    }
                    modal.hidden = !isTarget;
                });
                closeOpenAccountMenu();
                if (modalKey === "new") {
                    const savedOpeningTab = String(accountOpeningModalTab || "personal");
                    setOpeningTab(savedOpeningTab === "kin" || savedOpeningTab === "documents" ? savedOpeningTab : "personal");
                    const accountNumberPreview = container.querySelector("[data-account-number-preview]");
                    const accountTypeSelect = container.querySelector('select[name="accountType"]');
                    const statusNode = container.querySelector("[data-open-account-status]");
                    if (accountNumberPreview) {
                        const selectedType = String(accountTypeSelect?.value || "").trim();
                        if (selectedType) {
                            accountNumberPreview.placeholder = "Generating account number...";
                            generateAccountNumberForType(selectedType)
                                .then((value) => {
                                    accountNumberPreview.value = value || "";
                                    accountNumberPreview.placeholder = "Auto-generated after approval";
                                })
                                .catch((error) => {
                                    accountNumberPreview.value = "";
                                    accountNumberPreview.placeholder = error?.message || "Unable to generate account number";
                                });
                        } else {
                            accountNumberPreview.value = "";
                            accountNumberPreview.placeholder = "Select account type first";
                        }
                    }
                    if (statusNode) {
                        statusNode.textContent = "Fill the required customer information before opening the account.";
                    }
                }
            };

            const bindAutoCapitalize = () => {
                container.querySelectorAll("[data-auto-capitalize='words']").forEach((field) => {
                    field.addEventListener("input", (event) => {
                        const input = event.currentTarget;
                        const currentValue = String(input.value || "");
                        const nextValue = currentValue.replace(/\b([a-z])/g, (match) => match.toUpperCase());
                        if (nextValue !== currentValue) {
                            const cursorStart = input.selectionStart;
                            const cursorEnd = input.selectionEnd;
                            input.value = nextValue;
                            if (typeof cursorStart === "number" && typeof cursorEnd === "number") {
                                input.setSelectionRange(cursorStart, cursorEnd);
                            }
                        }
                    });
                });
            };

            const bindPhoneInputs = () => {
                container.querySelectorAll("[data-phone-input='true']").forEach((field) => {
                    field.addEventListener("input", (event) => {
                        const input = event.currentTarget;
                        const currentValue = String(input.value || "");
                        const nextValue = currentValue.replace(/[^0-9+]/g, "");
                        if (nextValue !== currentValue) {
                            const cursorStart = input.selectionStart;
                            const cursorEnd = input.selectionEnd;
                            input.value = nextValue;
                            if (typeof cursorStart === "number" && typeof cursorEnd === "number") {
                                input.setSelectionRange(cursorStart, cursorEnd);
                            }
                        }
                    });
                });
            };

            const bindAgeDisplay = () => {
                const dobInput = container.querySelector("[data-date-of-birth]");
                const ageDisplay = container.querySelector("[data-age-display]");
                if (!dobInput || !ageDisplay) {
                    return;
                }

                const updateAge = () => {
                    const rawValue = String(dobInput.value || "").trim();
                    if (!rawValue) {
                        ageDisplay.textContent = "Age will appear here.";
                        return;
                    }

                    const dob = new Date(rawValue);
                    if (Number.isNaN(dob.getTime())) {
                        ageDisplay.textContent = "Invalid date of birth.";
                        return;
                    }

                    const today = new Date();
                    let age = today.getFullYear() - dob.getFullYear();
                    const monthDiff = today.getMonth() - dob.getMonth();
                    const dayDiff = today.getDate() - dob.getDate();

                    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
                        age -= 1;
                    }

                    if (age < 0) {
                        ageDisplay.textContent = "Invalid date of birth.";
                        return;
                    }

                    ageDisplay.textContent = `${age}years`;
                };

                dobInput.addEventListener("input", updateAge);
                dobInput.addEventListener("change", updateAge);
            };

            const bindOpenAccountForm = () => {
                const form = container.querySelector("[data-open-account-form]");
                const submitButton = container.querySelector("[data-open-account-submit]");
                const statusNode = container.querySelector("[data-open-account-status]");
                const accountNumberPreview = container.querySelector("[data-account-number-preview]");
                const accountTypeSelect = container.querySelector('select[name="accountType"]');
                const ageDisplay = container.querySelector("[data-age-display]");

                const updateAccountNumberPreview = async () => {
                    if (!accountNumberPreview) {
                        return;
                    }
                    const selectedType = String(accountTypeSelect?.value || "").trim();
                    if (!selectedType) {
                        accountNumberPreview.value = "";
                        accountNumberPreview.placeholder = "Select account type first";
                        return;
                    }
                    try {
                        accountNumberPreview.placeholder = "Generating account number...";
                        accountNumberPreview.value = await generateAccountNumberForType(selectedType);
                        accountNumberPreview.placeholder = "Auto-generated after approval";
                    } catch (error) {
                        accountNumberPreview.value = "";
                        accountNumberPreview.placeholder = error?.message || "Unable to generate account number";
                    }
                };

                resetOpenAccountForm = () => {
                    form?.reset();
                    setOpeningTab("personal");
                    if (statusNode) {
                        statusNode.textContent = "Fill the required customer information before opening the account.";
                    }
                    if (ageDisplay) {
                        ageDisplay.textContent = "Age will appear here.";
                    }
                    void updateAccountNumberPreview();
                };

                void updateAccountNumberPreview();
                accountTypeSelect?.addEventListener("change", () => {
                    void updateAccountNumberPreview();
                });

                form?.addEventListener("submit", async (event) => {
                    event.preventDefault();
                    if (!form) {
                        return;
                    }

                    const data = new FormData(form);
                    const passportFile = data.get("passportFile");
                    const payload = {
                        firstName: String(data.get("firstName") || "").trim(),
                        lastName: String(data.get("lastName") || "").trim(),
                        otherName: String(data.get("otherName") || "").trim(),
                        phone: String(data.get("phone") || "").trim(),
                        email: String(data.get("email") || "").trim(),
                        dob: String(data.get("dob") || "").trim(),
                        accountType: String(data.get("accountType") || "").trim(),
                        branchId: String(data.get("branchId") || "").trim(),
                        branchName: String(data.get("branchName") || "").trim(),
                        residentialAddress: String(data.get("residentialAddress") || "").trim()
                    };

                    if (statusNode) {
                        statusNode.textContent = "Opening account...";
                    }
                    setSubmittingState(submitButton, true);

                    try {
                        const created = await openAccount(payload);
                        if (passportFile instanceof File && passportFile.size > 0) {
                            saveFileToLaptop(
                                passportFile,
                                buildLocalPassportFileName(passportFile, created?.accountNumber, created?.name)
                            );
                        }
                        if (accountNumberPreview) {
                            accountNumberPreview.value = created.accountNumber || "";
                        }
                        if (statusNode) {
                            statusNode.textContent = passportFile instanceof File && passportFile.size > 0
                                ? `Account opened successfully. Account number: ${created.accountNumber}. Passport saved to this laptop downloads.`
                                : `Account opened successfully. Account number: ${created.accountNumber}`;
                        }
                        showToast(`Account opened: ${created.accountNumber}`);
                        form.reset();
                        await updateAccountNumberPreview();
                        if (ageDisplay) {
                            ageDisplay.textContent = "Age will appear here.";
                        }
                        if (typeof refresh === "function") {
                            await refresh();
                        }
                    } catch (error) {
                        const message = error?.message || "We could not open this account right now. Please try again.";
                        if (statusNode) {
                            statusNode.textContent = message;
                        }
                        showToast(message);
                    } finally {
                        setSubmittingState(submitButton, false);
                    }
                });
            };

            const bindUpdateAccountForm = () => {
                const form = container.querySelector("[data-update-account-form]");
                const accountNumberInput = container.querySelector("[data-update-account-number]");
                const customerNameInput = container.querySelector("[data-update-customer-name]");
                const branchNameInput = container.querySelector("[data-update-branch-name]");
                const passportNameNode = container.querySelector("[data-update-passport-name]");
                const signatureNameNode = container.querySelector("[data-update-signature-name]");
                const statusNode = container.querySelector("[data-update-account-status]");
                const submitButton = container.querySelector("[data-update-account-submit]");

                const populateUpdateForm = (record) => {
                    if (!form) {
                        return;
                    }
                    form.querySelector('input[name="phone"]').value = String(record?.phone || "");
                    form.querySelector('input[name="email"]').value = String(record?.email || "");
                    form.querySelector('textarea[name="residentialAddress"]').value = String(record?.residentialAddress || "");
                    form.querySelector('textarea[name="operationsNote"]').value = String(record?.operationsNote || "");
                    form.querySelector('select[name="status"]').value = String(record?.status || "Active");
                    if (customerNameInput) {
                        customerNameInput.value = String(record?.name || "");
                    }
                    if (branchNameInput) {
                        branchNameInput.value = String(record?.branchName || branchNameInput.value || "");
                    }
                    if (passportNameNode) {
                        passportNameNode.textContent = record?.passportFileName
                            ? `Current passport: ${record.passportFileName}`
                            : "No passport uploaded yet.";
                    }
                    if (signatureNameNode) {
                        signatureNameNode.textContent = record?.signatureFileName
                            ? `Current signature: ${record.signatureFileName}`
                            : "No signature uploaded yet.";
                    }
                };

                resetUpdateAccountForm = () => {
                    form?.reset();
                    if (customerNameInput) {
                        customerNameInput.value = "";
                    }
                    if (passportNameNode) {
                        passportNameNode.textContent = "No passport uploaded yet.";
                    }
                    if (signatureNameNode) {
                        signatureNameNode.textContent = "No signature uploaded yet.";
                    }
                    if (statusNode) {
                        statusNode.textContent = "Enter an account number to load existing account details.";
                    }
                };

                const loadByAccountNumber = async () => {
                    const accountNumber = String(accountNumberInput?.value || "").trim();
                    if (!accountNumber) {
                        if (statusNode) {
                            statusNode.textContent = "Enter an account number to load account details.";
                        }
                        return;
                    }

                    const record = await getOpenedAccountByNumber(accountNumber);
                    if (!record) {
                        if (customerNameInput) {
                            customerNameInput.value = "";
                        }
                        if (statusNode) {
                            statusNode.textContent = "Account number not found.";
                        }
                        if (passportNameNode) {
                            passportNameNode.textContent = "No passport uploaded yet.";
                        }
                        if (signatureNameNode) {
                            signatureNameNode.textContent = "No signature uploaded yet.";
                        }
                        return;
                    }

                    populateUpdateForm(record);
                    if (statusNode) {
                        statusNode.textContent = "Account details loaded.";
                    }
                };

                accountNumberInput?.addEventListener("change", () => {
                    void loadByAccountNumber();
                });
                accountNumberInput?.addEventListener("blur", () => {
                    void loadByAccountNumber();
                });

                form?.addEventListener("submit", async (event) => {
                    event.preventDefault();
                    if (!form) {
                        return;
                    }

                    const data = new FormData(form);
                    const accountNumber = String(data.get("accountNumber") || "").trim();
                    const passportFile = data.get("passportFile");
                    const signatureFile = data.get("signatureFile");
                    if (!accountNumber) {
                        if (statusNode) {
                            statusNode.textContent = "Enter an account number before updating.";
                        }
                        return;
                    }

                    setSubmittingState(submitButton, true);
                    if (statusNode) {
                        statusNode.textContent = "Updating account...";
                    }

                    try {
                        const passportFileUrl = await readFileAsDataUrl(passportFile);
                        const signatureFileUrl = await readFileAsDataUrl(signatureFile);
                        const hasPassportFile = passportFile instanceof File && passportFile.size > 0;
                        const hasSignatureFile = signatureFile instanceof File && signatureFile.size > 0;
                        const updated = await updateOpenedAccount(accountNumber, {
                            phone: String(data.get("phone") || "").trim(),
                            email: String(data.get("email") || "").trim(),
                            residentialAddress: String(data.get("residentialAddress") || "").trim(),
                            status: String(data.get("status") || "").trim(),
                            operationsNote: String(data.get("operationsNote") || "").trim(),
                            ...(hasPassportFile ? {
                                passportFileName: passportFile.name || "",
                                passportFileUrl
                            } : {}),
                            ...(hasSignatureFile ? {
                                signatureFileName: signatureFile.name || "",
                                signatureFileUrl
                            } : {})
                        });
                        if (hasPassportFile) {
                            saveFileToLaptop(
                                passportFile,
                                buildLocalPassportFileName(passportFile, updated?.accountNumber, updated?.name)
                            );
                        }
                        populateUpdateForm(updated);
                        if (statusNode) {
                            statusNode.textContent = hasPassportFile
                                ? "Account updated successfully. Passport saved to this laptop downloads."
                                : "Account updated successfully.";
                        }
                        showToast("Account updated successfully.");
                        if (typeof refresh === "function") {
                            await refresh();
                        }
                    } catch (error) {
                        const message = error?.message || "Unable to update account right now.";
                        if (statusNode) {
                            statusNode.textContent = message;
                        }
                        showToast(message);
                    } finally {
                        setSubmittingState(submitButton, false);
                    }
                });
            };

            const bindExistingRecordForm = () => {
                const form = container.querySelector("[data-existing-record-form]");
                const recordReferenceInput = container.querySelector("[data-existing-record-reference]");
                const recordIdInput = container.querySelector("[data-existing-record-id]");
                const fetchButton = container.querySelector("[data-existing-record-fetch]");
                const previewNode = container.querySelector("[data-existing-record-preview]");
                const referenceDisplayNode = container.querySelector("[data-existing-record-reference-display]");
                const nameNode = container.querySelector("[data-existing-record-name]");
                const emailNode = container.querySelector("[data-existing-record-email]");
                const phoneNode = container.querySelector("[data-existing-record-phone]");
                const industryNode = container.querySelector("[data-existing-record-industry]");
                const createdAtNode = container.querySelector("[data-existing-record-created-at]");
                const passportPreviewNode = container.querySelector("[data-existing-record-passport-preview]");
                const signaturePreviewNode = container.querySelector("[data-existing-record-signature-preview]");
                const statusNode = container.querySelector("[data-existing-record-status]");
                const submitButton = container.querySelector("[data-existing-record-submit]");

                const formatPreviewDate = (value) => {
                    const parsed = new Date(String(value || ""));
                    if (Number.isNaN(parsed.getTime())) {
                        return "-";
                    }
                    return parsed.toLocaleDateString("en-NG", {
                        year: "numeric",
                        month: "short",
                        day: "numeric"
                    });
                };

                const populateExistingRecord = (record) => {
                    if (referenceDisplayNode) {
                        referenceDisplayNode.textContent = record?.reference || "-";
                    }
                    if (nameNode) {
                        nameNode.textContent = record?.name || "-";
                    }
                    if (emailNode) {
                        emailNode.textContent = record?.email || "-";
                    }
                    if (phoneNode) {
                        phoneNode.textContent = record?.phone || "-";
                    }
                    if (industryNode) {
                        industryNode.textContent = record?.industry || "-";
                    }
                    if (createdAtNode) {
                        createdAtNode.textContent = formatPreviewDate(record?.createdAt);
                    }
                    if (passportPreviewNode) {
                        passportPreviewNode.innerHTML = buildDocumentPreviewMarkup(
                            record?.passportFileUrl,
                            record?.passportFileName,
                            "No passport uploaded.",
                            { showImageName: false }
                        );
                    }
                    if (signaturePreviewNode) {
                        signaturePreviewNode.innerHTML = buildDocumentPreviewMarkup(
                            record?.signatureFileUrl,
                            record?.signatureFileName,
                            "No signature uploaded.",
                            { showImageName: false }
                        );
                    }
                    if (previewNode) {
                        previewNode.value = record
                            ? `${record.name || "Customer"} ${record.email ? `| ${record.email}` : ""}${record.phone ? ` | ${record.phone}` : ""}`.trim()
                            : "Select an existing record to preview details.";
                    }
                    if (recordIdInput) {
                        recordIdInput.value = record?.id || "";
                    }
                };

                resetExistingRecordForm = () => {
                    form?.reset();
                    populateExistingRecord(null);
                    if (statusNode) {
                        statusNode.textContent = "Enter a 10-digit existing account number to fetch the customer profile and continue.";
                    }
                };

                const loadExistingRecord = async () => {
                    const reference = String(recordReferenceInput?.value || "").replace(/\D/g, "").slice(0, 10);
                    if (recordReferenceInput && recordReferenceInput.value !== reference) {
                        recordReferenceInput.value = reference;
                    }
                    if (!reference) {
                        populateExistingRecord(null);
                        if (statusNode) {
                            statusNode.textContent = "Enter a 10-digit number before fetching details.";
                        }
                        return null;
                    }
                    if (reference.length < 10) {
                        populateExistingRecord(null);
                        if (statusNode) {
                            statusNode.textContent = "Enter the complete 10-digit number.";
                        }
                        return null;
                    }

                    const record = await getOpenedAccountByNumber(reference);
                    if (!record) {
                        populateExistingRecord(null);
                        if (statusNode) {
                            statusNode.textContent = "Account number not found.";
                        }
                        return null;
                    }

                    if (recordReferenceInput) {
                        recordReferenceInput.value = record.accountNumber || reference;
                    }
                    populateExistingRecord(record);
                    if (statusNode) {
                        statusNode.textContent = "Record loaded. Select an account product to continue.";
                    }
                    return record;
                };

                fetchButton?.addEventListener("click", () => {
                    void loadExistingRecord();
                });

                recordReferenceInput?.addEventListener("change", () => {
                    void loadExistingRecord();
                });

                recordReferenceInput?.addEventListener("input", (event) => {
                    const input = event.currentTarget;
                    const currentValue = String(input.value || "");
                    const nextValue = currentValue.replace(/\D/g, "").slice(0, 10);
                    if (nextValue !== currentValue) {
                        input.value = nextValue;
                    }
                    if (nextValue.length === 10) {
                        void loadExistingRecord();
                        return;
                    }
                    if (nextValue.length === 0) {
                        populateExistingRecord(null);
                        if (statusNode) {
                            statusNode.textContent = "Enter a 10-digit existing account number to fetch the customer profile and continue.";
                        }
                        return;
                    }
                    if (statusNode) {
                        statusNode.textContent = "Enter the complete 10-digit number.";
                    }
                });

                recordReferenceInput?.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        void loadExistingRecord();
                    }
                });

                form?.addEventListener("submit", async (event) => {
                    event.preventDefault();
                    if (!form) {
                        return;
                    }

                    const data = new FormData(form);
                    const recordId = String(data.get("recordId") || "").trim();
                    const accountType = String(data.get("accountType") || "").trim();
                    if (!recordId) {
                        if (statusNode) {
                            statusNode.textContent = "Fetch the 10-digit number before continuing.";
                        }
                        return;
                    }
                    if (!accountType) {
                        if (statusNode) {
                            statusNode.textContent = "Select an account product before continuing.";
                        }
                        return;
                    }

                    setSubmittingState(submitButton, true);
                    if (statusNode) {
                        statusNode.textContent = "Opening account from existing record...";
                    }

                    try {
                        const created = await openAccountFromExistingAccount(String(recordReferenceInput?.value || "").trim(), {
                            accountType,
                            branchId: String(data.get("branchId") || "").trim(),
                            branchName: String(data.get("branchName") || "").trim()
                        });
                        if (statusNode) {
                            statusNode.textContent = `Account opened successfully. Account number: ${created.accountNumber}`;
                        }
                        showToast(`Account opened: ${created.accountNumber}`);
                        resetExistingRecordForm();
                        closeModal(container.querySelector('[data-account-management-modal="existing"]'));
                        if (typeof refresh === "function") {
                            await refresh();
                        }
                    } catch (error) {
                        const message = error?.message || "Unable to open account from the selected existing record.";
                        if (statusNode) {
                            statusNode.textContent = message;
                        }
                        showToast(message);
                    } finally {
                        setSubmittingState(submitButton, false);
                    }
                });
            };

            const bindStatementModal = () => {
                const accountNumberInput = container.querySelector("[data-statement-account-number]");
                const statusNode = container.querySelector("[data-statement-status]");
                const customerNameInput = container.querySelector("[data-statement-customer-name]");
                const branchNameInput = container.querySelector("[data-statement-branch-name]");
                const ledgerBalanceInput = container.querySelector("[data-statement-ledger-balance]");
                const availableBalanceInput = container.querySelector("[data-statement-available-balance]");
                const currentBalanceInput = container.querySelector("[data-statement-current-balance]");
                const overdraftInput = container.querySelector("[data-statement-overdraft]");
                const passportPreview = container.querySelector("[data-statement-passport-preview]");
                const signaturePreview = container.querySelector("[data-statement-signature-preview]");
                const alertNode = container.querySelector("[data-statement-alert]");
                const previewContent = container.querySelector("[data-statement-preview-content]");
                const balanceNodes = [
                    ledgerBalanceInput,
                    availableBalanceInput,
                    currentBalanceInput,
                    overdraftInput
                ];

                const formatAmount = (value) => {
                    const amount = Number(value || 0);
                    return `N ${amount.toLocaleString("en-NG", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    })}`;
                };

                const setBalanceTone = (node, value) => {
                    if (!node) {
                        return;
                    }
                    const amount = Number(value || 0);
                    node.classList.remove("is-credit", "is-debit", "is-neutral");
                    if (!Number.isFinite(amount) || amount === 0) {
                        node.classList.add("is-neutral");
                        return;
                    }
                    node.classList.add(amount < 0 ? "is-debit" : "is-credit");
                };

                const resetStatementFields = () => {
                    if (accountNumberInput) accountNumberInput.value = "";
                    if (customerNameInput) customerNameInput.textContent = "";
                    if (branchNameInput) branchNameInput.textContent = "";
                    if (ledgerBalanceInput) ledgerBalanceInput.textContent = "";
                    if (availableBalanceInput) availableBalanceInput.textContent = "";
                    if (currentBalanceInput) currentBalanceInput.textContent = "";
                    if (overdraftInput) overdraftInput.textContent = "";
                    activeStatementRecord = null;
                    balanceNodes.forEach((node) => setBalanceTone(node, 0));
                    if (passportPreview) passportPreview.innerHTML = buildDocumentPreviewMarkup("", "", "No passport uploaded.");
                    if (signaturePreview) signaturePreview.innerHTML = buildDocumentPreviewMarkup("", "", "No signature uploaded.");
                    if (statusNode) {
                        statusNode.textContent = "Enter account number to fetch account details.";
                    }
                    if (previewContent) {
                        previewContent.innerHTML = "";
                    }
                    showAlert("");
                };

                resetStatementModal = resetStatementFields;

                const showAlert = (message = "") => {
                    if (!alertNode) {
                        return;
                    }
                    const text = String(message || "").trim();
                    alertNode.textContent = text;
                    alertNode.hidden = !text;
                };

                const loadStatementAccount = async () => {
                    const accountNumber = String(accountNumberInput?.value || "").trim();
                    if (!/^\d{10}$/.test(accountNumber)) {
                        resetStatementFields();
                        showAlert("");
                        if (statusNode) {
                            statusNode.textContent = "Enter a valid 10-digit account number.";
                        }
                        return;
                    }

                    const record = await getOpenedAccountByNumber(accountNumber);
                    if (!record) {
                        resetStatementFields();
                        showAlert("Account does not exist.");
                        if (statusNode) {
                            statusNode.textContent = "Account does not exist.";
                        }
                        return;
                    }

                    showAlert("");
                    if (customerNameInput) customerNameInput.textContent = String(record.name || "");
                    if (branchNameInput) branchNameInput.textContent = String(record.branchName || "");
                    if (ledgerBalanceInput) ledgerBalanceInput.textContent = formatAmount(record.ledgerBalance);
                    if (availableBalanceInput) availableBalanceInput.textContent = formatAmount(record.availableBalance);
                    if (currentBalanceInput) currentBalanceInput.textContent = formatAmount(record.currentBalance);
                    if (overdraftInput) overdraftInput.textContent = formatAmount(record.overdraft);
                    setBalanceTone(ledgerBalanceInput, record.ledgerBalance);
                    setBalanceTone(availableBalanceInput, record.availableBalance);
                    setBalanceTone(currentBalanceInput, record.currentBalance);
                    setBalanceTone(overdraftInput, record.overdraft);
                    if (passportPreview) {
                        passportPreview.innerHTML = buildDocumentPreviewMarkup(
                            record.passportFileUrl,
                            record.passportFileName,
                            "No passport uploaded.",
                            { showImageName: false }
                        );
                    }
                    if (signaturePreview) {
                        signaturePreview.innerHTML = buildDocumentPreviewMarkup(
                            record.signatureFileUrl,
                            record.signatureFileName,
                            "No signature uploaded.",
                            { showImageName: false }
                        );
                    }
                    activeStatementRecord = record;
                    if (statusNode) {
                        statusNode.textContent = "Account details loaded successfully.";
                    }
                };

                accountNumberInput?.addEventListener("input", (event) => {
                    const input = event.currentTarget;
                    const currentValue = String(input.value || "");
                    const nextValue = currentValue.replace(/\D/g, "").slice(0, 10);
                    if (nextValue !== currentValue) {
                        input.value = nextValue;
                    }
                    if (nextValue.length < 10) {
                        showAlert("");
                        if (
                            statusNode?.textContent === "Account does not exist."
                            || statusNode?.textContent === "Enter a valid 10-digit account number."
                        ) {
                            statusNode.textContent = "";
                        }
                    }
                    if (nextValue.length === 10) {
                        void loadStatementAccount();
                    }
                });

                accountNumberInput?.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        void loadStatementAccount();
                    }
                });

                container.querySelector("[data-statement-fetch]")?.addEventListener("click", () => {
                    void loadStatementAccount();
                });

                container.querySelector("[data-statement-view]")?.addEventListener("click", async () => {
                    await loadStatementAccount();
                    if (statusNode?.textContent === "Account details loaded successfully.") {
                        if (previewContent) {
                            previewContent.innerHTML = buildStatementPreviewHtml(activeStatementRecord);
                        }
                        openModal("statement-preview", { stack: true });
                    }
                });

                previewContent?.addEventListener("click", (event) => {
                    const trigger = event.target.closest("[data-statement-entry-index]");
                    if (!trigger || !activeStatementRecord) {
                        return;
                    }

                    const entryIndex = Number(trigger.getAttribute("data-statement-entry-index"));
                    const entry = getStatementEntries(activeStatementRecord)[entryIndex];
                    if (!entry || !statementEntryDetailContent) {
                        return;
                    }

                    statementEntryDetailContent.innerHTML = buildStatementEntryDetailHtml(activeStatementRecord, entry, {
                        fallbackPostedBy: session?.fullName || session?.userEmail || ""
                    });
                    openModal("statement-entry-detail", { stack: true });
                });

                container.querySelector("[data-statement-export-excel]")?.addEventListener("click", () => {
                    if (!activeStatementRecord) {
                        showToast("Fetch an account before exporting.");
                        return;
                    }
                    downloadStatementExcel(activeStatementRecord);
                });

                container.querySelector("[data-statement-export-pdf]")?.addEventListener("click", () => {
                    if (!activeStatementRecord) {
                        showToast("Fetch an account before exporting.");
                        return;
                    }
                    downloadStatementPdf(activeStatementRecord);
                });
            };

            openAccountMenuTrigger?.addEventListener("click", () => {
                setMainTab("open");
                toggleOpenAccountMenu();
            });

            container.querySelector("[data-open-statement-modal]")?.addEventListener("click", () => {
                openModal("statement");
            });

            container.addEventListener("click", (event) => {
                const trigger = event.target.closest("[data-account-stats-action]");
                if (!trigger || !container.contains(trigger)) {
                    return;
                }

                const actionKey = String(trigger.getAttribute("data-account-stats-action") || "").trim();
                if (actionKey === "opened-today") {
                    openModal("opened-today");
                }
            });

            container.querySelectorAll("[data-open-account-action]").forEach((button) => {
                button.addEventListener("click", () => {
                    openModal(String(button.getAttribute("data-open-account-action") || "new"));
                });
            });

            container.querySelectorAll("[data-account-opening-tab]").forEach((button) => {
                button.addEventListener("click", () => {
                    setOpeningTab(String(button.getAttribute("data-account-opening-tab") || "personal"));
                });
            });

            container.querySelectorAll(".business-modal__close[data-account-management-close]").forEach((control) => {
                control.addEventListener("click", (event) => {
                    const modal = event.currentTarget.closest("[data-account-management-modal]");
                    closeModal(modal);
                });
            });

            document.addEventListener("click", (event) => {
                if (!event.target.closest(".account-management-dropdown")) {
                    closeOpenAccountMenu();
                }
            });

            bindAutoCapitalize();
            bindPhoneInputs();
            bindAgeDisplay();
            bindOpenAccountForm();
            bindUpdateAccountForm();
            bindExistingRecordForm();
            bindStatementModal();
            setMainTab("open");
        }
    };
}
