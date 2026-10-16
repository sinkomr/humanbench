/**
 * The quant topic groups (ROADMAP A23 and AI.3; Phase AI proposal §5.2; DESIGN R-17.4): the six
 * M1 groups, and since generator 1.4.0 (M3.12, group_version g2) two more for the hard strata,
 * geometry and trigonometry, and calculus.
 *
 * A quant item's facet is its template (M1.F2, `QUANT_TEMPLATES`). The A11 lifetime exclusion
 * (§7.7) caps a single template at 2–5 variants, so no template alone can carry a topic claim;
 * six **groups** sit above the template facets, and every template maps to exactly one group.
 * A group is a pure constant: it needs no change to the family contract and does not touch
 * `family_id` or an item's `facet`. `group_version` `g1` is written into the JSON export and into
 * `brief_prefs`. A new group_version is required when a template moves to another group or a
 * group is added, split or retired (with aliases in `topics-aliases.json`); a new template
 * joining an existing group keeps `g1`. (The same wording is in the bank's
 * `hb.gen.quant.topics`.)
 *
 * This module is dependency-free on purpose (no import of `templates.ts`): the notes builder
 * needs the ids and labels without pulling in the quant generators. The tests check it against
 * the real templates (`topics.test.ts`) and against `topics-v1.json`, which lists the same six
 * groups; the bank's `hb.gen.quant.topics` is the twin, and the two agree through that
 * byte-identical file (ROADMAP A17).
 */

export const QUANT_GROUP_VERSION = 'g2'

export interface QuantGroup {
  /** The topic ID, `quant/<name>` (`topics-v1.json` `kind: group`). */
  readonly id: string
  readonly label: string
  /** The template facets it covers (`QUANT_TEMPLATES`). */
  readonly templates: readonly string[]
}

const group = (id: string, label: string, templates: readonly string[]): QuantGroup =>
  Object.freeze({ id, label, templates: Object.freeze([...templates]) })

/**
 * The groups in display order: the six M1 groups in the order of their M1 prior mean b (−2.0 … +1.0,
 * [SPEC v0]), then the two groups of generator 1.4.0. The hard templates of 1.4.0 (strata 5–6) that
 * continue an M1 topic join its group (a new template joining a group would keep g1); geometry and
 * trigonometry, and calculus, are new groups, hence g2 (M3.12). The two floor groups take no hard
 * template (the two word problems of linear equations, candles and ferries, join `quant/linear`),
 * so they stay the "two lowest rungs" of the floor rule (proposal §3.3, R-17.7).
 */
export const QUANT_GROUPS: readonly QuantGroup[] = Object.freeze([
  group('quant/arith_fractions_percent', 'Arithmetic, fractions and percentages', ['arith', 'fraction', 'fraction_of', 'percent']),
  group('quant/ratios_rates_averages', 'Ratios, rates and averages', ['ratio', 'rate', 'mean']),
  group('quant/linear', 'Linear equations and systems', ['linear_eq', 'system', 'remainder', 'functional', 'candles', 'ferries']),
  group('quant/powers_quadratics', 'Powers and quadratics', ['exponent', 'quadratic', 'vieta', 'log_eq', 'newton']),
  group('quant/probability_counting', 'Probability and counting', [
    'probability', 'counting', 'stars_bars', 'grid_paths', 'conditional', 'meet', 'digit_sum', 'ap_triples', 'ruin', 'adjacent', 'necklace',
  ]),
  group('quant/series_number', 'Series and number puzzles', [
    'arith_series', 'geom_series', 'modular', 'recip', 'symmetric', 'recurrence', 'divisors', 'crt', 'legendre', 'mod100', 'egyptian',
    'gcd_power', 'tower_mod', 'lattice_circle', 'telescoping',
  ]),
  group('quant/geometry_trig', 'Geometry and trigonometry', [
    'heron', 'chords', 'coord', 'solid', 'trig_sin', 'angle_sum', 'law_cosines', 'triangle', 'tangent_circles', 'inscribed_sphere', 'tan_triangle', 'sin_squares',
  ]),
  group('quant/calculus', 'Limits, derivatives and integrals', ['derivative', 'integral', 'limit', 'optimise', 'area_between', 'beta', 'revolution']),
])

export const QUANT_GROUP_IDS: readonly string[] = Object.freeze(QUANT_GROUPS.map((g) => g.id))

/** The two lowest quant groups: no results-derived build-up line there (floor rule, R-17.7). */
export const FLOOR_GROUP_IDS: readonly string[] = Object.freeze(QUANT_GROUP_IDS.slice(0, 2))

const GROUP_OF_TEMPLATE: ReadonlyMap<string, QuantGroup> = new Map(QUANT_GROUPS.flatMap((g) => g.templates.map((t) => [t, g] as const)))

/** The group of a quant template facet (`percent` → arithmetic, fractions and percentages), or undefined. */
export function quantGroupOfTemplate(template: string): QuantGroup | undefined {
  return GROUP_OF_TEMPLATE.get(template)
}

/** The group of a quant item, through its facet (the template). */
export function quantGroupOfItem(item: { readonly facet: string }): QuantGroup | undefined {
  return GROUP_OF_TEMPLATE.get(item.facet)
}

/** The group with topic ID `quant/<name>`, or undefined. */
export function quantGroupById(id: string): QuantGroup | undefined {
  return QUANT_GROUPS.find((g) => g.id === id)
}
