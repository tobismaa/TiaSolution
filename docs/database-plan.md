# Database Plan

Supabase tables included in `sql/schema.sql`:

- `businesses`
- `profiles`
- `business_members`
- `customers`
- `invoices`
- `invoice_items`
- `expenses`
- `subscriptions`
- `audit_logs`

Each operational table carries `business_id` so Row Level Security can isolate data per company.
