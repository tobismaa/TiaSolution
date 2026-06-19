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
