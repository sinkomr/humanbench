/**
 * Blob palette (DESIGN §9.8, §13; ROADMAP M1.16): Okabe–Ito colours (colour-blind safe) with the
 * §9.8 roles — blob #0072B2, band #56B4E9, tier-c hatch #E69F00, muted #999999 — and text tokens
 * with at least 4.5:1 contrast on the page background in both colour schemes (WCAG 1.4.3). Marks
 * that carry meaning (the mean stroke, whiskers, markers, not-measured stubs) keep at least 3:1
 * (WCAG 1.4.11). `palette.test.ts` checks every ratio and that the backgrounds match `app.css`.
 *
 * Deviations, documented:
 * - Light scheme: #999999 is 2.8:1 on white, below the 3:1 non-text minimum, so muted marks use
 *   #808080 there; the dark scheme keeps §9.8's #999999.
 * - Dark scheme: the two blue roles swap (blob #56B4E9, band #0072B2). #0072B2 is only 3.5:1 on
 *   the dark background (#15151a), enough for 3:1 but not for 4.5:1, so it cannot serve as the
 *   text accent there; #56B4E9 is 7.9:1. Keeping the mean curve, its markers and the accent text
 *   in one colour, the brighter blue takes the blob role and the darker one the (translucent)
 *   band. Both stay Okabe–Ito, so the pair is still colour-blind safe (§9.8).
 */

/** The eight Okabe–Ito colours (Okabe & Ito 2008). */
export const OKABE_ITO = Object.freeze({
  black: '#000000',
  orange: '#E69F00',
  skyBlue: '#56B4E9',
  bluishGreen: '#009E73',
  yellow: '#F0E442',
  blue: '#0072B2',
  vermillion: '#D55E00',
  reddishPurple: '#CC79A7',
})

/** §9.8 "muted #999999": spikes whose 90% interval crosses θ = 0 (§9.5, A12). */
export const MUTED_GREY = '#999999'

export interface VizTheme {
  /** Page background (must equal `--bg` of app.css in the same scheme). */
  readonly bg: string
  /** Body text. */
  readonly text: string
  /** Headings and axis labels. */
  readonly textStrong: string
  /** Text in the blob colour (legend keys, credible values). */
  readonly textAccent: string
  /** Text of muted and not-measured spokes. */
  readonly textMuted: string
  /** The crisp mean curve and credible markers (§9.3). */
  readonly blob: string
  /** The ±1 SD band and the fuzz bands (§9.3). */
  readonly band: string
  /** Tier (c) hatch (§9.7). */
  readonly hatch: string
  /** Muted markers and whiskers (§9.5). */
  readonly muted: string
  /** Rings and spokes (decorative grid). */
  readonly grid: string
  /** Not-measured stubs, dashed spokes and gap markers (§9.7). */
  readonly stub: string
}

export const THEMES: Readonly<Record<'light' | 'dark', VizTheme>> = Object.freeze({
  light: Object.freeze({
    bg: '#ffffff',
    text: '#3d3a44',
    textStrong: '#0b0a0f',
    textAccent: OKABE_ITO.blue,
    textMuted: '#6b6b6b',
    blob: OKABE_ITO.blue,
    band: OKABE_ITO.skyBlue,
    hatch: OKABE_ITO.orange,
    muted: '#808080',
    grid: '#d4d3d8',
    stub: '#767676',
  }),
  dark: Object.freeze({
    bg: '#15151a',
    text: '#c9c7cf',
    textStrong: '#f4f3f6',
    textAccent: OKABE_ITO.skyBlue,
    textMuted: MUTED_GREY,
    blob: OKABE_ITO.skyBlue,
    band: OKABE_ITO.blue,
    hatch: OKABE_ITO.orange,
    muted: MUTED_GREY,
    grid: '#3a3942',
    stub: '#8c8c8c',
  }),
})

export type ThemeName = keyof typeof THEMES

/** Tokens used for text: each needs ≥ 4.5:1 against `bg` (WCAG 1.4.3, §9.8). */
export const TEXT_TOKENS = ['text', 'textStrong', 'textAccent', 'textMuted'] as const satisfies readonly (keyof VizTheme)[]

/** Tokens of marks that carry meaning: each needs ≥ 3:1 against `bg` (WCAG 1.4.11). */
export const MARK_TOKENS = ['blob', 'muted', 'stub'] as const satisfies readonly (keyof VizTheme)[]

export const MIN_TEXT_CONTRAST = 4.5
export const MIN_MARK_CONTRAST = 3

function channel(v: number): number {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new RangeError(`expected #rrggbb, got ${JSON.stringify(hex)}`)
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((h) => channel(parseInt(h, 16))) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio (L1 + 0.05)/(L2 + 0.05), in [1, 21]. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** CSS custom properties (`--hb-<token>`) for a theme, to set on the chart's root element. */
export function themeVars(theme: VizTheme): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(theme)) out[`--hb-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = v
  return out
}
