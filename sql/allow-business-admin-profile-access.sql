drop policy if exists "business admins can view member profiles" on public.profiles;
create policy "business admins can view member profiles"
on public.profiles for select
using (
    exists (
        select 1
        from public.business_members actor
        join public.business_members member
          on member.business_id = actor.business_id
        where actor.user_id = auth.uid()
          and actor.is_active = true
          and actor.role = 'business_admin'
          and member.user_id = profiles.id
    )
);

drop policy if exists "business admins can insert member profiles" on public.profiles;
create policy "business admins can insert member profiles"
on public.profiles for insert
with check (
    exists (
        select 1
        from public.business_members actor
        where actor.user_id = auth.uid()
          and actor.is_active = true
          and actor.role = 'business_admin'
    )
);

drop policy if exists "business admins can update member profiles" on public.profiles;
create policy "business admins can update member profiles"
on public.profiles for update
using (
    exists (
        select 1
        from public.business_members actor
        join public.business_members member
          on member.business_id = actor.business_id
        where actor.user_id = auth.uid()
          and actor.is_active = true
          and actor.role = 'business_admin'
          and member.user_id = profiles.id
    )
)
with check (
    exists (
        select 1
        from public.business_members actor
        join public.business_members member
          on member.business_id = actor.business_id
        where actor.user_id = auth.uid()
          and actor.is_active = true
          and actor.role = 'business_admin'
          and member.user_id = profiles.id
    )
);
