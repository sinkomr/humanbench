/**
 * Scoring a finished round (ROADMAP M6.4; DESIGN §5.4): embeds the object, its "a use for X" template and the ideas in ONE
 * call of the embedder, then hands the vectors to the pure scoring core (`scoring.ts`). The embedder runs on the device
 * (`minilm.ts`) or is the test stand-in (`embedder.ts`); nothing here sends a text anywhere.
 */

import type { Embedder } from './embedder'
import { AUT_PARAMS_V0, type AutParams } from './params'
import { scoreAut, type AutScore } from './scoring'
import { templateText } from './text'

/**
 * The score of `responses` for `object`: embeds `[object, templateText(object), ...responses]` in one `embed` call and
 * calls `scoreAut` (default parameters {@link AUT_PARAMS_V0}). `object` is embedded as given (the bare word, which is what
 * the prompt norms are keyed on). Throws the RangeError of `scoreAut` or `templateText` for an empty object, and an Error
 * when the embedder returns another number of vectors than texts; an embedder's own failure rejects as it is.
 */
export async function scoreResponses(embedder: Embedder, object: string, responses: readonly string[], params: AutParams = AUT_PARAMS_V0): Promise<AutScore> {
  const texts = [object, templateText(object), ...responses]
  const vecs = await embedder.embed(texts)
  if (vecs.length !== texts.length) throw new Error(`the embedder returned ${vecs.length} vectors for ${texts.length} texts`)
  const [objectVec, templateVec, ...rest] = vecs as [Float32Array, Float32Array, ...Float32Array[]]
  return scoreAut({ object, objectVec, templateVec, responses: responses.map((text, i) => ({ text, vec: rest[i] as Float32Array })) }, params)
}
