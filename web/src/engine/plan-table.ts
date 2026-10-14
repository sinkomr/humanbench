/**
 * The session's parts, as plain tables (ROADMAP A15, M3.11 phase 1; DESIGN §3, §7.4 "Session
 * composition"). Constants and types only, with no import of the task registry, so the copy
 * (`session/copy.ts`), the build (`vite.config.ts`) and the selector can all read the same figures.
 *
 * Two tables:
 *
 * - {@link A15_SEGMENTS}: the six parts of the M1 session, on every device and in both versions.
 *   Their time is {@link A15_TARGET_S}, shared as before (`planSession`), plus what a part's
 *   minimum adds ({@link A15_MINIMUMS}: a minute for the Quantitative part, below). **The text parts change
 *   nothing of them**: a session without served text parts is planned, budgeted and timed the same
 *   with or without the setting.
 * - {@link TEXT_PARTS}: the served parts: text multiple choice (M3.11 phase 1), passages (phase 2: Reading
 *   Comprehension), and the remaining families (2026-10-13: Logic Games, Fermi Estimation, Emotion Reading,
 *   Creative Thinking by its word links). They exist only in the online version, only for the skills the server says
 *   it has questions for (`public.live_axes`; no build variable names them since 2026-10-13), only in their turn of the
 *   {@link ROTATION} ("Rotation", below), and a part whose first request is answered "no items" is still dropped
 *   without a word (`session/run.ts`). Each has a planned share of its own, **on top of** the six parts' time.
 *
 * And one figure per part that the plan does not use: how long it **typically** takes
 * ({@link A15_TYPICAL_S}, {@link TextPart.typical_s}). The words that state a session's length, and
 * the progress ring, are made from those ("How long a session is said to be", below).
 *
 * ## The shares (owner: change them here)
 *
 * `share_s` is the planned time of a text part in seconds; it is what its "Up next" screen says
 * ("About 2 minutes"), what the progress ring's target grows by, and when the part stops asking
 * once its minimum is met. The figures are provisional defaults (open owner decision, ROADMAP M3.11):
 *
 * | Part | Axis | Share | Why |
 * |---|---|---|---|
 * | Logical Reasoning | LR | 6 min | an argument to read per question (the bank's expected time is 60 s), six questions |
 * | Reading Comprehension | RC | 9 min | two passages of 3 or 4 questions: about 100 s to read one, 45 s a question |
 * | Vocabulary | VOC | 2 min | a word per question (15 s) |
 * | STEM knowledge | KST | 2 min 10 s | a fact per question (20 s) |
 * | Humanities knowledge | KHU | 2 min 10 s | the same |
 * | Arts & Practical | KAP | 2 min 10 s | the same |
 * | Emotion Reading | EMO | 4 min | six questions, vignettes (23 s) and situational judgments (57 s) in turn |
 * | Creative Thinking | CRE | 2 min 10 s | six word-links puzzles (20 s) |
 * | Logic Games | LG | 7 min 30 s | two games of 3 or 4 questions: the bank's 78 to 84 s for the first question of a setup, less for the others |
 * | Fermi Estimation | FER | 6 min | six estimates (45 to 75 s) |
 *
 * The five of phase 1 together are 14.5 minutes, so a session with them is planned at 43 minutes (28.5 +
 * 14.5); with Reading Comprehension, 52. The owner's ceiling for a session is 60 minutes (2026-10-12);
 * the hard stop is at 57 active minutes (`session/constants.ts`).
 *
 * ## Passages ({@link TextPart.sets}; M3.11 phase 2)
 *
 * The server serves a passage's questions together (`supabase/migrations/20261013000100_item_sets.sql`)
 * and says of each where it stands in its set. A part of passages is counted in passages: Reading
 * Comprehension reads {@link RC_PASSAGES} (two), which is 6 to 8 questions, and then ends, whatever is left
 * of its share (Logic Games likewise reads {@link LG_GAMES}, two games, their setups in the passage's place); a passage that has been started is always finished (its time does not cut it, only the
 * hard stop, a skip or "finish early" do); and its minimum of five answers ({@link PART_MINIMUMS}) still holds, so when fewer than
 * five questions were answered after two passages (some ran out of time) one more passage is read.
 *
 * ## How long a session is said to be ({@link sessionOutline}, {@link aboutMinutes})
 *
 * A session runs longer than its plan: a part with a minimum of answers goes past its share, and every
 * answer costs a moment beyond the question (it was 4.8 s with the follow-up confidence step of the one full session
 * on record; 1.5 s since the owner decision of 2026-10-13 put an optional confidence on the question screen).
 * So the words that state the length ("about 45 minutes"), and the target of the progress ring, are not
 * the plan's sum but the **typical** length: the median of simulated sessions (`npm run sim:session`,
 * calibrated to that session: `scripts/sim-session.ts`, "Where the time goes"), {@link A15_TYPICAL_S}
 * for the six parts and {@link TextPart.typical_s} for each text part, added up for the parts a session
 * asks for and said to the nearest five minutes. The figures are measured, not derived:
 * `scripts/sim-length.test.ts` holds each to the simulation for the combinations of parts (re-measure
 * and change them here when a share, a minimum or a task's length changes). The plan, the budgets and
 * the place of the break are untouched by them.
 *
 * Measured 2026-10-13 without the follow-up confidence step (owner decision 2026-10-13; 400 sessions each; takers
 * at the model's pace, ±15% from person to person; in brackets, the same with the 4.8 s step):
 *
 * | Session | said | median | 95th percentile | at the 57-minute hard stop |
 * |---|---|---|---|---|
 * | six parts | about 30 minutes | 29.3 (29.5) | 34.5 (35.2) | none (none) |
 * | six parts, 1.25 times slower | | 32.9 (33.6) | 41.3 (42.3) | none (none) |
 * | eleven (the five of phase 1) | about 45 minutes | 45.0 (45.6) | 52.2 (54.4) | 1% (3%) |
 * | eleven, 1.25 times slower | | 50.7 (53.3) | 57.0 (57.0) | 18% (29%) |
 * | twelve (with Reading Comprehension) | about 55 minutes | 53.6 (54.5) | 57.0 (57.0) | 23% (35%) |
 *
 * Twelve parts do not fit under the hard stop with margin: ROADMAP, "Owner decisions 2026-10-13".
 *
 * ## Rotation ({@link ROTATION}; the remaining families, 2026-10-13)
 *
 * With every served part on, one session would hold sixteen parts and typically take about 75 minutes (planned 71.7),
 * which the 57-minute hard stop cuts: simulated, every session reaches it, and Fermi Estimation, at the end, is never
 * reached (ROADMAP M3.11, "Session length with the remaining families"). So the served parts take turns: three groups
 * of about a quarter of an hour, one a session, chosen by the session's number among the saves of this browser (0 for
 * a first session; `session/SessionApp.svelte`). Each group with the six parts typically takes about 45 minutes, as
 * the eleven-part session of phase 1 did; over three sessions every served skill is asked once. The welcome screen,
 * before it knows which turn comes, states the longest turn ({@link longestOutline}); the ready screen states the one
 * that comes. The profile counts every served skill the server has as offered, so a skill waiting for its turn reads
 * "not measured", not "not offered yet". An empty table puts every served part in every session.
 *
 * ## A minimum of answered questions for every question part ({@link PART_MINIMUMS}; owner decision 2026-10-13)
 *
 * The owner, after a full session: "its ok to have more questions if there is time, but each section
 * should have a minimum number of questions asked, even if running over the originally estimated time
 * for that section." (The rule is the owner's; the number, six everywhere, is the proposal that was
 * built and is the owner's to change here.) So every part that asks questions has a stated minimum of ANSWERED questions that
 * holds past its time share, in ONE table, {@link PART_MINIMUMS}: six for Matrix & Series, Spatial,
 * Quantitative and each text part; Reading Comprehension is counted in passages (two, 6 to 8 questions)
 * and keeps five as the least it will accept of them. The rule, the same for every part and in both
 * versions (`session/run.ts`):
 *
 * - the part goes on past its time until `min_items` of its questions are answered;
 * - a question that runs out of time is not an answer, so the part shows more to get there, but at
 *   most {@link MIN_ITEMS_SLACK} more than the minimum (the bounded extra: a person who lets every
 *   question run out is not kept in the part);
 * - once the minimum is met the part's time decides, so there are more questions when time remains;
 * - skipping the part, "finish early", the hard stop and the precision stop work as before, and a focus
 *   session has no minimum (its time is the skills it names).
 *
 * Why six and not the §7.4 floor of three: the server publishes a skill's score only from a session
 * that holds at least five scored answers on it ({@link PUBLISH_MIN_ITEMS}; `rescore.min_axis_items`,
 * supabase/README.md "What `rescore` does not tell": fewer would read single answers out), and six
 * answered leaves that five with one to spare. A count is used, not a larger time share, because a
 * share buys a number of answers that depends on the person's pace and on how long the timed tasks
 * before it ran. In the owner's session of 2026-10-12 Matrix & Series got five questions.
 *
 * `extra_s` ({@link A15_MINIMUMS}) is what a minimum adds to the plan of one of the six parts: the
 * Quantitative part's planned time is its share plus a minute (owner decision 2026-10-12: about
 * 5 + 1 = 6 minutes, six questions at 55 to 60 s), and the session's is {@link A15_TARGET_S} plus
 * that, 28.5 minutes. Matrix & Series and Spatial add nothing to the plan: their share already buys
 * six questions for a taker at the model's pace, and the minimum is there for the taker it does not.
 * Nothing else of the six parts moves: the budgets and the place of the break are worked out from
 * {@link A15_TARGET_S} as before.
 */

import type { AxisCode } from './axes'

/** Default M1 session length for `planSession`: A15's target of about 25–30 min, taken at the midpoint. */
export const A15_TARGET_S = 27.5 * 60

/** The six parts of the M1 session (A15). */
export type A15SegmentId = 'rt' | 'matrix_series' | 'spatial' | 'memory' | 'quant' | 'coding_reading'

/**
 * The served parts: text multiple choice (M3.11 phase 1), passages (phase 2), and logic games, Fermi estimates,
 * emotion vignettes with situational judgments, and word links (the remaining families, 2026-10-13).
 */
export type TextSegmentId =
  | 'logical_reasoning'
  | 'reading_comprehension'
  | 'vocabulary'
  | 'knowledge_stem'
  | 'knowledge_humanities'
  | 'knowledge_arts'
  | 'logic_games'
  | 'fermi'
  | 'emotion'
  | 'word_links'

/** Every part a session can have. */
export type SegmentId = A15SegmentId | TextSegmentId

/** One fixed block of a segment: a block family (one per sub-task, M1.F2). */
export interface BlockDef {
  readonly family: string
}

/** One A15 segment: fixed blocks, or a CAT segment on some axes. */
export type SegmentDef =
  | { readonly id: A15SegmentId; readonly kind: 'block'; readonly axis: AxisCode; readonly blocks: readonly BlockDef[] }
  | { readonly id: A15SegmentId; readonly kind: 'cat'; readonly axes: readonly AxisCode[] }

/**
 * The M1 session order (A15): RT → Matrix/Series → Spatial → Memory → Quant → Coding/Reading.
 * RT runs simple then 4-choice (M1.10); Memory runs digits forward, digits backward, Corsi (M1.9).
 * Each sub-task is its own block family (M1.F2).
 */
export const A15_SEGMENTS: readonly SegmentDef[] = Object.freeze([
  { id: 'rt', kind: 'block', axis: 'RT', blocks: [{ family: 'rt_simple' }, { family: 'rt_choice4' }] },
  { id: 'matrix_series', kind: 'cat', axes: ['MAT'] },
  { id: 'spatial', kind: 'cat', axes: ['SPA'] },
  { id: 'memory', kind: 'block', axis: 'WM', blocks: [{ family: 'span_fwd' }, { family: 'span_bwd' }, { family: 'corsi' }] },
  { id: 'quant', kind: 'cat', axes: ['QR'] },
  { id: 'coding_reading', kind: 'block', axis: 'PS', blocks: [{ family: 'coding' }, { family: 'reading' }] },
] as const satisfies readonly SegmentDef[])

/** Answers on one skill in one session from which the server publishes its score (`rescore.min_axis_items`). */
export const PUBLISH_MIN_ITEMS = 5

/**
 * Answered questions every question part runs to in a normal session (owner decision 2026-10-13; the
 * Quantitative part since 2026-10-12: "go to six questions"). One more than {@link PUBLISH_MIN_ITEMS}.
 */
export const PART_MIN_ITEMS = 6

/** Questions a part with a minimum may show beyond it to reach it (some may run out of time). */
export const MIN_ITEMS_SLACK = 2

/** Passages the Reading Comprehension part reads (module comment, "Passages"). */
export const RC_PASSAGES = 2

/** Games the Logic Games part plays (module comment, "Passages": a game's setup is read like a passage). */
export const LG_GAMES = 2

/** The parts that ask questions: three of the six A15 parts and every text part. */
export type QuestionSegmentId = 'matrix_series' | 'spatial' | 'quant' | TextSegmentId

/** The minimum of one question part (module comment, "A minimum of answered questions"). */
export interface PartMinimum {
  /** Answered questions before the part's time may end it. */
  readonly min_items: number
  /** A part of passages: how many it reads before it ends. Absent on the others. */
  readonly sets?: number
}

/**
 * THE table of minimums (owner: change them here): the answered questions each question part runs to,
 * whatever its time share says. Reading Comprehension is counted in passages: it reads two (6 to 8
 * questions) and reads a third only when fewer than five of those were answered.
 */
export const PART_MINIMUMS: Readonly<Record<QuestionSegmentId, PartMinimum>> = Object.freeze({
  matrix_series: Object.freeze({ min_items: PART_MIN_ITEMS }),
  spatial: Object.freeze({ min_items: PART_MIN_ITEMS }),
  quant: Object.freeze({ min_items: PART_MIN_ITEMS }),
  logical_reasoning: Object.freeze({ min_items: PART_MIN_ITEMS }),
  knowledge_stem: Object.freeze({ min_items: PART_MIN_ITEMS }),
  vocabulary: Object.freeze({ min_items: PART_MIN_ITEMS }),
  reading_comprehension: Object.freeze({ min_items: PUBLISH_MIN_ITEMS, sets: RC_PASSAGES }),
  knowledge_humanities: Object.freeze({ min_items: PART_MIN_ITEMS }),
  knowledge_arts: Object.freeze({ min_items: PART_MIN_ITEMS }),
  logic_games: Object.freeze({ min_items: PUBLISH_MIN_ITEMS, sets: LG_GAMES }),
  fermi: Object.freeze({ min_items: PART_MIN_ITEMS }),
  emotion: Object.freeze({ min_items: PART_MIN_ITEMS }),
  word_links: Object.freeze({ min_items: PART_MIN_ITEMS }),
})

/** Answered questions the Quantitative part runs to ({@link PART_MINIMUMS}). */
export const QUANT_MIN_ITEMS = PART_MINIMUMS.quant.min_items

/** Planned seconds the six-question rule adds to the Quantitative part's share, and so to the session. */
export const QUANT_EXTRA_S = 60

/** A minimum of answered questions on one of the six parts, and the planned time it adds (module comment). */
export interface A15Minimum {
  readonly min_items: number
  readonly extra_s: number
}

/**
 * The minimums of the A15 parts as the plan takes them: {@link PART_MINIMUMS} with the planned seconds
 * each adds to its part's share (module comment: only the Quantitative part's adds any).
 */
export const A15_MINIMUMS: Readonly<Partial<Record<A15SegmentId, A15Minimum>>> = Object.freeze({
  matrix_series: Object.freeze({ min_items: PART_MINIMUMS.matrix_series.min_items, extra_s: 0 }),
  spatial: Object.freeze({ min_items: PART_MINIMUMS.spatial.min_items, extra_s: 0 }),
  quant: Object.freeze({ min_items: PART_MINIMUMS.quant.min_items, extra_s: QUANT_EXTRA_S }),
})

/** Planned seconds of the six-part session: the A15 target and what the minimums add. */
export const A15_PLANNED_S = A15_TARGET_S + Object.values(A15_MINIMUMS).reduce((t, m) => t + m.extra_s, 0)

/**
 * Typical active seconds of the six-part session: the simulated median of the online version, 29 minutes
 * 20 seconds (400 sessions, `npm run sim:session -- --mode online`; the device-only version's was 28.8
 * minutes with the follow-up step, not re-measured; module comment, "How long a session is said to be"). Said as "about 30 minutes", as the plan was.
 * Re-measured 2026-10-13 with the simulator calibrated to a real session (`scripts/sim-session.ts`, "Where
 * the time goes"), the reactive memory blocks and the minimums of six: it was 1,880 s. Re-measured again the same
 * day without the follow-up confidence step (owner decision 2026-10-13): 1,760 s, from 1,769. Little changes
 * because the parts that end on their time fit more questions into it rather than ending sooner.
 */
export const A15_TYPICAL_S = 1760

/** What the six-part session typically runs over its plan, in seconds. */
export const A15_TYPICAL_OVER_S = A15_TYPICAL_S - A15_PLANNED_S

/**
 * The axes of the served parts (text multiple choice, passages, logic games, Fermi estimates, emotion vignettes and
 * situational judgments, word links), in the canonical axis order. The name is older than the last four.
 */
export const TEXT_AXES = ['LR', 'LG', 'RC', 'VOC', 'FER', 'KST', 'KHU', 'KAP', 'EMO', 'CRE'] as const satisfies readonly AxisCode[]
export type TextAxis = (typeof TEXT_AXES)[number]

export function isTextAxis(code: unknown): code is TextAxis {
  return typeof code === 'string' && (TEXT_AXES as readonly string[]).includes(code)
}

export interface TextPart {
  readonly id: TextSegmentId
  readonly axis: TextAxis
  /** The A15 part it comes after (the §7.4 order: Reasoning → Knowledge → Spatial → Verbal → Memory → Quant → Knowledge). */
  readonly after: A15SegmentId
  /** Planned seconds, on top of the six parts' time (module comment: "The shares"). */
  readonly share_s: number
  /** Answered questions before the part's time may end it ({@link PART_MINIMUMS}). */
  readonly min_items: number
  /**
   * Typical active seconds of the part: what it takes a taker at the model's pace, which is the simulated median
   * (module comment: "How long a session is said to be"). Each question at the bank's expected time plus 1.5 s around
   * its answer (the optional confidence tap and the screen change; no step after the answer since the owner decision
   * of 2026-10-13): six for Logical Reasoning (369); seven for the knowledge parts, whose sixth answer comes just
   * inside their share (151); eight for Vocabulary (132); two passages, seven questions, for Reading Comprehension (526).
   * Re-measured 2026-10-13 (they were 389, 149, 139 and 549 with the 4.8 s follow-up confidence step).
   */
  readonly typical_s: number
  /** A part of passages: how many it reads before it ends (module comment: "Passages"). Absent on the others. */
  readonly sets?: number
}

/**
 * THE table of the text parts: which, where in the session, and how long. In session order (two parts
 * after the same A15 part run in the order listed here).
 */
export const TEXT_PARTS: readonly TextPart[] = Object.freeze([
  { id: 'logical_reasoning', axis: 'LR', after: 'matrix_series', share_s: 360, ...PART_MINIMUMS.logical_reasoning, typical_s: 369 },
  { id: 'knowledge_stem', axis: 'KST', after: 'matrix_series', share_s: 130, ...PART_MINIMUMS.knowledge_stem, typical_s: 151 },
  { id: 'vocabulary', axis: 'VOC', after: 'spatial', share_s: 120, ...PART_MINIMUMS.vocabulary, typical_s: 132 },
  { id: 'reading_comprehension', axis: 'RC', after: 'spatial', share_s: 540, ...PART_MINIMUMS.reading_comprehension, typical_s: 526 },
  { id: 'emotion', axis: 'EMO', after: 'memory', share_s: 240, ...PART_MINIMUMS.emotion, typical_s: 243 },
  { id: 'word_links', axis: 'CRE', after: 'memory', share_s: 130, ...PART_MINIMUMS.word_links, typical_s: 151 },
  { id: 'knowledge_humanities', axis: 'KHU', after: 'quant', share_s: 130, ...PART_MINIMUMS.knowledge_humanities, typical_s: 151 },
  { id: 'knowledge_arts', axis: 'KAP', after: 'quant', share_s: 130, ...PART_MINIMUMS.knowledge_arts, typical_s: 151 },
  { id: 'logic_games', axis: 'LG', after: 'coding_reading', share_s: 450, ...PART_MINIMUMS.logic_games, typical_s: 446 },
  { id: 'fermi', axis: 'FER', after: 'coding_reading', share_s: 360, ...PART_MINIMUMS.fermi, typical_s: 363 },
] as const satisfies readonly TextPart[])

/**
 * THE rotation of the served parts (owner: change it here; module comment, "Rotation"): groups of served parts that
 * take turns, one group a session. A person's session number `n` (0 for the first) runs the group `n mod k` and every
 * served part that is in no group. With every served part on, one session holding all of them typically takes about
 * 80 minutes, which no session can (the hard stop is at 57); a group of about 16 minutes keeps a typical session
 * near 46 (ROADMAP M3.11, "Session length with the remaining families"). An empty table switches the rotation off.
 */
export const ROTATION: readonly (readonly TextAxis[])[] = Object.freeze([
  Object.freeze(['LR', 'RC'] as const),
  Object.freeze(['LG', 'VOC', 'KST', 'KHU'] as const),
  Object.freeze(['FER', 'EMO', 'CRE', 'KAP'] as const),
])

/**
 * The served parts whose answers are not rated for confidence (DESIGN §3 row 12: a Fermi estimate states its own 80%
 * range; Emotion Reading's vignettes are tier c and its situational judgments have no right answer;
 * `backend/items.ts` `asksConfidence` decides it per item).
 */
export const UNRATED_AXES: readonly TextAxis[] = Object.freeze(['FER', 'EMO'] as const)

/** The served parts the server has live questions for, whatever the rotation: what the profile counts as offered. */
export function liveServedAxes(live: readonly AxisCode[] | null): TextAxis[] {
  return live === null ? [] : TEXT_AXES.filter((k) => live.includes(k))
}

/**
 * The axes of the served parts session number `ordinal` asks for (0 for a person's first; the number of sessions in
 * the save it starts from): of the skills the server has live questions for (`public.live_axes`, `backend/backend.ts`
 * `Backend.liveAxes`), those of its {@link ROTATION} group and those in no group, in the canonical order; none when the
 * list is not known (null). A group whose skills have no questions is passed over, so a session asks for something
 * whenever anything is live.
 */
export function servedPartAxes(live: readonly AxisCode[] | null, ordinal = 0, rotation: readonly (readonly TextAxis[])[] = ROTATION): TextAxis[] {
  const all = liveServedAxes(live)
  const grouped = new Set(rotation.flat())
  const groups = rotation.map((g) => all.filter((k) => g.includes(k))).filter((g) => g.length > 0)
  const turn = groups.length === 0 ? [] : groups[((Math.trunc(ordinal) % groups.length) + groups.length) % groups.length]!
  return all.filter((k) => !grouped.has(k) || turn.includes(k))
}

/** The longest session the rotation can give with these skills live: what the welcome screen says before it knows which one comes. */
export function longestOutline(live: readonly AxisCode[] | null, rotation: readonly (readonly TextAxis[])[] = ROTATION): SessionOutline {
  const n = Math.max(1, rotation.length)
  const outlines = Array.from({ length: n }, (_, i) => sessionOutline(servedPartAxes(live, i, rotation)))
  return outlines.reduce((a, b) => (b.typical_s > a.typical_s ? b : a))
}

/** The text part of an axis, or undefined. */
export function textPartOf(axis: AxisCode): TextPart | undefined {
  return TEXT_PARTS.find((p) => p.axis === axis)
}

/** The text part with this id, or undefined (an A15 part). */
export function textPartById(id: SegmentId): TextPart | undefined {
  return TEXT_PARTS.find((p) => p.id === id)
}

/** Every part id in session order: the A15 parts with the text parts after the ones they follow. */
export const SEGMENT_ORDER: readonly SegmentId[] = Object.freeze(A15_SEGMENTS.flatMap((s): SegmentId[] => [s.id, ...TEXT_PARTS.filter((p) => p.after === s.id).map((p) => p.id)]))

/** What a session is planned to be, for the words that say so before it starts. */
export interface SessionOutline {
  /** Parts at most: the six of A15 plus the text parts asked for. */
  readonly parts: number
  /** Planned seconds with every part present. */
  readonly planned_s: number
  /** Typical active seconds with every part present: what the length is said from (module comment, "How long a session is said to be"). */
  readonly typical_s: number
  /** Some parts depend on what the server has, so the count is "up to". */
  readonly upTo: boolean
}

/** The plan of a session that asks for the text parts of `textAxes` (none: the M1 session). */
export function sessionOutline(textAxes: readonly AxisCode[] = []): SessionOutline {
  const parts = TEXT_PARTS.filter((p) => textAxes.includes(p.axis))
  return {
    parts: A15_SEGMENTS.length + parts.length,
    planned_s: A15_PLANNED_S + parts.reduce((t, p) => t + p.share_s, 0),
    typical_s: A15_TYPICAL_S + parts.reduce((t, p) => t + p.typical_s, 0),
    upTo: parts.length > 0,
  }
}

/**
 * The figure a length is said as: whole minutes, to the nearest five from three minutes up
 * ("about 30" for 31, "about 45" for 44.5), the rule of the progress ring (UX-008).
 */
export function aboutMinutes(seconds: number): number {
  const m = Math.max(1, Math.round(seconds / 60))
  return m < 3 ? m : Math.round(m / 5) * 5
}
