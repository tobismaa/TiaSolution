export const APP_NAME = "Tia";
export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_DEMO_LINK_DAYS = 7;

export function getCurrentPeriodLabel(date = new Date()) {
    return date.toLocaleDateString("en-GB", {
        month: "long",
        year: "numeric"
    });
}
