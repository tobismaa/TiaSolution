# Demo And Trial Flow

1. Prospect opens `login.html`.
2. Prospect chooses a demo role or starts a trial.
3. Demo and trial context is stored locally for the front-end shell.
4. Production rollout should back this with `businesses.is_demo`, `businesses.trial_ends_at`, and `subscriptions.status`.
5. Demo data can be restored from `sql/demo-seeds.sql` or a scheduled reset routine.

`super_admin` is excluded from demo. Create that user directly in Supabase Auth and mark it with `user_metadata.role = 'super_admin'` or `user_metadata.platform_role = 'super_admin'`.
