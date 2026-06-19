begin;

alter table public.demo_access_links
add column if not exists token_plain text;

create unique index if not exists uq_demo_access_links_token_plain_not_null
on public.demo_access_links(token_plain)
where token_plain is not null;

drop policy if exists "platform admins can update demo access links" on public.demo_access_links;
create policy "platform admins can update demo access links"
on public.demo_access_links for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

notify pgrst, 'reload schema';

commit;
