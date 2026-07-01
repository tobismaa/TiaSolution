-- Tia full database bootstrap
-- Run this once in Supabase SQL Editor (or re-run safely; script is idempotent).

begin;

create extension if not exists "pgcrypto";

-- =========================
-- Core Tables
-- =========================

create table if not exists public.businesses (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text unique not null,
    legal_name text,
    email text,
    phone text,
    country text,
    max_branches integer check (max_branches is null or max_branches > 0),
    currency_code text not null default 'NGN',
    fiscal_year_start_month integer not null default 1 check (fiscal_year_start_month between 1 and 12),
    is_demo boolean not null default false,
    trial_ends_at timestamptz,
    subscription_status text not null default 'trial' check (subscription_status in ('trial', 'active', 'past_due', 'deactivated', 'expired', 'demo')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    email text,
    phone text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.platform_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    is_active boolean not null default true,
    role text not null default 'super_admin' check (role in ('super_admin', 'business_admin', 'manager', 'staff', 'account', 'auditor')),
    created_at timestamptz not null default now()
);

create table if not exists public.user_login_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    session_key text not null unique,
    is_active boolean not null default true,
    signed_in_at timestamptz not null default now(),
    signed_out_at timestamptz,
    login_attempt_count integer not null default 0,
    last_login_attempt_at timestamptz,
    last_login_attempt_session_key text,
    updated_at timestamptz not null default now()
);

with ranked_sessions as (
    select id,
           row_number() over (
               partition by user_id
               order by signed_in_at desc, updated_at desc, id desc
           ) as row_number
      from public.user_login_sessions
     where is_active = true
)
update public.user_login_sessions sessions
   set is_active = false,
       signed_out_at = coalesce(sessions.signed_out_at, now()),
       updated_at = now()
  from ranked_sessions
 where sessions.id = ranked_sessions.id
   and ranked_sessions.row_number > 1;

create unique index if not exists user_login_sessions_one_active_per_user
on public.user_login_sessions (user_id)
where is_active = true;

create table if not exists public.demo_requests (
    id uuid primary key default gen_random_uuid(),
    business_name text not null,
    contact_name text not null,
    email text not null,
    phone text,
    team_size text,
    preferred_role text not null check (preferred_role in ('all_roles', 'business_admin', 'manager', 'staff', 'account', 'auditor')),
    message text not null,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    reviewed_by uuid references auth.users(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.demo_access_links (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null unique references public.demo_requests(id) on delete cascade,
    role text not null check (role in ('all_roles', 'business_admin', 'manager', 'staff', 'account', 'auditor')),
    token_plain text not null unique,
    token_hash text not null unique,
    expires_at timestamptz not null,
    used_at timestamptz,
    revoked_at timestamptz,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.branches (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    name text not null,
    code text,
    is_head_office boolean not null default false,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (business_id, name)
);

create table if not exists public.business_members (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('business_admin', 'manager', 'staff', 'account', 'auditor')),
    branch_id uuid references public.branches(id) on delete set null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (business_id, user_id)
);

create table if not exists public.business_settings (
    business_id uuid primary key references public.businesses(id) on delete cascade,
    tax_number text,
    invoice_prefix text default 'INV',
    theme_color text not null default 'green' check (theme_color in ('green', 'blue', 'red', 'purple', 'teal', 'gold')),
    logo_url text,
    expense_approval_required boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.business_features (
    business_id uuid not null references public.businesses(id) on delete cascade,
    feature_key text not null,
    is_enabled boolean not null default false,
    sort_order integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (business_id, feature_key)
);

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

create table if not exists public.tax_rates (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    name text not null,
    rate numeric(7,4) not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.chart_of_accounts (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    code text not null,
    name text not null,
    account_type text not null check (account_type in ('asset', 'liability', 'equity', 'income', 'expense')),
    parent_account_id uuid references public.chart_of_accounts(id) on delete set null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (business_id, code)
);

create table if not exists public.customers (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    branch_id uuid references public.branches(id) on delete set null,
    name text not null,
    email text,
    phone text,
    industry text,
    billing_address text,
    balance numeric(14,2) not null default 0,
    last_payment_at date,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    name text not null,
    email text,
    phone text,
    created_at timestamptz not null default now()
);

create table if not exists public.products (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    sku text,
    name text not null,
    description text,
    unit_price numeric(14,2) not null default 0,
    created_at timestamptz not null default now()
);

create table if not exists public.invoices (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    branch_id uuid references public.branches(id) on delete set null,
    customer_id uuid references public.customers(id) on delete set null,
    invoice_number text not null,
    status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    subtotal_amount numeric(14,2) not null default 0,
    tax_amount numeric(14,2) not null default 0,
    total_amount numeric(14,2) not null default 0,
    notes text,
    accepted_payment_methods text,
    payment_terms text,
    due_date date,
    issued_at date default current_date,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (business_id, invoice_number)
);

create table if not exists public.invoice_items (
    id uuid primary key default gen_random_uuid(),
    invoice_id uuid not null references public.invoices(id) on delete cascade,
    product_id uuid references public.products(id) on delete set null,
    tax_rate_id uuid references public.tax_rates(id) on delete set null,
    description text not null,
    quantity numeric(12,2) not null default 1,
    unit_price numeric(14,2) not null default 0,
    tax_amount numeric(14,2) not null default 0,
    line_total numeric(14,2) not null default 0
);

create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    invoice_id uuid references public.invoices(id) on delete set null,
    customer_id uuid references public.customers(id) on delete set null,
    amount numeric(14,2) not null default 0,
    payment_method text,
    received_at date default current_date,
    reference text,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.expenses (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    branch_id uuid references public.branches(id) on delete set null,
    supplier_id uuid references public.suppliers(id) on delete set null,
    account_id uuid references public.chart_of_accounts(id) on delete set null,
    title text not null,
    category text,
    amount numeric(14,2) not null default 0,
    tax_amount numeric(14,2) not null default 0,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paid')),
    incurred_at date default current_date,
    created_by uuid references auth.users(id) on delete set null,
    approved_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.journal_entries (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    branch_id uuid references public.branches(id) on delete set null,
    entry_date date not null default current_date,
    reference text,
    memo text,
    source_type text,
    source_id uuid,
    created_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.journal_entry_lines (
    id uuid primary key default gen_random_uuid(),
    journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
    account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
    description text,
    debit numeric(14,2) not null default 0,
    credit numeric(14,2) not null default 0,
    customer_id uuid references public.customers(id) on delete set null,
    supplier_id uuid references public.suppliers(id) on delete set null
);

create table if not exists public.subscriptions (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null unique references public.businesses(id) on delete cascade,
    plan_name text not null default 'trial',
    status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'deactivated', 'expired', 'demo')),
    amount numeric(14,2) not null default 0,
    billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'quarterly', 'yearly', 'custom')),
    billing_months integer,
    starts_at timestamptz not null default now(),
    ends_at timestamptz
);

create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    business_id uuid references public.businesses(id) on delete cascade,
    actor_user_id uuid references auth.users(id) on delete set null,
    action text not null,
    entity_type text not null,
    entity_id uuid,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.demo_requests drop constraint if exists demo_requests_preferred_role_check;
alter table public.demo_requests
    add constraint demo_requests_preferred_role_check
    check (preferred_role in ('all_roles', 'business_admin', 'manager', 'staff', 'auditor'));

alter table public.demo_access_links drop constraint if exists demo_access_links_role_check;
alter table public.demo_access_links
    add constraint demo_access_links_role_check
    check (role in ('all_roles', 'business_admin', 'manager', 'staff', 'auditor'));

alter table public.demo_access_links add column if not exists token_plain text;
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'demo_access_links_request_id_key'
    ) then
        alter table public.demo_access_links
            add constraint demo_access_links_request_id_key unique (request_id);
    end if;
end $$;

create unique index if not exists uq_demo_access_links_request_id on public.demo_access_links(request_id);
create unique index if not exists uq_demo_access_links_token_plain_not_null
on public.demo_access_links(token_plain)
where token_plain is not null;

-- Helpful relationship constraints for Supabase nested selects into profiles
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'platform_admins_user_id_profiles_fkey'
    ) then
        alter table public.platform_admins
            add constraint platform_admins_user_id_profiles_fkey
            foreign key (user_id) references public.profiles(id) on delete cascade not valid;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'business_members_user_id_profiles_fkey'
    ) then
        alter table public.business_members
            add constraint business_members_user_id_profiles_fkey
            foreign key (user_id) references public.profiles(id) on delete cascade not valid;
    end if;
end $$;

-- =========================
-- Sync Profiles
-- =========================

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, full_name, email)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
        new.email
    )
    on conflict (id) do update
    set
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        email = coalesce(excluded.email, public.profiles.email),
        updated_at = now();

    return new;
end;
$$;

drop trigger if exists on_auth_user_created_sync_profile on auth.users;
create trigger on_auth_user_created_sync_profile
after insert on auth.users
for each row execute procedure public.sync_profile_from_auth_user();

insert into public.profiles (id, full_name, email)
select
    u.id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
    u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

alter table public.platform_admins validate constraint platform_admins_user_id_profiles_fkey;
alter table public.business_members validate constraint business_members_user_id_profiles_fkey;

-- =========================
-- Triggers
-- =========================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists set_businesses_updated_at on public.businesses;
create trigger set_businesses_updated_at before update on public.businesses
for each row execute procedure public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists set_customers_updated_at on public.customers;
create trigger set_customers_updated_at before update on public.customers
for each row execute procedure public.set_updated_at();

drop trigger if exists set_business_settings_updated_at on public.business_settings;
create trigger set_business_settings_updated_at before update on public.business_settings
for each row execute procedure public.set_updated_at();

drop trigger if exists set_invoices_updated_at on public.invoices;
create trigger set_invoices_updated_at before update on public.invoices
for each row execute procedure public.set_updated_at();

drop trigger if exists set_expenses_updated_at on public.expenses;
create trigger set_expenses_updated_at before update on public.expenses
for each row execute procedure public.set_updated_at();

-- =========================
-- Indexes
-- =========================

create index if not exists idx_demo_requests_status_created_at on public.demo_requests(status, created_at desc);
create index if not exists idx_demo_access_links_token_hash on public.demo_access_links(token_hash);
create index if not exists idx_demo_access_links_request_id on public.demo_access_links(request_id);
create index if not exists idx_business_members_user_id on public.business_members(user_id);
create index if not exists idx_business_members_business_id on public.business_members(business_id);
create index if not exists idx_customers_business_id on public.customers(business_id);
create index if not exists idx_invoices_business_id on public.invoices(business_id);
create index if not exists idx_expenses_business_id on public.expenses(business_id);
create index if not exists idx_subscriptions_business_id on public.subscriptions(business_id);
create index if not exists idx_audit_logs_business_id_created_at on public.audit_logs(business_id, created_at desc);

-- =========================
-- RLS + Policies
-- =========================

alter table public.businesses enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.user_login_sessions enable row level security;
alter table public.demo_requests enable row level security;
alter table public.demo_access_links enable row level security;
alter table public.branches enable row level security;
alter table public.business_members enable row level security;
alter table public.business_settings enable row level security;
alter table public.business_features enable row level security;
alter table public.branch_features enable row level security;
alter table public.tax_rates enable row level security;
alter table public.chart_of_accounts enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_entry_lines enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_logs enable row level security;

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

create or replace function public.start_user_login_session(p_session_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    active_session_key text;
begin
    if current_user_id is null or nullif(trim(p_session_key), '') is null then
        return false;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

    select session_key
      into active_session_key
      from public.user_login_sessions
     where user_id = current_user_id
       and is_active = true
     limit 1
     for update;

    if active_session_key is not null then
        if active_session_key = p_session_key then
            return true;
        end if;

        update public.user_login_sessions
           set login_attempt_count = coalesce(login_attempt_count, 0) + 1,
               last_login_attempt_at = now(),
               last_login_attempt_session_key = p_session_key,
               updated_at = now()
         where user_id = current_user_id
           and session_key = active_session_key
           and is_active = true;

        return false;
    end if;

    update public.user_login_sessions
       set is_active = true,
           signed_in_at = now(),
           signed_out_at = null,
           updated_at = now()
     where user_id = current_user_id
       and session_key = p_session_key
       and is_active = false;

    if found then
        return true;
    end if;

    begin
        insert into public.user_login_sessions (user_id, session_key, is_active, signed_in_at, updated_at)
        values (current_user_id, p_session_key, true, now(), now());
    exception when unique_violation then
        return false;
    end;

    return true;
end;
$$;

create or replace function public.end_user_login_session(p_session_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null or nullif(trim(p_session_key), '') is null then
        return;
    end if;

    update public.user_login_sessions
       set is_active = false,
           signed_out_at = now(),
           updated_at = now()
     where user_id = auth.uid()
       and session_key = p_session_key
       and is_active = true;
end;
$$;

drop policy if exists "users can view their profile" on public.profiles;
drop policy if exists "users can insert their profile" on public.profiles;
create policy "users can view their profile"
on public.profiles for select
using (id = auth.uid());

create policy "users can insert their profile"
on public.profiles for insert
with check (id = auth.uid());

drop policy if exists "users can update their profile" on public.profiles;
create policy "users can update their profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "platform admins can view profiles" on public.profiles;
create policy "platform admins can view profiles"
on public.profiles for select
using (public.is_platform_admin());

drop policy if exists "business admins can view member profiles" on public.profiles;
create policy "business admins can view member profiles"
on public.profiles for select
using (
    exists (
        select 1
        from public.business_members actor
        join public.business_members member
          on member.business_id = actor.business_id
        where actor.user_id = auth.uid()
          and actor.is_active = true
          and actor.role = 'business_admin'
          and member.user_id = profiles.id
    )
);

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

drop policy if exists "business admins can update member profiles" on public.profiles;
create policy "business admins can update member profiles"
on public.profiles for update
using (
    exists (
        select 1
        from public.business_members actor
        join public.business_members member
          on member.business_id = actor.business_id
        where actor.user_id = auth.uid()
          and actor.is_active = true
          and actor.role = 'business_admin'
          and member.user_id = profiles.id
    )
)
with check (
    exists (
        select 1
        from public.business_members actor
        join public.business_members member
          on member.business_id = actor.business_id
        where actor.user_id = auth.uid()
          and actor.is_active = true
          and actor.role = 'business_admin'
          and member.user_id = profiles.id
    )
);

drop policy if exists "platform admins can insert profiles" on public.profiles;
create policy "platform admins can insert profiles"
on public.profiles for insert
with check (public.is_platform_admin());

drop policy if exists "platform admins can update profiles" on public.profiles;
create policy "platform admins can update profiles"
on public.profiles for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins can view their platform record" on public.platform_admins;
create policy "platform admins can view their platform record"
on public.platform_admins for select
using (public.is_platform_admin());

drop policy if exists "platform admins can insert platform records" on public.platform_admins;
create policy "platform admins can insert platform records"
on public.platform_admins for insert
with check (public.is_platform_admin());

drop policy if exists "platform admins can update platform records" on public.platform_admins;
create policy "platform admins can update platform records"
on public.platform_admins for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins can delete platform records" on public.platform_admins;
create policy "platform admins can delete platform records"
on public.platform_admins for delete
using (public.is_platform_admin());

drop policy if exists "users can view their login sessions" on public.user_login_sessions;
create policy "users can view their login sessions"
on public.user_login_sessions for select
using (user_id = auth.uid());

drop policy if exists "platform admins view login sessions" on public.user_login_sessions;
create policy "platform admins view login sessions"
on public.user_login_sessions for select
using (public.is_platform_admin());

drop policy if exists "public can submit demo requests" on public.demo_requests;
create policy "public can submit demo requests"
on public.demo_requests for insert
with check (true);

drop policy if exists "platform admins can view demo requests" on public.demo_requests;
create policy "platform admins can view demo requests"
on public.demo_requests for select
using (public.is_platform_admin());

drop policy if exists "platform admins can update demo requests" on public.demo_requests;
create policy "platform admins can update demo requests"
on public.demo_requests for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins can insert demo access links" on public.demo_access_links;
create policy "platform admins can insert demo access links"
on public.demo_access_links for insert
with check (public.is_platform_admin());

drop policy if exists "platform admins can view demo access links" on public.demo_access_links;
create policy "platform admins can view demo access links"
on public.demo_access_links for select
using (public.is_platform_admin());

drop policy if exists "platform admins can update demo access links" on public.demo_access_links;
create policy "platform admins can update demo access links"
on public.demo_access_links for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "public can verify valid demo links" on public.demo_access_links;
create policy "public can verify valid demo links"
on public.demo_access_links for select
using (revoked_at is null and used_at is null and expires_at > now());

drop policy if exists "public can consume valid demo links" on public.demo_access_links;
create policy "public can consume valid demo links"
on public.demo_access_links for update
using (revoked_at is null and used_at is null and expires_at > now())
with check (true);

drop policy if exists "members can view their businesses" on public.businesses;
create policy "members can view their businesses"
on public.businesses for select
using (id in (select public.current_business_ids()) or public.is_platform_admin());

drop policy if exists "platform admins can manage businesses" on public.businesses;
create policy "platform admins can manage businesses"
on public.businesses for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "members can view their memberships" on public.business_members;
create policy "members can view their memberships"
on public.business_members for select
using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

drop policy if exists "admins can manage memberships" on public.business_members;
create policy "admins can manage memberships"
on public.business_members for all
using (business_id in (select public.current_business_ids()) or public.is_platform_admin())
with check (business_id in (select public.current_business_ids()) or public.is_platform_admin());

drop policy if exists "business scoped settings" on public.business_settings;
create policy "business scoped settings"
on public.business_settings for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "platform admins manage business features" on public.business_features;
create policy "platform admins manage business features"
on public.business_features for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "business members view business features" on public.business_features;
create policy "business members view business features"
on public.business_features for select
using (business_id in (select public.current_business_ids()));

drop policy if exists "platform admins manage branch features" on public.branch_features;
create policy "platform admins manage branch features"
on public.branch_features for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "business members view branch features" on public.branch_features;
create policy "business members view branch features"
on public.branch_features for select
using (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped branches" on public.branches;
create policy "business scoped branches"
on public.branches for all
using (business_id in (select public.current_business_ids()) or public.is_platform_admin())
with check (business_id in (select public.current_business_ids()) or public.is_platform_admin());

drop policy if exists "business scoped tax rates" on public.tax_rates;
create policy "business scoped tax rates"
on public.tax_rates for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped accounts" on public.chart_of_accounts;
create policy "business scoped accounts"
on public.chart_of_accounts for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped customers" on public.customers;
create policy "business scoped customers"
on public.customers for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped suppliers" on public.suppliers;
create policy "business scoped suppliers"
on public.suppliers for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped products" on public.products;
create policy "business scoped products"
on public.products for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped invoices" on public.invoices;
create policy "business scoped invoices"
on public.invoices for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business members can view invoice items" on public.invoice_items;
create policy "business members can view invoice items"
on public.invoice_items for select
using (
    exists (
        select 1
        from public.invoices
        where invoices.id = invoice_items.invoice_id
          and invoices.business_id in (select public.current_business_ids())
    )
);

drop policy if exists "business members can manage invoice items" on public.invoice_items;
create policy "business members can manage invoice items"
on public.invoice_items for all
using (
    exists (
        select 1
        from public.invoices
        where invoices.id = invoice_items.invoice_id
          and invoices.business_id in (select public.current_business_ids())
    )
)
with check (
    exists (
        select 1
        from public.invoices
        where invoices.id = invoice_items.invoice_id
          and invoices.business_id in (select public.current_business_ids())
    )
);

drop policy if exists "business scoped payments" on public.payments;
create policy "business scoped payments"
on public.payments for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped expenses" on public.expenses;
create policy "business scoped expenses"
on public.expenses for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business scoped journal entries" on public.journal_entries;
create policy "business scoped journal entries"
on public.journal_entries for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

drop policy if exists "business members can view journal lines" on public.journal_entry_lines;
create policy "business members can view journal lines"
on public.journal_entry_lines for select
using (
    exists (
        select 1
        from public.journal_entries
        where journal_entries.id = journal_entry_lines.journal_entry_id
          and journal_entries.business_id in (select public.current_business_ids())
    )
);

drop policy if exists "business members can manage journal lines" on public.journal_entry_lines;
create policy "business members can manage journal lines"
on public.journal_entry_lines for all
using (
    exists (
        select 1
        from public.journal_entries
        where journal_entries.id = journal_entry_lines.journal_entry_id
          and journal_entries.business_id in (select public.current_business_ids())
    )
)
with check (
    exists (
        select 1
        from public.journal_entries
        where journal_entries.id = journal_entry_lines.journal_entry_id
          and journal_entries.business_id in (select public.current_business_ids())
    )
);

drop policy if exists "members can view subscriptions" on public.subscriptions;
create policy "members can view subscriptions"
on public.subscriptions for select
using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

drop policy if exists "platform admins can manage subscriptions" on public.subscriptions;
create policy "platform admins can manage subscriptions"
on public.subscriptions for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "business members can view audit logs" on public.audit_logs;
create policy "business members can view audit logs"
on public.audit_logs for select
using (
    business_id in (select public.current_business_ids())
    or public.is_platform_admin()
    or business_id is null
);

drop policy if exists "system can insert audit logs" on public.audit_logs;
create policy "system can insert audit logs"
on public.audit_logs for insert
with check (
    business_id in (select public.current_business_ids())
    or public.is_platform_admin()
    or business_id is null
);

-- =========================
-- Grants
-- =========================

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant insert on public.demo_requests to anon;
grant select, update on public.demo_access_links to anon;

commit;

-- Refresh PostgREST schema cache (helps after new tables like demo_requests are added).
notify pgrst, 'reload schema';
