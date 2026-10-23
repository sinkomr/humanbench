-- M3.13 (ROADMAP M3.13; scope variety; DESIGN §3 row 6, §9.6): the Quantitative family `qdata` (tables, charts and
-- everyday word problems, generator 1.0.0) has a facet per template, 23 templates with ids of their own (`dt_*`, `wp_*`;
-- none is a quant template), and the drill-down shows each under the quant topic group of the computation it asks for
-- (`web/src/tasks/quant/topics.ts` QDATA_TEMPLATE_GROUPS): percentages and totals under arithmetic, fractions and
-- percentages; means, rates, unit prices and mixtures under ratios, rates and averages; shares of a two-way table under
-- probability and counting. No group is added, so the group version stays g2.
--
-- hb.drill_facet is re-created with the same body, signature and privileges as 20261016000200_quant_hard_facets.sql;
-- only its table grows by the 23 qdata templates (create or replace keeps the grants; the revoke is repeated so the
-- function stays closed to every role). Nothing else changes: a qdata answer is a typed number scored by the same entry
-- grammar and exact tolerance as a quant answer (`{abs: 0}`), and the new Spatial families (paper folding, 2D figures,
-- cube nets) are multiple choice with the facet as its own drill-down id, as rotation's.

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
                 ('revolution', 'quant/calculus'),
                 ('dt_bar_read', 'quant/arith_fractions_percent'),
                 ('dt_table_sum', 'quant/arith_fractions_percent'),
                 ('wp_change', 'quant/arith_fractions_percent'),
                 ('dt_line_temp', 'quant/arith_fractions_percent'),
                 ('dt_table_mean', 'quant/ratios_rates_averages'),
                 ('wp_timetable', 'quant/arith_fractions_percent'),
                 ('dt_bar_share', 'quant/arith_fractions_percent'),
                 ('wp_bill_split', 'quant/arith_fractions_percent'),
                 ('wp_unit_price', 'quant/ratios_rates_averages'),
                 ('wp_recipe', 'quant/ratios_rates_averages'),
                 ('dt_line_pct_change', 'quant/arith_fractions_percent'),
                 ('dt_freq_mean', 'quant/ratios_rates_averages'),
                 ('dt_twoway_share', 'quant/probability_counting'),
                 ('wp_fuel', 'quant/ratios_rates_averages'),
                 ('wp_discount_tax', 'quant/arith_fractions_percent'),
                 ('dt_freq_median', 'quant/ratios_rates_averages'),
                 ('dt_missing_mean', 'quant/ratios_rates_averages'),
                 ('dt_two_series', 'quant/arith_fractions_percent'),
                 ('wp_work_together', 'quant/ratios_rates_averages'),
                 ('wp_mixture', 'quant/ratios_rates_averages'),
                 ('dt_compound_change', 'quant/arith_fractions_percent'),
                 ('dt_share_change', 'quant/arith_fractions_percent'),
                 ('wp_reverse_pct', 'quant/arith_fractions_percent')
               ) as m (template, grp)
              where m.template = p_facet), p_facet)
           else p_facet
         end
$$;

reset role;

revoke all on function hb.drill_facet(text, text) from public, anon, authenticated, service_role;
