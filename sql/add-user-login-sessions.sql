create table if not exists public.user_login_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    session_key text not null unique,
    is_active boolean not null default true,
    signed_in_at timestamptz not null default now(),
    signed_out_at timestamptz,
    login_attempt_count integer not null default 0,
    last_login_attempt_at timestamptz,
    last_login_attempt_session_key text,
    updated_at timestamptz not null default now()
);

alter table public.user_login_sessions
add column if not exists login_attempt_count integer not null default 0;

alter table public.user_login_sessions
add column if not exists last_login_attempt_at timestamptz;

alter table public.user_login_sessions
add column if not exists last_login_attempt_session_key text;

with ranked_sessions as (
    select id,
           row_number() over (
               partition by user_id
               order by signed_in_at desc, updated_at desc, id desc
           ) as row_number
      from public.user_login_sessions
     where is_active = true
)
update public.user_login_sessions sessions
   set is_active = false,
       signed_out_at = coalesce(sessions.signed_out_at, now()),
       updated_at = now()
  from ranked_sessions
 where sessions.id = ranked_sessions.id
   and ranked_sessions.row_number > 1;

create unique index if not exists user_login_sessions_one_active_per_user
on public.user_login_sessions (user_id)
where is_active = true;

alter table public.user_login_sessions enable row level security;

drop policy if exists "users can view their login sessions" on public.user_login_sessions;
create policy "users can view their login sessions"
on public.user_login_sessions for select
using (user_id = auth.uid());

drop policy if exists "platform admins view login sessions" on public.user_login_sessions;
create policy "platform admins view login sessions"
on public.user_login_sessions for select
using (public.is_platform_admin());

create or replace function public.start_user_login_session(p_session_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    active_session_key text;
begin
    if current_user_id is null or nullif(trim(p_session_key), '') is null then
        return false;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

    select session_key
      into active_session_key
      from public.user_login_sessions
     where user_id = current_user_id
       and is_active = true
     limit 1
     for update;

    if active_session_key is not null then
        if active_session_key = p_session_key then
            return true;
        end if;

        update public.user_login_sessions
           set login_attempt_count = coalesce(login_attempt_count, 0) + 1,
               last_login_attempt_at = now(),
               last_login_attempt_session_key = p_session_key,
               updated_at = now()
         where user_id = current_user_id
           and session_key = active_session_key
           and is_active = true;

        return false;
    end if;

    update public.user_login_sessions
       set is_active = true,
           signed_in_at = now(),
           signed_out_at = null,
           updated_at = now()
     where user_id = current_user_id
       and session_key = p_session_key
       and is_active = false;

    if found then
        return true;
    end if;

    begin
        insert into public.user_login_sessions (user_id, session_key, is_active, signed_in_at, updated_at)
        values (current_user_id, p_session_key, true, now(), now());
    exception when unique_violation then
        return false;
    end;

    return true;
end;
$$;

create or replace function public.end_user_login_session(p_session_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null or nullif(trim(p_session_key), '') is null then
        return;
    end if;

    update public.user_login_sessions
       set is_active = false,
           signed_out_at = now(),
           updated_at = now()
     where user_id = auth.uid()
       and session_key = p_session_key
       and is_active = true;
end;
$$;
