alter table public.branches
add column if not exists logo_url text;

drop policy if exists "business scoped settings" on public.business_settings;
create policy "business scoped settings"
on public.business_settings for all
using (business_id in (select public.current_business_ids()) or public.is_platform_admin())
with check (business_id in (select public.current_business_ids()) or public.is_platform_admin());

create table if not exists public.platform_settings (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;

drop policy if exists "platform admins manage platform settings" on public.platform_settings;
create policy "platform admins manage platform settings"
on public.platform_settings for all
using (public.is_platform_admin())
with check (public.is_platform_admin());

insert into public.platform_settings (key, value)
values ('session_timeout_minutes', '30')
on conflict (key) do nothing;

create or replace function public.get_session_timeout_minutes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    configured_value text;
    timeout_minutes integer;
begin
    select value
      into configured_value
      from public.platform_settings
     where key = 'session_timeout_minutes';

    timeout_minutes := coalesce(nullif(configured_value, '')::integer, 30);

    if timeout_minutes < 5 then
        return 5;
    end if;

    if timeout_minutes > 720 then
        return 720;
    end if;

    return timeout_minutes;
exception when others then
    return 30;
end;
$$;

create or replace function public.set_session_timeout_minutes(p_minutes integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    normalized_minutes integer := greatest(5, least(720, coalesce(p_minutes, 30)));
begin
    if not public.is_platform_admin() then
        raise exception 'Only platform admins can update session timeout.';
    end if;

    insert into public.platform_settings (key, value, updated_at)
    values ('session_timeout_minutes', normalized_minutes::text, now())
    on conflict (key) do update
       set value = excluded.value,
           updated_at = now();
end;
$$;

create or replace function public.force_end_login_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_platform_admin() then
        raise exception 'Only platform admins can end user sessions.';
    end if;

    update public.user_login_sessions
       set is_active = false,
           signed_out_at = now(),
           updated_at = now()
     where id = p_session_id
       and is_active = true;
end;
$$;

grant execute on function public.get_session_timeout_minutes() to authenticated;
grant execute on function public.set_session_timeout_minutes(integer) to authenticated;
grant execute on function public.force_end_login_session(uuid) to authenticated;

notify pgrst, 'reload schema';
