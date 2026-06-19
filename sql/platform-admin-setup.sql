-- Create the user in Supabase Auth first from the dashboard or Admin API.
-- Then replace the placeholder UUID below with that auth user's id.

insert into public.platform_admins (user_id, is_active)
values ('00000000-0000-0000-0000-000000000000', true)
on conflict (user_id) do update
set is_active = excluded.is_active;

-- Recommended auth metadata for the same user:
-- {
--   "role": "super_admin",
--   "platform_role": "super_admin",
--   "business_name": "Tia Platform Workspace",
--   "subscription": "Live"
-- }
