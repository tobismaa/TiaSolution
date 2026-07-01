alter table public.businesses enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
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

drop policy if exists "users can view their profile" on public.profiles;
drop policy if exists "users can update their profile" on public.profiles;
drop policy if exists "platform admins can view profiles" on public.profiles;
drop policy if exists "business admins can view member profiles" on public.profiles;
drop policy if exists "business admins can insert member profiles" on public.profiles;
drop policy if exists "business admins can update member profiles" on public.profiles;
drop policy if exists "platform admins can insert profiles" on public.profiles;
drop policy if exists "platform admins can update profiles" on public.profiles;
drop policy if exists "platform admins can view their platform record" on public.platform_admins;
drop policy if exists "platform admins can insert platform records" on public.platform_admins;
drop policy if exists "platform admins can update platform records" on public.platform_admins;
drop policy if exists "platform admins can delete platform records" on public.platform_admins;
drop policy if exists "public can submit demo requests" on public.demo_requests;
drop policy if exists "platform admins can view demo requests" on public.demo_requests;
drop policy if exists "platform admins can update demo requests" on public.demo_requests;
drop policy if exists "platform admins can insert demo access links" on public.demo_access_links;
drop policy if exists "platform admins can view demo access links" on public.demo_access_links;
drop policy if exists "platform admins can update demo access links" on public.demo_access_links;
drop policy if exists "public can verify valid demo links" on public.demo_access_links;
drop policy if exists "public can consume valid demo links" on public.demo_access_links;
drop policy if exists "members can view their businesses" on public.businesses;
drop policy if exists "platform admins can manage businesses" on public.businesses;
drop policy if exists "members can view their memberships" on public.business_members;
drop policy if exists "admins can manage memberships" on public.business_members;
drop policy if exists "business scoped settings" on public.business_settings;
drop policy if exists "platform admins manage business features" on public.business_features;
drop policy if exists "business members view business features" on public.business_features;
drop policy if exists "platform admins manage branch features" on public.branch_features;
drop policy if exists "business members view branch features" on public.branch_features;
drop policy if exists "business scoped branches" on public.branches;
drop policy if exists "business scoped tax rates" on public.tax_rates;
drop policy if exists "business scoped accounts" on public.chart_of_accounts;
drop policy if exists "business scoped customers" on public.customers;
drop policy if exists "business scoped suppliers" on public.suppliers;
drop policy if exists "business scoped products" on public.products;
drop policy if exists "business scoped invoices" on public.invoices;
drop policy if exists "business members can view invoice items" on public.invoice_items;
drop policy if exists "business members can manage invoice items" on public.invoice_items;
drop policy if exists "business scoped payments" on public.payments;
drop policy if exists "business scoped expenses" on public.expenses;
drop policy if exists "business scoped journal entries" on public.journal_entries;
drop policy if exists "business members can view journal lines" on public.journal_entry_lines;
drop policy if exists "business members can manage journal lines" on public.journal_entry_lines;
drop policy if exists "members can view subscriptions" on public.subscriptions;
drop policy if exists "platform admins can manage subscriptions" on public.subscriptions;
drop policy if exists "business members can view audit logs" on public.audit_logs;
drop policy if exists "system can insert audit logs" on public.audit_logs;

create policy "users can view their profile"
on public.profiles for select
using (id = auth.uid());

create policy "users can update their profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "platform admins can view profiles"
on public.profiles for select
using (public.is_platform_admin());

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

create policy "business admins can insert member profiles"
on public.profiles for insert
with check (
    exists (
        select 1
        from public.business_members actor
        where actor.user_id = auth.uid()
          and actor.is_active = true
          and actor.role = 'business_admin'
          and actor.business_id in (
              select bm.business_id
              from public.business_members bm
              where bm.user_id = profiles.id
          )
    )
);

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

create policy "platform admins can insert profiles"
on public.profiles for insert
with check (public.is_platform_admin());

create policy "platform admins can update profiles"
on public.profiles for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "platform admins can view their platform record"
on public.platform_admins for select
using (public.is_platform_admin());

create policy "platform admins can insert platform records"
on public.platform_admins for insert
with check (public.is_platform_admin());

create policy "platform admins can update platform records"
on public.platform_admins for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "platform admins can delete platform records"
on public.platform_admins for delete
using (public.is_platform_admin());

create policy "public can submit demo requests"
on public.demo_requests for insert
with check (true);

create policy "platform admins can view demo requests"
on public.demo_requests for select
using (public.is_platform_admin());

create policy "platform admins can update demo requests"
on public.demo_requests for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "platform admins can insert demo access links"
on public.demo_access_links for insert
with check (public.is_platform_admin());

create policy "platform admins can view demo access links"
on public.demo_access_links for select
using (public.is_platform_admin());

create policy "platform admins can update demo access links"
on public.demo_access_links for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "public can verify valid demo links"
on public.demo_access_links for select
using (revoked_at is null and used_at is null and expires_at > now());

create policy "public can consume valid demo links"
on public.demo_access_links for update
using (revoked_at is null and used_at is null and expires_at > now())
with check (true);

create policy "members can view their businesses"
on public.businesses for select
using (id in (select public.current_business_ids()) or public.is_platform_admin());

create policy "platform admins can manage businesses"
on public.businesses for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "members can view their memberships"
on public.business_members for select
using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

create policy "admins can manage memberships"
on public.business_members for all
using (business_id in (select public.current_business_ids()) or public.is_platform_admin())
with check (business_id in (select public.current_business_ids()) or public.is_platform_admin());

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

create policy "business scoped branches"
on public.branches for all
using (business_id in (select public.current_business_ids()) or public.is_platform_admin())
with check (business_id in (select public.current_business_ids()) or public.is_platform_admin());

create policy "business scoped tax rates"
on public.tax_rates for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

create policy "business scoped accounts"
on public.chart_of_accounts for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

create policy "business scoped customers"
on public.customers for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

create policy "business scoped suppliers"
on public.suppliers for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

create policy "business scoped products"
on public.products for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

create policy "business scoped invoices"
on public.invoices for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

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

create policy "business scoped payments"
on public.payments for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

create policy "business scoped expenses"
on public.expenses for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

create policy "business scoped journal entries"
on public.journal_entries for all
using (business_id in (select public.current_business_ids()))
with check (business_id in (select public.current_business_ids()));

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

create policy "members can view subscriptions"
on public.subscriptions for select
using (business_id in (select public.current_business_ids()) or public.is_platform_admin());

create policy "platform admins can manage subscriptions"
on public.subscriptions for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "business members can view audit logs"
on public.audit_logs for select
using (
    business_id in (select public.current_business_ids())
    or public.is_platform_admin()
    or business_id is null
);

create policy "system can insert audit logs"
on public.audit_logs for insert
with check (
    business_id in (select public.current_business_ids())
    or public.is_platform_admin()
    or business_id is null
);
