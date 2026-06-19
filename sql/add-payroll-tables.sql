-- Payroll tables for organization workflow
-- Run once in Supabase SQL Editor

create table if not exists public.payroll_levels (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    level_name text not null,
    default_amount numeric(14,2) not null default 0,
    created_at timestamptz not null default now(),
    unique (business_id, level_name)
);

create table if not exists public.payroll_runs (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    payroll_staff_id uuid null,
    staff_name text not null,
    staff_level text not null,
    amount numeric(14,2) not null default 0,
    status text not null default 'pending_admin_approval' check (status in ('pending_admin_approval', 'approved', 'rejected')),
    branch_id uuid null references public.branches(id) on delete set null,
    posting_date date null,
    journal_entry_id uuid null references public.journal_entries(id) on delete set null,
    posted_by uuid null references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.payroll_settings (
    business_id uuid primary key references public.businesses(id) on delete cascade,
    frequency text not null default 'Monthly',
    cutoff_day integer not null default 25,
    posting_day integer not null default 28,
    payday_rule text not null default 'Last working day',
    tax_method text not null default 'PAYE',
    pension_employee_rate numeric(8,2) not null default 8,
    pension_employer_rate numeric(8,2) not null default 10,
    currency_code text not null default 'NGN',
    include_13th_month boolean not null default false,
    payroll_control_account_id uuid null references public.chart_of_accounts(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.payroll_settings add column if not exists payroll_control_account_id uuid null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'payroll_settings_payroll_control_account_id_fkey'
    ) then
        alter table public.payroll_settings
            add constraint payroll_settings_payroll_control_account_id_fkey
            foreign key (payroll_control_account_id) references public.chart_of_accounts(id) on delete restrict;
    end if;
end $$;

create table if not exists public.payroll_staff (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    employee_code text not null,
    full_name text not null,
    branch_id uuid not null references public.branches(id) on delete restrict,
    salary_level text not null,
    gross_salary numeric(14,2) not null default 0,
    debit_account_id uuid null references public.chart_of_accounts(id) on delete restrict,
    credit_account_id uuid null references public.chart_of_accounts(id) on delete restrict,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (business_id, employee_code)
);

alter table public.payroll_runs add column if not exists payroll_staff_id uuid null;
alter table public.payroll_runs add column if not exists branch_id uuid null;
alter table public.payroll_runs add column if not exists posting_date date null;
alter table public.payroll_runs add column if not exists journal_entry_id uuid null;
alter table public.payroll_runs add column if not exists posted_by uuid null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'payroll_runs_payroll_staff_id_fkey'
    ) then
        alter table public.payroll_runs
            add constraint payroll_runs_payroll_staff_id_fkey
            foreign key (payroll_staff_id) references public.payroll_staff(id) on delete set null;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'payroll_runs_branch_id_fkey'
    ) then
        alter table public.payroll_runs
            add constraint payroll_runs_branch_id_fkey
            foreign key (branch_id) references public.branches(id) on delete set null;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'payroll_runs_journal_entry_id_fkey'
    ) then
        alter table public.payroll_runs
            add constraint payroll_runs_journal_entry_id_fkey
            foreign key (journal_entry_id) references public.journal_entries(id) on delete set null;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'payroll_runs_posted_by_fkey'
    ) then
        alter table public.payroll_runs
            add constraint payroll_runs_posted_by_fkey
            foreign key (posted_by) references auth.users(id) on delete set null;
    end if;
end $$;

create table if not exists public.payroll_components (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    component_name text not null,
    component_type text not null,
    calculation_basis text not null default 'fixed',
    default_value numeric(14,2) not null default 0,
    debit_account_id uuid null references public.chart_of_accounts(id) on delete restrict,
    credit_account_id uuid null references public.chart_of_accounts(id) on delete restrict,
    is_taxable boolean not null default false,
    is_statutory boolean not null default false,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

alter table public.payroll_components add column if not exists debit_account_id uuid null;
alter table public.payroll_components add column if not exists credit_account_id uuid null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'payroll_components_debit_account_id_fkey'
    ) then
        alter table public.payroll_components
            add constraint payroll_components_debit_account_id_fkey
            foreign key (debit_account_id) references public.chart_of_accounts(id) on delete restrict;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'payroll_components_credit_account_id_fkey'
    ) then
        alter table public.payroll_components
            add constraint payroll_components_credit_account_id_fkey
            foreign key (credit_account_id) references public.chart_of_accounts(id) on delete restrict;
    end if;
end $$;

create table if not exists public.payroll_level_components (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    level_name text not null,
    component_name text not null,
    component_type text not null,
    amount numeric(14,2) not null default 0,
    is_enabled boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.leave_policies (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    leave_type text not null,
    days_allowed integer not null default 0,
    carry_forward_days integer not null default 0,
    approval_required boolean not null default true,
    is_paid boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists idx_payroll_levels_business_id on public.payroll_levels(business_id);
create index if not exists idx_payroll_runs_business_id on public.payroll_runs(business_id);
create index if not exists idx_payroll_runs_branch_id on public.payroll_runs(branch_id);
create index if not exists idx_payroll_staff_business_id on public.payroll_staff(business_id);
create index if not exists idx_payroll_staff_branch_id on public.payroll_staff(branch_id);
create index if not exists idx_payroll_settings_business_id on public.payroll_settings(business_id);
create index if not exists idx_payroll_components_business_id on public.payroll_components(business_id);
create index if not exists idx_payroll_level_components_business_id on public.payroll_level_components(business_id);
create index if not exists idx_leave_policies_business_id on public.leave_policies(business_id);

alter table public.payroll_levels enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_settings enable row level security;
alter table public.payroll_staff enable row level security;
alter table public.payroll_components enable row level security;
alter table public.payroll_level_components enable row level security;
alter table public.leave_policies enable row level security;

drop policy if exists "business scoped payroll levels" on public.payroll_levels;
create policy "business scoped payroll levels"
on public.payroll_levels for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped payroll runs" on public.payroll_runs;
create policy "business scoped payroll runs"
on public.payroll_runs for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped payroll settings" on public.payroll_settings;
create policy "business scoped payroll settings"
on public.payroll_settings for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped payroll staff" on public.payroll_staff;
create policy "business scoped payroll staff"
on public.payroll_staff for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped payroll components" on public.payroll_components;
create policy "business scoped payroll components"
on public.payroll_components for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped payroll level components" on public.payroll_level_components;
create policy "business scoped payroll level components"
on public.payroll_level_components for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped leave policies" on public.leave_policies;
create policy "business scoped leave policies"
on public.leave_policies for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));
