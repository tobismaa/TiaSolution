-- Fix bootstrap loops for platform-admin detection and business membership lookup.
-- Run this once in Supabase SQL Editor.

create or replace function public.current_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    select business_id
    from public.business_members
    where user_id = auth.uid()
      and is_active = true
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.platform_admins
        where user_id = auth.uid()
          and is_active = true
    )
$$;
