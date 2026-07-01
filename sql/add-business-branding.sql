alter table public.business_settings
add column if not exists theme_color text not null default 'green';

alter table public.business_settings
add column if not exists logo_url text;

alter table public.business_settings
drop constraint if exists business_settings_theme_color_check;

alter table public.business_settings
add constraint business_settings_theme_color_check
check (theme_color in ('green', 'blue', 'red', 'purple', 'teal', 'gold'));

insert into public.business_settings (business_id, theme_color)
select businesses.id, 'green'
from public.businesses businesses
on conflict (business_id) do nothing;

insert into public.business_features (business_id, feature_key, is_enabled, sort_order)
select businesses.id, 'settings', true, 999
from public.businesses businesses
on conflict (business_id, feature_key) do update
set is_enabled = true,
    sort_order = coalesce(public.business_features.sort_order, excluded.sort_order),
    updated_at = now();
