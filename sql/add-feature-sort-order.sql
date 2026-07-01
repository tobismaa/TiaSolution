alter table public.business_features
add column if not exists sort_order integer;

alter table public.branch_features
add column if not exists sort_order integer;
