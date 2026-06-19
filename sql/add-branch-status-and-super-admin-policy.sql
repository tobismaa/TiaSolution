alter table public.branches
add column if not exists is_active boolean not null default true;

drop policy if exists "business scoped branches" on public.branches;
create policy "business scoped branches"
on public.branches for all
using (business_id in (select public.current_business_ids()) or public.is_platform_admin())
with check (business_id in (select public.current_business_ids()) or public.is_platform_admin());
