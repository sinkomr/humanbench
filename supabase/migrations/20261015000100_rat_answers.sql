-- M3.11 (ROADMAP M3.11, M6.3; DESIGN §3 row 17, §5.4, §11.2, R-11.1; owner decisions 2026-10-13: "the remaining
-- families", "i don't want to use a model for any scoring"): a typed word of a word-links puzzle (Remote
-- Associates, item_type 'rat_triad') is scored on the server against the puzzle's accept list.
--
-- Before this, hb.score_response knew `index`, `letter` and `value` keys only, so a triad was stored and served but
-- its answer was recorded with no verdict, and hb.response_fits let any response in.
--
-- THE KEY is the bank's `{answer, accept}` (hb.rat.record): the solution and every accepted spelling, the solution
-- first. It stays in item_keys and is read only here.
--
-- THE RULE is the bank's hb.rat.answers and the app's web/src/tasks/rat/answers.ts, the same one (their shared
-- golden vectors, golden/m6_scoring_v1.json, hold this function too: web/scripts/db/families.db.test.ts):
--   * hb.rat_answer_key(text): Unicode NFKD, then only the ASCII letters A to Z and a to z kept, in lower case.
--     Case, accents, full-width letters, ligatures, spaces, hyphens, apostrophes, digits and punctuation never
--     matter (the app drops the combining marks before it lowers the case; after NFKD the only characters that
--     lower to a to z are A to Z, so the order does not change the result);
--   * an answer is right when its key is not empty and equals the key of one accepted form. Nothing else is
--     forgiven: a plural, a misspelling or a longer compound is another word, and a spelling variant counts only
--     because the accept list names it. No fuzzy match and no model (owner decision 2026-10-13).
--
-- THE ANSWER SPACE (hb.response_fits, the rule of 20261001000500_private_functions.sql: what anybody could give as
-- an answer without knowing the key): a string of 1 to 40 characters once trimmed that has at least one letter
-- a to z after the folding. An empty answer, one of digits or punctuation only, or a number is known to be wrong
-- by anybody and so counts as no answer for rescore() and the session's score, like an index of -1.
--
-- Nothing is added to any reply: the verdict stays in responses.correct, as for every key (R-11.1).

set local role hb_definer;

-- The letters a-z of a text, folded as the header says; '' when there is none, null for null.
create function hb.rat_answer_key(p_text text)
returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.normalize(p_text, 'NFKD'), '[^A-Za-z]', '', 'g'))
$$;

-- Is the response inside the answer space of the item (see 20261001000500_private_functions.sql for the rule)?
-- As before, with the word-links answer: {answer, accept} keys (the header).
create or replace function hb.response_fits(p_key jsonb, p_n_options int, p_response jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  v_idx numeric;
  v_type text := pg_catalog.jsonb_typeof(p_response);
  v_parsed record;
  v_text text;
begin
  if p_key is null then
    return true;
  end if;
  if p_key ? 'index' then
    if v_type is distinct from 'number' then
      return false;
    end if;
    v_idx := (p_response #>> '{}')::numeric;
    return v_idx = pg_catalog.trunc(v_idx) and v_idx >= 0 and (coalesce(p_n_options, 0) = 0 or v_idx < p_n_options);
  elsif p_key ? 'letter' then
    return v_type is not distinct from 'string' and pg_catalog.btrim(p_response #>> '{}') ~ '^[A-Za-z]$';
  elsif p_key ? 'value' then
    if v_type is null or v_type not in ('string', 'number') then
      return false;
    end if;
    select * into v_parsed from hb.parse_entry(p_response #>> '{}');
    return v_parsed.o_num is not null;
  elsif p_key ? 'accept' then
    if v_type is distinct from 'string' then
      return false;
    end if;
    v_text := pg_catalog.btrim(p_response #>> '{}', E' \t\n\r\f\u000b ');
    return pg_catalog.char_length(v_text) between 1 and 40 and hb.rat_answer_key(v_text) <> '';
  end if;
  return true;
end
$$;

-- Scores one response against the item's key (see 20261001000500_private_functions.sql), with the word-links
-- branch: correct when the folded answer is one of the folded accepted forms.
create or replace function hb.score_response(p_item_id text, p_response jsonb, out o_correct smallint, out o_score real)
language plpgsql stable
set search_path = ''
as $$
declare
  k record;
  v_idx numeric;
  v_valid boolean := false;
  v_text text;
  v_ok boolean;
  v_accept jsonb;
begin
  o_correct := null;
  o_score := null;
  select ik.key, ik.tolerance, ik.option_weights,
         pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end) as n_opt
    into k
    from public.item_keys ik join public.items i on i.item_id = ik.item_id
   where ik.item_id = p_item_id;
  if not found then
    return;
  end if;

  if k.key ? 'index' then
    v_valid := hb.response_fits(k.key, k.n_opt, p_response);
    if v_valid then
      v_idx := (p_response #>> '{}')::numeric;
    end if;
    v_ok := v_valid and v_idx = (k.key ->> 'index')::numeric;
    o_correct := case when v_ok then 1 else 0 end;
    if pg_catalog.jsonb_typeof(k.option_weights) = 'array' then
      o_score := case when v_valid and v_idx < pg_catalog.jsonb_array_length(k.option_weights)
                      then (k.option_weights ->> v_idx::int)::real else 0 end;
    else
      o_score := o_correct::real;
    end if;
  elsif k.key ? 'letter' then
    v_ok := pg_catalog.jsonb_typeof(p_response) = 'string'
            and pg_catalog.upper(pg_catalog.btrim(p_response #>> '{}')) = pg_catalog.upper(k.key ->> 'letter');
    o_correct := case when v_ok then 1 else 0 end;
    o_score := o_correct::real;
  elsif k.key ? 'value' then
    v_text := case when pg_catalog.jsonb_typeof(p_response) in ('string', 'number') then p_response #>> '{}' end;
    v_ok := coalesce(hb.numeric_correct(v_text, k.key, k.tolerance), false);
    o_correct := case when v_ok then 1 else 0 end;
    o_score := o_correct::real;
  elsif k.key ? 'accept' then
    -- the accept list, or the answer alone when a key has no list
    v_accept := case when pg_catalog.jsonb_typeof(k.key -> 'accept') = 'array' then k.key -> 'accept'
                     else pg_catalog.jsonb_build_array(k.key -> 'answer') end;
    v_ok := hb.response_fits(k.key, k.n_opt, p_response)
            and exists (select 1 from pg_catalog.jsonb_array_elements(v_accept) a
                         where pg_catalog.jsonb_typeof(a) = 'string'
                           and hb.rat_answer_key(a #>> '{}') = hb.rat_answer_key(pg_catalog.btrim(p_response #>> '{}', E' \t\n\r\f\u000b ')));
    o_correct := case when coalesce(v_ok, false) then 1 else 0 end;
    o_score := o_correct::real;
  end if;
end
$$;

reset role;

revoke all on function hb.rat_answer_key(text) from public, anon, authenticated, service_role;
