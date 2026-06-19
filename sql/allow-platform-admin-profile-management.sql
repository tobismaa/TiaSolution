-- Allow platform admins to view and edit profiles for platform user management.
-- Run this once in Supabase SQL Editor.

drop policy if exists "platform admins can view profiles" on public.profiles;
create policy "platform admins can view profiles"
on public.profiles for select
using (public.is_platform_admin());

drop policy if exists "platform admins can insert profiles" on public.profiles;
create policy "platform admins can insert profiles"
on public.profiles for insert
with check (public.is_platform_admin());

drop policy if exists "platform admins can update profiles" on public.profiles;
create policy "platform admins can update profiles"
on public.profiles for update
using (public.is_platform_admin())
with check (public.is_platform_admin());
