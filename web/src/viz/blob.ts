/**
 * The blob's render model (DESIGN §9; ROADMAP A7, A12, A15, M1.16): every coordinate and SVG path
 * the chart draws, computed without the DOM so it can be tested and benchmarked in Node.
 * `BlobChart.svelte` only maps this model to SVG elements.
 *
 * - Radius linear in θ over [−3, 3] (§9.1, `geometry.ts`); rings at −2 … +2 SD, "provisional"
 *   (A12); the θ = 0 ring dashed.
 * - Crisp posterior curve + the ±1 SD band + the fuzz (§9.3): 20 nested closed curves at
 *   θ_k + z·SD_k for z spread evenly over ±1.645, each filling the band toward the mean with
 *   opacity ∝ the normal density φ(z) ({@link FUZZ_Z}, {@link fuzzOpacity}); every curve is chosen
 *   by the overshoot rule (§9.2, `curve.ts`).
 * - Not-measured spokes (§9.7, A15): a dashed spoke, a grey stub at the centre and a gap marker,
 *   never interpolated through. UX review D13 A (a provisional default, amending the §9.7 dip):
 *   the crisp curve, the band and the fuzz break there instead of dipping to the inner clamp, where
 *   −3 SD is drawn; each run of measured neighbours is an open curve (`curve.ts`), a lone measured
 *   spoke keeps its marker and 90% whisker, and the gap marker is a small × on the 0 SD ring. With
 *   every spoke measured the curves are closed, as before.
 * - D13 B (provisional default): on a narrow screen (where the default text layout does not fit)
 *   with at least {@link STUB_LIST_MIN} not-measured spokes, those spokes lose their label and the
 *   model lists them ({@link BlobModel.stubList}), which the chart prints under itself.
 * - Measured spokes: a marker at θ and a 90% whisker; muted when the interval overlaps 0 (§9.5).
 *   An estimate beyond the scale (below the inner clamp, or above +3 SD) gets an arrowhead at the
 *   clamp instead of the dot, never mistaken for a stub (UX-037); the radius map itself is untouched.
 * - Tier (c) spokes: the blob's wedge around the spoke gets a hatch (§9.7); glyphs on labels.
 * - One clickable wedge per contiguous group (cluster) for the drill-down (§9.6, A7).
 * - Muting (§9.5, A12) reaches the crisp curve too: it is split into angular runs, and the runs
 *   around muted spokes are drawn in the muted tone, so only credible jaggedness stands out.
 * - Text: every label box is measured (canvas in the browser, else estimated from its characters;
 *   `TextMeasure`), the viewBox fits the boxes, and {@link fitLayout} picks a font size (and, on
 *   narrow screens, one-line compact labels) so the smallest chart text renders at
 *   ≥ {@link MIN_TEXT_PX} CSS px with no two labels overlapping, where the width allows. In-chart
 *   text has a halo in the page background (BlobChart.svelte), so its contrast is the palette's
 *   text contrast (§9.8) even where it crosses the band, the fuzz or the curve.
 * Nothing here sums, averages or measures the shape (§9.5 a).
 */

import { OFF_SCALE_LABEL, RING_NOTE, stubListLead } from './copy'
import { chooseCurve, CURVE_CHAIN, fmt, pathData, pathEnd, reversedSegmentsData, type CurveKind, type RecordedPath } from './curve'
import { offScaleOf, polar, R_MIN_FRACTION, radiusScale, ringLabel, ringSpacing, RING_THETAS, spokeAngle, Z90, type Point } from './geometry'
import { stubLabel, type SpokeEstimate } from './profile'

/** Default outer radius (θ = +3) in SVG user units. */
export const DEFAULT_R = 180
/** The grey stub at the centre of a not-measured spoke, as a fraction of R (§9.7). */
const STUB_FRACTION = 0.14
/** Half the length of each arm of the × on the 0 SD ring of a not-measured spoke (D13 A), in user units. */
export const GAP_MARK_ARM = 4.5
/** D13 B: on a narrow screen, this many not-measured spokes or more lose their labels to a list under the chart. */
export const STUB_LIST_MIN = 5
/** Room between the wedges (R + 4) and the spoke labels. */
const LABEL_GAP = 12
/** Padding inside the viewBox edge. */
const VIEW_PAD = 6

/** Spoke-label size in user units at the chart's full width. */
export const LABEL_FONT = 12.5
/** Ring labels, the ring note and stub notes, relative to the spoke labels. */
export const SMALL_FONT_RATIO = 0.88
/** The smallest chart text should render at ≥ this many CSS px (§13 legibility; M1.16 review). */
export const MIN_TEXT_PX = 11
/** The largest spoke-label size {@link fitLayout} may pick, in user units. */
export const MAX_LABEL_FONT = 48
/** Average glyph advance in em used to size label boxes: generous for sans-serif UI fonts. */
export const CHAR_EM = 0.6
/** Ascent and descent of a line, in em: generous for the viewBox, glyph-tight for overlaps. */
const ASCENT_EM = 0.85
const DESCENT_EM = 0.3
const GLYPH_ASCENT_EM = 0.75
const GLYPH_DESCENT_EM = 0.22
/** Line height of labels (tspan dy) and of the ring note, in em. */
export const LABEL_LINE_EM = 1.15
export const NOTE_LINE_EM = 1.2
/** Compact labels without a one-line form (facets) wrap at spaces to lines of this many characters. */
export const WRAP_CHARS = 10
/** Stub notes are set smaller, so they wrap only past this length ("not measured" stays whole). */
export const NOTE_WRAP_CHARS = 12
/** Halo width around chart text, in em of that text. */
const HALO_EM = 0.3

/** §9.3 / ROADMAP M1.16: the fuzz is 20 nested closed curves. */
export const N_FUZZ = 20
/**
 * The z of each fuzz curve (§9.3: radii θ_k + z·SD_k, z ∈ [−1.64, 1.64]), inside out:
 * ±Z90·j/10 for j = 10 … 1, then 1 … 10. The crisp curve is z = 0, so each side has 10 bands of
 * equal width in z out to the 90% interval ({@link Z90}), the edge the whiskers show.
 */
export const FUZZ_Z: readonly number[] = Object.freeze(
  Array.from({ length: N_FUZZ }, (_, j) => (j < N_FUZZ / 2 ? j - N_FUZZ / 2 : j - N_FUZZ / 2 + 1) * (Z90 / (N_FUZZ / 2))),
)
/** Fill opacity of the fuzz next to the crisp curve (z → 0). */
export const FUZZ_MAX_OPACITY = 0.3
/** §9.3: a fuzz curve's fill opacity, ∝ the normal density φ(z) (peak {@link FUZZ_MAX_OPACITY}). */
export function fuzzOpacity(z: number): number {
  return FUZZ_MAX_OPACITY * Math.exp(-(z * z) / 2)
}

export interface RingView {
  readonly theta: number
  readonly r: number
  readonly label: string
  /** θ = 0: dashed reference ring (§9.1). */
  readonly reference: boolean
  readonly labelAt: Point
  /**
   * Whether this ring is labelled: every ring, or every second one (−2, 0, +2 SD) when the text is
   * too large for one ring spacing (narrow screens), so ring labels never overlap.
   */
  readonly showLabel: boolean
}

/** One line of a spoke label; a note ("not measured", "insufficient data") is set smaller. */
export interface LabelLine {
  readonly text: string
  readonly note: boolean
  /** The spoke's tier glyph (§9.7) follows this line. */
  readonly glyph: boolean
}

export interface SpokeView {
  readonly id: string
  readonly name: string
  readonly lines: readonly LabelLine[]
  readonly glyph: string
  readonly tier: SpokeEstimate['tier']
  readonly group: string
  readonly measured: boolean
  readonly muted: boolean
  readonly angle: number
  /** Spoke line end (θ = +3). */
  readonly outer: Point
  readonly label: { readonly at: Point; readonly anchor: 'start' | 'middle' | 'end'; readonly dy0: number }
  /** Measured: marker at θ and 90% whisker ends. */
  readonly marker?: Point
  readonly whisker?: readonly [Point, Point]
  /**
   * Measured and beyond the scale: which end (UX-037). The marker is then at the clamp radius and
   * `arrow` (an arrowhead pointing off the scale, tip on the clamp) is drawn in its place.
   */
  readonly offScale?: 'low' | 'high'
  readonly arrow?: string
  /**
   * Not measured: the grey stub from the centre, and the gap marker (D13 A): `gap` is its centre on
   * the 0 SD ring, `gapMark` the × drawn there (two strokes, turned with the spoke).
   */
  readonly stub?: Point
  readonly gap?: Point
  readonly gapMark?: string
  /** A share card's named peak (D15 A): its marker is ringed and its label bold. */
  readonly peak?: boolean
}

export interface CurveView {
  readonly d: string
  readonly kind: CurveKind
  readonly overshootRings: number
}

/** One §9.3 fuzz curve (radii θ_k + z·SD_k) and the band it fills. */
export interface FuzzView extends CurveView {
  readonly z: number
  /** Fill opacity ∝ φ(z) ({@link fuzzOpacity}). */
  readonly opacity: number
  /**
   * This curve then its neighbour toward the mean (the crisp curve for the innermost pair), drawn
   * with fill-rule evenodd: the band between them. Only ever a band at the edge, never the shape.
   */
  readonly band: string
}

export interface WedgeView {
  readonly group: string
  readonly d: string
  readonly spokeIds: readonly string[]
}

/** A contiguous angular run of spokes that are all muted or all not muted (§9.5). */
export interface MuteRun {
  readonly muted: boolean
  /** The run's sector (R + 4), used as a clip path for the crisp curve. */
  readonly d: string
  readonly spokeIds: readonly string[]
}

/** Font sizes in user units (the chart sets them as attributes; CSS never fixes them). */
export interface TextSizes {
  /** Spoke labels. */
  readonly label: number
  /** Ring labels, the ring note and stub notes. */
  readonly small: number
  /** Width of the background halo behind every chart text. */
  readonly halo: number
}

/**
 * How the not-measured spokes are labelled: `full` (the name and the stub note, "not measured") or
 * `none` (no label, and a list under the chart names them: D13 B). Short names alone were measured
 * too: they free no width, because the labels of the measured spokes set it.
 */
export type StubLabels = 'full' | 'none'

/** The text layout {@link fitLayout} chooses for a given on-screen width. */
export interface BlobLayout {
  /** Spoke-label size in user units ({@link LABEL_FONT} at full width). */
  readonly fontSize: number
  /**
   * Narrow screens: each spoke's one-line `compactLabel` (axes), or its label wrapped at
   * {@link WRAP_CHARS} (facets), and long stub notes wrapped.
   */
  readonly compact: boolean
  /**
   * Labels of the not-measured spokes; `full` when absent. With `none` (D13 B) the viewBox fits the
   * labels that are left on each side, so the circle may sit off centre and grows.
   */
  readonly stubLabels?: StubLabels
}

/** One line of the list under a chart whose not-measured spokes carry no stub note (D13 B). */
export interface StubGroup {
  /** "Not measured" or "Insufficient data". */
  readonly lead: string
  /** The skills (or facets), full names, in spoke order. */
  readonly names: readonly string[]
}

export const DEFAULT_LAYOUT: BlobLayout = Object.freeze({ fontSize: LABEL_FONT, compact: false })

/** An axis-aligned box in user units. */
export interface Box {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface BlobModel {
  readonly R: number
  readonly viewBox: string
  readonly ring: number
  readonly rings: readonly RingView[]
  readonly spokes: readonly SpokeView[]
  /** The crisp posterior curve (§9.3): closed, or one open curve per run of measured spokes (D13 A). */
  readonly crisp: CurveView
  /**
   * The region the tier (c) hatch fills, clipped to each hatched wedge: the crisp curve when it is
   * closed; with gaps (D13 A), each run's curve closed through the centre, and a narrow sector up to
   * the marker for a lone measured spoke.
   */
  readonly hatchFill: string
  /**
   * The crisp curve's angular runs (§9.5): runs with `muted` are drawn in the muted tone, the
   * others in the blob colour. One run (not muted) when no spoke is muted.
   */
  readonly muteRuns: readonly MuteRun[]
  /**
   * ±1 SD band: outer then inner closed curve, drawn with fill-rule evenodd; with gaps (D13 A), one
   * closed region per run (its outer curve, then its inner curve backwards).
   */
  readonly band: { readonly d: string; readonly outer: CurveView; readonly inner: CurveView }
  /** The §9.3 fuzz, in {@link FUZZ_Z} order (inside out). */
  readonly fuzz: readonly FuzzView[]
  /** Wedge clip paths for tier (c) measured spokes (§9.7 hatch). */
  readonly hatch: readonly { readonly id: string; readonly d: string }[]
  readonly wedges: readonly WedgeView[]
  /** Whether the in-chart ring note is drawn (a share card sets it in its own text instead). */
  readonly showNote: boolean
  /** Where the in-chart ring note (copy.ts RING_NOTE) starts: below the chart, at the left. */
  readonly noteAt: Point
  readonly text: TextSizes
  /** Estimated box of each spoke label (same order as `spokes`) and of the ring note. */
  readonly labelBoxes: readonly Box[]
  readonly noteBox: Box
  /** D13 B: the not-measured spokes the layout leaves without a label, by stub note; empty otherwise. */
  readonly stubList: readonly StubGroup[]
}

export interface BlobOptions extends FitOptions {
  /** Text layout; {@link DEFAULT_LAYOUT} when omitted (see {@link fitLayout}). */
  readonly layout?: BlobLayout
  /** Ids of spokes to mark as named peaks (the share card, D15 A); none on the page. */
  readonly peaks?: Iterable<string>
}

/** Arrowhead length and half-width in user units (the dot it replaces is 4.5 across). */
export const ARROW_LENGTH = 12
export const ARROW_HALF_WIDTH = 6.5

/**
 * An arrowhead on spoke `angle` whose tip sits on the clamp radius `tipR` and points off the
 * scale: outward from the rim for `high`, towards the centre for `low` (UX-037). A closed path
 * starting at the tip; distinct from the grey stub and its ring.
 */
export function arrowPath(angle: number, tipR: number, end: 'low' | 'high'): string {
  const f = (p: Point): string => `${fmt(p[0])},${fmt(p[1])}`
  const baseR = end === 'high' ? tipR - ARROW_LENGTH : tipR + ARROW_LENGTH
  const [bx, by] = polar(baseR, angle)
  const [nx, ny] = [Math.cos(angle) * ARROW_HALF_WIDTH, Math.sin(angle) * ARROW_HALF_WIDTH]
  return `M${f(polar(tipR, angle))}L${f([bx + nx, by + ny])}L${f([bx - nx, by - ny])}Z`
}

/** A sector from angle a0 to a1 (clockwise), radius r, as SVG path data. */
export function sectorPath(a0: number, a1: number, r: number): string {
  const f = (p: Point): string => `${fmt(p[0])},${fmt(p[1])}`
  const span = a1 - a0
  if (span >= 2 * Math.PI - 1e-9) {
    // A full circle: two half arcs.
    const top = polar(r, 0)
    const bottom = polar(r, Math.PI)
    return `M${f(top)}A${r},${r} 0 1,1 ${f(bottom)}A${r},${r} 0 1,1 ${f(top)}Z`
  }
  return `M0,0L${f(polar(r, a0))}A${r},${r} 0 ${span > Math.PI ? 1 : 0},1 ${f(polar(r, a1))}Z`
}

function curveView(points: readonly Point[], ring: number): CurveView {
  const c = chooseCurve(points, ring)
  return { d: c.d, kind: c.kind, overshootRings: c.overshootRings }
}

/** A run of measured spokes between two gaps (D13 A): its first index and length (indices mod K). */
interface Run {
  readonly start: number
  readonly len: number
}

/**
 * One curve of the blob (the crisp curve, a band edge or a fuzz curve): its view, and the recorded
 * open curve of each run (null for a lone spoke, which has no curve), when there are gaps.
 */
interface Curve {
  readonly view: CurveView
  readonly runs: readonly (RecordedPath | null)[] | null
}

/**
 * The curve through `points` (one per spoke): closed when `runs` is null (every spoke measured),
 * else one open curve per run of two or more spokes, each chosen by the overshoot rule on its own;
 * the view reports the last fallback any run needed and the largest overshoot.
 */
function blobCurve(points: readonly Point[], runs: readonly Run[] | null, ring: number): Curve {
  if (runs === null) return { view: curveView(points, ring), runs: null }
  const k = points.length
  const chosen = runs.map((run) => (run.len < 2 ? null : chooseCurve(Array.from({ length: run.len }, (_, j) => points[(run.start + j) % k]!), ring, undefined, false)))
  const drawn = chosen.filter((c) => c !== null)
  const kind = drawn.reduce<CurveKind>((worst, c) => (CURVE_CHAIN.indexOf(c.kind) > CURVE_CHAIN.indexOf(worst) ? c.kind : worst), 'catmullRom')
  return {
    view: { d: drawn.map((c) => c.d).join(''), kind, overshootRings: Math.max(0, ...drawn.map((c) => c.overshootRings)) },
    runs: chosen.map((c) => c?.path ?? null),
  }
}

/**
 * The band between two curves of the same spokes, `a` then `b` (fill-rule evenodd): both closed
 * curves one after the other; with gaps, per run, a's curve, across to b's end, b's curve backwards.
 */
function bandBetween(a: Curve, b: Curve): string {
  if (a.runs === null || b.runs === null) return `${a.view.d}${b.view.d}`
  const f = (p: Point): string => `${fmt(p[0])},${fmt(p[1])}`
  return a.runs
    .map((pa, j) => {
      const pb = b.runs![j]
      return pa === null || pb === null || pb === undefined ? '' : `${pathData(pa)}L${f(pathEnd(pb))}${reversedSegmentsData(pb)}Z`
    })
    .join('')
}

/** The two strokes of an × centred on `at`, its arms at 45° to the spoke at `angle` (D13 A gap marker). */
export function gapMarkPath(at: Point, angle: number, arm = GAP_MARK_ARM): string {
  const f = (p: Point): string => `${fmt(p[0])},${fmt(p[1])}`
  const u: Point = [Math.sin(angle), -Math.cos(angle)] // outward along the spoke
  const t: Point = [Math.cos(angle), Math.sin(angle)] // along the ring
  const d = arm / Math.SQRT2
  const end = (su: number, st: number): Point => [at[0] + d * (su * u[0] + st * t[0]), at[1] + d * (su * u[1] + st * t[1])]
  return `M${f(end(-1, -1))}L${f(end(1, 1))}M${f(end(-1, 1))}L${f(end(1, -1))}`
}

/** The label of the spoke at `angle`, `extra` user units further out than the default place. */
function labelFor(angle: number, R: number, nLines: number, extra = 0): SpokeView['label'] {
  const at = polar(R + LABEL_GAP + extra, angle)
  const s = Math.sin(angle)
  const c = Math.cos(angle)
  // Centred only on (nearly) vertical spokes: two spokes either side of 6 o'clock (odd K) must
  // grow away from each other, not into each other.
  const anchor = Math.abs(s) < 0.1 ? 'middle' : s > 0 ? 'start' : 'end'
  // The block sits above the anchor at the top, below it at the bottom and centred at the sides,
  // moving smoothly with the angle, so neighbouring labels stay apart (t: 0 at the top, 1 at the bottom).
  const block = (nLines - 1) * LABEL_LINE_EM
  const t = (1 - c) / 2
  const dy0 = -block * (1 - t) + 0.8 * t
  return { at, anchor, dy0 }
}

/** Break `text` at spaces into lines of at most `max` characters (a longer word stays whole). */
export function wrapLine(text: string, max = WRAP_CHARS): string[] {
  const out: string[] = []
  for (const w of text.split(/\s+/).filter((x) => x.length > 0)) {
    const last = out.at(-1)
    if (last !== undefined && last.length + 1 + w.length <= max) out[out.length - 1] = `${last} ${w}`
    else out.push(w)
  }
  return out
}

/**
 * The label lines of a spoke: its short label (compact: the one-line compact label, or the label
 * wrapped to {@link WRAP_CHARS}) with the tier glyph, then the stub note if not measured ("not
 * measured" stays one line so it reads as one; a longer note wraps at {@link NOTE_WRAP_CHARS} when
 * compact). `stubs` (D13 B): with `none` a not-measured spoke has no label.
 */
export function spokeLines(s: SpokeEstimate, compact: boolean, stubs: StubLabels = 'full'): LabelLine[] {
  if (!s.measured && stubs === 'none') return []
  const texts = !compact ? [...s.shortLabel] : s.compactLabel !== undefined ? [s.compactLabel] : wrapLine(s.shortLabel.join(' '))
  // The glyph goes on the first line it does not make the widest, else on the shortest line.
  let g = -1
  if (s.glyph) {
    const limit = Math.max(WRAP_CHARS, ...texts.map((t) => t.length))
    g = texts.findIndex((t) => t.length + 2 <= limit)
    if (g < 0) g = texts.reduce((best, t, i) => (t.length < texts[best]!.length ? i : best), 0)
  }
  const main = texts.map((text, i) => ({ text, note: false, glyph: i === g }))
  // A measured spoke beyond the scale says so under its name (UX-037), like a stub says "not measured".
  const off = s.measured && s.theta !== undefined && (s.offScale ?? offScaleOf(s.theta)) !== 'none'
  if (s.measured && !off) return main
  const note = off ? OFF_SCALE_LABEL : stubLabel(s.reason)
  const notes = compact && note.length > NOTE_WRAP_CHARS ? wrapLine(note, NOTE_WRAP_CHARS) : [note]
  return [...main, ...notes.map((text) => ({ text, note: true, glyph: false }))]
}

/** Width of `text` set at font size `size` (italic for stub notes), both in user units. */
export type TextMeasure = (text: string, size: number, italic?: boolean) => number

/** The DOM-free estimate: {@link CHAR_EM} per character (generous for UI sans-serif fonts). */
export const estimateTextWidth: TextMeasure = (text, size) => text.length * CHAR_EM * size

/**
 * The boxes of a spoke label, glyph included: `view` (generous, halo included) for the viewBox and
 * `glyph` (tight, no halo) for overlaps between labels. Line j's baseline is 1.15 em (of line j's
 * own size) below line j − 1's, as the tspans' dy="1.15em" set it.
 */
function labelBoxes(label: SpokeView['label'], lines: readonly LabelLine[], glyph: string, sizes: TextSizes, measure: TextMeasure): { view: Box; glyph: Box } {
  const size = (l: LabelLine): number => (l.note ? sizes.small : sizes.label)
  const w = Math.max(...lines.map((l) => measure(l.glyph ? `${l.text}\u00a0${glyph}` : l.text, size(l), l.note)))
  const [x, y] = label.at
  const x0 = label.anchor === 'start' ? x : label.anchor === 'end' ? x - w : x - w / 2
  const first = y + label.dy0 * sizes.label
  let last = first
  for (let j = 1; j < lines.length; j++) last += LABEL_LINE_EM * size(lines[j]!)
  const s0 = size(lines[0]!)
  const sN = size(lines.at(-1)!)
  const halo = sizes.halo / 2
  return {
    view: { x0: x0 - halo, x1: x0 + w + halo, y0: first - ASCENT_EM * s0 - halo, y1: last + DESCENT_EM * sN + halo },
    glyph: { x0, x1: x0 + w, y0: first - GLYPH_ASCENT_EM * s0, y1: last + GLYPH_DESCENT_EM * sN },
  }
}

function textSizes(fontSize: number): TextSizes {
  const small = SMALL_FONT_RATIO * fontSize
  return { label: fontSize, small, halo: HALO_EM * small }
}

interface TextLayout {
  readonly sizes: TextSizes
  readonly lines: readonly LabelLine[][]
  readonly labels: readonly SpokeView['label'][]
  readonly labelBoxes: readonly Box[]
  readonly noteAt: Point
  readonly noteBox: Box
  readonly viewBox: readonly [number, number, number, number]
  /** Two spoke labels, or a spoke label and a ring label, overlap. */
  readonly collides: boolean
  /** Label every ring (1) or every second one (2). */
  readonly ringStep: 1 | 2
  /** The ring labels' bisector ({@link ringLabelAngle}). */
  readonly ringAngle: number
}

/** Do two boxes come closer than `pad` sideways and `padY` vertically (default: the same)? */
function overlap(a: Box, b: Box, pad = 0, padY = pad): boolean {
  return a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.y0 - padY < b.y1 && b.y0 - padY < a.y1
}

/** Labels whose spoke is within 60° of vertical may move outward to clear their neighbours. */
const MOVABLE_COS = 0.5
/** Outward steps (in em) and their maximum count when clearing a label. */
const MOVE_STEP_EM = 0.25
const MOVE_STEPS = 24
/** Clear space kept between two labels, in em. */
const LABEL_SPACE_EM = 0.1
/**
 * Least clear space between two labels above one another (neighbouring spokes near 12 and 6
 * o'clock), in em of the label size (UX-042: "Quantitative" over "Estimation" read as one label).
 * Their whole boxes count, a note line ("not measured") included. Twice the side gap; a full line
 * of clearance would take the 17-spoke labels below 9 CSS px on a 320 px screen, so the rest of the
 * fix is in the names (`COMPACT_LABELS`: no label that sits above or below another reads as one).
 */
export const LABEL_CLEAR_Y_EM = 0.2

/**
 * The bisector the ring labels sit on: the one between two spokes nearest to vertical, so the
 * labels stack (nearly) straight up or down; the top one unless one below is clearly nearer
 * (small K, e.g. 3 or 5 facets, whose top bisectors lean far over).
 */
export function ringLabelAngle(k: number): number {
  const bisectors = Array.from({ length: k }, (_, i) => spokeAngle(i + 0.5, k))
  const best = Math.max(...bisectors.map((a) => Math.abs(Math.cos(a))))
  const top = bisectors.find((a) => Math.cos(a) >= best - 0.1)
  return top ?? bisectors.find((a) => Math.abs(Math.cos(a)) === best)!
}

/**
 * Where a ring's label starts (text-anchor start): just outside the ring on the ring-label
 * bisector; below the centre, the baseline moves down by the ascent so the text clears the ring.
 */
function ringLabelAt(ringR: number, angle: number, size: number): Point {
  const [x, y] = polar(ringR + 3, angle)
  return Math.cos(angle) < 0 ? [x, y + GLYPH_ASCENT_EM * size] : [x, y]
}

/** Do any two label boxes overlap? (K ≤ 24 spokes: all pairs.) `padY`: the least clear space between two boxes above one another. */
export function labelsCollide(boxes: readonly Box[], pad = 0, padY = pad): boolean {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i]!, boxes[j]!, pad, padY)) return true
  return false
}

/**
 * Where every text goes and the viewBox that holds it: the circle (with the wedges, R + 4) and
 * all label boxes, horizontally symmetric about the centre, then the ring note below.
 */
function textLayout(spokes: readonly SpokeEstimate[], R: number, layout: BlobLayout, measure: TextMeasure, note = true, minRingStep: 1 | 2 = 1): TextLayout {
  const k = spokes.length
  const sizes = textSizes(layout.fontSize)
  const lines = spokes.map((s) => spokeLines(s, layout.compact, layout.stubLabels))
  const angles = spokes.map((_, i) => spokeAngle(i, k))
  // A spoke without a label (D13 B) has an empty box on the circle: it takes no room and never collides.
  const labelled = lines.map((l) => l.length > 0)
  const place = (i: number, extra: number): { label: SpokeView['label']; view: Box; glyph: Box } => {
    const label = labelFor(angles[i]!, R, Math.max(1, lines[i]!.length), extra)
    if (!labelled[i]) {
      const [x, y] = polar(R, angles[i]!)
      const at: Box = { x0: x, x1: x, y0: y, y1: y }
      return { label, view: at, glyph: at }
    }
    return { label, ...labelBoxes(label, lines[i]!, spokes[i]!.glyph, sizes, measure) }
  }
  // Height is free (the chart's height follows its width), width is not: labels towards 12 and
  // 6 o'clock, where neighbours sit side by side, move outward along their spoke until they clear
  // the labels already placed. Side labels are placed first and never move.
  const order = angles.map((_, i) => i).sort((a, b) => Math.abs(Math.cos(angles[a]!)) - Math.abs(Math.cos(angles[b]!)) || a - b)
  const placed: ({ label: SpokeView['label']; view: Box; glyph: Box } | undefined)[] = new Array<undefined>(k)
  const space = LABEL_SPACE_EM * sizes.label
  const spaceY = LABEL_CLEAR_Y_EM * sizes.label
  // The ring labels (inside the circle, but large text reaches out) are fixed obstacles.
  // Every ring labelled, or every second one when a label is taller than the vertical step
  // between two ring labels (large text on narrow screens), so ring labels never overlap.
  const ringAngle = ringLabelAngle(k)
  const ringRise = ringSpacing(R) * Math.abs(Math.cos(ringAngle))
  const ringStep: 1 | 2 = minRingStep === 2 || (GLYPH_ASCENT_EM + GLYPH_DESCENT_EM) * sizes.small + space > ringRise ? 2 : 1
  const r = radiusScale(R)
  const ringBoxes: Box[] = RING_THETAS.filter((t) => t % ringStep === 0).map((t) => {
    const [x, y] = ringLabelAt(r(t), ringAngle, sizes.small)
    return { x0: x, x1: x + measure(ringLabel(t), sizes.small), y0: y - GLYPH_ASCENT_EM * sizes.small, y1: y + GLYPH_DESCENT_EM * sizes.small }
  })
  const clashes = (b: Box): boolean => placed.some((q, j) => q !== undefined && labelled[j] && overlap(b, q.glyph, space, spaceY)) || ringBoxes.some((q) => overlap(b, q, space))
  for (const i of order) {
    let p = place(i, 0)
    if (labelled[i] && Math.abs(Math.cos(angles[i]!)) >= MOVABLE_COS) {
      for (let n = 1; n <= MOVE_STEPS && clashes(p.glyph); n++) p = place(i, n * MOVE_STEP_EM * sizes.label)
    }
    placed[i] = p
  }
  const boxes = placed.map((p) => p!)
  const labels = boxes.map((b) => b.label)
  const viewBoxes = boxes.map((b) => b.view)
  const outer = R + 4
  let left = outer
  let right = outer
  let top = -outer
  let bottom = outer
  for (const [i, b] of viewBoxes.entries()) {
    if (!labelled[i]) continue
    left = Math.max(left, -b.x0)
    right = Math.max(right, b.x1)
    top = Math.min(top, b.y0)
    bottom = Math.max(bottom, b.y1)
  }
  // Centred on the circle, unless the not-measured spokes are bare (D13 B): then each side holds
  // only its own labels, and the note at the left edge widens the right side if it must.
  if ((layout.stubLabels ?? 'full') === 'full') left = right = Math.max(left, right)
  const noteW = Math.max(...RING_NOTE.map((t) => measure(t, sizes.small))) + sizes.halo
  if (note) {
    const spare = noteW - (left + right)
    if (spare > 0) [left, right] = left === right ? [left + spare / 2, right + spare / 2] : [left, right + spare]
  }
  left += VIEW_PAD
  right += VIEW_PAD
  const noteX = -left + VIEW_PAD
  const noteY = bottom + (NOTE_LINE_EM + 0.2) * sizes.small
  const noteLast = noteY + (RING_NOTE.length - 1) * NOTE_LINE_EM * sizes.small
  // Without the note the box is empty, on the chart's bottom edge: it adds nothing to the viewBox.
  const noteBox: Box = note
    ? { x0: noteX, x1: noteX + noteW, y0: noteY - ASCENT_EM * sizes.small, y1: noteLast + DESCENT_EM * sizes.small + sizes.halo / 2 }
    : { x0: noteX, x1: noteX, y0: bottom, y1: bottom }
  const y0 = top - VIEW_PAD
  // Spoke labels keep a line of clear space above one another; ring labels only need to stay apart.
  const glyphs = boxes.filter((_, i) => labelled[i]).map((b) => b.glyph)
  const collides = labelsCollide(glyphs, space, spaceY) || glyphs.some((g) => ringBoxes.some((q) => overlap(g, q, space))) || labelsCollide(ringBoxes, space)
  return {
    sizes,
    lines,
    labels,
    labelBoxes: viewBoxes,
    noteAt: [noteX, noteY],
    noteBox,
    viewBox: [-left, y0, left + right, noteBox.y1 + VIEW_PAD - y0],
    collides,
    ringStep,
    ringAngle,
  }
}

/** Options of {@link fitLayout} and {@link renderedSizes}. */
export interface FitOptions {
  readonly R?: number
  /** Text widths; {@link estimateTextWidth} by default (the browser passes canvas measurements). */
  readonly measure?: TextMeasure
  /**
   * The page's root font size in CSS px (UX-044): 16 is the browser default. Larger (the person
   * raised the text size) scales the legibility floor and the font range with it. Below 16 counts as 16.
   */
  readonly rootPx?: number
  /** Draw the in-chart ring note (default true); a share card sets the same words in its own text. */
  readonly note?: boolean
  /** Label every ring (1, the default unless the text is large) or only −2, 0 and +2 SD (2). */
  readonly ringStep?: 1 | 2
}

/** The root font size the text floors are written for. */
export const BASE_ROOT_PX = 16

/** How much larger than the default the person's text is (≥ 1, at most 4). */
export function textScale(rootPx: number | undefined): number {
  return rootPx !== undefined && Number.isFinite(rootPx) && rootPx > BASE_ROOT_PX ? Math.min(4, rootPx / BASE_ROOT_PX) : 1
}

/** The default text layout at a text scale (`textScale`): {@link DEFAULT_LAYOUT} at 1. */
export function defaultLayout(scale = 1): BlobLayout {
  return scale === 1 ? DEFAULT_LAYOUT : { fontSize: LABEL_FONT * scale, compact: false }
}

/** At a rendered width: the on-screen size (CSS px) of the smallest chart text and of R, and whether labels overlap. */
export function renderedSizes(
  spokes: readonly SpokeEstimate[],
  widthPx: number,
  layout: BlobLayout,
  opts: FitOptions = {},
): { smallPx: number; rPx: number; collides: boolean } {
  const R = opts.R ?? DEFAULT_R
  const t = textLayout(spokes, R, layout, opts.measure ?? estimateTextWidth, opts.note ?? true, opts.ringStep ?? 1)
  const scale = widthPx / t.viewBox[2]
  return { smallPx: t.sizes.small * scale, rPx: R * scale, collides: t.collides }
}

/** The size of a layout in user units, for fitting a chart into a box that is not set by its width alone (the share card). */
export interface LayoutExtent {
  /** viewBox width and height. */
  readonly width: number
  readonly height: number
  /** The smallest chart text (ring labels, notes), in user units. */
  readonly small: number
  /** Two labels, or a label and a ring label, come closer than they should. */
  readonly collides: boolean
}

/** {@link LayoutExtent} of `layout` for these spokes (no paths are built: cheap enough to search with). */
export function layoutExtent(spokes: readonly SpokeEstimate[], layout: BlobLayout, opts: FitOptions = {}): LayoutExtent {
  const t = textLayout(spokes, opts.R ?? DEFAULT_R, layout, opts.measure ?? estimateTextWidth, opts.note ?? true, opts.ringStep ?? 1)
  return { width: t.viewBox[2], height: t.viewBox[3], small: t.sizes.small, collides: t.collides }
}

/** Bisect for the boundary of a monotone predicate on [lo, hi] (true at the high end): its low edge. */
function lowestTrue(pred: (f: number) => boolean, lo: number, hi: number): number {
  for (let i = 0; i < 30 && hi - lo > 0.05; i++) {
    const mid = (lo + hi) / 2
    if (pred(mid)) hi = mid
    else lo = mid
  }
  return hi
}

/** What {@link fitLayoutDetailed} found. */
export interface LayoutFit {
  readonly layout: BlobLayout
  /** On-screen size (CSS px) of the smallest chart text with this layout. */
  readonly smallPx: number
  /**
   * The smallest chart text reaches {@link MIN_TEXT_PX} (scaled with the page's text size) on
   * screen with no labels overlapping. False on a very narrow screen or with very large text: the
   * page then points to the bar view.
   */
  readonly legible: boolean
}

/**
 * The text layout for a chart rendered `widthPx` CSS px wide (M1.16 review: legible at phone
 * width). {@link DEFAULT_LAYOUT} if its smallest text is already ≥ {@link MIN_TEXT_PX} with no
 * labels overlapping. Otherwise, per label mode (full, then compact), the smallest font size that
 * reaches {@link MIN_TEXT_PX} on screen, if the labels do not overlap there: full labels if they
 * fit (unless compact ones leave a circle over {@link COMPACT_GAIN} times larger), else compact
 * ones. If neither fits (a very narrow screen), the mode and size with the
 * largest collision-free text. Larger text widens the viewBox, so the circle shrinks: legible
 * labels win over size on a phone, and the bar view is one tap away. Font sizes stay within
 * [{@link LABEL_FONT}, {@link MAX_LABEL_FONT}]. Unknown width (≤ 0, before layout): the default.
 *
 * With `opts.rootPx` above 16 (the person enlarged the text, UX-044) the floor {@link MIN_TEXT_PX}
 * and the font range scale with it, so chart text grows with the page's; `legible` says whether
 * the floor was reached.
 *
 * Both searches bisect: the on-screen text size grows with the font size (the viewBox grows at
 * most linearly with it, from a positive width), and label boxes grow with it, so overlaps
 * appear as it grows (outward moves near 12 and 6 o'clock make this nearly, not strictly, so:
 * the best-effort size steps down until clear).
 */
export function fitLayoutDetailed(spokes: readonly SpokeEstimate[], widthPx: number, opts: FitOptions = {}): LayoutFit {
  const k = textScale(opts.rootPx)
  const def = defaultLayout(k)
  if (!(widthPx > 0) || !Number.isFinite(widthPx) || spokes.length === 0) return { layout: def, smallPx: 0, legible: true }
  const minPx = MIN_TEXT_PX * k
  const at = (layout: BlobLayout): ReturnType<typeof renderedSizes> => renderedSizes(spokes, widthPx, layout, opts)
  const d = at(def)
  if (d.smallPx >= minPx && !d.collides) return { layout: def, smallPx: d.smallPx, legible: true }
  // D13 B: too narrow for the default and many not-measured spokes: those spokes lose their labels
  // to a list under the chart, which leaves the measured ones (and the circle) the room. (Whether
  // compact labels are needed depends on the font, so it is not the test of "narrow".)
  const stubs: StubLabels | undefined = spokes.filter((s) => !s.measured).length >= STUB_LIST_MIN ? 'none' : undefined
  const [full, compact] = [fitMode(spokes, widthPx, opts, false, stubs), fitMode(spokes, widthPx, opts, true, stubs)]
  // Full labels unless compact ones leave a circle more than COMPACT_GAIN larger.
  let chosen: ModeFit
  if (full.fits && (!compact.fits || compact.rPx <= COMPACT_GAIN * full.rPx)) chosen = full
  else if (compact.fits) chosen = compact
  else chosen = compact.smallPx > full.smallPx + 1e-9 ? compact : full
  return { layout: chosen.layout, smallPx: chosen.smallPx, legible: chosen.fits || (chosen.smallPx >= minPx - 1e-6 && !chosen.collides) }
}

/** What {@link fitMode} found for one label mode. */
interface ModeFit {
  readonly layout: BlobLayout
  readonly smallPx: number
  readonly rPx: number
  readonly collides: boolean
  /** The floor is reached with no labels overlapping. */
  readonly fits: boolean
}

/**
 * For one label mode (full or compact labels, and how not-measured spokes are labelled), the smallest
 * font size that reaches the floor with no overlaps; failing that, the largest clear size (best effort).
 */
function fitMode(spokes: readonly SpokeEstimate[], widthPx: number, opts: FitOptions, compact: boolean, stubLabels?: StubLabels): ModeFit {
  const k = textScale(opts.rootPx)
  const minPx = MIN_TEXT_PX * k
  const minFont = LABEL_FONT * k
  const maxFont = MAX_LABEL_FONT * k
  const step = FIT_STEP * k
  const layoutAt = (fontSize: number): BlobLayout => (stubLabels === undefined ? { fontSize, compact } : { fontSize, compact, stubLabels })
  const at = (f: number): ReturnType<typeof renderedSizes> => renderedSizes(spokes, widthPx, layoutAt(f), opts)
  const legible = (f: number): boolean => at(f).smallPx >= minPx
  const overlaps = (f: number): boolean => at(f).collides
  const fLegible = legible(maxFont) ? lowestTrue(legible, minFont, maxFont) : maxFont
  if (legible(fLegible)) {
    // Legible from fLegible up; the first size from there without overlaps (outward moves make
    // overlaps only nearly monotone in the size, so step up rather than trust one probe).
    let f = fLegible
    while (f < maxFont && overlaps(f)) f = Math.min(maxFont, f + step)
    if (!overlaps(f)) {
      const r = at(f)
      return { layout: layoutAt(f), smallPx: r.smallPx, rPx: r.rPx, collides: false, fits: true }
    }
  }
  // Best effort: the largest size below which labels do not overlap (or the smallest size).
  const fClear = !overlaps(minFont) ? (overlaps(maxFont) ? lowestTrue(overlaps, minFont, maxFont) - 0.05 : maxFont) : minFont
  let f = Math.max(minFont, Math.min(fLegible, fClear))
  while (f > minFont && overlaps(f)) f = Math.max(minFont, f - step)
  const r = at(f)
  return { layout: layoutAt(f), smallPx: r.smallPx, rPx: r.rPx, collides: r.collides, fits: false }
}

/** {@link fitLayoutDetailed}'s layout. */
export function fitLayout(spokes: readonly SpokeEstimate[], widthPx: number, opts: FitOptions = {}): BlobLayout {
  return fitLayoutDetailed(spokes, widthPx, opts).layout
}

/** {@link fitLayout} takes compact labels over full ones that also fit only for a circle this much larger. */
export const COMPACT_GAIN = 1.2
/** Font-size step (user units) when {@link fitLayout} walks past overlaps. */
const FIT_STEP = 0.5

/** Contiguous runs of equal `key` around the cycle, starting at a run boundary (or one run). */
function cyclicRuns<T>(keys: readonly T[]): { key: T; start: number; len: number }[] {
  const k = keys.length
  const startAt = keys.findIndex((g, i) => g !== keys[(i - 1 + k) % k])
  if (startAt < 0) return [{ key: keys[0]!, start: 0, len: k }]
  const runs: { key: T; start: number; len: number }[] = []
  let i = startAt
  for (let n = 0; n < k; ) {
    const key = keys[i % k]!
    const start = i
    while (n < k && keys[i % k] === key) {
      i++
      n++
    }
    runs.push({ key, start, len: i - start })
  }
  return runs
}

/** The sector of spokes start … start + len − 1 (indices mod k), half a spoke gap either side. */
function runSector(start: number, len: number, k: number, r: number): string {
  if (len >= k) return sectorPath(0, 2 * Math.PI, r)
  const half = Math.PI / k
  return sectorPath(spokeAngle(start, k) - half, spokeAngle(start + len - 1, k) + half, r)
}

/**
 * The render model of a blob with the given spokes (in order around the circle). Needs ≥ 3
 * spokes. The fuzz follows each measured spoke's θ and SD (§9.3), so axes (correlated posterior,
 * per-axis SD) and facets (separate EAPs) are drawn the same way.
 */
export function buildBlob(spokes: readonly SpokeEstimate[], opts: BlobOptions = {}): BlobModel {
  const R = opts.R ?? DEFAULT_R
  const layout = opts.layout ?? DEFAULT_LAYOUT
  if (!(layout.fontSize > 0) || !Number.isFinite(layout.fontSize)) throw new RangeError('layout.fontSize must be positive')
  const k = spokes.length
  if (k < 3) throw new RangeError('a blob needs at least 3 spokes')
  const r = radiusScale(R)
  const rMin = R_MIN_FRACTION * R
  const ring = ringSpacing(R)
  const angles = spokes.map((_, i) => spokeAngle(i, k))
  const half = Math.PI / k

  // D13 A: with every spoke measured the curves are closed; otherwise they break at each
  // not-measured spoke (null: no gaps). A not-measured spoke's point is never drawn.
  const runs: Run[] | null = spokes.every((s) => s.measured)
    ? null
    : cyclicRuns(spokes.map((s) => s.measured))
        .filter((run) => run.key)
        .map(({ start, len }) => ({ start, len }))
  const radiiOf = (thetaOf: (s: SpokeEstimate, i: number) => number): Point[] =>
    spokes.map((s, i) => polar(s.measured ? r(thetaOf(s, i)) : rMin, angles[i]!))
  const curveOf = (thetaOf: (s: SpokeEstimate, i: number) => number): Curve => blobCurve(radiiOf(thetaOf), runs, ring)

  const crispCurve = curveOf((s) => s.theta!)
  const outerCurve = curveOf((s) => s.theta! + s.sd!)
  const innerCurve = curveOf((s) => s.theta! - s.sd!)
  const crisp = crispCurve.view
  // §9.3: nested curves at θ + z·SD; each fills the band toward the mean with opacity ∝ φ(z).
  const fuzzCurves = FUZZ_Z.map((z) => curveOf((s) => s.theta! + z * s.sd!))
  const mid = N_FUZZ / 2 // fuzz[mid − 1] and fuzz[mid] are the innermost pair (z = ∓Z90/10)
  const fuzz: FuzzView[] = FUZZ_Z.map((z, j) => {
    const c = fuzzCurves[j]!
    const inward = j === mid - 1 || j === mid ? crispCurve : fuzzCurves[z < 0 ? j + 1 : j - 1]!
    return { ...c.view, z, opacity: fuzzOpacity(z), band: bandBetween(c, inward) }
  })
  // What the tier (c) hatch fills (clipped to its wedges): the closed crisp curve, or per run the
  // curve closed through the centre, and a narrow sector up to the marker of a lone spoke.
  const hatchFill =
    runs === null || crispCurve.runs === null
      ? crisp.d
      : runs
          .map((run, j) => {
            const path = crispCurve.runs![j]
            if (path) return `M0,0L${pathData(path).slice(1)}Z`
            const i = run.start % k
            return sectorPath(angles[i]! - half / 2, angles[i]! + half / 2, r(spokes[i]!.theta!))
          })
          .join('')

  const showNote = opts.note ?? true
  const peaks = new Set(opts.peaks ?? [])
  const text = textLayout(spokes, R, layout, opts.measure ?? estimateTextWidth, showNote, opts.ringStep ?? 1)
  const views: SpokeView[] = spokes.map((s, i) => {
    const a = angles[i]!
    const lines = text.lines[i]!
    const base = {
      id: s.id,
      name: s.name,
      lines,
      ...(peaks.has(s.id) ? { peak: true } : {}),
      glyph: s.glyph,
      tier: s.tier,
      group: s.group,
      measured: s.measured,
      muted: s.muted,
      angle: a,
      outer: polar(R, a),
      label: text.labels[i]!,
    }
    if (!s.measured) {
      // D13 A: the gap marker is an × on the 0 SD ring, not a point at the centre (−3 SD).
      const gap = polar(r(0), a)
      return { ...base, stub: polar(STUB_FRACTION * R, a), gap, gapMark: gapMarkPath(gap, a) }
    }
    // Beyond the scale the dot is an arrowhead on the clamp (UX-037); the whisker keeps whatever part of the range is inside.
    const end = s.offScale !== undefined ? s.offScale : offScaleOf(s.theta!)
    const off = end === 'none' ? {} : { offScale: end, arrow: arrowPath(a, end === 'high' ? R : rMin, end) }
    return {
      ...base,
      marker: polar(r(s.theta!), a),
      whisker: [polar(r(s.lo90!), a), polar(r(s.hi90!), a)] as const,
      ...off,
    }
  })

  const hatch = spokes.flatMap((s, i) => (s.measured && s.tier === 'c' ? [{ id: s.id, d: sectorPath(angles[i]! - half, angles[i]! + half, R + 4) }] : []))

  // One wedge per contiguous run of a group around the cycle.
  const wedges: WedgeView[] = cyclicRuns(spokes.map((s) => s.group)).map((run) => ({
    group: run.key,
    d: runSector(run.start, run.len, k, R + 4),
    spokeIds: Array.from({ length: run.len }, (_, j) => spokes[(run.start + j) % k]!.id),
  }))
  // §9.5: the crisp curve in runs, muted around muted spokes.
  const muteRuns: MuteRun[] = cyclicRuns(spokes.map((s) => s.muted)).map((run) => ({
    muted: run.key,
    d: runSector(run.start, run.len, k, R + 4),
    spokeIds: Array.from({ length: run.len }, (_, j) => spokes[(run.start + j) % k]!.id),
  }))

  const rings: RingView[] = RING_THETAS.map((t) => ({
    theta: t,
    r: r(t),
    label: ringLabel(t),
    reference: t === 0,
    labelAt: ringLabelAt(r(t), text.ringAngle, text.sizes.small),
    showLabel: t % text.ringStep === 0,
  }))

  const viewBox = text.viewBox.map((v) => fmt(v)).join(' ')
  return {
    R,
    viewBox,
    ring,
    rings,
    spokes: views,
    crisp,
    hatchFill,
    muteRuns,
    band: { d: bandBetween(outerCurve, innerCurve), outer: outerCurve.view, inner: innerCurve.view },
    fuzz,
    hatch,
    wedges,
    showNote,
    noteAt: text.noteAt,
    text: text.sizes,
    labelBoxes: text.labelBoxes,
    noteBox: text.noteBox,
    stubList: stubList(spokes, layout),
  }
}

/**
 * D13 B: the not-measured spokes a layout leaves without a label (`none`), grouped by the note they
 * would carry ("Not measured", "Insufficient data"), in spoke order; empty otherwise.
 */
export function stubList(spokes: readonly SpokeEstimate[], layout: BlobLayout): StubGroup[] {
  if ((layout.stubLabels ?? 'full') === 'full') return []
  const groups = new Map<string, string[]>()
  for (const s of spokes) {
    if (s.measured) continue
    const lead = stubListLead(s.reason)
    groups.set(lead, [...(groups.get(lead) ?? []), s.name])
  }
  return [...groups].map(([lead, names]) => ({ lead, names }))
}
