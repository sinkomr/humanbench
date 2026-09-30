/**
 * The share card (DESIGN §9.9, §10, §13; ROADMAP M1.18, A12, A13, A15; R-5.6.1, R-5.6.4, R-17.12,
 * CLAUDE.md blob rules): a 1200 × 630 CSS px picture of the blob, the person's most distinctive
 * peaks and how many sessions it rests on, as one SVG document built from strings (no DOM), so it
 * is deterministic and testable in Node. The PNG export rasterises the same document at 2×
 * (2400 × 1260, `export.ts`).
 *
 * What a card may show, and nothing else:
 * - **Only measured skills the person left on.** A skill that was hidden is not drawn at all: it is
 *   left out of the blob (the remaining spokes keep the fixed seriation order, re-spread round the
 *   circle), out of the labels, the peaks, the description and the text alternative, and no value
 *   of it reaches the output (`card.test.ts`: for the same peaks, the SVG is byte-identical
 *   whatever a hidden skill's estimate is; `ShareCard.dom.test.ts`: also through the peaks, which
 *   the panel takes over the shown skills only). Not-measured skills get no stub here: the picture
 *   shows what was measured and chosen.
 * - **No emotion lows (R-5.6.4).** Emotion Reading is put on a card only when its estimate is at or
 *   above the 0 SD ring ({@link EMO_MIN_THETA}); below it the skill is {@link CardStatus withheld}
 *   whether or not the person hid it, so a low there is never drawn, listed or highlighted.
 * - **Peaks, never lows.** "Most distinctive peaks" are credible peaks only (A12: the 90% range
 *   lies above 0), at most three, each with its 90% range. Their contrasts are taken against the
 *   mean of the skills that are ON the card, so the caller computes them from the shown skills
 *   (`ShareCard.svelte`): a mean over a hidden skill or a withheld Emotion Reading would carry that
 *   skill's level into the visible numbers. No skill is picked out as a weakness (R-5.6.4).
 * - **No total, mean, area or single score (§9.5 a).** The blob is `buildBlob`'s: radius linear in θ
 *   over [−3, 3] (§9.1), the crisp mean curve, the ±1 SD band, the §9.3 fuzz and the 90% whiskers,
 *   the tier hatch, the muting rule, and the in-chart ring note ("Rings: SD units, provisional").
 * - **No other text.** Every text is an axis label, a ring label, the ring note, or a line of
 *   `card-copy.ts`. Notes for an AI (Phase AI), the R-5.6.5 resource line and the save file are
 *   never inputs of this module, and `card.test.ts` scans the output for them.
 *
 * Colours are inlined from the palette (§9.8): a picture cannot read the page's CSS variables.
 */

import { AXIS_INDEX, axis, type AxisCode } from '../engine/axes'
import { buildBlob, estimateTextWidth, fitLayout, LABEL_LINE_EM, MIN_TEXT_PX, NOTE_LINE_EM, wrapLine, type BlobModel } from './blob'
import {
  CARD_BRAND,
  CARD_NO_PEAKS,
  CARD_NOTE_READING,
  CARD_NOTE_SCALE,
  CARD_PEAKS_HEADING,
  CARD_PEAKS_SUB,
  CARD_PURPOSE,
  CARD_TITLE,
  cardAlt,
  cardPeakRange,
  cardPeakStands,
  cardSessions,
} from './card-copy'
import { RING_NOTE } from './copy'
import { formatTheta } from './geometry'
import { THEMES, type ThemeName, type VizTheme } from './palette'
import { COMPACT_LABELS, SHORT_LABELS, type AxisEstimate, type SpokeEstimate } from './profile'

/** The card's size in CSS px (ROADMAP M1.18: exactly 1200 × 630). */
export const CARD_W = 1200
export const CARD_H = 630
/** The PNG is the card at 2×: 2400 × 1260 px. */
export const PNG_SCALE = 2
/** A blob needs at least 3 spokes (`buildBlob`), so a card needs at least 3 skills. */
export const MIN_CARD_SKILLS = 3
/** At most this many peaks are listed (§9.9: "3 top strengths"). */
export const CARD_MAX_PEAKS = 3

/** R-5.6.4: Emotion Reading is on a card only at or above the 0 SD ring. */
export const EMO_CODE: AxisCode = 'EMO'
export const EMO_MIN_THETA = 0

/** A picture cannot load the page's fonts, so it names the system ones the app uses (`app.css`). */
export const CARD_FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

/** Where each part of the card sits, in card px. */
const BLOB_REGION = { x: 24, y: 24, w: 664, h: 582 } as const
const COLUMN_X = 728
export const CARD_COLUMN_W = 448
/** Smallest chart text on the card, in card px, that the blob's fit aims for (largest first). */
const TEXT_TARGETS: readonly number[] = [16, 15, 14, 13, 12, MIN_TEXT_PX]

// --------------------------------------------------------------------------------- which skills

/** Why a skill is or is not on the card. */
export type CardStatus = 'shown' | 'hidden' | 'withheld' | 'unmeasured'

export interface CardAxis {
  readonly estimate: AxisEstimate
  readonly status: CardStatus
}

/**
 * R-5.6.4: Emotion Reading with an estimate below the 0 SD ring never goes on a card. (Its
 * estimate is measured and finite whenever this is asked, so the plain comparison is enough.)
 */
export function isWithheld(e: Pick<SpokeEstimate, 'measured' | 'theta'> & { readonly code?: AxisCode }): boolean {
  return e.code === EMO_CODE && e.measured && (e.theta ?? 0) < EMO_MIN_THETA
}

/** Every skill's card status, in spoke order (module comment). A withheld skill stays withheld even if hidden. */
export function cardAxes(estimates: readonly AxisEstimate[], hidden: Iterable<AxisCode> = []): CardAxis[] {
  const off = new Set(hidden)
  return estimates.map((estimate) => ({
    estimate,
    status: !estimate.measured ? 'unmeasured' : isWithheld(estimate) ? 'withheld' : off.has(estimate.code) ? 'hidden' : 'shown',
  }))
}

/**
 * The estimate with every drawn word taken from the registry by axis code (the numbers stay the
 * caller's): a card's texts are then a closed list, whatever the estimate objects carry.
 */
function canonical(e: AxisEstimate): AxisEstimate {
  const def = axis(e.code)
  return { ...e, name: def.name, glyph: def.glyph, tier: def.tier, shortLabel: SHORT_LABELS[e.code], compactLabel: COMPACT_LABELS[e.code] }
}

/**
 * The peak shape the card needs (`reveal/peaks.ts` `Contrast` fits it). The card writes the skill's
 * name from the registry by `code`: no caller-supplied string is ever drawn.
 */
export interface CardPeak {
  readonly code: AxisCode
  readonly name?: string
  /** θ_k − θ̄ in SD units (A12). */
  readonly contrast: number
  readonly lo90: number
  readonly hi90: number
}

/**
 * The peaks a card lists: those on the card (never a hidden, withheld or unmeasured skill) that
 * are credible peaks (a positive contrast whose 90% range lies above 0, A12), the strongest first,
 * at most {@link CARD_MAX_PEAKS}. A low is never listed, whatever the caller passes (R-5.6.4).
 * `peaks` must have been computed over the skills on the card (module comment): this only filters.
 */
export function cardPeaks(peaks: readonly CardPeak[], shown: Iterable<AxisCode>, max = CARD_MAX_PEAKS): CardPeak[] {
  const on = new Set(shown)
  return peaks
    .filter((p) => on.has(p.code) && [p.contrast, p.lo90, p.hi90].every(Number.isFinite) && p.contrast > 0 && p.lo90 > 0)
    .sort((a, b) => b.contrast - a.contrast || AXIS_INDEX[a.code] - AXIS_INDEX[b.code])
    .slice(0, max)
}

// -------------------------------------------------------------------------------------- layout

/** A text of the card's right-hand column. */
export interface CardText {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly size: number
  readonly weight: 400 | 600 | 700
  readonly fill: keyof Pick<VizTheme, 'text' | 'textStrong' | 'textAccent' | 'textMuted'>
}

/** The registry's name of a peak's skill (the card never draws a name a caller supplies). */
export function peakName(p: Pick<CardPeak, 'code'>): string {
  return axis(p.code).name
}

/** The right-hand column: brand, title, sessions, peaks (or a plain sentence), then the small print. */
export function columnTexts(sessions: number, allPeaks: readonly CardPeak[]): CardText[] {
  const peaks = allPeaks.slice(0, CARD_MAX_PEAKS)
  const out: CardText[] = []
  const put = (text: string, y: number, size: number, weight: CardText['weight'], fill: CardText['fill']): void => {
    out.push({ text, x: COLUMN_X, y, size, weight, fill })
  }
  put(CARD_BRAND, 64, 26, 700, 'textAccent')
  put(CARD_TITLE, 114, 38, 700, 'textStrong')
  put(cardSessions(sessions), 148, 18, 400, 'textMuted')
  let y = 210
  if (peaks.length === 0) {
    for (const line of wrapLine(CARD_NO_PEAKS, 38)) {
      put(line, y, 18, 400, 'textMuted')
      y += 26
    }
  } else {
    put(CARD_PEAKS_HEADING, y, 21, 700, 'textStrong')
    put(CARD_PEAKS_SUB, y + 24, 14, 400, 'textMuted')
    y += 66
    for (const p of peaks) {
      const name = wrapLine(peakName(p), 34)
      name.forEach((line, i) => put(line, y + 26 * i, 22, 700, 'textStrong'))
      y += 26 * (name.length - 1)
      put(cardPeakStands(p.contrast.toFixed(1)), y + 25, 16, 400, 'text')
      put(cardPeakRange(formatTheta(p.lo90, 1), formatTheta(p.hi90, 1)), y + 47, 16, 400, 'textMuted')
      y += 86
    }
  }
  // The small print sits at the bottom, last baseline 24 px from the edge.
  const lines = [wrapLine(CARD_NOTE_SCALE, 54), wrapLine(CARD_NOTE_READING, 54), [CARD_PURPOSE]]
  const rows = lines.reduce((n, g) => n + g.length, 0)
  let fy = CARD_H - 24 - (rows - 1) * 17 - (lines.length - 1) * 8
  for (const group of lines) {
    for (const line of group) {
      put(line, fy, 13, 400, 'textMuted')
      fy += 17
    }
    fy += 8
  }
  return out
}

export interface BlobPlacement {
  readonly model: BlobModel
  /** Card px per blob user unit, and where the blob's centre (0, 0) lands. */
  readonly scale: number
  readonly tx: number
  readonly ty: number
  /** The smallest chart text (ring labels, note) on the card, in card px. */
  readonly smallPx: number
}

/**
 * The blob for these spokes, as large as fits the left part of the card with the largest chart
 * text that still fits (at least {@link MIN_TEXT_PX}, aiming for 16 card px, since a card is
 * often seen shrunk in a feed). Deterministic: widths are estimated, never measured.
 */
export function placeBlob(spokes: readonly SpokeEstimate[]): BlobPlacement {
  let fit: BlobPlacement | undefined
  for (const target of TEXT_TARGETS) {
    // fitLayout aims for MIN_TEXT_PX at the width it is given: a narrower width asks for larger text.
    const layout = fitLayout(spokes, (BLOB_REGION.w * MIN_TEXT_PX) / target)
    const model = buildBlob(spokes, { layout })
    const [vx, vy, vw, vh] = model.viewBox.split(' ').map(Number) as [number, number, number, number]
    const scale = Math.min(BLOB_REGION.w / vw, BLOB_REGION.h / vh)
    fit = {
      model,
      scale,
      tx: BLOB_REGION.x + (BLOB_REGION.w - vw * scale) / 2 - vx * scale,
      ty: BLOB_REGION.y + (BLOB_REGION.h - vh * scale) / 2 - vy * scale,
      smallPx: model.text.small * scale,
    }
    if (fit.smallPx >= target - 1e-6) break
  }
  return fit!
}

// ------------------------------------------------------------------------------------ markup

const f2 = (v: number): string => v.toFixed(2)

/** XML text and attribute escaping. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** The stylesheet of the picture: `BlobChart.svelte`'s rules with the palette's colours inlined. */
function styleSheet(t: VizTheme): string {
  return [
    `.blob text{paint-order:stroke fill;stroke:${t.bg};stroke-linejoin:round}`,
    `.ring{fill:none;stroke:${t.grid};stroke-width:1}`,
    `.ring.reference{stroke:${t.stub};stroke-dasharray:5 4}`,
    `.spoke{stroke:${t.grid};stroke-width:1}`,
    `.band{fill:${t.band};fill-opacity:.12;stroke:none}`,
    `.fuzz path{fill:${t.band};stroke:none}`,
    `.hatch{stroke:none}`,
    `.hatch-line{stroke:${t.hatch};stroke-width:2}`,
    `.crisp{fill:none;stroke:${t.blob};stroke-width:2.5;stroke-linejoin:round}`,
    `.crisp-muted{fill:none;stroke:${t.muted};stroke-width:2;stroke-linejoin:round}`,
    `.whisker{stroke:${t.blob};stroke-width:1.75}`,
    `.marker{fill:${t.blob};stroke:${t.bg};stroke-width:1.5}`,
    `.muted .whisker{stroke:${t.muted}}`,
    `.muted .marker{fill:${t.bg};stroke:${t.muted};stroke-width:2}`,
    `.ring-label{fill:${t.textMuted}}`,
    `.ring-label.reference{font-weight:600}`,
    `.ring-note{fill:${t.textMuted}}`,
    `.label{fill:${t.textStrong}}`,
    `.label.muted{fill:${t.text}}`,
  ].join('')
}

/**
 * The blob as SVG elements, in the coordinates of `model` (a string twin of `BlobChart.svelte`
 * for measured spokes: `card.dom.test.ts` compares the two element by element, so they cannot
 * drift apart). `id` prefixes the pattern and clip-path ids.
 */
export function blobMarkup(model: BlobModel, id: string): string {
  const mutedRuns = model.muteRuns.filter((r) => r.muted)
  const credibleRuns = model.muteRuns.filter((r) => !r.muted)
  const p: string[] = ['<defs>']
  p.push(`<pattern id="${id}-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="hatch-line" x1="0" y1="0" x2="0" y2="7"/></pattern>`)
  model.hatch.forEach((h, i) => p.push(`<clipPath id="${id}-clip-${i}"><path d="${h.d}"/></clipPath>`))
  if (mutedRuns.length > 0) {
    p.push(`<clipPath id="${id}-credible">${credibleRuns.map((r) => `<path d="${r.d}"/>`).join('')}</clipPath>`)
    p.push(`<clipPath id="${id}-muted">${mutedRuns.map((r) => `<path d="${r.d}"/>`).join('')}</clipPath>`)
  }
  p.push('</defs>')

  p.push('<g class="grid">')
  for (const r of model.rings) p.push(`<circle class="ring${r.reference ? ' reference' : ''}" r="${f2(r.r)}"/>`)
  for (const s of model.spokes) p.push(`<line class="spoke" x1="0" y1="0" x2="${f2(s.outer[0])}" y2="${f2(s.outer[1])}"/>`)
  p.push('</g>')

  p.push(`<path class="band" d="${model.band.d}" fill-rule="evenodd"/>`)
  p.push('<g class="fuzz">')
  for (const c of model.fuzz) p.push(`<path d="${c.band}" fill-rule="evenodd" fill-opacity="${c.opacity.toFixed(3)}"/>`)
  p.push('</g>')
  model.hatch.forEach((_, i) => p.push(`<path class="hatch" d="${model.crisp.d}" fill="url(#${id}-hatch)" clip-path="url(#${id}-clip-${i})"/>`))
  p.push(`<path class="crisp" d="${model.crisp.d}"${mutedRuns.length > 0 ? ` clip-path="url(#${id}-credible)"` : ''}/>`)
  if (mutedRuns.length > 0) p.push(`<path class="crisp-muted" d="${model.crisp.d}" clip-path="url(#${id}-muted)"/>`)

  p.push('<g class="marks">')
  for (const s of model.spokes) {
    if (!s.whisker || !s.marker) throw new RangeError('a card draws measured skills only')
    p.push(
      `<g class="mark${s.muted ? ' muted' : ''}"><line class="whisker" x1="${f2(s.whisker[0][0])}" y1="${f2(s.whisker[0][1])}" x2="${f2(s.whisker[1][0])}" y2="${f2(s.whisker[1][1])}"/><circle class="marker" cx="${f2(s.marker[0])}" cy="${f2(s.marker[1])}" r="4.5"/></g>`,
    )
  }
  p.push('</g>')

  p.push(`<g class="ring-labels" font-size="${f2(model.text.small)}" stroke-width="${f2(model.text.halo)}">`)
  for (const r of model.rings.filter((x) => x.showLabel)) {
    p.push(`<text class="ring-label${r.reference ? ' reference' : ''}" x="${f2(r.labelAt[0])}" y="${f2(r.labelAt[1])}">${esc(r.label)}</text>`)
  }
  p.push('</g>')

  const [nx, ny] = model.noteAt
  p.push(`<text class="ring-note" x="${f2(nx)}" y="${f2(ny)}" font-size="${f2(model.text.small)}" stroke-width="${f2(model.text.halo)}">`)
  RING_NOTE.forEach((line, i) => p.push(`<tspan x="${f2(nx)}" dy="${i === 0 ? '0' : `${NOTE_LINE_EM}em`}">${esc(line)}</tspan>`))
  p.push('</text>')

  p.push(`<g class="labels" font-size="${f2(model.text.label)}" stroke-width="${f2(model.text.halo)}">`)
  for (const s of model.spokes) {
    p.push(`<text class="label${s.muted ? ' muted' : ''}" x="${f2(s.label.at[0])}" y="${f2(s.label.at[1])}" text-anchor="${s.label.anchor}">`)
    s.lines.forEach((line, i) => {
      // U+00A0 (the page's &nbsp;) keeps the tier glyph on its label's line.
      p.push(`<tspan x="${f2(s.label.at[0])}" dy="${i === 0 ? s.label.dy0.toFixed(2) : LABEL_LINE_EM}em">${esc(line.text)}${line.glyph ? ` ${esc(s.glyph)}` : ''}</tspan>`)
    })
    p.push('</text>')
  }
  p.push('</g>')
  return p.join('')
}

// ------------------------------------------------------------------------------------- the card

export interface CardInput {
  /** All 17 estimates in spoke order (`axisEstimates`). */
  readonly estimates: readonly AxisEstimate[]
  /** Skills the person left off the card. */
  readonly hidden?: Iterable<AxisCode>
  /** The credible peaks among the skills ON the card, strongest first (`distinctivePeaks` over the shown skills). */
  readonly peaks?: readonly CardPeak[]
  /** Sessions the profile rests on. */
  readonly sessions: number
  /** Card colours; default the light palette. */
  readonly theme?: ThemeName
}

export interface CardModel {
  /** The skills drawn, in spoke order. */
  readonly shown: readonly AxisCode[]
  /** The peaks listed (module comment). */
  readonly peaks: readonly CardPeak[]
  readonly texts: readonly CardText[]
  readonly placement: BlobPlacement
  readonly theme: ThemeName
  /** The text alternative of the picture. */
  readonly alt: string
  /** The card at 1200 × 630 (the SVG export and the on-page preview). */
  readonly svg: string
  /** Everything inside the root element, for {@link cardSvg}. */
  readonly inner: string
}

/**
 * The card for these inputs. Throws a RangeError when fewer than {@link MIN_CARD_SKILLS} skills
 * are on it, or `sessions` is not a positive whole number.
 */
export function buildCard(input: CardInput): CardModel {
  if (!Number.isInteger(input.sessions) || input.sessions < 1) throw new RangeError('a card rests on at least one session')
  const axes = cardAxes(input.estimates, input.hidden)
  const spokes = axes.filter((a) => a.status === 'shown').map((a) => canonical(a.estimate))
  if (spokes.length < MIN_CARD_SKILLS) throw new RangeError(`a card needs at least ${MIN_CARD_SKILLS} skills`)
  const shown = spokes.map((s) => s.code)
  const peaks = cardPeaks(input.peaks ?? [], shown)
  const placement = placeBlob(spokes)
  const texts = columnTexts(input.sessions, peaks)
  const theme = input.theme ?? 'light'
  const t = THEMES[theme]
  const alt = cardAlt(shown.length, peaks.map(peakName))
  const desc = `${alt} Skills: ${spokes.map((s) => s.name).join(', ')}.`

  const inner = [
    `<title id="hb-card-title">${esc(CARD_TITLE)}</title>`,
    `<desc id="hb-card-desc">${esc(desc)}</desc>`,
    `<style>${styleSheet(t)}</style>`,
    `<rect width="${CARD_W}" height="${CARD_H}" fill="${t.bg}"/>`,
    `<g transform="translate(${f2(placement.tx)} ${f2(placement.ty)}) scale(${placement.scale.toFixed(4)})" class="blob">${blobMarkup(placement.model, 'hb-card')}</g>`,
    ...texts.map(
      (x) => `<text x="${x.x}" y="${x.y}" font-size="${x.size}"${x.weight === 400 ? '' : ` font-weight="${x.weight}"`} fill="${t[x.fill]}">${esc(x.text)}</text>`,
    ),
  ].join('')
  const model: Omit<CardModel, 'svg'> = { shown, peaks, texts, placement, theme, alt, inner }
  return { ...model, svg: cardSvg(model) }
}

/**
 * A card as a standalone SVG document: 1200 × 630 CSS px at `scale` 1 (the SVG export), or the
 * same picture at 2400 × 1260 for the PNG (same viewBox, so it is vector-sharp at any size).
 */
export function cardSvg(card: Pick<CardModel, 'inner'>, scale = 1): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W * scale}" height="${CARD_H * scale}" viewBox="0 0 ${CARD_W} ${CARD_H}" role="img" aria-labelledby="hb-card-title hb-card-desc" font-family="${esc(CARD_FONT)}">` +
    card.inner +
    '</svg>\n'
  )
}

/** Width of a card text (an estimate, generous for UI sans-serif fonts; used by the layout tests). */
export function cardTextWidth(t: CardText): number {
  return estimateTextWidth(t.text, t.size)
}
