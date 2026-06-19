begin;

alter table public.demo_access_links
add column if not exists token_plain text;

create unique index if not exists uq_demo_access_links_token_plain_not_null
on public.demo_access_links(token_plain)
where token_plain is not null;

notify pgrst, 'reload schema';

commit;
