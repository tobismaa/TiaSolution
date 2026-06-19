-- Allow the Account role in business membership and related role checks.
-- Run this once in Supabase SQL Editor.

alter table public.business_members
drop constraint if exists business_members_role_check;

alter table public.business_members
add constraint business_members_role_check
check (role in ('business_admin', 'manager', 'staff', 'account', 'auditor'));

alter table public.demo_requests
drop constraint if exists demo_requests_preferred_role_check;

alter table public.demo_requests
add constraint demo_requests_preferred_role_check
check (preferred_role in ('all_roles', 'business_admin', 'manager', 'staff', 'account', 'auditor'));

alter table public.demo_access_links
drop constraint if exists demo_access_links_role_check;

alter table public.demo_access_links
add constraint demo_access_links_role_check
check (role in ('all_roles', 'business_admin', 'manager', 'staff', 'account', 'auditor'));
