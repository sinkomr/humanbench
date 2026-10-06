/**
 * The scoring core of the Alternative Uses Task ("Unusual uses", experimental; ROADMAP M6.4, DESIGN
 * §5.4, §14.6 example 17): fluency, originality (semantic distance, mean of the top 3), its
 * within-prompt z-score, and flexibility (embedding clusters), from embedding vectors only.
 *
 * Pure and deterministic: no embedder, no Svelte, no DOM, no randomness, no I/O. The caller embeds
 * `[object, templateText(object), ...responses]` and passes the vectors in.
 *
 * **Each response**, in the order given, gets one status; the first that applies wins:
 * 1. `empty`: no word left after `cleanResponse` (blank, or only punctuation or symbols);
 * 2. `personal_info`: `personalInfo` finds something (DESIGN §8: "don't type personal info"). Its
 *    text comes back with those pieces replaced by "[removed]", so a score object never carries them;
 * 3. `too_long`: more than `maxWords` words (§5.4);
 * 4. `implausible`: its cosine with the "a use for X" template (`plausibility`) does not exceed
 *    `plausibilityFloor`, or its vector has no direction (zero or non-finite);
 * 5. `duplicate`: the same text as an earlier scored response (ignoring case, punctuation and
 *    spacing), or a cosine of at least `duplicateCosine` with one; the first is kept;
 * 6. `scored`.
 *
 * **Scores** use the scored responses only: fluency is how many there are; originality is the mean
 * of the `topK` largest distances (all of them, flagged `fewer_than_top_k`, when there are fewer; null
 * when there are none); originalityZ standardises it with the prompt's norm (null without one);
 * flexibility is the number of average-linkage clusters among them (./cluster).
 *
 * distance = 1 − cosine(objectVec, vec), in [0, 2]. An empty response's vector is ignored (it may be
 * any length or none): its distance and plausibility are reported as 0.
 */

import { clusterIds } from './cluster'
import { AUT_PARAMS_V0, checkAutParams, promptNorm, PROMPT_NORMS_V0, type AutParams, type PromptNorm } from './params'
import { cleanResponse, personalInfo, redactPersonalInfo, wordCount } from './text'
import { cosine, isFiniteVec, norm } from './vec'

export type { AutParams } from './params'

export interface AutScoreInput {
  readonly object: string
  readonly objectVec: Float32Array
  readonly templateVec: Float32Array
  readonly responses: readonly { readonly text: string; readonly vec: Float32Array }[]
}

export type AutStatus = 'scored' | 'duplicate' | 'too_long' | 'implausible' | 'personal_info' | 'empty'

/** Every status, in precedence order (the first that applies to a response wins). */
export const AUT_STATUS_PRECEDENCE: readonly AutStatus[] = Object.freeze([
  'empty',
  'personal_info',
  'too_long',
  'implausible',
  'duplicate',
  'scored',
])

export interface AutResponseScore {
  /** The cleaned response; for `personal_info`, with each personal piece replaced by "[removed]". */
  readonly text: string
  /** 1 − cosine(objectVec, vec), in [0, 2]; 0 for an empty response. */
  readonly distance: number
  /** cosine(templateVec, vec), in [−1, 1]; 0 for an empty response. */
  readonly plausibility: number
  readonly status: AutStatus
  /** The flexibility cluster (0, 1, ... by first appearance) for a scored response, else null. */
  readonly cluster: number | null
}

export interface AutScore {
  /** The parameter set's version (`AutParams.version`). */
  readonly version: string
  readonly fluency: number
  readonly originality: number | null
  readonly originalityZ: number | null
  readonly flexibility: number
  readonly perResponse: readonly AutResponseScore[]
  /** Zero or more of {@link AUT_FLAGS}, in that order. */
  readonly flags: readonly string[]
}

/**
 * The flags a score can carry:
 * - `no_scored_responses`: nothing was scored, so originality is null;
 * - `fewer_than_top_k`: some but fewer than `topK` responses were scored, so originality is the mean
 *   of those;
 * - `no_prompt_norm`: the object has no norm, so originalityZ is null;
 * - `personal_info`: at least one response held personal information and was not scored (the UI
 *   can repeat the "don't type personal info" reminder).
 */
export const AUT_FLAGS = Object.freeze(['no_scored_responses', 'fewer_than_top_k', 'no_prompt_norm', 'personal_info'] as const)
export type AutFlag = (typeof AUT_FLAGS)[number]

/** Text compared for exact repeats: lower case, letters and digits only, single spaces. */
function repeatKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function hasDirection(v: Float32Array): boolean {
  return isFiniteVec(v) && norm(v) > 0
}

/** Mean of the k largest values (all of them when there are fewer); null for none. */
function topKMean(values: readonly number[], k: number): number | null {
  if (values.length === 0) return null
  const top = [...values].sort((a, b) => b - a).slice(0, k)
  let s = 0
  for (const x of top) s += x
  return s / top.length
}

/**
 * Scores one AUT prompt (see the module comment). `norms` maps lower-case objects to the originality
 * norm used for originalityZ (default {@link PROMPT_NORMS_V0}). Throws a RangeError when the object is
 * empty, the object and template vectors are empty or differ in length, a non-empty response's
 * vector differs in length from them, or `params` is out of range.
 */
export function scoreAut(
  input: AutScoreInput,
  params: AutParams = AUT_PARAMS_V0,
  norms: Readonly<Record<string, PromptNorm>> = PROMPT_NORMS_V0,
): AutScore {
  checkAutParams(params)
  const { objectVec, templateVec } = input
  if (typeof input.object !== 'string' || input.object.trim() === '') throw new RangeError('scoreAut(): the object is empty')
  const dim = objectVec.length
  if (dim === 0) throw new RangeError('scoreAut(): objectVec is empty')
  if (templateVec.length !== dim) {
    throw new RangeError(`scoreAut(): templateVec has length ${templateVec.length}, objectVec ${dim}`)
  }

  type Draft = { text: string; distance: number; plausibility: number; status: AutStatus }
  const drafts: Draft[] = []
  /** Indices (into drafts) and vectors of the scored responses so far, for the duplicate check. */
  const kept: number[] = []
  const keptVecs: Float32Array[] = []
  const keptKeys = new Set<string>()
  let sawPersonalInfo = false

  input.responses.forEach((r, i) => {
    const text = cleanResponse(r.text)
    const words = wordCount(text)
    if (words === 0) {
      drafts.push({ text, distance: 0, plausibility: 0, status: 'empty' })
      return
    }
    if (r.vec.length !== dim) {
      throw new RangeError(`scoreAut(): responses[${i}].vec has length ${r.vec.length}, objectVec ${dim}`)
    }
    const distance = 1 - cosine(objectVec, r.vec)
    const plausibility = cosine(templateVec, r.vec)
    let status: AutStatus
    let shown = text
    if (personalInfo(text).length > 0) {
      status = 'personal_info'
      shown = redactPersonalInfo(text)
      sawPersonalInfo = true
    } else if (words > params.maxWords) {
      status = 'too_long'
    } else if (!hasDirection(r.vec) || !(plausibility > params.plausibilityFloor)) {
      status = 'implausible'
    } else {
      const key = repeatKey(text)
      const repeat = keptKeys.has(key) || keptVecs.some((v) => cosine(v, r.vec) >= params.duplicateCosine)
      status = repeat ? 'duplicate' : 'scored'
      if (!repeat) {
        kept.push(i)
        keptVecs.push(r.vec)
        keptKeys.add(key)
      }
    }
    drafts.push({ text: shown, distance, plausibility, status })
  })

  const ids = clusterIds(keptVecs, params.clusterCosine)
  const clusterOf = new Map<number, number>()
  kept.forEach((j, n) => clusterOf.set(j, ids[n] as number))

  const perResponse: AutResponseScore[] = drafts.map((d, i) => Object.freeze({ ...d, cluster: clusterOf.get(i) ?? null }))

  const fluency = kept.length
  const originality = topKMean(
    kept.map((j) => (drafts[j] as Draft).distance),
    params.topK,
  )
  const norm0 = promptNorm(input.object, norms)
  const originalityZ = zScore(originality, norm0)
  const flexibility = new Set(ids).size

  const flags: AutFlag[] = []
  if (fluency === 0) flags.push('no_scored_responses')
  else if (fluency < params.topK) flags.push('fewer_than_top_k')
  if (norm0 === null) flags.push('no_prompt_norm')
  if (sawPersonalInfo) flags.push('personal_info')

  return Object.freeze({
    version: params.version,
    fluency,
    originality,
    originalityZ,
    flexibility,
    perResponse: Object.freeze(perResponse),
    flags: Object.freeze(flags),
  })
}

function zScore(x: number | null, n: PromptNorm | null): number | null {
  if (x === null || n === null || !(n.sd > 0)) return null
  const z = (x - n.mean) / n.sd
  return Number.isFinite(z) ? z : null
}
