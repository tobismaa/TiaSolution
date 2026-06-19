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
drop policy if exists "business admins and heads can update ledger accounts" on public.general_ledger_accounts;
drop policy if exists "account can create ledger accounts" on public.general_ledger_accounts;
drop policy if exists "account can update ledger accounts" on public.general_ledger_accounts;

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
