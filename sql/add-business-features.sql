create table if not exists public.business_features (
    business_id uuid not null references public.businesses(id) on delete cascade,
    feature_key text not null,
    is_enabled boolean not null default false,
    sort_order integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (business_id, feature_key)
);

alter table public.business_features
add column if not exists sort_order integer;

alter table public.business_features enable row level security;

drop policy if exists "platform admins manage business features" on public.business_features;
create policy "platform admins manage business features"
on public.business_features for all
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

drop policy if exists "business members view business features" on public.business_features;
create policy "business members view business features"
on public.business_features for select
using (business_id in (select public.current_business_ids()));
