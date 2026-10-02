-- TEST FIXTURE (web/scripts/db, never applied anywhere else): the hardening M2.1 applies to every
-- table and RPC, in miniature, plus a few functions that exercise request() and rpc().

create table public.locked (id int primary key, note text not null);
insert into public.locked values (1, 'fake row, hidden from anon'), (2, 'another fake row');
alter table public.locked enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- A whitelisted RPC: SECURITY DEFINER with a pinned search_path, EXECUTE for anon only. (The default
-- grants give authenticated and service_role EXECUTE too, so revoke from them as well.)
create function public.locked_count() returns int
language sql security definer set search_path = ''
as $$ select count(*)::int from public.locked $$;
revoke execute on function public.locked_count() from public, anon, authenticated;
grant execute on function public.locked_count() to anon;

-- Not whitelisted: PUBLIC and anon cannot run it, authenticated can.
create function public.members_only() returns text
language sql security definer set search_path = ''
as $$ select 'members'::text $$;
revoke execute on function public.members_only() from public, anon;
grant execute on function public.members_only() to authenticated;

-- Reports what the database sees of the request (role, claims, headers, role settings).
create function public.whoami() returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'current_user', current_user,
    'session_user', session_user,
    'auth_role', auth.role(),
    'auth_uid', auth.uid(),
    'claims', coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb,
    'headers', coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb,
    'method', current_setting('request.method', true),
    'statement_timeout', current_setting('statement_timeout'),
    'search_path', current_setting('search_path')
  )
$$;

-- Argument handling: text, array and jsonb parameters, with defaults.
create function public.echo_args(p_text text, p_list text[] default array['default'], p_doc jsonb default '{}'::jsonb)
returns jsonb
language sql immutable
as $$ select jsonb_build_object('text', p_text, 'list', to_jsonb(p_list), 'doc', p_doc) $$;

-- Return shapes: a table, a scalar, and void.
create function public.squares(n int) returns table (i int, sq int)
language sql immutable
as $$ select g, g * g from generate_series(1, n) as g $$;

create function public.do_nothing() returns void
language sql
as $$ select 1 $$;

-- Writes, then fails: the whole request must roll back.
create table public.audit (note text);
revoke all on table public.audit from anon, authenticated;
create function public.write_then_fail() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit values ('written before the error');
  raise exception 'boom' using errcode = 'P0001';
end
$$;
revoke execute on function public.write_then_fail() from public, anon, authenticated;
grant execute on function public.write_then_fail() to anon;

create function public.write_ok() returns void
language sql security definer set search_path = ''
as $$ insert into public.audit values ('written and committed') $$;
revoke execute on function public.write_ok() from public, anon, authenticated;
grant execute on function public.write_ok() to anon;

-- Takes longer than anon's 3 s statement_timeout.
create function public.sleepy() returns void
language sql security definer set search_path = ''
as $$ select pg_catalog.pg_sleep(6) $$;
revoke execute on function public.sleepy() from public, anon, authenticated;
grant execute on function public.sleepy() to anon, authenticated;
