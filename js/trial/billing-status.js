export function getBillingStatus(session) {
    return session?.mode === "trial" ? "Trial account: convert to paid before expiry." : "Active plan status.";
}
