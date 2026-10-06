/**
 * The names a person reads for the 17 skills and the six session parts (provisional default,
 * UX-REVIEW D25, option A with option C's display names; the owner has not confirmed it yet).
 *
 * One form everywhere, Title Case: the interstitial ("Up next: Reaction Time"), the part's heading,
 * the checklist, "Skip Reaction Time", the notices, the focus picker, the bar table, the blob labels,
 * the share card and the results sections all take a skill's name from here (`axisName`), so they
 * cannot drift apart.
 *
 * The engine registry (`engine/axes.ts`, mirrored by bank `hb.axes`) keeps the DESIGN §3 names: they
 * are the shared axis spec of the two scorers. Two of them are research words, so the screens show
 * plain display names instead:
 * - LG "Analytical/Logic Games" → "Logic Games";
 * - CAL "Calibration/Metacognition" → "Confidence Calibration".
 * Every other skill keeps its registry name, which is already Title Case. The emotion skill keeps its
 * R-5.6.2 name word for word, "(text scenarios)" included (`copy.ts` EMO_AXIS_NAME, ROADMAP A7).
 */

import { AXES, type AxisCode } from './engine/axes'

/** The plain display names of the two skills whose §3 names are research words. */
export const PLAIN_AXIS_NAMES: Readonly<Partial<Record<AxisCode, string>>> = Object.freeze({
  LG: 'Logic Games',
  CAL: 'Confidence Calibration',
})

/** Every skill's on-screen name, by axis code. */
export const AXIS_NAMES: Readonly<Record<AxisCode, string>> = Object.freeze(
  Object.fromEntries(AXES.map((a) => [a.code, PLAIN_AXIS_NAMES[a.code] ?? a.name])) as Record<AxisCode, string>,
)

/** The name a person reads for a skill (and for the session part that measures it). */
export function axisName(code: AxisCode): string {
  return AXIS_NAMES[code]
}
