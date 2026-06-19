import { getDemoRequests, approveDemoRequest, cancelDemoRequest, generateDemoLink } from "./demo-requests-service.js";

const TOKEN_CACHE_KEY = "tia_demo_request_tokens_v1";
const tokenCacheMemory = {};

function showPageLoading() {
    window.TIA_PAGE_LOADING?.show?.();
}

function hidePageLoading() {
    window.TIA_PAGE_LOADING?.hide?.();
}

function readTokenCache() {
    return { ...tokenCacheMemory };
}

function getCachedToken(requestId) {
    return readTokenCache()[requestId] || "";
}

function setCachedToken(requestId, tokenPlain) {
    tokenCacheMemory[requestId] = tokenPlain;
}

function removeCachedToken(requestId) {
    delete tokenCacheMemory[requestId];
}

function formatRequestStatus(status) {
    if (status === "approved") {
        return { label: "Approved", tone: "paid" };
    }
    if (status === "pending") {
        return { label: "Pending", tone: "due" };
    }
    return { label: "Rejected", tone: "draft" };
}

function buildTokenLink(tokenPlain) {
    if (!tokenPlain) {
        return "";
    }
    return `${window.location.origin}/demo-access.html?token=${encodeURIComponent(tokenPlain)}`;
}

function renderDemoLinkStore(tokenPlain) {
    if (!tokenPlain) {
        return `<p class="muted demo-link-placeholder">No demo link yet. Approve the request and generate one.</p>`;
    }

    const link = buildTokenLink(tokenPlain);
    return `
        <div class="stack-list demo-link-stack">
            <input type="text" class="token-link-input" value="${link}" readonly aria-label="Demo link">
            <div class="button-row">
                <button class="btn btn-secondary copy-demo-link" data-link="${encodeURIComponent(link)}" type="button">Copy Link</button>
            </div>
        </div>
    `;
}

function requestDataFrom(request) {
    const tokenPlain = request.demo_access_links?.[0]?.token_plain || getCachedToken(request.id) || "";
    return {
        id: request.id,
        business_name: request.business_name,
        contact_name: request.contact_name,
        email: request.email,
        preferred_role: request.preferred_role,
        status: request.status,
        team_size: request.team_size || "",
        phone: request.phone || "",
        created_at: request.created_at,
        message: request.message || "",
        token_plain: tokenPlain,
        has_link: Boolean(tokenPlain)
    };
}

async function ensureApprovedRequestLinks(requests) {
    await Promise.all(requests.map(async (request) => {
        if (request.status !== "approved") {
            return;
        }

        const existingToken = request.demo_access_links?.[0]?.token_plain || getCachedToken(request.id) || "";
        if (existingToken) {
            return;
        }

        try {
            const link = await generateDemoLink({
                id: request.id,
                preferred_role: request.preferred_role
            });
            const token = new URL(link).searchParams.get("token") || "";
            if (!token) {
                return;
            }
            setCachedToken(request.id, token);
            request.demo_access_links = [{ token_plain: token }];
        } catch {
            request.demo_access_links = [];
        }
    }));
}

function renderRequestRow(request) {
    const status = formatRequestStatus(request.status);
    const demoLinkCell = renderDemoLinkStore(request.token_plain);
    const actionButtons = request.status === "approved"
        ? `
            ${request.has_link ? "" : `<button class="btn btn-primary generate-demo-link" data-request-id="${request.id}" type="button">Generate Link</button>`}
            <button class="btn btn-secondary deactivate-demo-request" data-request-id="${request.id}" type="button">Deactivate</button>
        `
        : `<button class="btn btn-secondary approve-demo-request" data-request-id="${request.id}" type="button">Approve</button>`;
    const feedback = request.status === "approved" && !request.has_link
        ? `<p class="muted demo-request-feedback" id="feedback-${request.id}">Generate and store a permanent demo link.</p>`
        : (request.status === "approved" ? "" : `<p class="muted demo-request-feedback" id="feedback-${request.id}">Approve the request to activate the demo user.</p>`);

    return `
        <tr class="demo-request-row" data-request-id="${request.id}" data-status="${request.status}" data-preferred-role="${request.preferred_role}" data-token-plain="${request.token_plain}" data-business-name="${request.business_name}" data-contact-name="${request.contact_name}" data-email="${request.email}" data-team-size="${request.team_size}" data-phone="${request.phone}" data-created-at="${request.created_at}" data-message="${request.message}">
            <td>
                <strong class="cell-strong">${request.contact_name}</strong>
            </td>
            <td>
                <a class="cell-link" href="mailto:${request.email}">${request.email}</a>
            </td>
            <td>
                <strong class="cell-strong">${request.business_name}</strong>
            </td>
            <td>
                <span class="badge ${status.tone}">${status.label}</span>
            </td>
            <td>
                <span class="cell-time">${new Date(request.created_at).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false
                })}</span>
            </td>
            <td>
                <div class="table-token-panel">${demoLinkCell}</div>
            </td>
            <td>
                <div class="button-row" data-request-actions>
                    ${actionButtons}
                </div>
                ${feedback}
            </td>
        </tr>
    `;
}

function renderRequestTable(title, panelName, requests, emptyMessage, tbodyId) {
    return `
        <section class="panel demo-table-panel" data-demo-panel="${panelName}">
            <div class="panel-head">
                <div>
                    <p class="sidebar-card-label">${title}</p>
                    <h3>${requests.length} requests</h3>
                </div>
            </div>
            <div class="table-wrap">
                <table class="demo-request-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Mail</th>
                            <th>Company Name</th>
                            <th>Status</th>
                            <th>Time Stamp</th>
                            <th>Demo Link</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody id="${tbodyId}" data-empty-message="${emptyMessage}">
                        ${requests.length ? requests.map((request) => renderRequestRow(requestDataFrom(request))).join("") : `<tr class="demo-request-empty-row"><td colspan="7"><div class="empty-state">${emptyMessage}</div></td></tr>`}
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

function findCardOrRow(target) {
    return target.closest(".demo-request-row");
}

function replaceRow(container, row, requestStatus, tokenPlain = "") {
    const tbodyId = requestStatus === "approved" ? "approvedRequestsBody" : "pendingRequestsBody";
    const tbody = container.querySelector(`#${tbodyId}`);
    if (!tbody) {
        return;
    }
    const sourceTbody = row.parentElement;

    const request = requestDataFrom({
        id: row.dataset.requestId,
        business_name: row.dataset.businessName,
        contact_name: row.dataset.contactName,
        email: row.dataset.email,
        preferred_role: row.dataset.preferredRole,
        status: requestStatus,
        team_size: row.dataset.teamSize,
        phone: row.dataset.phone,
        created_at: row.dataset.createdAt,
        message: row.dataset.message,
        demo_access_links: tokenPlain ? [{ token_plain: tokenPlain }] : []
    });

    const renderedRow = renderRequestRow(request);
    const emptyRow = tbody.querySelector(".demo-request-empty-row");
    if (emptyRow) {
        emptyRow.remove();
    }
    if (row.parentElement === tbody) {
        row.outerHTML = renderedRow;
    } else {
        tbody.insertAdjacentHTML("beforeend", renderedRow);
        row.remove();
    }
    syncTableEmptyState(sourceTbody);
    syncTableEmptyState(tbody);
}

function removeRequestRow(container, row) {
    if (!row) {
        return;
    }

    const requestId = row.dataset.requestId;
    const tbody = row.parentElement;
    row.remove();
    if (requestId) {
        removeCachedToken(requestId);
    }
    if (tbody) {
        syncTableEmptyState(tbody);
    }
    refreshTabCounts(container);
}

function syncTableEmptyState(tbody) {
    if (!tbody) {
        return;
    }

    const emptyMessage = tbody.dataset.emptyMessage || "No records found.";
    const hasRows = tbody.querySelectorAll(".demo-request-row").length > 0;
    const emptyExisting = tbody.querySelector(".demo-request-empty-row");

    if (hasRows) {
        emptyExisting?.remove();
        return;
    }

    if (!emptyExisting) {
        tbody.innerHTML = `
            <tr class="demo-request-empty-row">
                <td colspan="7"><div class="empty-state">${emptyMessage}</div></td>
            </tr>
        `;
    }
}

function refreshTabCounts(container) {
    const pendingCount = container.querySelectorAll("#pendingRequestsBody .demo-request-row").length;
    const approvedCount = container.querySelectorAll("#approvedRequestsBody .demo-request-row").length;

    const pendingButton = container.querySelector('[data-demo-tab="pending"]');
    const approvedButton = container.querySelector('[data-demo-tab="approved"]');
    if (pendingButton) {
        pendingButton.textContent = `Pending (${pendingCount})`;
    }
    if (approvedButton) {
        approvedButton.textContent = `Approved (${approvedCount})`;
    }

    const pendingPanelHeading = container.querySelector('[data-demo-panel="pending"] h3');
    const approvedPanelHeading = container.querySelector('[data-demo-panel="approved"] h3');
    if (pendingPanelHeading) {
        pendingPanelHeading.textContent = `${pendingCount} requests`;
    }
    if (approvedPanelHeading) {
        approvedPanelHeading.textContent = `${approvedCount} requests`;
    }
}

function setActiveTab(container, tabName) {
    container.querySelectorAll("[data-demo-tab]").forEach((button) => {
        const isActive = button.dataset.demoTab === tabName;
        button.classList.toggle("btn-primary", isActive);
        button.classList.toggle("btn-secondary", !isActive);
        button.setAttribute("aria-selected", String(isActive));
    });

    container.querySelectorAll("[data-demo-tab-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.demoTabPanel !== tabName;
    });
}

function matchesDemoRequest(row, query) {
    if (!query) {
        return true;
    }

    const haystack = [
        row.dataset.contactName || "",
        row.dataset.businessName || ""
    ].join(" ").toLowerCase();

    return haystack.includes(query);
}

function filterDemoRequests(container, query) {
    const normalizedQuery = query.trim().toLowerCase();

    ["pendingRequestsBody", "approvedRequestsBody"].forEach((tbodyId) => {
        const tbody = container.querySelector(`#${tbodyId}`);
        if (!tbody) {
            return;
        }

        const emptyRow = tbody.querySelector(".demo-request-filter-empty-row");
        emptyRow?.remove();

        const rows = Array.from(tbody.querySelectorAll(".demo-request-row"));
        let visibleCount = 0;
        rows.forEach((row) => {
            const isVisible = matchesDemoRequest(row, normalizedQuery);
            row.hidden = !isVisible;
            if (isVisible) {
                visibleCount += 1;
            }
        });

        if (rows.length > 0 && visibleCount === 0) {
            tbody.insertAdjacentHTML("beforeend", `
                <tr class="demo-request-filter-empty-row">
                    <td colspan="7"><div class="empty-state">No requests match "${query.trim()}".</div></td>
                </tr>
            `);
        }
    });
}

export async function renderDemoRequests() {
    const requests = await getDemoRequests();
    await ensureApprovedRequestLinks(requests);
    const approvedRequests = requests.filter((request) => request.status === "approved");
    const pendingRequests = requests.filter((request) => request.status === "pending");

    return `
        <div class="section-stack">
            <div class="panel demo-request-filter-panel">
                <label class="form-field demo-request-search">
                    <span>Search by name or company</span>
                    <input type="search" data-demo-request-search placeholder="Type a name or company...">
                </label>
            </div>
            <div class="button-row demo-tabbar" role="tablist" aria-label="Demo request views">
                <button class="btn btn-primary" type="button" data-demo-tab="approved" aria-selected="true">Approved (${approvedRequests.length})</button>
                <button class="btn btn-secondary" type="button" data-demo-tab="pending" aria-selected="false">Pending (${pendingRequests.length})</button>
            </div>
            <div class="demo-tab-panel" data-demo-tab-panel="approved" hidden>
                ${renderRequestTable("Approved Requests", "approved", approvedRequests, "No approved requests yet.", "approvedRequestsBody")}
            </div>
            <div class="demo-tab-panel" data-demo-tab-panel="pending" hidden>
                ${renderRequestTable("Pending Requests", "pending", pendingRequests, "No pending requests.", "pendingRequestsBody")}
            </div>
        </div>
    `;
}

export function bindDemoRequestActions(container) {
    if (container.dataset.demoRequestsBound === "true") {
        return;
    }
    container.dataset.demoRequestsBound = "true";

    container.addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button || !container.contains(button)) {
            return;
        }

        if (button.dataset.demoTab) {
            showPageLoading();
            setActiveTab(container, button.dataset.demoTab);
            requestAnimationFrame(() => hidePageLoading());
            return;
        }

        if (button.closest("[data-demo-request-search]")) {
            return;
        }

        if (button.classList.contains("copy-demo-link")) {
            showPageLoading();
            const encoded = button.dataset.link || "";
            const link = decodeURIComponent(encoded);
            try {
                await navigator.clipboard.writeText(link);
                button.textContent = "Copied";
                setTimeout(() => {
                    button.textContent = "Copy Link";
                }, 1200);
            } catch {
                window.prompt("Copy this link", link);
            } finally {
                requestAnimationFrame(() => hidePageLoading());
            }
            return;
        }

        if (button.classList.contains("copy-token-link")) {
            showPageLoading();
            const encoded = button.dataset.link || "";
            const token = decodeURIComponent(encoded);
            try {
                await navigator.clipboard.writeText(token);
                button.textContent = "Copied";
                setTimeout(() => {
                    button.textContent = "Copy Token";
                }, 1200);
            } catch {
                window.prompt("Copy this token", token);
            } finally {
                requestAnimationFrame(() => hidePageLoading());
            }
            return;
        }

        if (button.classList.contains("approve-demo-request")) {
            const requestId = button.dataset.requestId;
            const feedback = document.getElementById(`feedback-${requestId}`);
            const row = findCardOrRow(button);
            button.disabled = true;
            if (feedback) {
                feedback.textContent = "Approving request...";
            }
            showPageLoading();

            try {
                await approveDemoRequest(requestId);
                const link = await generateDemoLink({
                    id: requestId,
                    preferred_role: row?.dataset.preferredRole || ""
                });
                const token = new URL(link).searchParams.get("token") || "";
                setCachedToken(requestId, token);
                if (row) {
                    row.dataset.status = "approved";
                    row.dataset.tokenPlain = token;
                    replaceRow(container, row, "approved", token);
                }
                refreshTabCounts(container);
                if (feedback) {
                    feedback.textContent = "Request approved and demo link generated.";
                }
            } catch (error) {
                button.disabled = false;
                if (feedback) {
                    feedback.textContent = error.message || "Unable to approve request.";
                }
            } finally {
                hidePageLoading();
            }
            return;
        }

        if (button.classList.contains("generate-demo-link")) {
            const requestId = button.dataset.requestId;
            const feedback = document.getElementById(`feedback-${requestId}`);
            const row = findCardOrRow(button);
            button.disabled = true;
            if (feedback) {
                feedback.textContent = "Generating permanent demo link...";
            }
            showPageLoading();

            try {
                const link = await generateDemoLink({
                    id: requestId,
                    preferred_role: row?.dataset.preferredRole || ""
                });
                const token = new URL(link).searchParams.get("token") || "";
                setCachedToken(requestId, token);
                if (row) {
                    row.dataset.status = "approved";
                    row.dataset.tokenPlain = token;
                    replaceRow(container, row, "approved", token);
                }
                refreshTabCounts(container);
                if (feedback) {
                    feedback.textContent = "Permanent demo link generated.";
                }
            } catch (error) {
                button.disabled = false;
                if (feedback) {
                    feedback.textContent = error.message || "Unable to generate demo link.";
                }
            } finally {
                hidePageLoading();
            }
            return;
        }

        if (button.classList.contains("cancel-demo-request")) {
            const requestId = button.dataset.requestId;
            const feedback = document.getElementById(`feedback-${requestId}`);
            const row = findCardOrRow(button);
            button.disabled = true;
            if (feedback) {
                feedback.textContent = "Deactivating demo user...";
            }
            showPageLoading();

            try {
                await cancelDemoRequest(requestId);
                if (row) {
                    row.dataset.status = "pending";
                    replaceRow(container, row, "pending", row.dataset.tokenPlain || "");
                }
                refreshTabCounts(container);
                if (feedback) {
                    feedback.textContent = "Demo user deactivated.";
                }
            } catch (error) {
                button.disabled = false;
                if (feedback) {
                    feedback.textContent = error.message || "Unable to cancel request.";
                }
            } finally {
                hidePageLoading();
            }
            return;
        }

        if (button.classList.contains("deactivate-demo-request")) {
            const requestId = button.dataset.requestId;
            const feedback = document.getElementById(`feedback-${requestId}`);
            const row = findCardOrRow(button);
            button.disabled = true;
            if (feedback) {
                feedback.textContent = "Deactivating demo user...";
            }
            showPageLoading();

            try {
                await cancelDemoRequest(requestId);
                if (row) {
                    row.dataset.status = "pending";
                    replaceRow(container, row, "pending", row.dataset.tokenPlain || "");
                }
                refreshTabCounts(container);
                if (feedback) {
                    feedback.textContent = "Demo user deactivated.";
                }
            } catch (error) {
                button.disabled = false;
                if (feedback) {
                    feedback.textContent = error.message || "Unable to deactivate request.";
                }
            } finally {
                hidePageLoading();
            }
            return;
        }

    });

    const searchInput = container.querySelector("[data-demo-request-search]");
    searchInput?.addEventListener("input", () => {
        filterDemoRequests(container, searchInput.value || "");
    });

    setActiveTab(container, "approved");
    filterDemoRequests(container, searchInput?.value || "");
}
