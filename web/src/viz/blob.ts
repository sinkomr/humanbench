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
 * - Not-measured spokes (§9.7, A15): a dashed spoke, a grey stub at the centre and a gap marker;
 *   every curve dips to the inner clamp there (never interpolated through).
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

import { OFF_SCALE_LABEL, RING_NOTE } from './copy'
import { chooseCurve, fmt, type CurveKind } from './curve'
import { offScaleOf, polar, R_MIN_FRACTION, radiusScale, ringLabel, ringSpacing, RING_THETAS, spokeAngle, Z90, type Point } from './geometry'
import { stubLabel, type SpokeEstimate } from './profile'

/** Default outer radius (θ = +3) in SVG user units. */
export const DEFAULT_R = 180
/** The grey stub at the centre of a not-measured spoke, as a fraction of R (§9.7). */
const STUB_FRACTION = 0.14
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
  /** Not measured: the grey stub from the centre and the gap marker where the curve dips. */
  readonly stub?: Point
  readonly gap?: Point
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

/** The text layout {@link fitLayout} chooses for a given on-screen width. */
export interface BlobLayout {
  /** Spoke-label size in user units ({@link LABEL_FONT} at full width). */
  readonly fontSize: number
  /**
   * Narrow screens: each spoke's one-line `compactLabel` (axes), or its label wrapped at
   * {@link WRAP_CHARS} (facets), and long stub notes wrapped.
   */
  readonly compact: boolean
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
  /** The crisp posterior curve (§9.3). */
  readonly crisp: CurveView
  /**
   * The crisp curve's angular runs (§9.5): runs with `muted` are drawn in the muted tone, the
   * others in the blob colour. One run (not muted) when no spoke is muted.
   */
  readonly muteRuns: readonly MuteRun[]
  /** ±1 SD band: outer then inner closed curve, drawn with fill-rule evenodd. */
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
}

export interface BlobOptions extends FitOptions {
  /** Text layout; {@link DEFAULT_LAYOUT} when omitted (see {@link fitLayout}). */
  readonly layout?: BlobLayout
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
 * compact).
 */
export function spokeLines(s: SpokeEstimate, compact: boolean): LabelLine[] {
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
  const lines = spokes.map((s) => spokeLines(s, layout.compact))
  const angles = spokes.map((_, i) => spokeAngle(i, k))
  const place = (i: number, extra: number): { label: SpokeView['label']; view: Box; glyph: Box } => {
    const label = labelFor(angles[i]!, R, lines[i]!.length, extra)
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
  const clashes = (b: Box): boolean => placed.some((q) => q !== undefined && overlap(b, q.glyph, space, spaceY)) || ringBoxes.some((q) => overlap(b, q, space))
  for (const i of order) {
    let p = place(i, 0)
    if (Math.abs(Math.cos(angles[i]!)) >= MOVABLE_COS) {
      for (let n = 1; n <= MOVE_STEPS && clashes(p.glyph); n++) p = place(i, n * MOVE_STEP_EM * sizes.label)
    }
    placed[i] = p
  }
  const boxes = placed.map((p) => p!)
  const labels = boxes.map((b) => b.label)
  const viewBoxes = boxes.map((b) => b.view)
  const outer = R + 4
  let half = outer
  let top = -outer
  let bottom = outer
  for (const b of viewBoxes) {
    half = Math.max(half, -b.x0, b.x1)
    top = Math.min(top, b.y0)
    bottom = Math.max(bottom, b.y1)
  }
  const noteW = Math.max(...RING_NOTE.map((t) => measure(t, sizes.small))) + sizes.halo
  half = Math.max(half, note ? noteW / 2 : 0) + VIEW_PAD
  const noteX = -half + VIEW_PAD
  const noteY = bottom + (NOTE_LINE_EM + 0.2) * sizes.small
  const noteLast = noteY + (RING_NOTE.length - 1) * NOTE_LINE_EM * sizes.small
  // Without the note the box is empty, on the chart's bottom edge: it adds nothing to the viewBox.
  const noteBox: Box = note
    ? { x0: noteX, x1: noteX + noteW, y0: noteY - ASCENT_EM * sizes.small, y1: noteLast + DESCENT_EM * sizes.small + sizes.halo / 2 }
    : { x0: noteX, x1: noteX, y0: bottom, y1: bottom }
  const y0 = top - VIEW_PAD
  // Spoke labels keep a line of clear space above one another; ring labels only need to stay apart.
  const glyphs = boxes.map((b) => b.glyph)
  const collides = labelsCollide(glyphs, space, spaceY) || glyphs.some((g) => ringBoxes.some((q) => overlap(g, q, space))) || labelsCollide(ringBoxes, space)
  return {
    sizes,
    lines,
    labels,
    labelBoxes: viewBoxes,
    noteAt: [noteX, noteY],
    noteBox,
    viewBox: [-half, y0, 2 * half, noteBox.y1 + VIEW_PAD - y0],
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
  const minFont = LABEL_FONT * k
  const maxFont = MAX_LABEL_FONT * k
  const step = FIT_STEP * k
  const at = (layout: BlobLayout): ReturnType<typeof renderedSizes> => renderedSizes(spokes, widthPx, layout, opts)
  const d = at(def)
  if (d.smallPx >= minPx && !d.collides) return { layout: def, smallPx: d.smallPx, legible: true }
  let fallback: { layout: BlobLayout; smallPx: number; collides: boolean } | null = null
  const fits: { layout: BlobLayout; rPx: number; smallPx: number }[] = []
  for (const compact of [false, true]) {
    const legible = (f: number): boolean => at({ fontSize: f, compact }).smallPx >= minPx
    const overlaps = (f: number): boolean => at({ fontSize: f, compact }).collides
    const fLegible = legible(maxFont) ? lowestTrue(legible, minFont, maxFont) : maxFont
    if (legible(fLegible)) {
      // Legible from fLegible up; the first size from there without overlaps (outward moves make
      // overlaps only nearly monotone in the size, so step up rather than trust one probe).
      let f = fLegible
      while (f < maxFont && overlaps(f)) f = Math.min(maxFont, f + step)
      if (!overlaps(f)) {
        const layout = { fontSize: f, compact }
        const r = at(layout)
        fits.push({ layout, rPx: r.rPx, smallPx: r.smallPx })
        continue
      }
    }
    // Best effort: the largest size below which labels do not overlap (or the smallest size).
    const fClear = !overlaps(minFont) ? (overlaps(maxFont) ? lowestTrue(overlaps, minFont, maxFont) - 0.05 : maxFont) : minFont
    let f = Math.max(minFont, Math.min(fLegible, fClear))
    while (f > minFont && overlaps(f)) f = Math.max(minFont, f - step)
    const layout = { fontSize: f, compact }
    const r = at(layout)
    if (fallback === null || r.smallPx > fallback.smallPx + 1e-9) fallback = { layout, smallPx: r.smallPx, collides: r.collides }
  }
  // Full labels unless compact ones leave a circle more than COMPACT_GAIN larger.
  const [full, compact] = [fits.find((c) => !c.layout.compact), fits.find((c) => c.layout.compact)]
  if (full && (!compact || compact.rPx <= COMPACT_GAIN * full.rPx)) return { layout: full.layout, smallPx: full.smallPx, legible: true }
  if (compact) return { layout: compact.layout, smallPx: compact.smallPx, legible: true }
  return { layout: fallback!.layout, smallPx: fallback!.smallPx, legible: fallback!.smallPx >= minPx - 1e-6 && !fallback!.collides }
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

  const radiiOf = (thetaOf: (s: SpokeEstimate, i: number) => number): Point[] =>
    spokes.map((s, i) => polar(s.measured ? r(thetaOf(s, i)) : rMin, angles[i]!))

  const crisp = curveView(
    radiiOf((s) => s.theta!),
    ring,
  )
  const outer = curveView(
    radiiOf((s) => s.theta! + s.sd!),
    ring,
  )
  const inner = curveView(
    radiiOf((s) => s.theta! - s.sd!),
    ring,
  )
  // §9.3: nested curves at θ + z·SD; each fills the band toward the mean with opacity ∝ φ(z).
  const fuzzCurves = FUZZ_Z.map((z) =>
    curveView(
      radiiOf((s) => s.theta! + z * s.sd!),
      ring,
    ),
  )
  const mid = N_FUZZ / 2 // fuzz[mid − 1] and fuzz[mid] are the innermost pair (z = ∓Z90/10)
  const fuzz: FuzzView[] = FUZZ_Z.map((z, j) => {
    const c = fuzzCurves[j]!
    const inward = j === mid - 1 || j === mid ? crisp : fuzzCurves[z < 0 ? j + 1 : j - 1]!
    return { ...c, z, opacity: fuzzOpacity(z), band: `${c.d}${inward.d}` }
  })

  const showNote = opts.note ?? true
  const text = textLayout(spokes, R, layout, opts.measure ?? estimateTextWidth, showNote, opts.ringStep ?? 1)
  const views: SpokeView[] = spokes.map((s, i) => {
    const a = angles[i]!
    const lines = text.lines[i]!
    const base = {
      id: s.id,
      name: s.name,
      lines,
      glyph: s.glyph,
      tier: s.tier,
      group: s.group,
      measured: s.measured,
      muted: s.muted,
      angle: a,
      outer: polar(R, a),
      label: text.labels[i]!,
    }
    if (!s.measured) return { ...base, stub: polar(STUB_FRACTION * R, a), gap: polar(rMin, a) }
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
    muteRuns,
    band: { d: `${outer.d}${inner.d}`, outer, inner },
    fuzz,
    hatch,
    wedges,
    showNote,
    noteAt: text.noteAt,
    text: text.sizes,
    labelBoxes: text.labelBoxes,
    noteBox: text.noteBox,
  }
}
