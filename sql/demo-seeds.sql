insert into public.businesses (name, slug, is_demo, subscription_status)
values
    ('Tia Demo Workspace', 'tia-demo-workspace', true, 'demo'),
    ('Northwind Clinic Demo', 'northwind-clinic-demo', true, 'demo')
on conflict (slug) do nothing;
