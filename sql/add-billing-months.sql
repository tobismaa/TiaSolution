alter table public.subscriptions
add column if not exists billing_months integer;
