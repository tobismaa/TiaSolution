update public.branches branch_row
set is_head_office = true
where lower(coalesce(branch_row.name, '')) = 'head office'
  and not exists (
      select 1
      from public.branches bx
      where bx.business_id = branch_row.business_id
        and bx.is_head_office = true
  );

insert into public.branches (business_id, name, code, is_head_office)
select
    business_row.id,
    'Head Office',
    'BR-001',
    true
from public.businesses business_row
where not exists (
    select 1
    from public.branches branch_row
    where branch_row.business_id = business_row.id
      and branch_row.is_head_office = true
);
