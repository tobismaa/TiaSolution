drop policy if exists "platform admins can view their platform record" on public.platform_admins;
create policy "platform admins can view their platform record"
on public.platform_admins for select
using (public.is_platform_admin());

drop policy if exists "platform admins can insert platform records" on public.platform_admins;
create policy "platform admins can insert platform records"
on public.platform_admins for insert
with check (public.is_platform_admin());

drop policy if exists "platform admins can update platform records" on public.platform_admins;
create policy "platform admins can update platform records"
on public.platform_admins for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins can delete platform records" on public.platform_admins;
create policy "platform admins can delete platform records"
on public.platform_admins for delete
using (public.is_platform_admin());
