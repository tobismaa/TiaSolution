# Tia

Tia is now structured as a Supabase-ready multi-role ERP prototype that preserves the existing visual shell while expanding into a real project layout.

## What Is Included

- business and platform role structure
- login page with Supabase sign-in, demo access, and trial entry
- role-aware app shell for `super_admin`, `business_admin`, `manager`, `staff`, and `auditor`
- modular CSS split by responsibility
- modular JavaScript split into `core`, `shared`, `dashboards`, `modules`, `demo`, and `trial`
- Supabase SQL schema, RLS policies, triggers, and seed files

## Supabase

- project URL: `https://clfwijtkiblpmgentbho.supabase.co`
- publishable client config: `supabase-config.js` and `js/core/supabase-config.js`
- client helper: `js/core/supabase-client.js`
- schema: `sql/schema.sql`
- full bootstrap (tables + triggers + RLS + grants): `sql/full-setup.sql`
- RLS: `sql/rls-policies.sql`
- platform admin setup: `sql/platform-admin-setup.sql`
- demo request flow: `docs/demo-request-flow.md`

## Main Entry Points

- `login.html`
- `index.html`

## Notes

- Current module services now query live Supabase tables and will show empty states until real records exist.
- `sql/seeds.sql` is intentionally empty for live deployments.
- `sql/demo-seeds.sql` is optional and only for demo environments.
- `super_admin` is intended to be a live platform account, not a demo role.
