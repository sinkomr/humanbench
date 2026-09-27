/**
 * Span block verifier (gates G2/G3, §4.1; ROADMAP M1.9). Recomputes everything from the instance
 * alone and never throws: a malformed instance fails with a reason. Checks, by name:
 *
 * - shape: `spec_fields`, `trials_well_formed`, `key_well_formed`;
 * - protocol: `task_matches`, `protocol_matches` (start 3, 2 per length, max 10/9/10),
 *   `timing_matches`, `board_matches` (the fixed Corsi board; absent for digits);
 * - layout: `trial_count`, `trial_lengths` (trial i has length 3 + ⌊i/2⌋);
 * - sequence rules: `symbols_valid` (digits 1–9 / blocks 0–8), `no_immediate_repeats`,
 *   `no_runs_of_three` (digits), `no_palindromes` (backward), `sequences_distinct`;
 * - key: `key_matches_rule` (the stimuli, reversed for backward);
 * - A11/A10/M1.P: `structure_matches`, `grm_params`, `prior_matches`, `stratum_matches`,
 *   `expected_time_matches` (and 60–120 s);
 * - `state_machine_consistent`: the block's own protocol, key and GRM thresholds cohere: the
 *   key as responses reaches the top category m = #thresholds; failing both trials at length F
 *   after passing everything before stops there with category F − 3; one pass per length is
 *   enough; the stop categories are exactly 0 … m; and the stimuli as typed (no reversal)
 *   score m forward but fail at once backward. Given the checks above it depends only on
 *   `protocol.ts`, so it never fails alone on a bad block: it is a per-item self-test of the
 *   state machine that every gate run (G2/G3) repeats, not an extra item rule.
 */

import { canonicalJson } from '../ids'
import { stratumOfB } from '../priors'
import { verdict, type VerifyResult } from '../family'
import { CORSI_BOARD, SPAN_TIMING, START_LENGTH, TRIALS_PER_LENGTH, type SpanItem, type SpanTaskConfig } from './config'
import { isPalindrome, runCompletion } from './gen'
import {
  SPAN_GRM_A,
  grmThresholds,
  protocolOf,
  spanDifficulty,
  spanExpectedTime,
  spanStratum,
} from './prior'
import { advanceSpan, categoryCount, trialCount, trialLength, type SpanProtocol, type SpanStatus } from './protocol'

/** Tolerance for recomputed floats (thresholds, b_prior, E[T]); the Python twin uses the same. */
export const SPAN_FLOAT_TOL = 1e-9

/** Block duration bounds of the E[T] prior (M1.9: about 60–120 s per block). */
export const SPAN_TIME_RANGE_S: readonly [number, number] = Object.freeze([60, 120])

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
/** Every index of a dense array passes `f` (Array.from turns holes into undefined; `every` skips them). */
const isArrayOf = <T>(v: unknown, f: (x: unknown) => x is T): v is T[] => Array.isArray(v) && Array.from(v as unknown[]).every(f)
const isIntArray = (v: unknown): v is number[] => isArrayOf(v, isInt)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b)
const close = (a: unknown, b: number): boolean => typeof a === 'number' && Math.abs(a - b) <= SPAN_FLOAT_TOL

/** The spec fields of a task, sorted. */
export function specFieldsOf(cfg: SpanTaskConfig): string[] {
  const base = ['task', 'recall', 'start_length', 'trials_per_length', 'max_length', 'trials', 'timing']
  return (cfg.task === 'corsi' ? [...base, 'board'] : base).sort()
}

/** The key the rules give for these stimuli: each sequence, reversed for backward recall. */
export function expectedKey(cfg: SpanTaskConfig, trials: readonly (readonly number[])[]): number[][] {
  return trials.map((t) => (cfg.recall === 'backward' ? [...t].reverse() : [...t]))
}

export function hasImmediateRepeat(seq: readonly number[]): boolean {
  return seq.some((x, i) => i > 0 && x === seq[i - 1])
}

/** A ±1 run of three: three consecutive elements stepping +1, +1 or −1, −1. */
export function hasRunOfThree(seq: readonly number[]): boolean {
  return seq.some((x, i) => i >= 2 && runCompletion(seq[i - 2], seq[i - 1]) === x)
}

const finished = (s: SpanStatus) => (s.finished ? s.outcome : null)

/** The state-machine invariants of the module comment; true if they all hold. */
function stateMachineConsistent(
  cfg: SpanTaskConfig,
  p: SpanProtocol,
  key: readonly (readonly number[])[],
  trials: readonly (readonly number[])[],
  thresholds: number,
): boolean {
  const n = trialCount(p)
  const m = categoryCount(p)
  if (key.length !== n || m !== thresholds) return false
  const wrong: number[] = []
  // Everything exactly right: all trials given, top category.
  const top = finished(advanceSpan(p, key, key))
  if (!top || top.stop !== 'max_length' || top.longest_passed !== p.max_length || top.category !== m) return false
  if (top.trials_given !== n || top.trials_correct !== n) return false
  // One of two right at every length is still a pass.
  const half = finished(advanceSpan(p, key, key.map((k, i) => (i % p.trials_per_length === 0 ? wrong : k))))
  if (!half || half.category !== m || half.trials_correct !== n / p.trials_per_length) return false
  // Fail every trial at length F after passing all shorter lengths: stop at F with category F − start.
  const seen = new Set<number>([top.category])
  for (let f = p.start_length; f <= p.max_length; f++) {
    const upTo = (f - p.start_length + 1) * p.trials_per_length
    const responses = key.slice(0, upTo).map((k, i) => (trialLength(p, i) === f ? wrong : k))
    const partial = advanceSpan(p, key, responses.slice(0, upTo - 1))
    if (partial.finished || partial.trial !== upTo - 1 || partial.length !== f) return false
    const out = finished(advanceSpan(p, key, responses))
    if (!out || out.stop !== 'failed_length' || out.trials_given !== upTo) return false
    if (out.longest_passed !== (f === p.start_length ? 0 : f - 1) || out.category !== f - p.start_length) return false
    seen.add(out.category)
  }
  if (seen.size !== m + 1 || [...seen].some((y) => y < 0 || y > m)) return false
  // The stimuli typed as shown: all right forward; wrong at once backward (no palindromes).
  const asShown = finished(advanceSpan(p, key, trials.slice(0, cfg.recall === 'backward' ? p.trials_per_length : n)))
  return asShown !== null && asShown.category === (cfg.recall === 'backward' ? 0 : m)
}

/** Verify a span block of task `cfg` (see the module comment). Never throws. */
export function verifySpan(cfg: SpanTaskConfig, item: SpanItem): VerifyResult {
  try {
    const spec = item.spec as unknown
    if (!isRecord(spec)) return verdict({ spec_fields: false })
    const trials = spec.trials
    if (!isArrayOf(trials, isIntArray)) return verdict({ trials_well_formed: false })
    const key = item.key as unknown
    const seqs = isRecord(key) ? key.sequences : undefined
    const keyOk =
      isRecord(key) && Object.keys(key).length === 1 && isArrayOf(seqs, isIntArray) && seqs.length === trials.length
    const p = protocolOf(cfg)
    const n = trialCount(p)
    const symbols = new Set(cfg.symbols)
    const lengthsOk = trials.length === n && trials.every((t, i) => t.length === trialLength(p, i))
    const thresholds = grmThresholds(cfg)
    const params = item.params as unknown
    const grmOk =
      isRecord(params) &&
      params.model === 'grm' &&
      params.a === SPAN_GRM_A &&
      Array.isArray(params.b) &&
      params.b.length === thresholds.length &&
      thresholds.every((b, i) => close((params.b as unknown[])[i], b))
    const prior = spanDifficulty(cfg)
    const d = item.difficulty as unknown
    const priorOk =
      isRecord(d) &&
      isRecord(d.features) &&
      sameJson(d.features, prior.features) &&
      close(d.b_prior, prior.b_prior) &&
      d.sd_prior === prior.sd_prior &&
      d.provenance === prior.provenance
    const recorded: SpanProtocol = {
      start_length: spec.start_length as number,
      trials_per_length: spec.trials_per_length as number,
      max_length: spec.max_length as number,
    }
    const protocolOk =
      recorded.start_length === START_LENGTH && recorded.trials_per_length === TRIALS_PER_LENGTH && recorded.max_length === cfg.maxLength
    const [tMin, tMax] = SPAN_TIME_RANGE_S
    return verdict({
      spec_fields: sameJson(Object.keys(spec).sort(), specFieldsOf(cfg)),
      task_matches: spec.task === cfg.task && spec.recall === cfg.recall,
      protocol_matches: protocolOk,
      timing_matches: isRecord(spec.timing) && sameJson(spec.timing, SPAN_TIMING),
      board_matches: cfg.task === 'corsi' ? isRecord(spec.board) && sameJson(spec.board, CORSI_BOARD) : !('board' in spec),
      trials_well_formed: true,
      trial_count: trials.length === n,
      trial_lengths: lengthsOk,
      symbols_valid: trials.every((t) => t.every((x) => symbols.has(x))),
      no_immediate_repeats: !trials.some(hasImmediateRepeat),
      no_runs_of_three: !cfg.forbidRuns || !trials.some(hasRunOfThree),
      no_palindromes: !cfg.forbidPalindromes || !trials.some(isPalindrome),
      sequences_distinct: new Set(trials.map((t) => t.join(','))).size === trials.length,
      key_well_formed: keyOk,
      key_matches_rule: keyOk && sameJson(seqs, expectedKey(cfg, trials)),
      structure_matches: sameJson(item.structural_params, { task: cfg.task, trials }),
      grm_params: grmOk,
      prior_matches: priorOk,
      stratum_matches:
        item.stratum === spanStratum(cfg) &&
        isRecord(d) &&
        typeof d.b_prior === 'number' &&
        Number.isFinite(d.b_prior) &&
        item.stratum === stratumOfB(d.b_prior),
      expected_time_matches:
        close(item.expected_time_s, spanExpectedTime(cfg)) && item.expected_time_s >= tMin && item.expected_time_s <= tMax,
      state_machine_consistent:
        keyOk &&
        protocolOk &&
        lengthsOk &&
        isRecord(params) &&
        Array.isArray(params.b) &&
        stateMachineConsistent(cfg, recorded, seqs as number[][], trials, params.b.length),
      trials: trials.length,
      categories: thresholds.length + 1,
    })
  } catch (e) {
    return { ok: false, reason: `malformed item: ${e instanceof Error ? e.message : String(e)}`, checks: {} }
  }
}
