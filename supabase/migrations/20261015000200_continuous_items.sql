-- M3.11 (ROADMAP M3.11, M5.1, M6.1, M6.2; DESIGN §3 rows 11, 12 and 16, §5.2, §5.3, §7.1, §7.4, §11.2, R-11.1; owner
-- decisions 2026-10-13: "work on the fermi estimation scoring ... the remaining families", "i don't want to use a model
-- for any scoring"): the two kinds of item whose answer is not right or wrong are selected, served and scored.
--
--   FERMI ESTIMATES (item_type 'fermi_estimate', axis FER, model 'gaussian'). The key is the bank's FermiTruth
--     {true_value (decimal text), unit, as_of_date, true_value_uncertainty_log10}; the parameter row is
--     fermi_params(δ), {lam, d, sigma} in item_parameters.extra (a and b are null). A response is
--     {value, unit, low, high}: a best guess and its 80% interval, all in one unit of the item's dimension.
--     The score (DESIGN §3 row 11, §7.1) is x = −|log10(estimate / truth)| after converting the guess to the
--     truth's unit in log space (hb.fermi_unit: the units table of web/src/tasks/fermi/units.ts and the bank's
--     hb.fermi.units, fermi-units-v1, copied exactly). It enters θ_FER as a Gaussian observation
--     x ~ N(lam·θ + d, σ²) with σ = √(SE² + sigma²), SE = 0.35·√(max(0, k² − 1)), k = 1/√w, w = 1 up to
--     0.15 dex of truth uncertainty and (0.15/u)² up to 0.3 (the bank's fermi_se and gaussian_observation_sigma,
--     web/src/tasks/fermi/scoring.ts fermiObservation; the uncertainty u is read from the key, never sent).
--     The interval's hit is computed with the score (hb.fermi_eval) and is not stored apart: whether 80% interval
--     hits enter θ_CAL is left to the M4.8 calibration, as DESIGN §3 row 12 and §7.1 put it ("interval hit rate"
--     beside the Brier score) and as tasks/fermi/scoring.ts records; the session's calibration axis is still the
--     confidence ratings' alone. The hit can be recomputed from the stored response and the key at any time.
--   SITUATIONAL JUDGMENT (item_type 'sjt_rating', axis EMO, model 'grm'). The key is the bank's profile
--     {ratings: four numbers in [1, 4], best, worst, source} (hb.sjt.record); the parameter row is a GRM with a
--     and extra.thresholds (three, the bank's b − 1, b, b + 1 prior until M4). A response is four whole ratings
--     1 to 4 in display order. The score (DESIGN §5.3, §14.6 ex. 15; hb.sjt.scoring.rating_score, the app's
--     tasks/sjt/scoring.ts ratingScore) is 1 − Σ|u_i − k_i| / 12, and the GRM category is how many of the edges
--     0.625, 0.75, 0.875 it reaches (hb.sjt.scoring.score_category). The key is what the bank's records carry:
--     the panel's profile w^AI, or the author's provisional one; there is no expert or population key yet
--     (§5.2's blend is λ = 0 for every item), so the score is closeness to that profile and nothing else. No
--     model runs at scoring time.
--
-- WHAT CHANGES, function by function. Every dichotomous item is selected and scored exactly as before (the
-- tests hold the 2PL/3PL numbers of each function to the earlier ones).
--   hb.response_fits     + {true_value}: a Fermi response of the shape above whose unit is of the item's dimension
--                          (the dimension is public: it is in the payload's media); + {ratings}: four whole ratings.
--   hb.score_response    + the two branches. responses.correct stays null for both (no answer is right or wrong);
--                          responses.score holds x or the rating score.
--   hb.response_obs      NEW: the observation of one stored answer in the scoring core's wire schema
--                          (20261002000100_scoring_core.sql), or null when it counts for nothing: the one place that
--                          says which answers count. 2PL/3PL as hb.session_obs had it; Gaussian and GRM as above.
--   hb.eap_add_response  the session's grid EAP takes Gaussian and GRM answers too (the selector's posterior and the
--                          per-axis stop of §7.4 see them).
--   hb.session_obs       the MAP at finish takes them too (hb.map_theta has had Gaussian and GRM terms since M2.2).
--   hb.candidate_items   re-created with one more column, o_extra (the parameter row's extra): a live item whose row
--                          is Gaussian (lam, d, sigma > 0) with a Fermi key, or GRM (a > 0, increasing thresholds)
--                          with a rating key, is a candidate; pretest slots still take dichotomous items only. The
--                          per-axis stop (posterior sd < selection.stop_sd) does not apply to a Gaussian item: with the
--                          provisional fermi-v0 norms (lam 0.2 dex per SD) a few answers 1.5 dex off put the grid
--                          posterior at its edge (θ = −4), whose sd the grid makes small, and the part would end before
--                          its minimum of answers; the client's part decides when Fermi questions end.
--   hb.rank_live         the information of a Gaussian item is (lam/sigma)², of a GRM item its expected Fisher
--                          information at the aim; an item with no difficulty b passes the start-up's window (it has
--                          no difficulty to aim); and on the axes of selection.balance_item_type_axes (EMO) the
--                          content balancing of §7.4 also alternates the item types, so a part of emotion vignettes
--                          and situational judgments shows both and not only the quicker kind.
--   public.rescore       counts Gaussian and GRM answers toward the axis (rescore.min_axis_items) and adds their
--                          terms to the grid EAP; the practice-gain shift of §7.8 moves each as it moves a 2PL item
--                          (θ + ρ in place of θ: d + lam·ρ, thresholds − ρ).
--
-- WHAT A REPLY TELLS: nothing new. No truth value, unit of the truth, uncertainty, rating profile, parameter or
-- verdict is in any reply (R-11.1); responses.score is never returned (the save's session object has no score).

insert into public.app_config (key, value, description) values
  ('selection.balance_item_type_axes', '["EMO"]', 'DESIGN §7.4 content balancing: on these axes the selector also alternates item types (an axis of vignettes and situational judgments shows both); elsewhere it balances generator families only');

set local role hb_definer;

-- -------------------------------------------------------------------------------------------- Fermi
-- One unit of fermi-units-v1: its dimension and its size in the dimension's base unit; nulls for anything else.
create function hb.fermi_unit(p_symbol text, out o_dimension text, out o_factor double precision)
language sql immutable parallel safe
set search_path = ''
as $$
  select u.dimension, u.factor
    from (values
      ('ms', 'time', 0.001::double precision), ('s', 'time', 1), ('min', 'time', 60), ('h', 'time', 3600), ('day', 'time', 86400),
      ('week', 'time', 604800), ('year', 'time', 31557600),
      ('mm', 'length', 0.001), ('cm', 'length', 0.01), ('m', 'length', 1), ('km', 'length', 1000), ('in', 'length', 0.0254),
      ('ft', 'length', 0.3048), ('yd', 'length', 0.9144), ('mi', 'length', 1609.344),
      ('mg', 'mass', 1e-06), ('g', 'mass', 0.001), ('kg', 'mass', 1), ('t', 'mass', 1000), ('oz', 'mass', 0.028349523125),
      ('lb', 'mass', 0.45359237),
      ('cm2', 'area', 0.0001), ('m2', 'area', 1), ('ha', 'area', 10000), ('km2', 'area', 1000000), ('ft2', 'area', 0.09290304),
      ('acre', 'area', 4046.8564224), ('mi2', 'area', 2589988.110336),
      ('mL', 'volume', 1e-06), ('L', 'volume', 0.001), ('m3', 'volume', 1), ('km3', 'volume', 1000000000), ('gal', 'volume', 0.003785411784),
      ('m/s', 'speed', 1), ('km/h', 'speed', 0.2777777777777778), ('mph', 'speed', 0.44704),
      ('J', 'energy', 1), ('kJ', 'energy', 1000), ('kcal', 'energy', 4184), ('kWh', 'energy', 3600000), ('GJ', 'energy', 1000000000),
      ('W', 'power', 1), ('kW', 'power', 1000), ('MW', 'power', 1000000), ('GW', 'power', 1000000000), ('TW', 'power', 1000000000000),
      ('count', 'count', 1), ('thousand', 'count', 1000), ('million', 'count', 1000000), ('billion', 'count', 1000000000),
      ('trillion', 'count', 1000000000000), ('quadrillion', 'count', 1000000000000000),
      ('usd', 'usd', 1), ('kusd', 'usd', 1000), ('musd', 'usd', 1000000), ('busd', 'usd', 1000000000), ('tusd', 'usd', 1000000000000),
      ('B', 'data', 1), ('kB', 'data', 1000), ('MB', 'data', 1000000), ('GB', 'data', 1000000000), ('TB', 'data', 1000000000000),
      ('PB', 'data', 1000000000000000),
      ('frac', 'fraction', 1), ('pct', 'fraction', 0.01), ('ppm', 'fraction', 1e-06)
    ) as u (symbol, dimension, factor)
   where u.symbol = p_symbol
$$;

-- A typed magnitude of a Fermi response: a JSON number in [1e-30, 1e30] as a double; null for anything else. The
-- bounds are checked on the exact numeric first, so no JSON number can overflow the cast.
create function hb.fermi_magnitude(p_v jsonb)
returns double precision
language sql immutable parallel safe
set search_path = ''
as $$
  select case when pg_catalog.jsonb_typeof(p_v) = 'number'
               and (p_v #>> '{}')::numeric >= 1e-30::numeric and (p_v #>> '{}')::numeric <= 1e30::numeric
              then (p_v #>> '{}')::double precision end
$$;

-- A Fermi answer scored against its truth (web/src/tasks/fermi/scoring.ts parseFermiResponse and scoreFermi, the
-- bank's hb.fermi.scoring; the operations in the same order). o_valid false: the response is not one the app's
-- parser accepts, or its unit is of another dimension, or the key is not a valid truth; every other output is then
-- null. o_x = −|e|, o_hit the 80% interval contains the truth (ends included, 1e-9 dex), o_weight the truth's
-- weight, o_u its uncertainty in dex, o_interval_score the Gneiting-Raftery score in dex.
create function hb.fermi_eval(p_key jsonb, p_response jsonb,
  out o_valid boolean, out o_x double precision, out o_hit boolean, out o_weight double precision, out o_u double precision,
  out o_error double precision, out o_interval_score double precision)
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_value double precision;
  v_low double precision;
  v_high double precision;
  v_ru record;
  v_tu record;
  v_true double precision;
  v_t double precision;
  v_est double precision;
  v_lo double precision;
  v_hi double precision;
  v_low_err double precision;
  v_high_err double precision;
  v_width double precision;
begin
  o_valid := false;
  -- the response: exactly {value, unit, low, high}
  if pg_catalog.jsonb_typeof(p_response) is distinct from 'object'
     or (select pg_catalog.string_agg(k, ',' order by k collate "C") from pg_catalog.jsonb_object_keys(p_response) k) is distinct from 'high,low,unit,value' then
    return;
  end if;
  v_value := hb.fermi_magnitude(p_response -> 'value');
  v_low := hb.fermi_magnitude(p_response -> 'low');
  v_high := hb.fermi_magnitude(p_response -> 'high');
  if v_value is null or v_low is null or v_high is null or pg_catalog.jsonb_typeof(p_response -> 'unit') is distinct from 'string' then
    return;
  end if;
  select * into v_ru from hb.fermi_unit(p_response ->> 'unit');
  if v_ru.o_dimension is null then
    return;
  end if;
  if not (v_low <= v_value and v_value <= v_high) or pg_catalog.log(v_high) - pg_catalog.log(v_low) > 8 then
    return;
  end if;
  -- the truth: a positive decimal, a known unit of the same dimension, an uncertainty in [0, 0.3] dex
  if pg_catalog.jsonb_typeof(p_key) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_key -> 'true_value') is distinct from 'string'
     or (p_key ->> 'true_value') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]{1,3})?$'
     or pg_catalog.jsonb_typeof(p_key -> 'unit') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_key -> 'true_value_uncertainty_log10') is distinct from 'number' then
    return;
  end if;
  if (p_key ->> 'true_value')::numeric <= 0 or (p_key ->> 'true_value')::numeric > 1e300::numeric then
    return;
  end if;
  select * into v_tu from hb.fermi_unit(p_key ->> 'unit');
  o_u := (p_key ->> 'true_value_uncertainty_log10')::double precision;
  if v_tu.o_dimension is null or v_tu.o_dimension <> v_ru.o_dimension or not (o_u >= 0 and o_u <= 0.3) then
    o_u := null;
    return;
  end if;
  v_true := (p_key ->> 'true_value')::double precision;
  -- log10Between: log10(value) + log10(from.factor) - log10(to.factor)
  v_est := pg_catalog.log(v_value) + pg_catalog.log(v_ru.o_factor) - pg_catalog.log(v_tu.o_factor);
  v_lo := pg_catalog.log(v_low) + pg_catalog.log(v_ru.o_factor) - pg_catalog.log(v_tu.o_factor);
  v_hi := pg_catalog.log(v_high) + pg_catalog.log(v_ru.o_factor) - pg_catalog.log(v_tu.o_factor);
  v_t := pg_catalog.log(v_true);
  o_error := v_est - v_t;
  v_low_err := v_lo - v_t;
  v_high_err := v_hi - v_t;
  v_width := v_hi - v_lo;
  o_x := 0 - pg_catalog.abs(o_error);
  o_weight := case when o_u <= 0.15 then 1 else (0.15 / o_u) ^ 2 end;
  o_hit := v_low_err <= 1e-9 and v_high_err >= -1e-9;
  o_interval_score := v_width + (2 / 0.2::double precision) * greatest(0::double precision, v_low_err) + (2 / 0.2::double precision) * greatest(0::double precision, - v_high_err);
  o_valid := true;
end
$$;

-- --------------------------------------------------------------------------------- situational judgment
-- The rating score and its GRM category (the header; hb.sjt.scoring rating_score, score_category). Nulls unless the
-- response is four whole ratings 1 to 4 and the key's ratings four finite numbers in [1, 4].
create function hb.sjt_eval(p_key jsonb, p_response jsonb, out o_score double precision, out o_category int)
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_sum double precision := 0;
  v_u numeric;
  v_k double precision;
  v_n int;
begin
  o_score := null;
  o_category := null;
  if pg_catalog.jsonb_typeof(p_key -> 'ratings') is distinct from 'array' or pg_catalog.jsonb_typeof(p_response) is distinct from 'array' then
    return;
  end if;
  v_n := pg_catalog.jsonb_array_length(p_key -> 'ratings');
  if v_n <> 4 or pg_catalog.jsonb_array_length(p_response) <> v_n then
    return;
  end if;
  for i in 0..v_n - 1 loop
    if pg_catalog.jsonb_typeof(p_response -> i) is distinct from 'number' or pg_catalog.jsonb_typeof(p_key -> 'ratings' -> i) is distinct from 'number' then
      return;
    end if;
    v_u := (p_response ->> i)::numeric;
    if v_u <> pg_catalog.trunc(v_u) or v_u < 1 or v_u > 4 then
      return;
    end if;
    if (p_key -> 'ratings' ->> i)::numeric < 1 or (p_key -> 'ratings' ->> i)::numeric > 4 then
      return;
    end if;
    v_k := (p_key -> 'ratings' ->> i)::double precision;
    v_sum := v_sum + pg_catalog.abs(v_u::double precision - v_k);
  end loop;
  o_score := 1 - v_sum / (3 * 4)::double precision;
  o_category := (case when o_score >= 0.625 then 1 else 0 end) + (case when o_score >= 0.75 then 1 else 0 end) + (case when o_score >= 0.875 then 1 else 0 end);
end
$$;

-- --------------------------------------------------------------------------------- the answer space
-- As in 20261015000100_rat_answers.sql, with the Fermi and the rating answers (the header). Neither depends on a
-- key's value: a Fermi response is checked against the dimension of the truth's unit, which the payload states.
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
  v_value double precision;
  v_low double precision;
  v_high double precision;
  v_n int;
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
  elsif p_key ? 'true_value' then
    if v_type is distinct from 'object'
       or (select pg_catalog.string_agg(k, ',' order by k collate "C") from pg_catalog.jsonb_object_keys(p_response) k) is distinct from 'high,low,unit,value'
       or pg_catalog.jsonb_typeof(p_response -> 'unit') is distinct from 'string' then
      return false;
    end if;
    v_value := hb.fermi_magnitude(p_response -> 'value');
    v_low := hb.fermi_magnitude(p_response -> 'low');
    v_high := hb.fermi_magnitude(p_response -> 'high');
    return v_value is not null and v_low is not null and v_high is not null
       and v_low <= v_value and v_value <= v_high
       and pg_catalog.log(v_high) - pg_catalog.log(v_low) <= 8
       and (select u.o_dimension from hb.fermi_unit(p_response ->> 'unit') u) is not distinct from (select u.o_dimension from hb.fermi_unit(p_key ->> 'unit') u)
       and (select u.o_dimension from hb.fermi_unit(p_response ->> 'unit') u) is not null;
  elsif p_key ? 'ratings' then
    if v_type is distinct from 'array' then
      return false;
    end if;
    v_n := case when coalesce(p_n_options, 0) > 0 then p_n_options else 4 end;
    if pg_catalog.jsonb_array_length(p_response) <> v_n then
      return false;
    end if;
    return not exists (
      select 1 from pg_catalog.jsonb_array_elements(p_response) r
       where pg_catalog.jsonb_typeof(r) is distinct from 'number'
          or (r #>> '{}')::numeric <> pg_catalog.trunc((r #>> '{}')::numeric)
          or (r #>> '{}')::numeric < 1 or (r #>> '{}')::numeric > 4);
  end if;
  return true;
end
$$;

-- ------------------------------------------------------------------------------------- scoring an answer
-- As in 20261015000100_rat_answers.sql, with the Fermi and the rating branches: correct stays null, score is x or
-- the rating score (null for a response outside the answer space).
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
  v_f record;
  v_s record;
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
    v_accept := case when pg_catalog.jsonb_typeof(k.key -> 'accept') = 'array' then k.key -> 'accept'
                     else pg_catalog.jsonb_build_array(k.key -> 'answer') end;
    v_ok := hb.response_fits(k.key, k.n_opt, p_response)
            and exists (select 1 from pg_catalog.jsonb_array_elements(v_accept) a
                         where pg_catalog.jsonb_typeof(a) = 'string'
                           and hb.rat_answer_key(a #>> '{}') = hb.rat_answer_key(pg_catalog.btrim(p_response #>> '{}', E' \t\n\r\f\u000b ')));
    o_correct := case when coalesce(v_ok, false) then 1 else 0 end;
    o_score := o_correct::real;
  elsif k.key ? 'true_value' then
    select * into v_f from hb.fermi_eval(k.key, p_response);
    o_score := case when v_f.o_valid then v_f.o_x::real end;
  elsif k.key ? 'ratings' then
    select * into v_s from hb.sjt_eval(k.key, p_response);
    o_score := v_s.o_score::real;
  end if;
end
$$;

-- ------------------------------------------------------------------------------------ the parameter rows
-- A parameter row of a continuous model the server scores: Gaussian with numbers lam and d and sigma > 0 in extra,
-- or GRM with a > 0 and one to eight strictly increasing thresholds in extra.thresholds.
create function hb.continuous_params_ok(p_model text, p_a double precision, p_extra jsonb)
returns boolean
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_n int;
begin
  if p_model = 'gaussian' then
    return pg_catalog.jsonb_typeof(p_extra -> 'lam') = 'number' and pg_catalog.jsonb_typeof(p_extra -> 'd') = 'number'
       and pg_catalog.jsonb_typeof(p_extra -> 'sigma') = 'number' and (p_extra ->> 'sigma')::double precision > 0
       and (p_extra ->> 'lam')::double precision <> 0;
  elsif p_model = 'grm' then
    if p_a is null or not (p_a > 0) or pg_catalog.jsonb_typeof(p_extra -> 'thresholds') is distinct from 'array' then
      return false;
    end if;
    v_n := pg_catalog.jsonb_array_length(p_extra -> 'thresholds');
    if v_n < 1 or v_n > 8 then
      return false;
    end if;
    for i in 0..v_n - 1 loop
      if pg_catalog.jsonb_typeof(p_extra -> 'thresholds' -> i) is distinct from 'number' then
        return false;
      end if;
      if i > 0 and not ((p_extra -> 'thresholds' ->> i)::double precision > (p_extra -> 'thresholds' ->> (i - 1))::double precision) then
        return false;
      end if;
    end loop;
    return true;
  end if;
  return false;
end
$$;

-- The key a continuous model scores against: a Fermi truth for a Gaussian row, a rating profile for a GRM row.
create function hb.key_fits_model(p_model text, p_key jsonb)
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select case p_model
           when 'gaussian' then coalesce(p_key ? 'true_value', false)
           when 'grm' then coalesce(p_key ? 'ratings', false)
           else true
         end
$$;

-- ------------------------------------------------------------------------------- one answer's observation
-- The observation of one stored answer (the header), or null when no score counts it. p_n_options is the number of
-- the payload's options. Dichotomous answers: exactly the conditions and the objects of hb.session_obs before.
create function hb.response_obs(p_axis text, p_model text, p_a double precision, p_b double precision, p_c double precision,
  p_extra jsonb, p_key jsonb, p_n_options int, p_response jsonb, p_correct smallint)
returns jsonb
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_f record;
  v_s record;
  v_w double precision;
  v_k double precision;
  v_se double precision;
  v_sig double precision;
begin
  if p_model in ('2pl', '2pl_testlet', '3pl') then
    if p_correct is null or p_a is null or p_b is null then
      return null;
    end if;
    if p_model = '3pl' and (p_c is null or not (p_c > 0 and p_c < 1)) then
      return null;
    end if;
    if not hb.response_fits(p_key, p_n_options, p_response) then
      return null;
    end if;
    if p_model = '3pl' then
      return pg_catalog.jsonb_build_object('kind', '3pl', 'axis', p_axis, 'a', p_a, 'b', p_b, 'c', p_c, 'y', p_correct);
    end if;
    return pg_catalog.jsonb_build_object('kind', '2pl', 'axis', p_axis, 'a', p_a, 'b', p_b, 'y', p_correct);
  elsif p_model = 'gaussian' then
    if not hb.continuous_params_ok(p_model, p_a, p_extra) or not hb.key_fits_model(p_model, p_key) then
      return null;
    end if;
    select * into v_f from hb.fermi_eval(p_key, p_response);
    if not v_f.o_valid then
      return null;
    end if;
    -- fermiSe(u) and gaussianObservationSigma (tasks/fermi/scoring.ts), in that order
    v_w := v_f.o_weight;
    v_k := 1 / pg_catalog.sqrt(v_w);
    v_se := 0.35::double precision * pg_catalog.sqrt(greatest(0::double precision, v_k * v_k - 1));
    v_sig := (p_extra ->> 'sigma')::double precision;
    return pg_catalog.jsonb_build_object('kind', 'gaussian', 'axis', p_axis,
      'lam', (p_extra ->> 'lam')::double precision, 'd', (p_extra ->> 'd')::double precision,
      'sigma', pg_catalog.sqrt(v_se * v_se + v_sig * v_sig), 'x', v_f.o_x);
  elsif p_model = 'grm' then
    if not hb.continuous_params_ok(p_model, p_a, p_extra) or not hb.key_fits_model(p_model, p_key) then
      return null;
    end if;
    if pg_catalog.jsonb_array_length(p_extra -> 'thresholds') <> 3 then
      return null; -- the score has four categories (three edges)
    end if;
    select * into v_s from hb.sjt_eval(p_key, p_response);
    if v_s.o_score is null then
      return null;
    end if;
    return pg_catalog.jsonb_build_object('kind', 'grm', 'axis', p_axis, 'a', p_a, 'b', p_extra -> 'thresholds', 'y', v_s.o_category);
  end if;
  return null;
end
$$;

-- The log-likelihood of one observation (any kind of the scoring core) at the 61 grid points. A Gaussian and a GRM
-- observation are computed in one statement over the grid (the terms of hb.obs_terms kinds 4 and 3, written out: a
-- call of hb.obs_terms per grid point costs about 0.2 ms, which a save of forty sessions with situational judgments
-- would multiply past the anon role's 3 s); any other kind goes through hb.obs_terms.
create function hb.obs_grid_ll(p_obs jsonb)
returns double precision[]
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_set hb.obs_set := hb.parse_obs(pg_catalog.jsonb_build_array(p_obs));
  v_grid double precision[] := hb.eap_grid();
  v_out double precision[] := pg_catalog.array_fill(0::double precision, array[61]);
  v_a double precision;
  v_m int;
  v_y int;
  v_lo double precision;
  v_hi double precision;
  v_gap double precision;
begin
  if v_set.kind[1] = 4 then
    -- x ~ N(lam·θ + d, sigma²): -½ r² - ln sigma - ½ ln 2π
    -- (a residual below 1e-150 is 0: its square would underflow, an error in PostgreSQL)
    return (select pg_catalog.array_agg(-0.5 * (case when pg_catalog.abs(r.r) < 1e-150::double precision then 0 else r.r * r.r end)
                                        - pg_catalog.ln(v_set.pc[1]) - 0.5 * pg_catalog.ln(2 * pg_catalog.pi()) order by g.i)
              from pg_catalog.unnest(v_grid) with ordinality g (t, i)
             cross join lateral (select (v_set.py[1] - v_set.pa[1] * g.t - v_set.pb[1]) / v_set.pc[1] as r) r);
  elsif v_set.kind[1] = 3 then
    -- P(y) of the GRM with thresholds b_1 < … < b_m: log σ(-z_1) for y = 0, log σ(z_m) for y = m, and
    -- log σ(z_y) + log σ(-z_{y+1}) + ln(1 - e^{-a(b_{y+1} - b_y)}) between (z_j = a(θ - b_j))
    v_a := v_set.pa[1];
    v_m := v_set.len[1];
    v_y := v_set.py[1]::int;
    v_lo := case when v_y >= 1 then v_set.ext[v_set.off[1] + v_y] end;
    v_hi := case when v_y < v_m then v_set.ext[v_set.off[1] + v_y + 1] end;
    v_gap := case when v_y >= 1 and v_y < v_m then pg_catalog.ln(- hb.expm1(- v_a * (v_hi - v_lo))) else 0 end;
    return (select pg_catalog.array_agg(
                     (case when v_lo is null then 0::double precision
                           else (case when v_a * (g.t - v_lo) >= 0 then - pg_catalog.ln(1 + pg_catalog.exp(greatest(- v_a * (g.t - v_lo), -700::double precision)))
                                      else v_a * (g.t - v_lo) - pg_catalog.ln(1 + pg_catalog.exp(greatest(v_a * (g.t - v_lo), -700::double precision))) end) end)
                     + (case when v_hi is null then 0::double precision
                             else (case when - v_a * (g.t - v_hi) >= 0 then - pg_catalog.ln(1 + pg_catalog.exp(greatest(v_a * (g.t - v_hi), -700::double precision)))
                                        else - v_a * (g.t - v_hi) - pg_catalog.ln(1 + pg_catalog.exp(greatest(- v_a * (g.t - v_hi), -700::double precision))) end) end)
                     + v_gap order by g.i)
              from pg_catalog.unnest(v_grid) with ordinality g (t, i));
  end if;
  for g in 1..61 loop
    v_out[g] := (select o.o_ll from hb.obs_terms(v_set.kind[1], v_grid[g], v_set.pa[1], v_set.pb[1], v_set.pc[1], v_set.py[1], v_set.ext, v_set.off[1], v_set.len[1], 1) o);
  end loop;
  return v_out;
end
$$;

-- An observation as if θ were θ + ρ (the practice gain of DESIGN §7.8 that rescore() takes out): a 2PL/3PL's b − ρ
-- (as rescore does for them), a Gaussian's d + lam·ρ, a GRM's thresholds − ρ.
create function hb.obs_shift(p_obs jsonb, p_rho double precision)
returns jsonb
language sql immutable parallel safe
set search_path = ''
as $$
  select case p_obs ->> 'kind'
           when 'gaussian' then p_obs || pg_catalog.jsonb_build_object('d', (p_obs ->> 'd')::double precision + (p_obs ->> 'lam')::double precision * p_rho)
           when 'grm' then p_obs || pg_catalog.jsonb_build_object('b', (select pg_catalog.jsonb_agg((t #>> '{}')::double precision - p_rho order by n) from pg_catalog.jsonb_array_elements(p_obs -> 'b') with ordinality e (t, n)))
           when '2pl' then p_obs || pg_catalog.jsonb_build_object('b', (p_obs ->> 'b')::double precision - p_rho)
           when '3pl' then p_obs || pg_catalog.jsonb_build_object('b', (p_obs ->> 'b')::double precision - p_rho)
           else p_obs
         end
$$;

-- The expected Fisher information of a GRM item at θ (scoring core, obs_terms kind 3).
create function hb.grm_info(p_a double precision, p_thresholds jsonb, p_theta double precision)
returns double precision
language plpgsql immutable parallel safe
set search_path = ''
as $$
declare
  v_thr double precision[] := array(select (t #>> '{}')::double precision from pg_catalog.jsonb_array_elements(p_thresholds) with ordinality e (t, n) order by n);
begin
  return (select o.o_info from hb.obs_terms(3, p_theta, p_a, 0, 0, 0, v_thr, 0, pg_catalog.array_length(v_thr, 1), 3) o);
end
$$;

-- ------------------------------------------------------------------------------------ the session's EAP
-- As in 20261002000200_session_scoring.sql, through hb.response_obs: a Gaussian or GRM answer adds its terms too.
-- The 2PL/3PL terms are hb.grid_ll's, as before.
create or replace function hb.eap_add_response(p_s public.sessions, p_item_id text, p_response jsonb, p_correct smallint, p_pretest boolean)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v record;
  v_obs jsonb;
  v_new double precision[];
  v_old double precision[];
  v_n int := 0;
  v_state jsonb := coalesce(p_s.state, '{}'::jsonb);
begin
  if p_pretest then
    return p_s.state;
  end if;
  select f.axis, i.status, p.model, p.a, p.b, p.c, p.extra, ik.key,
         pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end) as n_opt
    into v
    from public.items i
    join public.item_families f on f.family_id = i.family_id
    join public.item_keys ik on ik.item_id = i.item_id
    join lateral (
      select ip.model, ip.a, ip.b, ip.c, ip.extra
        from public.item_parameters ip
       where ip.item_id = i.item_id and (p_s.param_version is null or ip.param_version = p_s.param_version)
       order by ip.created_at desc
       limit 1) p on true
   where i.item_id = p_item_id;
  if not found or v.status = 'quarantined' then
    return p_s.state;
  end if;
  v_obs := hb.response_obs(v.axis, v.model, v.a, v.b, v.c, v.extra, v.key, v.n_opt, p_response, p_correct);
  if v_obs is null then
    return p_s.state;
  end if;

  if v.model in ('2pl', '2pl_testlet', '3pl') then
    v_new := hb.grid_ll(case when v.model = '3pl' then 2 else 1 end, v.a, v.b, coalesce(v.c, 0.5), p_correct::double precision);
  else
    v_new := hb.obs_grid_ll(v_obs);
  end if;
  if pg_catalog.jsonb_typeof(v_state #> array['eap', v.axis, 'll']) = 'array' then
    v_old := array(select x::double precision from pg_catalog.jsonb_array_elements_text(v_state #> array['eap', v.axis, 'll']) x);
    v_n := coalesce((v_state #>> array['eap', v.axis, 'n'])::int, 0);
    for i in 1..61 loop
      v_new[i] := v_new[i] + v_old[i];
    end loop;
  end if;
  v_state := pg_catalog.jsonb_set(v_state, '{eap}', coalesce(v_state -> 'eap', '{}'::jsonb), true);
  return pg_catalog.jsonb_set(v_state, array['eap', v.axis], pg_catalog.jsonb_build_object('n', v_n + 1, 'll', pg_catalog.to_jsonb(v_new)), true);
end
$$;

-- The answers of a session that count, as observations, in the order they were given (hb.response_obs).
create or replace function hb.session_obs(p_session_id text)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(o.obs order by o.seq), '[]'::jsonb)
    from (
      select r.seq,
             hb.response_obs(f.axis, p.model, p.a, p.b, p.c, p.extra, ik.key,
               pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end),
               r.response, r.correct) as obs
        from public.sessions s
        join public.responses r on r.session_id = s.session_id
        join public.items i on i.item_id = r.item_id
        join public.item_families f on f.family_id = i.family_id
        join public.item_keys ik on ik.item_id = i.item_id
        join lateral (
          select ip.model, ip.a, ip.b, ip.c, ip.extra
            from public.item_parameters ip
           where ip.item_id = i.item_id and (s.param_version is null or ip.param_version = s.param_version)
           order by ip.created_at desc
           limit 1) p on true
       where s.session_id = p_session_id
         and not r.pretest
         and i.status <> 'quarantined'
    ) o
   where o.obs is not null
$$;

-- ----------------------------------------------------------------------------------------- candidates
-- hb.candidate_items as in 20261002000300_selection.sql, with the parameter row's extra as o_extra, and live items
-- of the two continuous models (the header). o_gkey is what the content balancing alternates: the generator family,
-- and on the axes of selection.balance_item_type_axes the item type too.
drop function hb.candidate_items(public.sessions, text[], text, text[]);

create function hb.candidate_items(p_s public.sessions, p_axes text[], p_status text, p_exclude text[])
returns table (
  o_item_id text, o_family_id text, o_sibling_group text, o_axis text, o_gkey text,
  o_model text, o_a double precision, o_b double precision, o_c double precision, o_se_b double precision,
  o_mean double precision, o_sd double precision, o_et double precision, o_n_sessions bigint, o_extra jsonb)
language plpgsql stable
set search_path = ''
as $$
declare
  v_state jsonb := coalesce(p_s.state, '{}'::jsonb);
  v_seen_items text[] := array(select x from pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(v_state -> 'seen_items') = 'array' then v_state -> 'seen_items' else '[]'::jsonb end) x);
  v_seen_fams text[] := array(select x from pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(v_state -> 'seen_families') = 'array' then v_state -> 'seen_families' else '[]'::jsonb end) x);
  v_limit double precision := hb.exposure_limit();
  v_stop double precision := hb.cfg_num('selection.stop_sd', 0.3);
  v_excl text[] := coalesce(p_exclude, '{}'::text[]);
  v_balance jsonb := case when pg_catalog.jsonb_typeof(hb.cfg('selection.balance_item_type_axes')) = 'array' then hb.cfg('selection.balance_item_type_axes') else '[]'::jsonb end;
begin
  return query
  with post as (
    select * from hb.session_posteriors(v_state)
  ),
  used as (
    select e.item_id, e.family_id, e.sibling_group from public.exposure_log e where e.session_id = p_s.session_id
  ),
  seen_item as (
    select x as item_id from pg_catalog.unnest(v_seen_items) x
    union
    select u.item_id from used u
  ),
  seen_fam as (
    select x as family_id from pg_catalog.unnest(v_seen_fams) x
    union
    select i.family_id from public.items i join seen_item si on si.item_id = i.item_id
    union
    select u.family_id from used u
  ),
  bad_group as (
    select f.sibling_group from public.item_families f join seen_fam sf on sf.family_id = f.family_id
    union
    select u.sibling_group from used u
  )
  select i.item_id, i.family_id, f.sibling_group, f.axis,
         coalesce(f.generator, '') || case when v_balance ? f.axis then '|' || i.item_type else '' end,
         p.model, p.a, p.b, p.c, p.se_b,
         po.mean, po.sd,
         coalesce(
           case when pg_catalog.jsonb_typeof(p.extra -> 'median_time_s') = 'number' and (p.extra ->> 'median_time_s')::double precision > 0
                then (p.extra ->> 'median_time_s')::double precision end,
           case when pg_catalog.jsonb_typeof(p.extra -> 'expected_time_s') = 'number' and (p.extra ->> 'expected_time_s')::double precision > 0
                then (p.extra ->> 'expected_time_s')::double precision end,
           hb.item_prior_time_s(i.payload)),
         coalesce(x.n_sessions, 0),
         p.extra
    from public.items i
    join public.item_families f on f.family_id = i.family_id
    join post po on po.axis = f.axis
    join lateral (
      select ip.model, ip.a, ip.b, ip.c, ip.se_b, ip.extra
        from public.item_parameters ip
       where ip.item_id = i.item_id and (p_s.param_version is null or ip.param_version = p_s.param_version)
       order by ip.created_at desc
       limit 1) p on true
    left join public.item_exposure x on x.item_id = i.item_id
   where i.status = p_status
     and not f.practice_only
     and (p_axes is null or f.axis = any (p_axes))
     -- the per-axis stop of §7.4, except for a Gaussian (Fermi) item: an answer a few dex off moves the 61-point grid's
     -- posterior to its edge, where the grid makes its sd small, and the stop would end the part before its minimum
     and (po.sd >= v_stop or p.model = 'gaussian')
     and (
       (p.model in ('2pl', '2pl_testlet', '3pl')
        and p.a is not null and p.b is not null
        and (p.model <> '3pl' or (p.c is not null and p.c > 0 and p.c < 1))
        and exists (select 1 from public.item_keys k where k.item_id = i.item_id))
       or
       -- the continuous models: live slots only (a pretest slot is for a difficulty b), with the key they score against
       (p_status = 'live'
        and p.model in ('gaussian', 'grm')
        and hb.continuous_params_ok(p.model, p.a, p.extra)
        and exists (select 1 from public.item_keys k where k.item_id = i.item_id and hb.key_fits_model(p.model, k.key)))
     )
     and coalesce(x.n_sessions, 0) + 1 <= v_limit
     and not (i.item_id = any (v_excl))
     and not exists (select 1 from seen_item si where si.item_id = i.item_id)
     and not exists (select 1 from seen_fam sf where sf.family_id = i.family_id)
     and not exists (select 1 from bad_group bg where bg.sibling_group = f.sibling_group);
end
$$;

-- hb.rank_live as in 20261014000100_startup_step.sql, with the information of the continuous models, the start-up
-- window open to an item with no b, and the item type in the balancing key on the axes of selection.balance_item_type_axes (the header). For dichotomous items on
-- the other axes it ranks exactly as before.
create or replace function hb.rank_live(p_s public.sessions, p_axes text[], p_exclude text[])
returns table (o_item_id text, o_family_id text, o_axis text, o_gkey text, o_score double precision, o_info double precision, o_rank int)
language plpgsql stable
set search_path = ''
as $$
declare
  v_floor int := hb.cfg_int('selection.coverage_floor', 3);
  v_top_k int := greatest(hb.cfg_int('selection.top_k', 5), 1);
  v_factor double precision := hb.cfg_num('selection.testlet_info_factor', 0.8);
  v_types text[] := hb.set_item_types();
  v_window double precision := greatest(hb.cfg_num('selection.startup_window', 0.5), 0::double precision);
  v_state jsonb := coalesce(p_s.state, '{}'::jsonb);
  v_seen_items text[] := array(select x from pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(v_state -> 'seen_items') = 'array' then v_state -> 'seen_items' else '[]'::jsonb end) x);
  v_balance jsonb := case when pg_catalog.jsonb_typeof(hb.cfg('selection.balance_item_type_axes')) = 'array' then hb.cfg('selection.balance_item_type_axes') else '[]'::jsonb end;
begin
  return query
  with cand as (
    select c.*, coalesce(am.aim, c.o_mean) as o_aim
      from hb.candidate_items(p_s, p_axes, 'live', p_exclude) c
      left join hb.session_aims(p_s.state) am on am.axis = c.o_axis
  ),
  scored as (
    select c.o_item_id as item_id, c.o_family_id as family_id, c.o_axis as axis, c.o_gkey as gkey, c.o_sd as sd, c.o_et as et, c.o_b as b,
           k.info, k.info * c.o_sd * c.o_sd / c.o_et as score,
           exists (select 1 from public.items it where it.item_id = c.o_item_id and it.item_type = any (v_types)) as in_set
      from cand c
     cross join lateral (
       select (case when c.o_model = 'gaussian' then ((c.o_extra ->> 'lam')::double precision / (c.o_extra ->> 'sigma')::double precision) ^ 2
                    when c.o_model = 'grm' then hb.grm_info(c.o_a, c.o_extra -> 'thresholds', c.o_aim)
                    when c.o_model = '3pl' then (case when w.s < 1e-100::double precision then 0::double precision
                                                       else (c.o_a * c.o_a * w.s * w.s * (1 - c.o_c) * w.q) / (c.o_c + (1 - c.o_c) * w.s) end)
                    else (case when c.o_model = '2pl_testlet' then v_factor else 1::double precision end) * (c.o_a * c.o_a * w.s * w.q) end) as info
         from (
           select case when z.v >= 0 then 1 / (1 + z.e) else z.e / (1 + z.e) end as s,
                  case when z.v >= 0 then z.e / (1 + z.e) else 1 / (1 + z.e) end as q
             from (select coalesce(c.o_a * (c.o_aim - c.o_b), 0) as v, pg_catalog.exp(- least(pg_catalog.abs(coalesce(c.o_a * (c.o_aim - c.o_b), 0)), 700::double precision)) as e) z) w) k
  ),
  set_unit as (
    select q.entry as item_id, g.family_id, g.axis, g.gkey, g.info, g.info * g.sd * g.sd / g.et as score, g.b
      from (
        select s.family_id, pg_catalog.min(s.axis) as axis, pg_catalog.min(s.gkey) as gkey, pg_catalog.min(s.sd) as sd,
               pg_catalog.sum(s.info) as info, pg_catalog.sum(s.et) as et, pg_catalog.count(*) as n, pg_catalog.avg(s.b) as b
          from scored s
         where s.in_set
         group by s.family_id) g
     cross join lateral (
       select pg_catalog.count(*) as n, pg_catalog.min(sq.o_item_id) filter (where sq.o_pos = 1) as entry
         from hb.set_questions(g.family_id, p_s.param_version) sq) q
     where g.n = q.n and q.entry is not null
  ),
  unit as (
    select s.item_id, s.family_id, s.axis, s.gkey, s.info, s.score, s.b, false as is_set from scored s where not s.in_set
    union all
    select u.item_id, u.family_id, u.axis, u.gkey, u.info, u.score, u.b, true from set_unit u
  ),
  dist as (
    select u.*, t.target, pg_catalog.abs(u.b - t.target) as d
      from unit u
      left join hb.startup_targets(p_s) t on t.axis = u.axis
  ),
  nearest as (
    select d.axis, pg_catalog.min(d.d) as m from dist d where d.target is not null group by d.axis
  ),
  aimed as (
    -- a unit with no difficulty (a Gaussian or GRM item) has nothing to aim: the window does not apply to it
    select d.item_id, d.family_id, d.axis, d.gkey, d.info, d.score, d.is_set
      from dist d
      left join nearest n on n.axis = d.axis
     where d.target is null or d.b is null or d.d <= greatest(v_window, n.m) + 1e-9::double precision
  ),
  dup_family as (
    select s.family_id from aimed s where not s.is_set group by s.family_id having pg_catalog.count(*) > 1
  ),
  best as (
    select s.item_id, s.family_id, s.axis, s.gkey, s.info, s.score
      from aimed s
     where not s.is_set and s.family_id not in (select d.family_id from dup_family d)
    union all
    (select distinct on (s.family_id) s.item_id, s.family_id, s.axis, s.gkey, s.info, s.score
       from aimed s
      where not s.is_set and s.family_id in (select d.family_id from dup_family d)
      order by s.family_id, s.score desc, s.item_id)
    union all
    select u.item_id, u.family_id, u.axis, u.gkey, u.info, u.score from aimed u where u.is_set
  ),
  given as (
    select f.axis, pg_catalog.count(*) as n
      from (
        select e.item_id from public.exposure_log e where e.session_id = p_s.session_id and not e.pretest
        union
        select x from pg_catalog.unnest(v_seen_items) x
      ) it
      join public.items i on i.item_id = it.item_id
      join public.item_families f on f.family_id = i.family_id
     group by f.axis
  ),
  under as (
    select distinct b.axis
      from best b
      left join given g on g.axis = b.axis
     where coalesce(g.n, 0) < v_floor
  ),
  restricted as (
    select b.* from best b
     where not exists (select 1 from under) or b.axis in (select u.axis from under u)
  ),
  served as (
    -- the balancing key of every item served (the key of hb.candidate_items)
    select f.axis, coalesce(f.generator, '') || case when v_balance ? f.axis then '|' || i.item_type else '' end as gkey, pg_catalog.count(*) as n
      from public.exposure_log e
      join public.item_families f on f.family_id = e.family_id
      join public.items i on i.item_id = e.item_id
     where e.session_id = p_s.session_id and not e.pretest
     group by 1, 2
  ),
  counted as (
    select r.*, coalesce(sv.n, 0) as n_served
      from restricted r
      left join served sv on sv.axis = r.axis and sv.gkey = r.gkey
  ),
  least_served as (
    select c.axis, pg_catalog.min(c.n_served) as m from counted c group by c.axis
  ),
  balanced as (
    select c.* from counted c join least_served l on l.axis = c.axis where c.n_served <= l.m
  ),
  top as (
    select b.item_id, b.family_id, b.axis, b.gkey, b.score, b.info
      from balanced b
     order by b.score desc, b.item_id
     limit v_top_k
  )
  select t.item_id, t.family_id, t.axis, t.gkey, t.score, t.info,
         (pg_catalog.row_number() over (order by t.score desc, t.item_id))::int - 1
    from top t
   order by t.score desc, t.item_id;
end
$$;

reset role;

-- ------------------------------------------------------------------------------------------- rescore
-- public.rescore as in 20261007000100_rescore_facets.sql, with the continuous answers (the header). The 2PL/3PL terms
-- and every count are computed as before; a Gaussian or GRM answer is classified 'scored' when hb.response_obs gives
-- its observation, counts toward rescore.min_axis_items and rescore.min_facet_items like any answer, and adds the
-- grid log-likelihood of its (practice-shifted) observation to its axis.
grant create on schema public to hb_definer;
set local role hb_definer;

create or replace function public.rescore(p_save jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_anon text;
  v_tau double precision := hb.cfg_num('retest.tau', 1.2);
  v_rho jsonb := coalesce(hb.cfg('retest.rho_max'), '{}'::jsonb);
  v_param text := hb.cfg_text('param_version', null);
  -- what is published (R-11.1): never fewer than one item, never a negative step
  v_min_axis int := greatest(hb.cfg_int('rescore.min_axis_items', 5), 1);
  v_min_facet int := greatest(hb.cfg_int('rescore.min_facet_items', 5), 1);
  v_mean_step double precision := greatest(hb.cfg_num('rescore.mean_step', 0.1), 0);
  v_sd_step double precision := greatest(hb.cfg_num('rescore.sd_step', 0.05), 0);
  v_owned text[];
  v_result jsonb;
begin
  v_anon := hb.check_save(p_save);
  if pg_catalog.jsonb_array_length(p_save -> 'sessions') > hb.cfg_int('rescore.max_sessions', 40) then
    perform hb.fail(413, 'too_many_sessions', 'At most ' || hb.cfg_int('rescore.max_sessions', 40) || ' sessions per call.');
  end if;
  -- Before the count, so that no call runs for long enough to be cancelled (a cancelled call rolls its count back)
  perform hb.check_save_work(p_save);
  perform hb.rate_hit('rescore', hb.ip_key('rescore'), hb.cfg_int('rate.rescores_per_day', 20));
  -- Per anon_id too, so that changing the address between calls does not reset the count. Only a call
  -- that holds a session of this anon_id is counted: the id alone is in every copy of the person's
  -- file, and a stranger who knew it must not be able to use up its calls. (A raise below rolls the
  -- address count back with it, as for every limit.)
  select coalesce(pg_catalog.array_agg(distinct e ->> 'session_id'), '{}'::text[]) into v_owned
    from pg_catalog.jsonb_array_elements(p_save -> 'sessions') e
   where hb.session_owned(e, v_anon);
  if pg_catalog.cardinality(v_owned) > 0 then
    perform hb.rate_hit('rescore_anon', hb.day_key('rescore_anon|' || v_anon), hb.cfg_int('rate.rescores_per_anon_day', 10));
  end if;

  v_result := (
    with
    -- the save's sessions, once each, in the order sent
    req as (
      select x.session_id, x.ord
        from (
          select s.value ->> 'session_id' as session_id,
                 s.ord,
                 pg_catalog.row_number() over (partition by s.value ->> 'session_id' order by s.ord) as dup
            from pg_catalog.jsonb_array_elements(p_save -> 'sessions') with ordinality s (value, ord)
           where pg_catalog.jsonb_typeof(s.value) = 'object' and (s.value ->> 'session_id') is not null
        ) x
       where x.dup = 1
    ),
    -- issued to the caller's anon_id (never to the one a sig names), finished, and verified (v_owned)
    known as (
      select ss.session_id,
             pg_catalog.to_char(ss.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_utc,
             hb.is_eligible(ss.session_id, true) as counts
        from req
        join public.sessions ss on ss.session_id = req.session_id
       where ss.finished_at is not null and ss.session_id = any (v_owned)
    ),
    resp as (
      select k.session_id, k.started_utc, k.counts, r.pretest, r.correct,
             i.status as item_status, f.axis, f.facet, p.model, p.a, p.b, p.c,
             -- hb.key_fits_model written out (a function call per row is the largest cost of the row)
             coalesce((p.model = 'gaussian' and ik.key ? 'true_value') or (p.model = 'grm' and ik.key ? 'ratings'), false) as scored_here,
             hb.response_fits(ik.key,
               pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end),
               r.response) as in_space,
             -- the observation of a Gaussian or GRM answer (hb.response_obs); null for every other answer
             case when p.model in ('gaussian', 'grm') then
               hb.response_obs(f.axis, p.model, p.a, p.b, p.c, p.extra, ik.key,
                 pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(i.payload -> 'options') = 'array' then i.payload -> 'options' else '[]'::jsonb end),
                 r.response, r.correct) end as cobs
        from known k
        cross join lateral hb.responses_of(k.session_id) r
        join public.items i on i.item_id = r.item_id
        join public.item_families f on f.family_id = i.family_id
        left join public.item_keys ik on ik.item_id = r.item_id
        left join lateral (
          select ip.model, ip.a, ip.b, ip.c, ip.extra
            from public.item_parameters ip
           where ip.item_id = r.item_id and (v_param is null or ip.param_version = v_param)
           order by ip.created_at desc
           limit 1
        ) p on true
    ),
    cls0 as (
      select resp.*,
             case
               when pretest then 'pretest'
               when item_status = 'quarantined' then 'quarantined'
               when not counts then 'ineligible_session'
               when model is null then 'no_params'
               -- a Gaussian or GRM item the server scores (a Fermi truth, a rating profile): invalid when outside the answer
               -- space, else scored when it has an observation. One without such a key is a block, scored on the device.
               when scored_here then case when not in_space then 'invalid' when cobs is null then 'no_params' else 'scored' end
               when model not in ('2pl', '2pl_testlet', '3pl') then 'block'
               when correct is null then 'unscored'
               when a is null or b is null or (model = '3pl' and c is null) then 'no_params'
               -- known wrong to anybody, so no answer at all (hb.response_fits); never right or wrong
               when not in_space then 'invalid'
               else 'scored'
             end as outcome
        from resp
    ),
    -- a session's answers on an axis count only if the session holds at least v_min_axis of them
    -- (R-11.1: what a session adds to a score is a sum of that many answers, never one)
    cls as (
      select c.session_id, c.started_utc, c.counts, c.correct, c.axis, c.facet, c.model, c.a, c.b, c.c, c.cobs,
             case
               when c.outcome = 'scored' and c.n_axis < v_min_axis then 'short_axis'
               else c.outcome
             end as outcome
        from (
          select cls0.*,
                 pg_catalog.count(*) filter (where cls0.outcome = 'scored') over (partition by cls0.session_id, cls0.axis) as n_axis
            from cls0
        ) c
    ),
    -- test numbers (§7.8): every session that took the axis, scored or not, in time order
    taken as (
      select distinct axis, session_id, started_utc from resp
    ),
    ord as (
      select t.axis, t.session_id,
             pg_catalog.row_number() over (partition by t.axis order by t.started_utc collate "C", t.session_id collate "C") as s
        from taken t
    ),
    rho as (
      select o.axis, o.session_id, o.s,
             - coalesce((v_rho ->> o.axis)::double precision, 0) * (pg_catalog.exp(- (o.s - 1) / v_tau) - 1) as rho
        from ord o
    ),
    -- the answers that count, each under its drill-down facet (hb.drill_facet: a quant template's answers count
    -- under its topic group). facet_ok: the facet counts the answer only if the same session holds at least
    -- v_min_facet counted answers on that facet (the axis counts it either way); no facet, never
    obs as (
      select c.axis, coalesce(c.facet, '') as facet, c.a, c.b, c.c, c.y, c.cobs,
             (c.facet is not null and pg_catalog.count(*) over (partition by c.session_id, c.axis, c.facet) >= v_min_facet) as facet_ok
        from (
          select c0.session_id, c0.axis, hb.drill_facet(c0.axis, c0.facet) as facet, c0.a, c0.b - r.rho as b, c0.c, c0.correct as y,
                 case when c0.cobs is not null then hb.obs_shift(c0.cobs, r.rho) end as cobs
            from cls c0
            join rho r on r.axis = c0.axis and r.session_id = c0.session_id
           where c0.outcome = 'scored'
        ) c
    ),
    grid as (
      select g.i, case when g.i = 60 then 4::double precision else -4::double precision + g.i * (8::double precision / 60) end as g
        from pg_catalog.generate_series(0, 60) g (i)
    ),
    -- the grid log-likelihood of each continuous observation, once
    cgrid as materialized (
      select o.axis, o.facet, o.facet_ok, hb.obs_grid_ll(o.cobs) as ll
        from obs o
       where o.cobs is not null
    ),
    -- log-likelihood of the observations of one (axis, facet, facet_ok) at each grid point: the 2PL/3PL
    -- terms of engine/irt.ts, in the same numerically stable form (log sigmoid, log-sum-exp), and the
    -- continuous terms of the scoring core
    fll as (
      select t.axis, t.facet, t.facet_ok, t.i, t.g, pg_catalog.sum(t.ll) as ll
        from (
          select o.axis, o.facet, o.facet_ok, gr.i, gr.g,
                 case
                   when o.c is null then case when o.y = 1 then lz.pos else lz.neg end
                   when o.y = 0 then pg_catalog.ln(1 - o.c) + lz.neg
                   else mm.m + pg_catalog.ln(pg_catalog.exp(greatest(uv.u - mm.m, -700)) + pg_catalog.exp(greatest(uv.v - mm.m, -700)))
                 end as ll
            from obs o
           cross join grid gr
           cross join lateral (select o.a * (gr.g - o.b) as z) zz
           cross join lateral (
             select case when zz.z >= 0 then - pg_catalog.ln(1 + pg_catalog.exp(greatest(- zz.z, -700))) else zz.z - pg_catalog.ln(1 + pg_catalog.exp(greatest(zz.z, -700))) end as pos,
                    case when zz.z <= 0 then - pg_catalog.ln(1 + pg_catalog.exp(greatest(zz.z, -700))) else - zz.z - pg_catalog.ln(1 + pg_catalog.exp(greatest(- zz.z, -700))) end as neg
           ) lz
           cross join lateral (
             select case when o.c is null then 0::double precision else pg_catalog.ln(o.c) end as u,
                    case when o.c is null then 0::double precision else pg_catalog.ln(1 - o.c) + lz.pos end as v
           ) uv
           cross join lateral (select greatest(uv.u, uv.v) as m) mm
           where o.cobs is null
          union all
          select cg.axis, cg.facet, cg.facet_ok, gr.i, gr.g, cg.ll[gr.i + 1]
            from cgrid cg
           cross join grid gr
        ) t
       group by t.axis, t.facet, t.facet_ok, t.i, t.g
    ),
    axis_ll as (
      select axis, i, g, pg_catalog.sum(ll) as ll from fll group by axis, i, g
    ),
    axis_w as (
      select a.axis, a.i, a.g,
             pg_catalog.exp(greatest(lw.v - pg_catalog.max(lw.v) over (partition by a.axis), -230)) as w
        from axis_ll a
       cross join lateral (
         select - 0.5 * (a.g - hb.axis_prior_mean(a.axis)) * (a.g - hb.axis_prior_mean(a.axis)) / hb.axis_prior_var(a.axis) + a.ll as v
       ) lw
    ),
    axis_mean as (
      select axis, pg_catalog.sum(w) as tw, pg_catalog.sum(w * g) / pg_catalog.sum(w) as mean from axis_w group by axis
    ),
    axis_raw as (
      select m.axis, m.mean,
             pg_catalog.sqrt(greatest(pg_catalog.sum(w.w * (w.g - m.mean) * (w.g - m.mean)) / m.tw, 0)) as sd,
             (select pg_catalog.count(*) from obs o where o.axis = m.axis) as n
        from axis_mean m join axis_w w on w.axis = m.axis
       group by m.axis, m.mean, m.tw
    ),
    -- every axis here has a session with at least v_min_axis answers on it (obs holds no others), so
    -- every axis here is published; a facet is computed only under one of them. Its prior is the axis
    -- posterior WITHOUT the facet's counted answers (leave-facet-out, viz/facets.ts; UX review D4), and its
    -- answers are then added once. On this grid both steps are exact (log weights: prior + axis_ll - facet_ll,
    -- then + facet_ll), so the product IS the axis posterior: a facet's mean and sd are its axis's to the last
    -- digit, and only n, the facet's counted answers, is its own.
    facet_raw as (
      select o.axis, o.facet, e.mean, e.sd, pg_catalog.count(*) as n
        from obs o
        join axis_raw e on e.axis = o.axis
       where o.facet <> '' and o.facet_ok
       group by o.axis, o.facet, e.mean, e.sd
    )
    select pg_catalog.jsonb_build_object(
      'retest_version', 'retest_v1',
      'param_version', v_param,
      'sessions', coalesce((
        select pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'session_id', q.session_id,
                   'known', k.session_id is not null,
                   'ordinals', coalesce((select pg_catalog.jsonb_object_agg(r.axis, r.s) from rho r where r.session_id = q.session_id), '{}'::jsonb),
                   'rho', coalesce((select pg_catalog.jsonb_object_agg(r.axis, r.rho) from rho r where r.session_id = q.session_id), '{}'::jsonb),
                   'n_scored', (select pg_catalog.count(*) from cls c where c.session_id = q.session_id and c.outcome = 'scored'))
                 order by q.ord)
          from req q left join known k on k.session_id = q.session_id), '[]'::jsonb),
      -- mean and sd only above the minimum count, rounded (see the header)
      'eap', coalesce((
        select pg_catalog.jsonb_object_agg(e.axis, pg_catalog.jsonb_build_object(
                 'mean', hb.quantise_round(e.mean, v_mean_step), 'sd', hb.quantise_up(e.sd, v_sd_step), 'n', e.n))
          from axis_raw e), '{}'::jsonb),
      'facets', coalesce((
        select pg_catalog.jsonb_object_agg(x.axis, x.facets)
          from (
            select e.axis,
                   pg_catalog.jsonb_object_agg(e.facet, pg_catalog.jsonb_build_object(
                     'mean', hb.quantise_round(e.mean, v_mean_step), 'sd', hb.quantise_up(e.sd, v_sd_step), 'n', e.n)) as facets
              from facet_raw e group by e.axis) x), '{}'::jsonb),
      -- what was held back, as counts of valid answers only (the count does not depend on right or wrong):
      -- an axis no session of which holds enough, and a facet (of an axis that is returned) the same
      'withheld', pg_catalog.jsonb_build_object(
        'eap', coalesce((
          select pg_catalog.jsonb_object_agg(w.axis, w.n)
            from (
              select c.axis, pg_catalog.count(*) as n
                from cls c
               where c.outcome in ('scored', 'short_axis')
                 and not exists (select 1 from axis_raw a where a.axis = c.axis)
               group by c.axis) w), '{}'::jsonb),
        'facets', coalesce((
          select pg_catalog.jsonb_object_agg(x.axis, x.facets)
            from (
              select h.axis, pg_catalog.jsonb_object_agg(h.facet, h.n) as facets
                from (
                  select o.axis, o.facet, pg_catalog.count(*) as n
                    from obs o
                   where o.facet <> ''
                   group by o.axis, o.facet
                  having not pg_catalog.bool_or(o.facet_ok)) h
               group by h.axis) x), '{}'::jsonb)),
      'limits', pg_catalog.jsonb_build_object(
        'min_axis_items', v_min_axis, 'min_facet_items', v_min_facet, 'mean_step', v_mean_step, 'sd_step', v_sd_step),
      'skipped', coalesce((
        select pg_catalog.jsonb_object_agg(c.outcome, c.n)
          from (
            -- a session that is not scored for its integrity looks like one that is too short (the reason is not told)
            select case when outcome in ('ineligible_session', 'short_axis') then 'not_counted' else outcome end as outcome, pg_catalog.count(*) as n
              from cls where outcome <> 'scored' group by 1) c), '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
             'unknown_sessions', (select pg_catalog.count(*) from req) - (select pg_catalog.count(*) from known))));
  return v_result;
end
$$;

reset role;
revoke create on schema public from hb_definer;

revoke all on function hb.fermi_unit(text) from public, anon, authenticated, service_role;
revoke all on function hb.fermi_magnitude(jsonb) from public, anon, authenticated, service_role;
revoke all on function hb.fermi_eval(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function hb.sjt_eval(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function hb.continuous_params_ok(text, double precision, jsonb) from public, anon, authenticated, service_role;
revoke all on function hb.key_fits_model(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function hb.response_obs(text, text, double precision, double precision, double precision, jsonb, jsonb, int, jsonb, smallint) from public, anon, authenticated, service_role;
revoke all on function hb.obs_grid_ll(jsonb) from public, anon, authenticated, service_role;
revoke all on function hb.obs_shift(jsonb, double precision) from public, anon, authenticated, service_role;
revoke all on function hb.grm_info(double precision, jsonb, double precision) from public, anon, authenticated, service_role;
revoke all on function hb.candidate_items(public.sessions, text[], text, text[]) from public, anon, authenticated, service_role;
