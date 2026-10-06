/**
 * Scoring parameters for the Alternative Uses Task ("Unusual uses", experimental; ROADMAP M6.4,
 * DESIGN §5.4, §14.6 example 17). Every value is [SPEC] and provisional until calibrated on pilot
 * data; the version string travels with every score so later recalibrations stay distinguishable.
 *
 * **Where the cosine values come from.** The embedder is all-MiniLM-L6-v2 (384 dimensions, unit
 * length, mean pooling) via Transformers.js. On 2026-10-03 a scratch probe (not in this repo) embedded
 * 119 hand-written uses (67 for "brick", 52 for "paperclip", common and unusual), 37 off-task strings
 * (keyboard mashing, random noun lists, other languages, emoji, chit-chat) and 26 pairs of rephrasings
 * with Xenova/all-MiniLM-L6-v2 (q8) under @huggingface/transformers 4.3.0, the object as the bare word
 * and each response as typed. The comments below quote what it showed. It is one author's examples,
 * not people's responses: it only rules values in or out roughly.
 */

/** The tunable values of the AUT scoring core (see {@link AUT_PARAMS_V0} for each one's meaning). */
export interface AutParams {
  /** Identifies the parameter set in every score (`AutScore.version`). */
  readonly version: string
  /** Originality is the mean distance of the topK most distant scored responses. */
  readonly topK: number
  /** A response with more words than this is not scored. */
  readonly maxWords: number
  /** A response whose cosine with an earlier scored response is at least this is a duplicate. */
  readonly duplicateCosine: number
  /** A response is scored only if its cosine with the "a use for X" template exceeds this. */
  readonly plausibilityFloor: number
  /** Average-linkage threshold for joining two flexibility clusters (cosine). */
  readonly clusterCosine: number
}

export const AUT_PARAMS_V0: AutParams = Object.freeze({
  version: 'aut-v0',
  /** [SPEC] DESIGN §5.4: "mean of the top-3 responses' semantic distance from the prompt". */
  topK: 3,
  /** [SPEC] DESIGN §5.4: "responses longer than 12 words ... get penalised". Here: not scored. */
  maxWords: 12,
  /**
   * [SPEC] 0.85. Near-identical ideas count once (the first is kept). In the probe, article and
   * inflection variants of one idea sat at 0.87–0.96 ("a doorstop" / "doorstop" 0.894, "a weapon" /
   * "weapon" 0.891, "pick a lock" / "pick locks" 0.892, "hold papers together" / "hold papers" 0.866),
   * so 0.90 would let several of them count twice. Different ideas from one category stayed at or
   * below about 0.75 ("make a necklace" / "make a bracelet" 0.691, "prop open a gate" / "prop open a
   * door" 0.713). 0.85 removes plain repeats and leaves a margin of about 0.1 before distinct ideas;
   * looser rephrasings ("use as a doorstop" / "doorstop" 0.775) still count twice, a mild fluency gain
   * that does not move originality (a mean of the top 3, not a sum). Exact repeats of the same text
   * are duplicates whatever their cosine.
   */
  duplicateCosine: 0.85,
  /**
   * [SPEC] −0.05: the response must point at least roughly the same way as "a use for X" (§5.4: its
   * similarity to the template "must exceed a floor"). The floor is this low because MiniLM, given the
   * response as typed, barely separates real uses from off-task text: in the probe, real uses ran
   * from −0.027 to 0.53 (median about 0.2) and off-task strings from −0.052 to 0.27 (median about
   * 0.1). A floor of 0 would drop 2 of the 119 real uses, 0.05 would drop 9 and 0.10 would drop 18,
   * and the dropped ones are mostly the unusual uses this task exists to reward ("reset button on a
   * router" −0.027, "fix glasses hinge" −0.006, "fuse wire in an emergency" 0.013), while every
   * floor that spares real uses keeps nearly all off-task strings. So the floor only removes
   * responses that point away from the task; random noun lists are held back mainly by the word cap
   * and the top-3 mean, and a stronger check is an open calibration question (ROADMAP M6.4).
   */
  plausibilityFloor: -0.05,
  /**
   * [SPEC] 0.40. Average-linkage join threshold for flexibility clusters. Pairs of different uses in
   * the probe had cosines with a median of about 0.12 and a 90th percentile of about 0.25; uses of
   * one kind sat at 0.4–0.65 ("build a house" / "build a wall" 0.61–0.63, "crack nuts" / "smash
   * walnuts" 0.603, "use as a dumbbell" / "lift it for exercise" 0.443). At 0.40 the 67 brick uses
   * formed 46 clusters (weights, doorstops, cracking nuts, fire pits ...) and the 52 paperclip uses
   * 30. At 0.35 more uses joined on little more than a shared word or setting ("a mini skateboard
   * ramp" / "chalk to draw on pavement", "hold papers together" / "unclog a small hole"; a few such
   * joins remain at 0.40, e.g. "scratch art into wax" / "scratch an itch"); at 0.45 mostly rephrasings
   * stayed together, which would make flexibility little more than fluency.
   */
  clusterCosine: 0.4,
})

/** Mean and SD of originality (mean top-3 distance) for one prompt, for standardising within it. */
export interface PromptNorm {
  readonly mean: number
  readonly sd: number
}

/**
 * [SPEC] Provisional within-prompt norms (§14.6 example 17: "standardised within prompt") for the two
 * demo objects only; any other object gets a null z-score. Keys are lower-case objects as passed to
 * `templateText` ("brick", "paperclip"); the object vector must be the embedding of that bare word.
 *
 * From the probe above: the mean top-3 distance over 5,000 random sets of 5–10 of the hand-written
 * uses was 0.880 ± 0.036 for brick and 0.902 ± 0.047 for paperclip. The means are rounded to two
 * places; the SDs are raised to 0.05 because sets drawn from one author's list understate the spread
 * between people. Replace both with pilot norms before any z is shown as more than experimental.
 */
export const PROMPT_NORMS_V0: Readonly<Record<string, PromptNorm>> = Object.freeze({
  brick: Object.freeze({ mean: 0.88, sd: 0.05 }),
  paperclip: Object.freeze({ mean: 0.9, sd: 0.05 }),
})

/** The norm for `object` (trimmed, lower-cased, NFC), or null when the prompt has none. */
export function promptNorm(object: string, norms: Readonly<Record<string, PromptNorm>> = PROMPT_NORMS_V0): PromptNorm | null {
  const key = object.normalize('NFC').trim().toLowerCase()
  if (!Object.hasOwn(norms, key)) return null
  return norms[key] ?? null
}

/**
 * Throws a RangeError naming the first value that is out of range: topK and maxWords must be
 * integers ≥ 1; the three cosines must be finite and in [−1, 1]; the version must be non-empty.
 */
export function checkAutParams(p: AutParams): void {
  if (typeof p.version !== 'string' || p.version === '') throw new RangeError('AutParams.version must be a non-empty string')
  for (const k of ['topK', 'maxWords'] as const) {
    const x = p[k]
    if (!Number.isInteger(x) || x < 1) throw new RangeError(`AutParams.${k} must be an integer >= 1, got ${String(x)}`)
  }
  for (const k of ['duplicateCosine', 'plausibilityFloor', 'clusterCosine'] as const) {
    const x = p[k]
    if (typeof x !== 'number' || !Number.isFinite(x) || x < -1 || x > 1) {
      throw new RangeError(`AutParams.${k} must be a finite cosine in [-1, 1], got ${String(x)}`)
    }
  }
}
