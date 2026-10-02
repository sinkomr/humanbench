-- TEST FIXTURE (web/scripts/db, never applied anywhere else): a migration that forgets every
-- hardening step. On Supabase the default grants make this table readable by anyone with the
-- anon key; the local database must reproduce that (supabase/local/database/20-privileges.sql).
create table public.leaky (id int primary key, note text not null);
insert into public.leaky values (1, 'fake row, visible to anon');

create function public.leaky_count() returns int
language sql security definer set search_path = ''
as $$ select count(*)::int from public.leaky $$;
