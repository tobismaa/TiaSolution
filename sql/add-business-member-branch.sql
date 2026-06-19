alter table public.business_members
add column if not exists branch_id uuid references public.branches(id) on delete set null;

create index if not exists idx_business_members_branch_id
    on public.business_members (branch_id);
