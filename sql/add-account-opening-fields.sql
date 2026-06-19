-- Account opening fields on customers table
-- Run once in Supabase SQL Editor

alter table public.customers add column if not exists account_number text;
alter table public.customers add column if not exists first_name text;
alter table public.customers add column if not exists last_name text;
alter table public.customers add column if not exists other_name text;
alter table public.customers add column if not exists date_of_birth date;
alter table public.customers add column if not exists account_type text;
alter table public.customers add column if not exists residential_address text;
alter table public.customers add column if not exists current_balance numeric(14,2) not null default 0;
alter table public.customers add column if not exists ledger_balance numeric(14,2) not null default 0;
alter table public.customers add column if not exists available_balance numeric(14,2) not null default 0;
alter table public.customers add column if not exists overdraft numeric(14,2) not null default 0;
alter table public.customers add column if not exists statement_entries jsonb not null default '[]'::jsonb;
alter table public.customers add column if not exists passport_file_name text;
alter table public.customers add column if not exists passport_file_url text;
alter table public.customers add column if not exists signature_file_name text;
alter table public.customers add column if not exists signature_file_url text;
alter table public.customers add column if not exists status text not null default 'Active';
alter table public.customers add column if not exists operations_note text;

create unique index if not exists idx_customers_business_account_number_unique
on public.customers (business_id, account_number)
where account_number is not null;

create index if not exists idx_customers_business_account_type
on public.customers (business_id, account_type);

create index if not exists idx_customers_business_branch_account_number
on public.customers (business_id, branch_id, account_number);
