/**
 * The six M1 quant topic groups (ROADMAP A23 and AI.3; Phase AI proposal §5.2; DESIGN R-17.4).
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

export const QUANT_GROUP_VERSION = 'g1'

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
 * The groups in display order, which is also the order of their prior mean b (−2.0 … +1.0, [SPEC v0]).
 * The first two are the "two lowest rungs" of the floor rule (proposal §3.3, R-17.7).
 */
export const QUANT_GROUPS: readonly QuantGroup[] = Object.freeze([
  group('quant/arith_fractions_percent', 'Arithmetic, fractions and percentages', ['arith', 'fraction', 'fraction_of', 'percent']),
  group('quant/ratios_rates_averages', 'Ratios, rates and averages', ['ratio', 'rate', 'mean']),
  group('quant/linear', 'Linear equations and systems', ['linear_eq', 'system']),
  group('quant/powers_quadratics', 'Powers and quadratics', ['exponent', 'quadratic']),
  group('quant/probability_counting', 'Probability and counting', ['probability', 'counting']),
  group('quant/series_number', 'Series and number puzzles', ['arith_series', 'geom_series', 'modular', 'recip', 'symmetric']),
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
