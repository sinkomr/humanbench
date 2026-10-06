/**
 * Practice prompts for the dev-only page `#/dev/aut` and its e2e (ROADMAP M6.4; DESIGN §14.6 ex. 17). The two objects are the
 * classic public examples of the task (a brick, a paperclip), the ones `PROMPT_NORMS_V0` is keyed on. A prompt has no key, so
 * nothing about it is secret; the page marks it as practice, seeds the pick (A11) and gives it an id that cannot be a bank id
 * (`demo:aut:<seed>`). The query switches (`?seconds=`, `?embedder=`) are read here, so the page and its tests agree on them.
 */

import { createRng, type RngSeed } from '../../engine/prng'
import { AUT_DEFAULT_SECONDS, AUT_MAX_SECONDS, AUT_MIN_SECONDS, autSpec, type AutSpec } from './spec'

/** What the page says to mark a prompt as made for the demo. */
export const DEMO_NOTE = 'A practice object for this page.'

/** The practice objects, in this order. */
export const DEMO_OBJECTS: readonly string[] = Object.freeze(['brick', 'paperclip'])

/** A demo prompt as the page uses it. */
export interface DemoAutItem {
  /** `demo:aut:<seed>`: never an A11 bank id. */
  readonly item_id: string
  readonly spec: AutSpec
}

/**
 * The seeded demo prompt: same seed, same object (A11). `seconds` is the round length, {@link AUT_DEFAULT_SECONDS} unless
 * the page was given a valid `?seconds=` ({@link parseSeconds}).
 */
export function demoAutItem(seed: RngSeed, seconds: number = AUT_DEFAULT_SECONDS): DemoAutItem {
  const rng = createRng(`demo:aut:${String(seed)}`)
  return { item_id: `demo:aut:${String(seed)}`, spec: autSpec(rng.pick(DEMO_OBJECTS), seconds) }
}

/**
 * The round length a `?seconds=N` query asks for: a whole number, raised to {@link AUT_MIN_SECONDS} when below it and cut
 * to {@link AUT_MAX_SECONDS} when above; null when absent or not a whole number (the page then keeps 90 s). Dev only: it
 * is how a test makes a round short.
 */
export function parseSeconds(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !/^\d{1,6}$/.test(raw.trim())) return null
  return Math.min(AUT_MAX_SECONDS, Math.max(AUT_MIN_SECONDS, Number(raw.trim())))
}

/** Which scorer the page uses: the model downloaded on a button press, or the test stand-in (`?embedder=mock`, no download). */
export type EmbedderChoice = 'minilm' | 'mock'

/** The scorer a `?embedder=` query asks for: 'mock' only for exactly that value. */
export function parseEmbedderChoice(raw: string | null | undefined): EmbedderChoice {
  return raw === 'mock' ? 'mock' : 'minilm'
}
