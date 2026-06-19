export function getAccessBanner(session) {
    if (!session) {
        return { label: "No Session", tone: "due" };
    }

    if (session.role === "super_admin" && session.mode === "live") {
        return { label: "Live", tone: "paid" };
    }

    if (session.mode === "demo") {
        return { label: "Preview", tone: "pink" };
    }

    if (session.mode === "trial") {
        return { label: "Trial", tone: "due" };
    }

    return { label: session.subscriptionLabel || "Live", tone: "paid" };
}
