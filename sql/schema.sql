create extension if not exists "pgcrypto";

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
    logo_url text,
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

create table if not exists public.platform_settings (
    key text primary key,
    value text not null,
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
