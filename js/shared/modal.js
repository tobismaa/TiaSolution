function closeAlertModal(modal) {
    if (!modal) {
        return;
    }

    modal.remove();
}

export function showAlertModal(message, options = {}) {
    if (!message) {
        return;
    }

    const existing = document.querySelector("[data-tia-alert-modal]");
    if (existing) {
        existing.remove();
    }

    const modal = document.createElement("div");
    modal.className = "business-modal tia-alert-modal";
    modal.setAttribute("data-tia-alert-modal", "true");

    const backdrop = document.createElement("div");
    backdrop.className = "business-modal__backdrop";

    const dialog = document.createElement("div");
    dialog.className = "business-modal__dialog tia-alert-modal__dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "tiaAlertTitle");
    dialog.setAttribute("aria-describedby", "tiaAlertMessage");

    const head = document.createElement("div");
    head.className = "business-modal__head tia-alert-modal__head";

    const copy = document.createElement("div");
    const title = document.createElement("h2");
    title.id = "tiaAlertTitle";
    title.textContent = options.title || "Security warning";

    const eyebrow = document.createElement("p");
    eyebrow.className = "tia-alert-modal__eyebrow";
    eyebrow.textContent = options.eyebrow || "Account activity";

    copy.append(eyebrow, title);

    const iconClose = document.createElement("button");
    iconClose.className = "icon-btn business-modal__close";
    iconClose.type = "button";
    iconClose.setAttribute("aria-label", "Close warning");
    iconClose.innerHTML = "&times;";

    const body = document.createElement("div");
    body.className = "tia-alert-modal__body";

    const messageText = document.createElement("p");
    messageText.id = "tiaAlertMessage";
    messageText.textContent = String(message);

    const actionRow = document.createElement("div");
    actionRow.className = "tia-alert-modal__actions";

    const closeButton = document.createElement("button");
    closeButton.className = "btn btn-primary";
    closeButton.type = "button";
    closeButton.textContent = options.actionLabel || "Close";

    actionRow.append(closeButton);
    body.append(messageText, actionRow);
    head.append(copy, iconClose);
    dialog.append(head, body);
    modal.append(backdrop, dialog);
    document.body.appendChild(modal);

    const close = () => closeAlertModal(modal);
    iconClose.addEventListener("click", close);
    closeButton.addEventListener("click", close);
    closeButton.focus();
}

export function openModal(message) {
    showAlertModal(message);
}
