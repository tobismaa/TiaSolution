import { getSupabaseStatus } from "../../core/supabase-client.js";
import { getBillingStatus } from "../../trial/billing-status.js";

export async function renderSettings(session) {
    const status = await getSupabaseStatus();
    return `
        <div class="section-stack">
            <div class="content-grid">
                <section class="panel">
                    <div class="panel-head">
                        <h3>Supabase Connection</h3>
                        <span class="badge ${status.tone}">${status.status}</span>
                    </div>
                    <p class="muted mt-18">${status.message}</p>
                    <div class="stack-list mt-18">
                        <div class="stack-item"><span>Project URL</span><strong>${status.projectUrl}</strong></div>
                        <div class="stack-item"><span>Project Host</span><strong>${status.projectHost}</strong></div>
                        <div class="stack-item"><span>Auth Session</span><strong>${status.session}</strong></div>
                    </div>
                </section>
                <section class="panel">
                    <h3>ERP Setup Roadmap</h3>
                    <p class="muted mt-18">This workspace is structured for businesses, demo access, and trial conversion on Supabase.</p>
                    <div class="stack-list mt-18">
                        <div class="stack-item"><span>Database engine</span><strong>Supabase Postgres</strong></div>
                        <div class="stack-item"><span>Security model</span><strong>Row Level Security</strong></div>
                        <div class="stack-item"><span>Billing state</span><strong>${getBillingStatus(session)}</strong></div>
                    </div>
                </section>
            </div>
        </div>
    `;
}
