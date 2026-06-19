-- Asset Management Setup
-- Run this once in Supabase SQL editor.

create table if not exists public.fixed_assets (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    branch_id uuid references public.branches(id) on delete set null,
    asset_name text not null,
    acquisition_date date not null,
    capitalization_amount numeric(14,2) not null check (capitalization_amount > 0),
    useful_life_months integer not null check (useful_life_months > 0),
    depreciation_method text not null check (depreciation_method in ('depreciation', 'amortization')),
    monthly_charge numeric(14,2) not null check (monthly_charge >= 0),
    salvage_value numeric(14,2) not null default 0 check (salvage_value >= 0),
    capitalization_account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
    offset_account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
    expense_account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
    contra_account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
    is_active boolean not null default true,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.asset_depreciation_runs (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    asset_id uuid not null references public.fixed_assets(id) on delete cascade,
    period_month date not null,
    journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
    created_at timestamptz not null default now()
);

create unique index if not exists uq_asset_depreciation_runs_asset_period
on public.asset_depreciation_runs(asset_id, period_month);

create index if not exists idx_fixed_assets_business
on public.fixed_assets(business_id);

create index if not exists idx_fixed_assets_branch
on public.fixed_assets(branch_id);

create index if not exists idx_asset_runs_business
on public.asset_depreciation_runs(business_id);

alter table public.fixed_assets enable row level security;
alter table public.asset_depreciation_runs enable row level security;

drop policy if exists "business scoped fixed assets" on public.fixed_assets;
create policy "business scoped fixed assets"
on public.fixed_assets for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped asset depreciation runs" on public.asset_depreciation_runs;
create policy "business scoped asset depreciation runs"
on public.asset_depreciation_runs for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));
