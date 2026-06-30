alter table public.profiles
add column if not exists username text;

update public.profiles
   set username = lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9_]+', '_', 'g'))
 where username is null
   and email is not null
   and not exists (
       select 1
         from public.profiles existing
        where existing.username = lower(regexp_replace(split_part(profiles.email, '@', 1), '[^a-z0-9_]+', '_', 'g'))
          and existing.id <> profiles.id
   );

create unique index if not exists profiles_username_unique_idx
on public.profiles (lower(username))
where username is not null;

create table if not exists public.user_security_states (
    user_id uuid primary key references auth.users(id) on delete cascade,
    successful_login_count integer not null default 0,
    last_2fa_verified_at timestamptz,
    updated_at timestamptz not null default now()
);

create table if not exists public.user_two_factor_challenges (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    code_hash text not null,
    expires_at timestamptz not null,
    consumed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists user_two_factor_challenges_user_created_idx
on public.user_two_factor_challenges (user_id, created_at desc);

alter table public.user_security_states enable row level security;
alter table public.user_two_factor_challenges enable row level security;

drop policy if exists "users view their security state" on public.user_security_states;
create policy "users view their security state"
on public.user_security_states for select
using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists "platform admins manage security state" on public.user_security_states;
create policy "platform admins manage security state"
on public.user_security_states for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins view two factor challenges" on public.user_two_factor_challenges;
create policy "platform admins view two factor challenges"
on public.user_two_factor_challenges for select
using (public.is_platform_admin());

insert into public.platform_settings (key, value)
values ('email_2fa_after_logins', '10')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
