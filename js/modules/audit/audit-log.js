import { getSupabaseClient } from "../../core/supabase-client.js";
import { getCurrentSessionContext } from "../../core/session.js";
import { formatStatusTone } from "../../core/utils.js";

export async function renderAuditLog() {
    const supabase = getSupabaseClient();
    const session = await getCurrentSessionContext();
    let logs = [];
    let trails = [];

    if (supabase && session?.businessId) {
        const { data, error } = await supabase
            .from("audit_logs")
            .select("action, created_at, metadata")
            .eq("business_id", session.businessId)
            .order("created_at", { ascending: false })
            .limit(20);

        if (error) {
            throw error;
        }

        logs = (data || []).map((item) => ({
            date: item.created_at,
            actor: item.metadata?.actor_name || "System",
            action: item.action,
            status: item.metadata?.status || "Logged"
        }));

        trails = (data || []).map((item) => ({
            date: item.created_at,
            action: item.action || "Action",
            status: item.metadata?.status || item.metadata?.approval_status || "Logged",
            reference: item.metadata?.reference || item.metadata?.entry_reference || item.metadata?.entity_id || "-",
            actor: item.metadata?.actor_name || "System",
            note: item.metadata?.note || item.metadata?.description || "-"
        }));
    }

    return `
        <div class="section-stack">
            <div class="module-header">
                <div>
                    <p class="eyebrow">Review and traceability</p>
                    <h2>Audit Log</h2>
                </div>
                <span class="badge draft">Read only</span>
            </div>
            <section class="panel">
                <div class="audit-list">
                    ${logs.length ? logs.map((item) => `
                        <div class="audit-item">
                            <strong>${new Date(item.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</strong>
                            <div>
                                <div>${item.action}</div>
                                <p class="muted">${item.actor}</p>
                            </div>
                            <span class="badge ${formatStatusTone(item.status)}">${item.status}</span>
                        </div>
                    `).join("") : `<div class="empty-state">No audit logs yet.</div>`}
                </div>
            </section>
            <section class="panel">
                <div class="module-header">
                    <div>
                        <p class="eyebrow">Approval and status</p>
                        <h3>Transaction Trail</h3>
                    </div>
                </div>
                <div class="table-wrap">
                    <table class="gl-transaction-table">
                        <thead>
                            <tr>
                                <th>Date/Time</th>
                                <th>Reference</th>
                                <th>Action</th>
                                <th>Status</th>
                                <th>Actor</th>
                                <th>Note</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${trails.length
                                ? trails.map((item) => `
                                    <tr>
                                        <td>${new Date(item.date).toLocaleString("en-GB", {
                                            day: "2-digit",
                                            month: "short",
                                            year: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            second: "2-digit",
                                            hour12: false,
                                            timeZone: "Africa/Lagos"
                                        })}</td>
                                        <td>${item.reference}</td>
                                        <td>${item.action}</td>
                                        <td><span class="badge ${formatStatusTone(item.status)}">${item.status}</span></td>
                                        <td>${item.actor}</td>
                                        <td>${item.note}</td>
                                    </tr>
                                `).join("")
                                : `<tr><td colspan="6">No approval/status trail yet.</td></tr>`
                            }
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    `;
}
