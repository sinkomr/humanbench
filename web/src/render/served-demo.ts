/**
 * Made-up payloads of the remaining families as the server's `item_view` sends them (ROADMAP M3.11; owner decisions
 * 2026-10-13), for the session simulator, the jsdom tests and the browser tests: a Fermi estimate (`fermi_v1`), a
 * word-links puzzle (`rat_triad_v1`), an emotion vignette (`emotion_vignette_v1`), a situational judgment
 * (`sjt_rating_v1`) and a logic game's question (`logic_game_v1`, with its setup). **Everything here is synthetic and
 * says so**, or is a practice item of the dev demos (the `demo.ts` of each task family), and none carries a key (R-11.1; CLAUDE.md: no
 * finite-bank items and no keys in this repository).
 */

import { demoEmotionItem } from '../tasks/emotion/demo'
import { demoFermiItem } from '../tasks/fermi/demo'
import { demoRatItem } from '../tasks/rat/demo'
import { demoSjtItem } from '../tasks/sjt/demo'

/** A payload with the fields of `hb.item_view` beside the ids: what `toServedItem` reads. */
export interface DemoServedPayload {
  readonly itemType: string
  readonly stem: string
  readonly media: Readonly<Record<string, unknown>>
  readonly options: readonly string[] | null
}

/** A practice Fermi question of the dev demo, as served: the stem and the entry's shape, no truth. */
export function demoFermiPayload(seed: number): DemoServedPayload {
  const { spec } = demoFermiItem(seed)
  return { itemType: 'fermi_estimate', stem: spec.stem, media: { renderer: 'fermi_v1', dimension: spec.dimension, units: [...spec.units], interval_pct: 80 }, options: null }
}

/** A practice word-links puzzle of the dev demo, as served: the three cues, no answer. */
export function demoRatPayload(seed: number): DemoServedPayload {
  const { spec } = demoRatItem(seed)
  return { itemType: 'rat_triad', stem: spec.cues.join(' / '), media: { renderer: 'rat_triad_v1', cues: [...spec.cues] }, options: null }
}

/** A practice emotion vignette of the dev demo, as served: the situation and five feelings, no key. */
export function demoEmotionPayload(seed: number): DemoServedPayload {
  const { spec } = demoEmotionItem(seed)
  return { itemType: 'emotion_vignette_mc', stem: spec.stem, media: { renderer: 'emotion_vignette_v1' }, options: [...spec.options] }
}

/** A practice situational judgment of the dev demo, as served: the situation, the question and four responses, no ratings. */
export function demoSjtPayload(seed: number): DemoServedPayload {
  const { spec } = demoSjtItem(seed)
  return { itemType: 'sjt_rating', stem: spec.scenario, media: { renderer: 'sjt_rating_v1', question: spec.question }, options: [...spec.responses] }
}

/** Made-up logic-game setups: an opening sentence and one sentence per rule, as the bank's are written. */
export const DEMO_SETUPS: readonly string[] = Object.freeze([
  'Five made-up tokens (P, Q, R, S and T) are placed in slots numbered 1 through 5, one token to a slot. P is in an earlier slot than Q. R is not in slot 1. S and T are not in consecutive slots.',
  'Six made-up lamps (F, G, H, J, K and L) are each either lit or unlit. At least one of F and G is lit. If H is lit, then J is unlit. K and L are not both unlit.',
  'Four made-up boats (W, X, Y and Z) finish a made-up race with no ties, in places 1 through 4. W finishes ahead of Y. X finishes in place 2 or place 3. Z does not finish last.',
])

/** Question `q` (0-based) of made-up game `game`, as served: its setup in `media`, a made-up stem and five options. */
export function demoLogicGamePayload(game: number, q: number): DemoServedPayload {
  const setup = DEMO_SETUPS[game % DEMO_SETUPS.length]!
  return {
    itemType: 'mc_logic_game',
    stem: `Made-up question ${q + 1} about made-up game ${game + 1}: which one of the following could be true? (No real question.)`,
    media: { renderer: 'logic_game_v1', setup },
    options: ['A', 'B', 'C', 'D', 'E'].map((x) => `Made-up arrangement ${x} for question ${q + 1}`),
  }
}
