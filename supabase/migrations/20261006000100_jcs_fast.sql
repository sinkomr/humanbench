-- M2.3 (ROADMAP M2.3; DESIGN §11.2, R-11.1; ROADMAP A16): hb.jcs, RFC 8785 canonical JSON, made fast. Performance fix.
--
-- Found on the CI runner (ubuntu, 4 vCPU): the worst-case saves of the work budget (12,000 objects with a member, 12,000
-- arrays in arrays, 11,000 numbers of 17 digits, 60,000 to 100,000 units, signing.db.test.ts "the work one call can
-- cause is bounded") ran into the 3 s anon statement timeout (57014). They finished, with little margin, on a laptop.
-- The cost was a PL/pgSQL call per array and object (a sub-select, a string_agg and a regex per node, 4 to 7 us on a
-- laptop, three times that on the runner) and a PL/pgSQL call per number that is not a plain one.
--
-- What changed (the output did not: every byte is the same, the tests hold it to src/save/jcs.ts and to the RFC):
--
--   1. One walk, one sort, one string_agg, in place of a function call and a concatenation per node. A recursive
--      query lists the nodes of the value in one pass: a container's children are ranked (RFC 8785 key order) in
--      one sub-select per container, each node carries the path of ranks from the root, and the text is the tokens
--      (an opening bracket, a scalar, a closing bracket at the path of the container followed by the largest rank)
--      aggregated in the order of that path. No node costs a call of hb.jcs.
--   2. A number that is not a plain one (hb.jcs's c_plain) no longer costs a call of hb.jcs_number when it is a
--      decimal that float8 prints without an exponent: the digits PostgreSQL prints for the double are the shortest
--      that read back as it, and without an exponent they are laid out as ECMAScript lays them out (float8 prints
--      an exponent below 1e-4 and from 1e15; ECMAScript from 1e-7 and 1e21, so that every number it prints plainly
--      is printed plainly by ECMAScript too, with the same digits). That is a 16 or 17 digit decimal, such as 0.1 + 0.2.
--      hb.jcs_number stays for the rest: an exponent, and the intervals' edges of 1e16 and over (see there).
--
--   3. verify_save called hb.session_verdict THREE times per session. The verdict was a column of a sub-select that
--      the outer select reads three times (status, reason, and the case for each); the planner may pull a sub-select
--      up and evaluate a STABLE function in it once per reference, and does. `offset 0` keeps the sub-select as it
--      is, so each session is canonicalised and signed once: a third of the work, with the output unchanged.
--
-- hb.jcs keeps its signature, its owner (hb_definer), its search_path = '' and its grants (create or replace); it is
-- not a SECURITY DEFINER function. It gains `set extra_float_digits = 1`, because the digits of a double come from
-- float8's text form, which is the shortest form only for a positive setting (hb.jcs_number pins it for the same
-- reason). verify_save is re-created as it was (same owner, same grants, same SECURITY DEFINER and search_path) with
-- the one change of 3. Nothing else is touched: no rate-limit rule, no limit (those are hb.json_work, hb.check_save_work).

set local role hb_definer;

create or replace function hb.jcs(p_json jsonb, p_depth int default 0)
returns text
language plpgsql immutable
set search_path = ''
set extra_float_digits = 1
as $$
declare
  c_plain constant text := '^-?(?:[0-9]{1,15}|(?=[0-9.]{3,16}$)[1-9][0-9]*\.[0-9]*[1-9]|(?=[0-9.]{3,17}$)0\.(?!0{6})[0-9]*[1-9])$';
  c_astral constant text := '[\U00010000-\U0010FFFF]';
  c_flat constant text := '^-?[0-9]+(?:\.[0-9]+)?$';
  v_type text := pg_catalog.jsonb_typeof(p_json);
  v_out text;
  v_too_deep boolean;
begin
  if v_type not in ('object', 'array') then
    return case v_type
      when 'number' then case when p_json::text ~ c_plain then p_json::text else hb.jcs_number((p_json #>> '{}')::numeric) end
      else p_json::text
    end;
  end if;
  if p_depth > 24 then
    perform hb.fail(400, 'too_deep');
  end if;
  -- Keys are sorted by UTF-16 code units. When no key of the object has a character beyond U+FFFF that is the order of
  -- code points, which is the byte order of UTF-8, i.e. COLLATE "C" (whatever the database's collation is); an object
  -- with such a key takes the slow way, hb.utf16_units.
  -- Nesting beyond 24 levels raises (400 too_deep): a container at depth 25 is listed but not opened.
  with recursive t (rp, d, pt, r, k, v, typ) as (
    select '{}'::int[], p_depth, null::text, 0, null::text, p_json, v_type
    union all
    select t.rp || c.rank, t.d + 1, t.typ, c.rank, c.key, c.value, pg_catalog.jsonb_typeof(c.value)
      from t
     cross join lateral (
       select s.key, s.value,
              (pg_catalog.row_number() over (
                 order by (case when s.astral then null else s.key end) collate "C", (case when s.astral then hb.utf16_units(s.key) end), s.ord))::int as rank
         from (
           select e.key, e.value, 0::bigint as ord, pg_catalog.bool_or(e.key ~ c_astral) over () as astral
             from pg_catalog.jsonb_each(case when t.typ = 'object' then t.v else '{}'::jsonb end) e
           union all
           select null::text, a.value, a.ord, false
             from pg_catalog.jsonb_array_elements(case when t.typ = 'array' then t.v else '[]'::jsonb end) with ordinality a (value, ord)
         ) s
     ) c
     where t.typ in ('object', 'array') and t.d <= 24
  ),
  tok (rp, s) as (
    select t.rp,
           (case when t.r > 1 then ',' else '' end)
           || (case when t.pt = 'object' then pg_catalog.to_jsonb(t.k)::text || ':' else '' end)
           || (case t.typ
                 when 'object' then '{'
                 when 'array' then '['
                 when 'number' then
                   case when t.v::text ~ c_plain then t.v::text
                   else (select case when f.x = 0 then '0'
                                     when f.x::text ~ c_flat then f.x::text
                                     else hb.jcs_number((t.v #>> '{}')::numeric) end
                           from (select (t.v #>> '{}')::numeric::double precision as x) f)
                   end
                 else t.v::text
               end)
      from t
    union all
    select t.rp || 2147483647, case t.typ when 'object' then '}' else ']' end
      from t
     where t.typ in ('object', 'array')
  )
  select (select pg_catalog.string_agg(tok.s, '' order by tok.rp) from tok),
         exists (select 1 from t where t.d > 24 and t.typ in ('object', 'array'))
    into v_out, v_too_deep;
  if v_too_deep then
    perform hb.fail(400, 'too_deep');
  end if;
  return v_out;
end
$$;

reset role;

-- verify_save as in 20261003000100_save_signing.sql, with `offset 0` in the sub-select that holds the verdict.
grant create on schema public to hb_definer;
set local role hb_definer;

create or replace function public.verify_save(p_save jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_anon text;
  v_rows jsonb;
begin
  v_anon := hb.check_save(p_save);
  if pg_catalog.jsonb_array_length(p_save -> 'sessions') > hb.cfg_int('verify.max_sessions', 200) then
    perform hb.fail(413, 'too_many_sessions', 'At most ' || hb.cfg_int('verify.max_sessions', 200) || ' sessions per call.');
  end if;
  -- Before the count, so that no call runs for long enough to be cancelled (a cancelled call rolls its count back)
  perform hb.check_save_work(p_save);
  perform hb.rate_hit('verify_save', hb.ip_key('verify_save'), hb.cfg_int('rate.verifies_per_day', 60));

  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'session_id', case when (e.value ->> 'session_id') ~ '^s_[0-9A-Za-z]{8,32}$' then e.value ->> 'session_id' end,
             'status', case when e.verdict = 'verified' then 'verified' else 'unverified' end,
             'reason', case when e.verdict = 'verified' then null else e.verdict end)
           order by e.ord), '[]'::jsonb)
    into v_rows
    from (
      select x.value, x.ord, hb.session_verdict(x.value) as verdict
        from pg_catalog.jsonb_array_elements(p_save -> 'sessions') with ordinality x (value, ord)
      offset 0) e; -- offset 0: the verdict is computed once per session, not once per reference

  return pg_catalog.jsonb_build_object(
    'anon_id', v_anon,
    'sessions', v_rows,
    'n_verified', (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_rows) r where r ->> 'status' = 'verified'),
    'n_unverified', (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_rows) r where r ->> 'status' = 'unverified'));
end
$$;

reset role;
revoke create on schema public from hb_definer;
