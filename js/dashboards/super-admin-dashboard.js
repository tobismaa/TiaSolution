import { ROLES } from "../core/roles.js";
import { signUpWithPassword } from "../core/auth.js";
import { getSupabaseClient } from "../core/supabase-client.js";
import { createTable, formatRole } from "../core/utils.js";
import { getBusinesses } from "../modules/businesses/businesses-service.js";
import { getOrganizationUsersForPlatform } from "../modules/users/users-service.js";

async function countQuery(queryPromise) {
    try {
        const { count, error } = await queryPromise;
        if (error) {
            return 0;
        }

        return count || 0;
    } catch {
        return 0;
    }
}

async function safeQuery(queryPromise, fallbackData = []) {
    try {
        const { data, error } = await queryPromise;
        if (error) {
            return fallbackData;
        }

        return data || fallbackData;
    } catch {
        return fallbackData;
    }
}

function formatDate(value) {
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

function renderList(items, emptyLabel, renderItem) {
    if (!items.length) {
        return `<p class="muted">${emptyLabel}</p>`;
    }

    return `
        <div class="stack-list mt-18">
            ${items.map(renderItem).join("")}
        </div>
    `;
}

function showPageLoading() {
    window.TIA_PAGE_LOADING?.show?.();
}

function hidePageLoading() {
    window.TIA_PAGE_LOADING?.hide?.();
}

function formatBranchUsage(business) {
    const used = Number(business?.usedBranches || 0);
    const allowed = business?.maxBranches || "Unlimited";
    return `${used} / ${allowed}`;
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
                    formatDate(user.createdAt)
                ])
            )}
        </div>
    `;
}

export async function renderSuperAdminDashboard() {
    const supabase = getSupabaseClient();
    const businesses = supabase ? await getBusinesses() : [];

    const totalBusinesses = supabase ? await countQuery(supabase.from("businesses").select("id", { count: "exact", head: true })) : 0;
    const activeBusinesses = supabase ? await countQuery(supabase.from("businesses").select("id", { count: "exact", head: true }).eq("subscription_status", "active")) : 0;
    const totalSubscriptions = supabase ? await countQuery(supabase.from("subscriptions").select("id", { count: "exact", head: true })) : 0;
    const activeSubscriptions = supabase ? await countQuery(supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active")) : 0;
    const pendingRequests = supabase ? await countQuery(supabase.from("demo_requests").select("id", { count: "exact", head: true }).eq("status", "pending")) : 0;
    const totalBranchesUsed = businesses.reduce((sum, business) => sum + Number(business.usedBranches || 0), 0);

    const recentBusinesses = businesses.slice(0, 5);

    const recentRequests = supabase
        ? await safeQuery(
            supabase
                .from("demo_requests")
                .select("business_name, contact_name, status, created_at")
                .order("created_at", { ascending: false })
                .limit(5)
        )
        : [];

    return {
        summary: [
            { label: "Registered Organizations", value: String(totalBusinesses), note: `${activeBusinesses} active`, tone: "up" },
            { label: "Active Plans", value: String(activeSubscriptions), note: `${totalSubscriptions} total subscriptions`, tone: "up" },
            { label: "Pending Demo Requests", value: String(pendingRequests), note: "awaiting review", tone: "warn" },
            { label: "Branches In Use", value: String(totalBranchesUsed), note: "across organizations", tone: "up" }
        ],
        content: `
            <div class="section-stack">
                <section class="hero-card">
                    <div>
                        <p class="hero-tag">Platform control</p>
                        <h2>Manage onboarded clients, subscriptions, branch usage, and support visibility.</h2>
                        <p class="hero-copy">This workspace is connected to live Supabase data. The overview below reflects real organizations, real requests, and real subscriptions in the database.</p>
                    </div>
                    <div class="hero-metrics">
                        <div><span>Registered organizations</span><strong>${totalBusinesses}</strong></div>
                        <div><span>Active subscriptions</span><strong>${activeSubscriptions}</strong></div>
                        <div><span>Pending demo requests</span><strong>${pendingRequests}</strong></div>
                    </div>
                </section>
                <div class="content-grid">
                    <section class="panel">
                        <div class="panel-head">
                            <h3>Platform Snapshot</h3>
                            <span class="badge paid">Live</span>
                        </div>
                        <div class="stack-list mt-18">
                            <div class="stack-item"><span>Registered organizations</span><strong>${totalBusinesses}</strong></div>
                            <div class="stack-item"><span>Active organizations</span><strong>${activeBusinesses}</strong></div>
                            <div class="stack-item"><span>Subscription records</span><strong>${totalSubscriptions}</strong></div>
                            <div class="stack-item"><span>Branches in use</span><strong>${totalBranchesUsed}</strong></div>
                        </div>
                    </section>
                    <section class="panel">
                        <div class="panel-head">
                            <h3>Registered Organizations</h3>
                            <span class="badge draft">${businesses.length} total</span>
                        </div>
                        ${createTable(
                            ["Organization", "Email", "Branches Used", "Status", "Created", "Action"],
                            businesses.map((business) => [
                                business.name || "Untitled client",
                                business.email || "-",
                                formatBranchUsage(business),
                                business.status || "Unknown",
                                formatDate(business.createdAt),
                                `<button class="btn btn-secondary super-admin-org-users-btn" type="button" data-business-id="${business.id}" data-business-name="${business.name || "Organization"}">View Users</button>`
                            ])
                        )}
                    </section>
                </div>
                <div class="content-grid">
                    <section class="panel">
                        <div class="panel-head">
                            <h3>Recent Demo Requests</h3>
                            <span class="badge draft">Latest 5</span>
                        </div>
                        ${renderList(recentRequests, "No demo requests yet.", (request) => `
                            <div class="stack-item">
                                <span>${request.business_name || "Unknown business"}</span>
                                <strong>${request.contact_name || "Unknown contact"} &middot; ${request.status || "pending"}</strong>
                            </div>
                        `)}
                    </section>
                    <section class="panel">
                        <div class="panel-head">
                            <h3>Subscription Health</h3>
                            <span class="badge paid">Database</span>
                        </div>
                        <div class="stack-list mt-18">
                            <div class="stack-item"><span>Active plans</span><strong>${activeSubscriptions}</strong></div>
                            <div class="stack-item"><span>Live organizations</span><strong>${activeBusinesses}</strong></div>
                            <div class="stack-item"><span>Pending approvals</span><strong>${pendingRequests}</strong></div>
                        </div>
                    </section>
                </div>
                <section class="panel">
                    <div class="module-header">
                        <div>
                            <p class="hero-tag">Account setup</p>
                            <h2>Create a new organization admin account.</h2>
                        </div>
                        <span class="badge pink">Onboarding</span>
                    </div>
                    <p class="mini-insight">Use this form to create a live organization login from the platform side. It seeds the new user with admin access and the profile details needed for onboarding.</p>
                    <form id="superAdminCreateAccountForm" class="form-grid mt-18">
                        <div class="triple-grid">
                            <label class="form-field">
                                <span>Full Name</span>
                                <input name="full_name" type="text" placeholder="Amina Yusuf" required>
                            </label>
                            <label class="form-field">
                                <span>Business Name</span>
                                <input name="business_name" type="text" placeholder="Atlas Manufacturing" required>
                            </label>
                            <label class="form-field">
                                <span>Email</span>
                                <input name="email" type="email" placeholder="amina@company.com" required>
                            </label>
                        </div>
                        <label class="form-field">
                            <span>Password</span>
                            <input name="password" type="password" placeholder="Create a secure password" required>
                        </label>
                        <div class="button-row">
                            <button class="btn btn-primary" type="submit">Create Account</button>
                            <p class="muted" id="superAdminCreateAccountStatus">Ready to onboard a new admin.</p>
                        </div>
                    </form>
                </section>
                <div class="business-modal" data-super-admin-org-users-modal hidden>
                    <div class="business-modal__backdrop" data-super-admin-org-users-close></div>
                    <div class="business-modal__dialog gl-statement-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="superAdminOrgUsersTitle">
                        <div class="business-modal__head">
                            <div>
                                <p class="eyebrow">Organization Users</p>
                                <h3 id="superAdminOrgUsersTitle">User list</h3>
                            </div>
                            <button class="icon-btn business-modal__close" type="button" aria-label="Close modal" data-super-admin-org-users-close>&times;</button>
                        </div>
                        <div class="gl-statement-modal__content" data-super-admin-org-users-body>
                            <p class="muted">Select an organization to view its users.</p>
                        </div>
                    </div>
                </div>
            </div>
        `,
        afterRender(pageContent) {
            const form = pageContent.querySelector("#superAdminCreateAccountForm");
            const status = pageContent.querySelector("#superAdminCreateAccountStatus");
            const orgUsersModal = pageContent.querySelector("[data-super-admin-org-users-modal]");
            const orgUsersBody = pageContent.querySelector("[data-super-admin-org-users-body]");

            const openOrgUsersModal = () => {
                if (!orgUsersModal) {
                    return;
                }
                orgUsersModal.hidden = false;
            };

            const closeOrgUsersModal = () => {
                if (!orgUsersModal) {
                    return;
                }
                orgUsersModal.hidden = true;
            };

            orgUsersModal?.querySelectorAll(".business-modal__close[data-super-admin-org-users-close]").forEach((control) => {
                control.addEventListener("click", closeOrgUsersModal);
            });

            pageContent.addEventListener("click", async (event) => {
                const button = event.target.closest("[data-business-id]");
                if (!button || !orgUsersBody) {
                    return;
                }

                const businessId = String(button.getAttribute("data-business-id") || "").trim();
                const businessName = String(button.getAttribute("data-business-name") || "Organization").trim();
                if (!businessId) {
                    return;
                }

                orgUsersBody.innerHTML = `<p class="muted">Loading organization users...</p>`;
                openOrgUsersModal();
                showPageLoading();

                try {
                    const users = await getOrganizationUsersForPlatform(businessId);
                    orgUsersBody.innerHTML = renderOrganizationUsersList(businessName, users);
                } catch (error) {
                    orgUsersBody.innerHTML = `<p class="muted">${error?.message || "Unable to load organization users right now."}</p>`;
                } finally {
                    hidePageLoading();
                }
            });

            form?.addEventListener("submit", async (event) => {
                event.preventDefault();
                const data = new FormData(form);
                status.textContent = "Creating account...";
                showPageLoading();

                try {
                    await signUpWithPassword(
                        String(data.get("email") || "").trim().toLowerCase(),
                        String(data.get("password") || ""),
                        {
                            full_name: String(data.get("full_name") || "").trim(),
                            business_name: String(data.get("business_name") || "").trim(),
                            role: ROLES.BUSINESS_ADMIN,
                            subscription: "Live"
                        }
                    );

                    form.reset();
                    status.textContent = "Account created. Check email confirmation if it is enabled.";
                } catch (error) {
                    status.textContent = error.message || "Unable to create the account right now.";
                } finally {
                    hidePageLoading();
                }
            });
        }
    };
}
