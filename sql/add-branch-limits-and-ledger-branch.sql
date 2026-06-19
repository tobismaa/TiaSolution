alter table public.businesses
add column if not exists max_branches integer check (max_branches is null or max_branches > 0);

alter table public.general_ledger_accounts
add column if not exists branch_id uuid references public.branches(id) on delete set null;

create index if not exists idx_general_ledger_accounts_branch_id
    on public.general_ledger_accounts (branch_id);
