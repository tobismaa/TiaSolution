create table if not exists public.branch_features (
    business_id uuid not null references public.businesses(id) on delete cascade,
    branch_id uuid not null references public.branches(id) on delete cascade,
    feature_key text not null,
    is_enabled boolean not null default false,
    sort_order integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (business_id, branch_id, feature_key)
);

alter table public.branch_features
add column if not exists sort_order integer;

alter table public.branch_features enable row level security;

drop policy if exists "platform admins manage branch features" on public.branch_features;
create policy "platform admins manage branch features"
on public.branch_features for all
using (exists (
    select 1
    from public.platform_admins
    where platform_admins.user_id = auth.uid()
      and platform_admins.is_active = true
))
with check (exists (
    select 1
    from public.platform_admins
    where platform_admins.user_id = auth.uid()
      and platform_admins.is_active = true
));

drop policy if exists "business members view branch features" on public.branch_features;
create policy "business members view branch features"
on public.branch_features for select
using (business_id in (select public.current_business_ids()));
