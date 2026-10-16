/**
 * Matrices grammar (DESIGN §4.2 "Matrices", §14.6 example 1; ROADMAP M1.6, A11).
 *
 * An item is a 3×3 grid of cells with the 9th (bottom-right) cell missing, plus 6 options. A cell
 * is a set of identical objects: `shape`, `size`, `color` and `orientation` are shared by all of
 * the cell's objects, and `positions` lists the occupied slots of a 3×3 sub-grid (slots 0–8,
 * row-major), so the object count is `positions.length`.
 *
 * | attribute   | values, in ordinal order                                      | generator rules                        |
 * |-------------|---------------------------------------------------------------|----------------------------------------|
 * | shape       | triangle, square, pentagon, hexagon, circle (sides; RAVEN order) | constant, progression ±1, distribution |
 * | size        | small, medium, large                                          | constant, progression ±1, distribution |
 * | color       | white, light_grey, dark_grey, black (4 greys, light → dark)   | constant, progression ±1, distribution |
 * | orientation | 0, 45, 90, 135 (degrees)                                      | constant, progression ±1, distribution |
 * | count       | 1–4 in every cell (count mode: ruled; position mode: derived) | constant, progression ±1, arithmetic ±, distribution |
 * | position    | a set of 1–4 sub-grid slots                                   | canonical (count mode), xor, or, distribution |
 *
 * The layout (count + position) runs in one of two modes: in *count mode* a count rule governs
 * the number of objects and every cell uses the canonical layout of its count
 * ({@link CANONICAL_LAYOUTS}; `position: 'canonical'`); in *position mode* a set rule governs the
 * occupied slots and the count is derived (`count: 'derived'`). An item has 1–4 non-constant
 * rules ({@link MIN_RULES}–{@link MAX_RULES}); the rule set is the item's structure (A11
 * `family_id`). Rule semantics and the uniqueness solver are in `solver.ts`.
 *
 * Hard strata 5 and 6 (generator 1.3.0, ROADMAP M3.12): two more templates, drawn only when
 * stratum 5 or 6 is requested ({@link allHardRuleSets}). (a) All five attributes ruled at once
 * (5 non-constant rules). (b) A second component per cell, an outer **frame** (RAVEN's "out-in"
 * configurations; APM items with an outer figure around inner elements): a square band just
 * inside the cell edge with its own `shade` (light grey, dark grey, black: ordinal) and `pattern`
 * (solid, dashed, dotted: nominal) and its own rules (shade: constant / progression ±1 /
 * distribution; pattern: constant / distribution; at least one non-constant), on top of 3–5
 * inner rules, 4–6 rules in all. Every cell of a framed item (grid and options) has a frame; no
 * cell of any other item has one, so a 1.2.0 spec is a valid 1.3.0 spec unchanged.
 *
 * Render contract (M1.13): orientation rotates the whole object, which is drawn with an
 * orientation stripe through its centre, so all four orientations are visible for every shape
 * (a bare circle or square would hide them, and the verifier treats every value as visible).
 */

import type { JsonValue } from '../../engine'

export const SHAPES = Object.freeze(['triangle', 'square', 'pentagon', 'hexagon', 'circle'] as const)
export const SIZES = Object.freeze(['small', 'medium', 'large'] as const)
export const COLORS = Object.freeze(['white', 'light_grey', 'dark_grey', 'black'] as const)
export const ORIENTATIONS = Object.freeze([0, 45, 90, 135] as const)

export type Shape = (typeof SHAPES)[number]
export type Size = (typeof SIZES)[number]
export type Color = (typeof COLORS)[number]
export type Orientation = (typeof ORIENTATIONS)[number]

/** Frame shades, light → dark (ordinal). White is left out: a frame band must stand out from the paper. */
export const FRAME_SHADES = Object.freeze(['light_grey', 'dark_grey', 'black'] as const)
/** Frame patterns (nominal; ordered by ink only for the solver's lure check). */
export const FRAME_PATTERNS = Object.freeze(['solid', 'dashed', 'dotted'] as const)
export type FrameShade = (typeof FRAME_SHADES)[number]
export type FramePattern = (typeof FRAME_PATTERNS)[number]

/** The outer frame of a cell (hard template b, generator 1.3.0). */
export interface MatrixFrame {
  readonly shade: FrameShade
  readonly pattern: FramePattern
}

/** Slots of a cell's 3×3 sub-grid. */
export const SLOT_COUNT = 9
/**
 * Most objects in a cell, in both layout modes (DESIGN §4.2: count 1–4). The generator keeps
 * xor/or third cells and slot-toggle distractors within 1–4, and `verify` rejects any cell (grid
 * or option) with more (`counts_in_range`).
 */
export const MAX_COUNT = 4
/** Canonical layouts of counts 1–4 (count mode): centre, middle pair, diagonal, corners. */
export const CANONICAL_LAYOUTS: readonly (readonly number[])[] = Object.freeze([
  Object.freeze([4]),
  Object.freeze([3, 5]),
  Object.freeze([0, 4, 8]),
  Object.freeze([0, 2, 6, 8]),
])
/** Options per item (DESIGN §3: MC with ≥ 6 options, so 2PL per A9). */
export const OPTIONS_COUNT = 6
/** Non-constant rules per item (DESIGN §4.2 / M1.6: 1–4). */
export const MIN_RULES = 1
export const MAX_RULES = 4

/** A cell as the renderer sees it (spec JSON). */
export interface MatrixCell {
  readonly shape: Shape
  readonly size: Size
  readonly color: Color
  readonly orientation: Orientation
  /** Occupied sub-grid slots 0–8, strictly increasing, non-empty. */
  readonly positions: readonly number[]
  /** The outer frame: present on every cell of a framed (hard) item, absent everywhere else. */
  readonly frame?: MatrixFrame
}

/** Render payload: the 8 visible cells and the options. No key, rule or 9th cell (§12, A1). */
export interface MatrixSpec {
  /** Three rows of 3, 3 and 2 cells; the missing 9th cell is what an option completes. */
  readonly grid: readonly (readonly MatrixCell[])[]
  /** Six options in display order. */
  readonly options: readonly MatrixCell[]
}

export interface MatrixKey {
  /** Index of the option that completes the grid. */
  readonly index: number
}

/** The chosen option index. */
export type MatrixResponse = number

/** Internal cell: ordinal indices into the value lists and a slot bitmask. */
export interface Cell {
  readonly shape: number
  readonly size: number
  readonly color: number
  readonly orientation: number
  /** Bitmask of occupied slots (bit s = slot s). */
  readonly positions: number
  /** Frame shade index ({@link FRAME_SHADES}); set together with `framePattern`, or both absent. */
  readonly frameShade?: number
  /** Frame pattern index ({@link FRAME_PATTERNS}). */
  readonly framePattern?: number
}

/** The frame attributes of an internal cell (hard template b). */
export const FRAME_ATTRS = Object.freeze(['frameShade', 'framePattern'] as const)
export type FrameAttr = (typeof FRAME_ATTRS)[number]
export const FRAME_DOMAIN_SIZE: Readonly<Record<FrameAttr, number>> = Object.freeze({
  frameShade: FRAME_SHADES.length,
  framePattern: FRAME_PATTERNS.length,
})

/** A frame attribute's value, −1 for a cell without a frame. */
export function frameValue(c: Cell, attr: FrameAttr): number {
  return c[attr] ?? -1
}

/** True if the cell has a frame. */
export function hasFrame(c: Cell): boolean {
  return c.frameShade !== undefined
}

export const SCALAR_ATTRS = Object.freeze(['shape', 'size', 'color', 'orientation'] as const)
export type ScalarAttr = (typeof SCALAR_ATTRS)[number]

export const DOMAIN_SIZE: Readonly<Record<ScalarAttr, number>> = Object.freeze({
  shape: SHAPES.length,
  size: SIZES.length,
  color: COLORS.length,
  orientation: ORIENTATIONS.length,
})

/**
 * The five inner components two options can differ in (a layout change moves count and positions
 * together). The 1.2.0 distractor tree draws from exactly this list (its RNG stream depends on it).
 */
export const COMPONENTS = Object.freeze(['shape', 'size', 'color', 'orientation', 'positions'] as const)
export type InnerComponent = (typeof COMPONENTS)[number]
/** Every component, the two frame attributes included (one-change tree, distractor checks). */
export const ALL_COMPONENTS = Object.freeze([...COMPONENTS, ...FRAME_ATTRS] as const)
export type Component = (typeof ALL_COMPONENTS)[number]

/** A component's value (frame attributes −1 without a frame). */
export function componentValue(c: Cell, comp: Component): number {
  return comp === 'frameShade' || comp === 'framePattern' ? frameValue(c, comp) : c[comp]
}

export function popcount(mask: number): number {
  let n = 0
  for (let m = mask; m !== 0; m &= m - 1) n++
  return n
}

export function maskOf(positions: readonly number[]): number {
  let m = 0
  for (const p of positions) m |= 1 << p
  return m
}

export function positionsOf(mask: number): number[] {
  const out: number[] = []
  for (let s = 0; s < SLOT_COUNT; s++) if (mask & (1 << s)) out.push(s)
  return out
}

export const CANONICAL_MASKS: readonly number[] = Object.freeze(CANONICAL_LAYOUTS.map(maskOf))

/** The canonical layout of count 1–4 as a bitmask. */
export function canonicalMask(count: number): number {
  const m = CANONICAL_MASKS[count - 1]
  if (m === undefined) throw new RangeError(`no canonical layout for count ${count}`)
  return m
}

export function isCanonical(mask: number): boolean {
  return CANONICAL_MASKS.includes(mask)
}

/** True if the cell holds 1–{@link MAX_COUNT} objects (DESIGN §4.2 count range). */
export function countInRange(c: Cell): boolean {
  const n = popcount(c.positions)
  return n >= 1 && n <= MAX_COUNT
}

export function cellEquals(a: Cell, b: Cell): boolean {
  return (
    a.shape === b.shape &&
    a.size === b.size &&
    a.color === b.color &&
    a.orientation === b.orientation &&
    a.positions === b.positions &&
    frameValue(a, 'frameShade') === frameValue(b, 'frameShade') &&
    frameValue(a, 'framePattern') === frameValue(b, 'framePattern')
  )
}

/** The components in which two cells differ. */
export function differingComponents(a: Cell, b: Cell): Component[] {
  return ALL_COMPONENTS.filter((c) => componentValue(a, c) !== componentValue(b, c))
}

export function toSpecCell(c: Cell): MatrixCell {
  const cell: MatrixCell = {
    shape: SHAPES[c.shape] as Shape,
    size: SIZES[c.size] as Size,
    color: COLORS[c.color] as Color,
    orientation: ORIENTATIONS[c.orientation] as Orientation,
    positions: positionsOf(c.positions),
  }
  if (c.frameShade === undefined || c.framePattern === undefined) return cell
  return { ...cell, frame: { shade: FRAME_SHADES[c.frameShade] as FrameShade, pattern: FRAME_PATTERNS[c.framePattern] as FramePattern } }
}

const CELL_FIELDS = ['color', 'orientation', 'positions', 'shape', 'size'].join(',')
const FRAMED_CELL_FIELDS = ['color', 'frame', 'orientation', 'positions', 'shape', 'size'].join(',')
/** The render fields of a cell without / with a frame (sorted). */
export const CELL_FIELD_SETS: readonly string[] = Object.freeze([CELL_FIELDS, FRAMED_CELL_FIELDS])

/** Parse a spec cell strictly; returns the internal cell or a description of the problem. */
export function parseCell(x: unknown): Cell | string {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return 'a cell must be an object'
  const o = x as Record<string, unknown>
  const fields = Object.keys(o).sort().join(',')
  if (fields !== CELL_FIELDS && fields !== FRAMED_CELL_FIELDS) return `a cell has exactly the fields ${CELL_FIELDS} (and frame, when framed)`
  const shape = SHAPES.indexOf(o.shape as Shape)
  const size = SIZES.indexOf(o.size as Size)
  const color = COLORS.indexOf(o.color as Color)
  const orientation = ORIENTATIONS.indexOf(o.orientation as Orientation)
  if (shape < 0) return `unknown shape ${JSON.stringify(o.shape)}`
  if (size < 0) return `unknown size ${JSON.stringify(o.size)}`
  if (color < 0) return `unknown color ${JSON.stringify(o.color)}`
  if (orientation < 0) return `unknown orientation ${JSON.stringify(o.orientation)}`
  const p = o.positions
  if (!Array.isArray(p) || p.length === 0) return 'positions must be a non-empty array'
  for (let i = 0; i < p.length; i++) {
    const s: unknown = p[i]
    if (!(typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < SLOT_COUNT)) return `slot ${String(s)} is not in 0–8`
    if (i > 0 && s <= (p[i - 1] as number)) return 'positions must be strictly increasing'
  }
  const cell: Cell = { shape, size, color, orientation, positions: maskOf(p as number[]) }
  if (fields === CELL_FIELDS) return cell
  const f = o.frame
  if (typeof f !== 'object' || f === null || Array.isArray(f)) return 'frame must be an object'
  const fo = f as Record<string, unknown>
  if (Object.keys(fo).sort().join(',') !== 'pattern,shade') return 'a frame has exactly the fields pattern, shade'
  const frameShade = FRAME_SHADES.indexOf(fo.shade as FrameShade)
  const framePattern = FRAME_PATTERNS.indexOf(fo.pattern as FramePattern)
  if (frameShade < 0) return `unknown frame shade ${JSON.stringify(fo.shade)}`
  if (framePattern < 0) return `unknown frame pattern ${JSON.stringify(fo.pattern)}`
  return { ...cell, frameShade, framePattern }
}

// --- rules ---------------------------------------------------------------------------------------

export const SCALAR_RULES = Object.freeze(['constant', 'progression+1', 'progression-1', 'distribution'] as const)
export const COUNT_RULES = Object.freeze([
  'constant',
  'progression+1',
  'progression-1',
  'arithmetic+',
  'arithmetic-',
  'distribution',
  'derived',
] as const)
export const POSITION_RULES = Object.freeze(['canonical', 'xor', 'or', 'distribution'] as const)

export type ScalarRule = (typeof SCALAR_RULES)[number]
export type CountRule = (typeof COUNT_RULES)[number]
export type PositionRule = (typeof POSITION_RULES)[number]
/** Rules of the frame shade (ordinal, like the inner scalars). */
export const FRAME_SHADE_RULES = SCALAR_RULES
/** Rules of the frame pattern (nominal: no progression). */
export const FRAME_PATTERN_RULES = Object.freeze(['constant', 'distribution'] as const)
export type FramePatternRule = (typeof FRAME_PATTERN_RULES)[number]

/** The rule of every attribute along the rows: the item's structure (A11). */
export interface RuleSet {
  readonly shape: ScalarRule
  readonly size: ScalarRule
  readonly color: ScalarRule
  readonly orientation: ScalarRule
  readonly count: CountRule
  readonly position: PositionRule
  /** Frame rules: both present on a framed (hard template b) rule set, both absent otherwise. */
  readonly frame_shade?: ScalarRule
  readonly frame_pattern?: FramePatternRule
}

export const RULE_ATTRS = Object.freeze(['shape', 'size', 'color', 'orientation', 'count', 'position'] as const)
export type RuleAttr = (typeof RULE_ATTRS)[number]
/** The frame's rule attributes (structural_params keys), in the order of {@link FRAME_ATTRS}. */
export const FRAME_RULE_ATTRS = Object.freeze(['frame_shade', 'frame_pattern'] as const)
export type FrameRuleAttr = (typeof FRAME_RULE_ATTRS)[number]
export type AnyRuleAttr = RuleAttr | FrameRuleAttr

/** True if the rule set has a frame component (hard template b). */
export function isFramed(rules: RuleSet): boolean {
  return rules.frame_shade !== undefined
}

/** Rule types of the v0 difficulty prior (Carpenter, Just & Shell 1990 rule taxonomy). */
export type RuleType = 'progression' | 'distribution' | 'arithmetic' | 'logic'

/** The type of a non-constant rule, or null for constant / canonical / derived. */
export function ruleType(rule: string): RuleType | null {
  if (rule === 'progression+1' || rule === 'progression-1') return 'progression'
  if (rule === 'distribution') return 'distribution'
  if (rule === 'arithmetic+' || rule === 'arithmetic-') return 'arithmetic'
  if (rule === 'xor' || rule === 'or') return 'logic'
  return null
}

/** One entry per non-constant rule of the set. */
export function nonConstantRules(rules: RuleSet): RuleType[] {
  const out: RuleType[] = []
  for (const a of RULE_ATTRS) {
    const t = ruleType(rules[a])
    if (t !== null) out.push(t)
  }
  for (const a of FRAME_RULE_ATTRS) {
    const r = rules[a]
    const t = r === undefined ? null : ruleType(r)
    if (t !== null) out.push(t)
  }
  return out
}

/** The layout rules: 6 count-mode rules (canonical positions), 3 position-mode rules (derived count). */
export const LAYOUT_RULES: readonly { readonly count: CountRule; readonly position: PositionRule }[] = Object.freeze([
  ...(['constant', 'progression+1', 'progression-1', 'arithmetic+', 'arithmetic-', 'distribution'] as const).map(
    (count) => ({ count, position: 'canonical' as const }),
  ),
  ...(['xor', 'or', 'distribution'] as const).map((position) => ({ count: 'derived' as const, position })),
])

/** Every rule set with 1–4 non-constant rules, in a fixed order (4⁴ · 9 − 1 − 3⁴ · 8 = 1,655). */
export function allRuleSets(): RuleSet[] {
  const out: RuleSet[] = []
  for (const shape of SCALAR_RULES)
    for (const size of SCALAR_RULES)
      for (const color of SCALAR_RULES)
        for (const orientation of SCALAR_RULES)
          for (const layout of LAYOUT_RULES) {
            const rules: RuleSet = { shape, size, color, orientation, count: layout.count, position: layout.position }
            const n = nonConstantRules(rules).length
            if (n >= MIN_RULES && n <= MAX_RULES) out.push(rules)
          }
  return out
}

/** Most non-constant rules of a hard rule set (5 inner, or inner + frame). */
export const HARD_MAX_RULES = 6
/** Fewest non-constant rules of a framed rule set (an unframed hard set has exactly 5). */
export const HARD_FRAMED_MIN_RULES = 4

/**
 * True if the rule set is one of the hard templates' (M3.12): unframed with all 5 attributes
 * ruled, or framed with a non-constant frame rule and {@link HARD_FRAMED_MIN_RULES}–
 * {@link HARD_MAX_RULES} rules in all. (The 1.2.0 sets have 1–4 rules and no frame.)
 */
export function isHardRuleSet(rules: RuleSet): boolean {
  const n = nonConstantRules(rules).length
  if (!isFramed(rules)) return n === 5
  const frameRuled = rules.frame_shade !== 'constant' || rules.frame_pattern !== 'constant'
  return frameRuled && n >= HARD_FRAMED_MIN_RULES && n <= HARD_MAX_RULES
}

/**
 * Every hard-template candidate rule set ({@link isHardRuleSet}) in a fixed order: the inner sets
 * in {@link allRuleSets} order (any number of rules), each unframed then with every frame rule
 * pair (shade rule outer, pattern rule inner). The prior (`prior.ts`) keeps those in strata 5–6.
 */
export function allHardRuleSets(): RuleSet[] {
  const out: RuleSet[] = []
  for (const shape of SCALAR_RULES)
    for (const size of SCALAR_RULES)
      for (const color of SCALAR_RULES)
        for (const orientation of SCALAR_RULES)
          for (const layout of LAYOUT_RULES) {
            const inner: RuleSet = { shape, size, color, orientation, count: layout.count, position: layout.position }
            if (isHardRuleSet(inner)) out.push(inner)
            for (const frame_shade of FRAME_SHADE_RULES)
              for (const frame_pattern of FRAME_PATTERN_RULES) {
                const rules: RuleSet = { ...inner, frame_shade, frame_pattern }
                if (isHardRuleSet(rules)) out.push(rules)
              }
          }
  return out
}

/** Parse `structural_params` (`{ rules: RuleSet }`) strictly; null if it is not a valid rule set. */
export function parseRuleSet(sp: JsonValue): RuleSet | null {
  if (typeof sp !== 'object' || sp === null || Array.isArray(sp)) return null
  if (Object.keys(sp).join(',') !== 'rules') return null
  const r = sp.rules
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return null
  const keys = Object.keys(r).sort().join(',')
  const framed = keys === [...RULE_ATTRS, ...FRAME_RULE_ATTRS].sort().join(',')
  if (keys !== [...RULE_ATTRS].sort().join(',') && !framed) return null
  const scalarOk = SCALAR_ATTRS.every((a) => (SCALAR_RULES as readonly unknown[]).includes(r[a]))
  const layoutOk = LAYOUT_RULES.some((l) => l.count === r.count && l.position === r.position)
  const frameOk =
    !framed ||
    ((FRAME_SHADE_RULES as readonly unknown[]).includes(r.frame_shade) && (FRAME_PATTERN_RULES as readonly unknown[]).includes(r.frame_pattern))
  if (!scalarOk || !layoutOk || !frameOk) return null
  return r as unknown as RuleSet
}

/** `structural_params` of a rule set (A11: the matrix rule set is the family). */
export function structuralParamsOf(rules: RuleSet): { rules: { [attr: string]: string } } {
  return {
    rules: {
      shape: rules.shape,
      size: rules.size,
      color: rules.color,
      orientation: rules.orientation,
      count: rules.count,
      position: rules.position,
      ...(rules.frame_shade !== undefined && rules.frame_pattern !== undefined
        ? { frame_shade: rules.frame_shade, frame_pattern: rules.frame_pattern }
        : {}),
    },
  }
}
