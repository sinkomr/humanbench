-- M3.12 (ROADMAP M3.12; DESIGN §3 row 6, §9.6; owner 2026-10-15): quant generator 1.4.0, whose strata 5 and 6 add
-- 45 templates (geometry and trigonometry, polynomials and logarithms, recurrences, counting and
-- probability, number theory, calculus, multi-step word problems), and the topic grouping becomes
-- g2 (`web/src/tasks/quant/topics.ts`, `topics-v1.json`): the M1 groups take the hard templates that
-- continue their topics, and two groups are new, quant/geometry_trig and quant/calculus.
--
-- hb.drill_facet maps a quant template to the drill-down facet its answers count under (its topic
-- group; 20261007000100_rescore_facets.sql). Without this a hard template's answers would count
-- under the template's own id, a facet the results page does not show. Same function, same
-- signature and privileges (create or replace keeps the grants; the revoke is repeated so the
-- function stays closed to every role whatever ran before); only the table grows. Nothing else
-- changes: the scoring of a numeric answer is the same entry grammar and tolerance as before
-- (every hard key is an exact integer or fraction, `{abs: 0}`), so no scoring function changes.

set local role hb_definer;

create or replace function hb.drill_facet(p_axis text, p_facet text)
returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select case
           when p_axis = 'QR' then coalesce((
             select m.grp
               from (values
                 ('arith', 'quant/arith_fractions_percent'),
                 ('fraction', 'quant/arith_fractions_percent'),
                 ('fraction_of', 'quant/arith_fractions_percent'),
                 ('percent', 'quant/arith_fractions_percent'),
                 ('ratio', 'quant/ratios_rates_averages'),
                 ('rate', 'quant/ratios_rates_averages'),
                 ('mean', 'quant/ratios_rates_averages'),
                 ('linear_eq', 'quant/linear'),
                 ('system', 'quant/linear'),
                 ('remainder', 'quant/linear'),
                 ('functional', 'quant/linear'),
                 ('candles', 'quant/linear'),
                 ('ferries', 'quant/linear'),
                 ('exponent', 'quant/powers_quadratics'),
                 ('quadratic', 'quant/powers_quadratics'),
                 ('vieta', 'quant/powers_quadratics'),
                 ('log_eq', 'quant/powers_quadratics'),
                 ('newton', 'quant/powers_quadratics'),
                 ('probability', 'quant/probability_counting'),
                 ('counting', 'quant/probability_counting'),
                 ('stars_bars', 'quant/probability_counting'),
                 ('grid_paths', 'quant/probability_counting'),
                 ('conditional', 'quant/probability_counting'),
                 ('meet', 'quant/probability_counting'),
                 ('digit_sum', 'quant/probability_counting'),
                 ('ap_triples', 'quant/probability_counting'),
                 ('ruin', 'quant/probability_counting'),
                 ('adjacent', 'quant/probability_counting'),
                 ('necklace', 'quant/probability_counting'),
                 ('arith_series', 'quant/series_number'),
                 ('geom_series', 'quant/series_number'),
                 ('modular', 'quant/series_number'),
                 ('recip', 'quant/series_number'),
                 ('symmetric', 'quant/series_number'),
                 ('recurrence', 'quant/series_number'),
                 ('divisors', 'quant/series_number'),
                 ('crt', 'quant/series_number'),
                 ('legendre', 'quant/series_number'),
                 ('mod100', 'quant/series_number'),
                 ('egyptian', 'quant/series_number'),
                 ('gcd_power', 'quant/series_number'),
                 ('tower_mod', 'quant/series_number'),
                 ('lattice_circle', 'quant/series_number'),
                 ('telescoping', 'quant/series_number'),
                 ('heron', 'quant/geometry_trig'),
                 ('chords', 'quant/geometry_trig'),
                 ('coord', 'quant/geometry_trig'),
                 ('solid', 'quant/geometry_trig'),
                 ('trig_sin', 'quant/geometry_trig'),
                 ('angle_sum', 'quant/geometry_trig'),
                 ('law_cosines', 'quant/geometry_trig'),
                 ('triangle', 'quant/geometry_trig'),
                 ('tangent_circles', 'quant/geometry_trig'),
                 ('inscribed_sphere', 'quant/geometry_trig'),
                 ('tan_triangle', 'quant/geometry_trig'),
                 ('sin_squares', 'quant/geometry_trig'),
                 ('derivative', 'quant/calculus'),
                 ('integral', 'quant/calculus'),
                 ('limit', 'quant/calculus'),
                 ('optimise', 'quant/calculus'),
                 ('area_between', 'quant/calculus'),
                 ('beta', 'quant/calculus'),
                 ('revolution', 'quant/calculus')
               ) as m (template, grp)
              where m.template = p_facet), p_facet)
           else p_facet
         end
$$;

reset role;

revoke all on function hb.drill_facet(text, text) from public, anon, authenticated, service_role;
