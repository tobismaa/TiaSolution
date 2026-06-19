-- Account product GL setup
-- Run once in Supabase SQL Editor

create table if not exists public.account_products (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    product_name text not null,
    product_gl_account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
    product_gl_code text not null,
    parent_gl_account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
    general_overdraft_account_id uuid references public.chart_of_accounts(id) on delete restrict,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (business_id, product_name),
    unique (business_id, product_gl_code)
);

create index if not exists idx_account_products_business_id
    on public.account_products (business_id);

create index if not exists idx_account_products_product_gl_account_id
    on public.account_products (product_gl_account_id);

alter table public.account_products enable row level security;

drop policy if exists "business scoped account products" on public.account_products;
create policy "business scoped account products"
on public.account_products for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));
