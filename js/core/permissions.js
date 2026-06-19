import { ROLES } from "./roles.js";

export const ROLE_PERMISSIONS = {
    [ROLES.SUPER_ADMIN]: ["view_platform", "manage_platform", "view_reports", "manage_subscriptions"],
    [ROLES.BUSINESS_ADMIN]: ["view_financials", "manage_users", "manage_settings", "approve_payroll", "manage_payroll", "export_reports"],
    [ROLES.MANAGER]: ["view_financials", "approve_invoices", "approve_expenses", "approve_transactions", "post_payroll_for_admin", "export_reports"],
    [ROLES.STAFF]: ["post_invoices", "post_expenses", "post_transactions"],
    [ROLES.AUDITOR]: ["view_financials", "view_general_ledger", "view_financial_reports", "export_reports"],
    [ROLES.ACCOUNT]: ["view_financials", "view_general_ledger", "view_financial_reports", "export_reports", "post_branch_payroll"]
};

export function hasPermission(role, permission) {
    return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
