-- Add editable roles to platform admins.
-- Run this once in Supabase SQL Editor.

alter table public.platform_admins
add column if not exists role text not null default 'super_admin';

alter table public.platform_admins
drop constraint if exists platform_admins_role_check;

alter table public.platform_admins
add constraint platform_admins_role_check
check (role in ('super_admin', 'business_admin', 'manager', 'staff', 'auditor'));

update public.platform_admins
set role = coalesce(role, 'super_admin')
where role is null;
