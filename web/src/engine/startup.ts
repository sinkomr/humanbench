/**
 * The start-up rule of a part's item selection (owner feedback 2026-10-13: "was the test i took
 * adaptive? … it seemed like it didnt"; DESIGN §7.4; ROADMAP A9, M2.2). Pure; the device selector
 * (`selector.ts`) and the server's selection (`supabase/migrations/20261014000100_startup_step.sql`,
 * `hb.startup_targets`) apply the same rule, and `scripts/db/startup.db.test.ts` holds the SQL to
 * this module on the same answer sequences.
 *
 * ## Why
 *
 * The §7.4 criterion picks the item with the most information per second AT the current estimate,
 * and the estimate is the posterior mean under the N(0, 1) prior. With items of discrimination
 * about 1 an answer carries at most a quarter of the prior's weight, so after a run of correct
 * answers the estimate has barely moved (ten in a row: about +1.2), and the criterion divides by
 * time, which favours the quicker, easier items on top. In the owner's session every part began
 * near b = −1 to 0 and, with a perfect record, had reached only b ≈ +1 by its last question,
 * while the pool held items to b = 3 and above. The engine was adaptive; it could not be felt.
 *
 * ## The rule
 *
 * A run of answers that are all correct (or all wrong) has no finite maximum-likelihood estimate:
 * the likelihood only says "above (below) everything asked so far". Until the answers of a part
 * are mixed, the next question is therefore not placed at the prior-bound estimate but one step
 * beyond the last one, the standard start of an adaptive test before the estimate exists:
 *
 * - the FIRST question of a part is chosen as before (the criterion at the current estimate);
 * - while every scored answer on the skill in this session is correct, the next question is aimed
 *   at the difficulty of the last one plus {@link STARTUP_STEP} (one stratum); while every one is
 *   wrong, minus one step;
 * - at the first reversal (a miss after correct answers, or a correct answer after misses) the
 *   start-up is over for the part, for good: every later question is chosen by the criterion alone.
 *
 * "Aimed at" means: of the candidates the session may be served (after the exposure cap and the
 * family and sibling exclusions, which are untouched), only those whose difficulty is within
 * {@link STARTUP_WINDOW} of the target compete, or, when the pool has none there, those nearest to
 * it. Among them the §7.4 criterion, the coverage floor, the balancing of families and the
 * randomesque top five decide as before. The target is clamped to [{@link STARTUP_MIN},
 * {@link STARTUP_MAX}].
 *
 * A passage (a set of questions served together) counts as ONE unit: its difficulty is the mean of
 * its questions', it steps up when all of them were answered correctly, down when none was, and
 * anything in between is a reversal. An answer is what the session's score counts: a question that
 * ran out of time is a miss on the device (where it is scored as one) and no answer at all on the
 * server (where it is left out of the session's estimate), so there it neither steps nor reverses.
 *
 * ## After the start-up: where the items are aimed
 *
 * After the reversal the criterion decides, and it needs a point to evaluate information at. The
 * scoring posterior's mean is the right SCORE, and a poor aim: it is pulled toward the population
 * mean by a prior that weighs as much as four well-placed answers, so a strong taker's next items
 * sit a full stratum under them for the whole part. So the items are aimed at the estimate under a
 * prior {@link SELECTION_PRIOR_SD_FACTOR} times as wide (SD 2 where the scoring prior has 1): close
 * to the maximum-likelihood estimate a classical adaptive test aims at, still finite and bounded.
 * Only the point at which information is evaluated moves; the variance in the criterion, the
 * per-skill stop and every score use the scoring posterior as before.
 *
 * ## What it does not change
 *
 * Scoring: every answer enters the same posterior with the same parameters, and a 2PL/3PL
 * likelihood does not depend on how the items were chosen. Exposure, family and sibling rules,
 * pretest slots, the coverage floor, the per-skill stop and the order inside a passage.
 */

/** How many times wider than the scoring prior the selection prior is (module comment, "After the start-up"). */
export const SELECTION_PRIOR_SD_FACTOR = 2

/** One step of the start-up: one stratum of difficulty (the default bands are 1.0 wide). */
export const STARTUP_STEP = 1
/** Candidates within this of the target compete (half a stratum each way). */
export const STARTUP_WINDOW = 0.5
/** The target never leaves this range (the pool's difficulties lie inside it). */
export const STARTUP_MIN = -3.5
export const STARTUP_MAX = 3.5

/** One unit already answered on a skill in this session: a question, or a passage's questions together. */
export interface StartupUnit {
  /** Its difficulty b (a passage: the mean of its questions'). */
  readonly b: number
  /** Scored answers of the unit that were correct, and how many were scored. */
  readonly correct: number
  readonly scored: number
}

export type StartupDirection = 'up' | 'down'

/** What a unit says: all correct, all wrong, or mixed (null). A unit with no scored answer says nothing (undefined). */
function directionOf(u: StartupUnit): StartupDirection | null | undefined {
  if (!(u.scored > 0)) return undefined
  if (u.correct >= u.scored) return 'up'
  if (u.correct <= 0) return 'down'
  return null
}

/**
 * The difficulty the next question of a skill is aimed at while its start-up lasts, from the units
 * answered on it so far in this session, in the order served; null when the start-up does not
 * apply: before the first scored answer, and from the first reversal on.
 */
export function startupTarget(units: readonly StartupUnit[]): number | null {
  let direction: StartupDirection | undefined
  let last: StartupUnit | undefined
  for (const u of units) {
    if (!Number.isFinite(u.b)) throw new RangeError(`startupTarget(): b must be finite, got ${u.b}`)
    const d = directionOf(u)
    if (d === undefined) continue
    if (d === null || (direction !== undefined && d !== direction)) return null
    direction = d
    last = u
  }
  if (direction === undefined || last === undefined) return null
  const target = last.b + (direction === 'up' ? STARTUP_STEP : -STARTUP_STEP)
  return Math.min(STARTUP_MAX, Math.max(STARTUP_MIN, target))
}

/**
 * Which of the candidates' difficulties `bs` compete for a target: those within
 * {@link STARTUP_WINDOW} of it, or, when none is, those nearest to it (within 1e-9 of the nearest).
 */
export function startupCompetes(bs: readonly number[], target: number): boolean[] {
  if (bs.length === 0) return []
  const d = bs.map((b) => Math.abs(b - target))
  const limit = Math.max(STARTUP_WINDOW, Math.min(...d)) + 1e-9
  return d.map((x) => x <= limit)
}
