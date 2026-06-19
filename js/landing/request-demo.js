import { getSupabaseClient } from "../core/supabase-client.js";

const ALLOWED_ROLES = new Set(["all_roles", "business_admin", "manager", "staff", "auditor"]);

async function submitDemoRequest(payload) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        throw new Error("Supabase client is unavailable.");
    }

    const { error } = await supabase.from("demo_requests").insert(payload);
    if (error) {
        throw error;
    }
}

function initDemoRequestForm() {
    const form = document.getElementById("demoRequestForm");
    const status = document.getElementById("demoRequestStatus");
    const modal = document.querySelector("[data-demo-request-modal]");
    const openButtons = Array.from(document.querySelectorAll("[data-open-demo-modal]"));
    const closeButtons = Array.from(document.querySelectorAll("[data-demo-request-close]"))
        .filter((button) => !button.classList.contains("business-modal__backdrop"));
    if (!form || !status || !modal) {
        return;
    }

    const openModal = () => {
        modal.hidden = false;
        document.body.style.overflow = "hidden";
        window.setTimeout(() => {
            form.querySelector('input[name="business_name"]')?.focus();
        }, 0);
    };

    const closeModal = () => {
        modal.hidden = true;
        document.body.style.overflow = "";
    };

    openButtons.forEach((button) => {
        button.addEventListener("click", (event) => {
            event.preventDefault();
            openModal();
        });
    });

    closeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            closeModal();
        });
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        status.textContent = "Submitting request...";
        const preferredRole = String(data.get("preferred_role") || "").trim();

        if (!ALLOWED_ROLES.has(preferredRole)) {
            status.textContent = "Please choose a valid role before submitting.";
            return;
        }

        try {
            await submitDemoRequest({
                business_name: String(data.get("business_name") || "").trim(),
                contact_name: String(data.get("contact_name") || "").trim(),
                email: String(data.get("email") || "").trim().toLowerCase(),
                phone: String(data.get("phone") || "").trim(),
                team_size: String(data.get("team_size") || ""),
                preferred_role: preferredRole,
                message: String(data.get("message") || "").trim(),
                status: "pending"
            });

            form.reset();
            status.textContent = "Request submitted. A private demo link can be issued after review.";
            window.setTimeout(() => {
                closeModal();
                status.textContent = "Sent to review.";
            }, 1200);
        } catch (error) {
            status.textContent = error.message || "Unable to submit request right now.";
        }
    });
}

initDemoRequestForm();
