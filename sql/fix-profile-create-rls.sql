-- Fix profile creation during user onboarding.
-- Business admins need to create the profile before the new user has a membership row.

drop policy if exists "users can insert their profile" on public.profiles;
create policy "users can insert their profile"
on public.profiles for insert
with check (id = auth.uid());

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
