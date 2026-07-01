alter table public.invoices
add column if not exists accepted_payment_methods text,
add column if not exists payment_terms text;
