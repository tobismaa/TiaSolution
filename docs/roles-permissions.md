# Roles And Permissions

- `super_admin`: platform-level businesses, subscriptions, tenant users, portfolio reporting
- `business_admin`: full business operations, reports, users, settings
- `manager`: operational control, approvals, reports, audit visibility
- `staff`: customer, invoice, and expense workflows only
- `auditor`: read-only reports and audit visibility

Trial balance, financial reports, and audit evidence should be restricted to `business_admin`, `manager`, and `auditor`, with the auditor remaining read-only.

`super_admin` is a real internal platform account only. It should not be offered through demo or trial access.
