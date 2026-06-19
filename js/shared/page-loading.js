export function createPageLoadingController(options = {}) {
    const autoHideMs = Number(options.autoHideMs || 3000);
    let safetyTimer = null;

    function getOverlay() {
        return document.getElementById("pageLoadingOverlay");
    }

    function show() {
        const overlay = getOverlay();
        if (!overlay) {
            return;
        }

        if (safetyTimer) {
            window.clearTimeout(safetyTimer);
        }

        overlay.hidden = false;
        safetyTimer = window.setTimeout(() => {
            hide();
        }, autoHideMs);
    }

    function hide() {
        const overlay = getOverlay();
        if (safetyTimer) {
            window.clearTimeout(safetyTimer);
            safetyTimer = null;
        }

        if (overlay) {
            overlay.hidden = true;
        }
    }

    function bindInteractions({ sidebarNav, pageContent }) {
        const shouldSkip = (element) => {
            if (!element || element.disabled) {
                return true;
            }

            if (element.closest("[data-no-loading]")) {
                return true;
            }

            if (element.closest("[data-platform-user-modal-close], [data-platform-user-details-close], [data-ledger-modal-close], [data-business-modal-close], [data-business-details-close], [data-gl-report-close], [data-gl-statement-close], .gl-suggestion-item")) {
                return true;
            }

            if (element.closest("[data-gl-report-modal], [data-gl-statement-modal]")) {
                return true;
            }

            return false;
        };

        const shouldTrackPageNavigation = (element) => {
            if (!element) {
                return false;
            }

            if (element.matches("[data-page-loading-trigger]")) {
                return true;
            }

            if (element.matches("[data-route]")) {
                return true;
            }

            const href = String(element.getAttribute("href") || "").trim();
            return href.startsWith("#");
        };

        sidebarNav?.addEventListener("click", (event) => {
            const control = event.target.closest("button, a, [role='tab']");
            if (shouldSkip(control)) {
                return;
            }
            show();
        });

        pageContent?.addEventListener("click", (event) => {
            const control = event.target.closest("button, a, [role='tab']");
            if (shouldSkip(control) || !shouldTrackPageNavigation(control)) {
                return;
            }
            show();
        });

        pageContent?.addEventListener("submit", () => {
            show();
        });
    }

    return { show, hide, bindInteractions };
}
