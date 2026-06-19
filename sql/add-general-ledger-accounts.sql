create table if not exists public.general_ledger_accounts (
    id uuid primary key default gen_random_uuid(),
    business_id uuid not null references public.businesses(id) on delete cascade,
    branch_id uuid references public.branches(id) on delete set null,
    account_code text not null,
    account_name text not null,
    account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
    normal_side text not null default 'debit' check (normal_side in ('debit', 'credit')),
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (business_id, account_code)
);

create index if not exists idx_general_ledger_accounts_business_id
    on public.general_ledger_accounts (business_id);

create index if not exists idx_general_ledger_accounts_branch_id
    on public.general_ledger_accounts (branch_id);

alter table public.general_ledger_accounts enable row level security;

drop policy if exists "business members can view ledger accounts" on public.general_ledger_accounts;
drop policy if exists "account can view ledger accounts" on public.general_ledger_accounts;
create policy "account can view ledger accounts"
    on public.general_ledger_accounts
    for select
    using (
        exists (
            select 1
            from public.business_members bm
            where bm.business_id = general_ledger_accounts.business_id
              and bm.user_id = auth.uid()
              and bm.is_active = true
              and bm.role in ('account', 'auditor')
        )
    );

drop policy if exists "business admins and heads can create ledger accounts" on public.general_ledger_accounts;
drop policy if exists "account can create ledger accounts" on public.general_ledger_accounts;
create policy "account can create ledger accounts"
    on public.general_ledger_accounts
    for insert
    with check (
        exists (
            select 1
            from public.business_members bm
            where bm.business_id = general_ledger_accounts.business_id
              and bm.user_id = auth.uid()
              and bm.is_active = true
              and bm.role in ('account', 'auditor')
        )
    );

drop policy if exists "business admins and heads can update ledger accounts" on public.general_ledger_accounts;
drop policy if exists "account can update ledger accounts" on public.general_ledger_accounts;
create policy "account can update ledger accounts"
    on public.general_ledger_accounts
    for update
    using (
        exists (
            select 1
            from public.business_members bm
            where bm.business_id = general_ledger_accounts.business_id
              and bm.user_id = auth.uid()
              and bm.is_active = true
              and bm.role in ('account', 'auditor')
        )
    )
    with check (
        exists (
            select 1
            from public.business_members bm
            where bm.business_id = general_ledger_accounts.business_id
              and bm.user_id = auth.uid()
              and bm.is_active = true
              and bm.role in ('account', 'auditor')
        )
    );
