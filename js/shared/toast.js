const CONTAINER_ID = "tiaToastContainer";

function getContainer() {
    let container = document.getElementById(CONTAINER_ID);
    if (container) {
        return container;
    }

    container = document.createElement("div");
    container.id = CONTAINER_ID;
    container.className = "tia-toast-container";
    document.body.appendChild(container);
    return container;
}

function inferTone(message, tone) {
    if (tone) {
        return tone;
    }

    const text = String(message || "").toLowerCase();
    if (text.includes("error") || text.includes("unable") || text.includes("failed")) {
        return "error";
    }

    if (text.includes("warn")) {
        return "warn";
    }

    return "success";
}

export function showToast(message, options = {}) {
    if (!message) {
        return;
    }

    const tone = inferTone(message, options.tone);
    const duration = Number(options.duration || 3200);
    const container = getContainer();
    const toast = document.createElement("div");
    toast.className = `tia-toast tia-toast--${tone}`;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `
        <div class="tia-toast__icon" aria-hidden="true">${tone === "success" ? "✓" : tone === "error" ? "!" : "•"}</div>
        <div class="tia-toast__body">${String(message)}</div>
    `;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));

    window.setTimeout(() => {
        toast.classList.remove("is-visible");
        window.setTimeout(() => toast.remove(), 200);
    }, duration);
}
