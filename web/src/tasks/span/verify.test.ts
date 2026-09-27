/**
 * Negative tests of the span verifier: one hand-built bad block per failure reason, each
 * rejected with exactly the expected failed checks (the bank's `tests/gen/test_span.py` runs
 * the same cases against the Python twin).
 */

import { describe, expect, it } from 'vitest'
import type { VerifyResult } from '../family'
import {
  SPAN_BWD,
  SPAN_CORSI,
  SPAN_FWD,
  corsi,
  expectedKey,
  hasImmediateRepeat,
  hasRunOfThree,
  isPalindrome,
  spanBwd,
  spanFwd,
  verifySpan,
  type SpanItem,
  type SpanTaskConfig,
} from '.'

type Mutable = { -readonly [K in keyof SpanItem]: unknown } & { spec: Record<string, unknown>; key: Record<string, unknown> }

/** A deep copy of `item` changed by `f` (no validation: verify must cope with anything). */
function tamper(item: SpanItem, f: (x: Mutable) => void): SpanItem {
  const x = JSON.parse(JSON.stringify(item)) as Mutable
  f(x)
  return x as unknown as SpanItem
}

/** Replace the stimuli and keep key and structure consistent with them, so only rules can fail. */
function withTrials(cfg: SpanTaskConfig, item: SpanItem, edit: (trials: number[][]) => void): SpanItem {
  return tamper(item, (x) => {
    const trials = JSON.parse(JSON.stringify(item.spec.trials)) as number[][]
    edit(trials)
    x.spec.trials = trials
    x.key = { sequences: expectedKey(cfg, trials) }
    x.structural_params = { task: cfg.task, trials }
  })
}

const failed = (v: VerifyResult): string[] =>
  Object.entries(v.checks)
    .filter(([, ok]) => ok === false)
    .map(([k]) => k)
    .sort()

const fwd = spanFwd.generate('neg-fwd')
const bwd = spanBwd.generate('neg-bwd')
const cor = corsi.generate('neg-corsi')

function expectRejected(cfg: SpanTaskConfig, bad: SpanItem, checks: string[]): void {
  const v = verifySpan(cfg, bad)
  expect(v.ok).toBe(false)
  expect(failed(v)).toEqual([...checks].sort())
  expect(v.reason).toBe(`failed: ${Object.keys(v.checks).filter((k) => checks.includes(k)).join(', ')}`)
}

describe('span verifier accepts generated blocks', () => {
  it.each([
    [SPAN_FWD, fwd],
    [SPAN_BWD, bwd],
    [SPAN_CORSI, cor],
  ] as const)('%# ok, also after a JSON round trip and within float tolerance', (cfg, item) => {
    expect(verifySpan(cfg, item)).toMatchObject({ ok: true, reason: 'ok' })
    expect(verifySpan(cfg, JSON.parse(JSON.stringify(item)) as SpanItem).ok).toBe(true)
    const nudged = tamper(item, (x) => {
      x.expected_time_s = item.expected_time_s + 1e-12
      x.difficulty = { ...item.difficulty, b_prior: item.difficulty.b_prior + 1e-12 }
    })
    expect(verifySpan(cfg, nudged).ok).toBe(true)
  })

  it('does not apply digit rules to Corsi, or the palindrome rule forward', () => {
    expect(verifySpan(SPAN_CORSI, withTrials(SPAN_CORSI, cor, (t) => (t[0] = [3, 4, 5]))).ok).toBe(true)
    expect(verifySpan(SPAN_FWD, withTrials(SPAN_FWD, fwd, (t) => (t[0] = [3, 5, 3]))).ok).toBe(true)
  })
})

describe('span verifier rejects each failure reason (hand-built bad blocks)', () => {
  it('spec_fields: an extra spec field; a board on a digit task', () => {
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.spec.hint = 1)), ['spec_fields'])
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.spec.board = cor.spec.board)), ['spec_fields', 'board_matches'])
  })

  it('task_matches: wrong task or recall order', () => {
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.spec.task = 'digits_backward')), ['task_matches'])
    expectRejected(SPAN_BWD, tamper(bwd, (x) => (x.spec.recall = 'forward')), ['task_matches'])
  })

  it('protocol_matches: another start length, trials per length or max length', () => {
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.spec.max_length = 9)), ['protocol_matches', 'state_machine_consistent'])
    expectRejected(SPAN_BWD, tamper(bwd, (x) => (x.spec.start_length = 2)), ['protocol_matches', 'state_machine_consistent'])
    expectRejected(SPAN_CORSI, tamper(cor, (x) => (x.spec.trials_per_length = 3)), ['protocol_matches', 'state_machine_consistent'])
  })

  it('timing_matches: changed stimulus timing', () => {
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.spec.timing = { on_ms: 500, off_ms: 200 })), ['timing_matches'])
    expectRejected(SPAN_FWD, tamper(fwd, (x) => delete x.spec.timing), ['spec_fields', 'timing_matches'])
  })

  it('board_matches: a moved or missing Corsi block', () => {
    const moved = tamper(cor, (x) => {
      const board = x.spec.board as { blocks: number[][] }
      board.blocks[4] = [0.5, 0.5]
    })
    expectRejected(SPAN_CORSI, moved, ['board_matches'])
    expectRejected(SPAN_CORSI, tamper(cor, (x) => delete x.spec.board), ['spec_fields', 'board_matches'])
  })

  it('trials_well_formed: stimuli that are not integer sequences', () => {
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.spec.trials = 'abc')), ['trials_well_formed'])
    expectRejected(SPAN_FWD, tamper(fwd, (x) => ((x.spec.trials as unknown[][])[3] = [1, '2', 3, 4])), ['trials_well_formed'])
    expectRejected(SPAN_FWD, tamper(fwd, (x) => ((x.spec.trials as unknown[][])[3] = [1, 2.5, 3, 4])), ['trials_well_formed'])
  })

  it('trial_count: a missing length', () => {
    const bad = withTrials(SPAN_FWD, fwd, (t) => t.splice(14, 2))
    expectRejected(SPAN_FWD, bad, ['trial_count', 'trial_lengths', 'state_machine_consistent'])
  })

  it('trial_lengths: trials out of length order', () => {
    const bad = withTrials(SPAN_BWD, bwd, (t) => {
      const [a, b] = [t[0] as number[], t[2] as number[]]
      t[0] = b
      t[2] = a
    })
    expectRejected(SPAN_BWD, bad, ['trial_lengths', 'state_machine_consistent'])
  })

  it('symbols_valid: a 0 in digit span, a 10th block in Corsi', () => {
    expectRejected(SPAN_FWD, withTrials(SPAN_FWD, fwd, (t) => (t[0] = [0, 5, 2])), ['symbols_valid'])
    expectRejected(SPAN_CORSI, withTrials(SPAN_CORSI, cor, (t) => (t[0] = [9, 5, 2])), ['symbols_valid'])
    expectRejected(SPAN_BWD, withTrials(SPAN_BWD, bwd, (t) => (t[0] = [10, 5, 2])), ['symbols_valid'])
  })

  it('no_immediate_repeats', () => {
    expect(hasImmediateRepeat([5, 5, 2])).toBe(true)
    expectRejected(SPAN_FWD, withTrials(SPAN_FWD, fwd, (t) => (t[0] = [5, 5, 2])), ['no_immediate_repeats'])
    expectRejected(SPAN_CORSI, withTrials(SPAN_CORSI, cor, (t) => (t[4] = [1, 6, 6, 2, 7])), ['no_immediate_repeats'])
  })

  it('no_runs_of_three: ascending and descending ±1 runs in digit span', () => {
    expect([hasRunOfThree([3, 4, 5]), hasRunOfThree([8, 7, 6]), hasRunOfThree([2, 4, 6]), hasRunOfThree([3, 4, 3])]).toEqual([
      true,
      true,
      false,
      false,
    ])
    expectRejected(SPAN_FWD, withTrials(SPAN_FWD, fwd, (t) => (t[0] = [3, 4, 5])), ['no_runs_of_three'])
    expectRejected(SPAN_BWD, withTrials(SPAN_BWD, bwd, (t) => (t[6] = [1, 9, 8, 7, 2, 4])), ['no_runs_of_three'])
  })

  it('no_palindromes: a backward trial that reads the same both ways', () => {
    expect(isPalindrome([3, 5, 3])).toBe(true)
    // The forward order would also be exactly correct, which the state-machine check sees too.
    expectRejected(SPAN_BWD, withTrials(SPAN_BWD, bwd, (t) => (t[0] = [3, 5, 3])), ['no_palindromes', 'state_machine_consistent'])
  })

  it('sequences_distinct: a repeated sequence within the block', () => {
    expectRejected(SPAN_FWD, withTrials(SPAN_FWD, fwd, (t) => (t[9] = [...(t[8] as number[])])), ['sequences_distinct'])
  })

  it('key_well_formed: extra key fields, a short or non-integer key', () => {
    const extra = tamper(fwd, (x) => (x.key = { ...fwd.key, hint: 1 }))
    expectRejected(SPAN_FWD, extra, ['key_well_formed', 'key_matches_rule', 'state_machine_consistent'])
    const short = tamper(fwd, (x) => (x.key = { sequences: fwd.key.sequences.slice(0, 4) }))
    expectRejected(SPAN_FWD, short, ['key_well_formed', 'key_matches_rule', 'state_machine_consistent'])
    const text = tamper(cor, (x) => (x.key = { sequences: cor.key.sequences.map((s) => s.join('')) }))
    expectRejected(SPAN_CORSI, text, ['key_well_formed', 'key_matches_rule', 'state_machine_consistent'])
  })

  it('key_matches_rule: a wrong forward key; an unreversed backward key', () => {
    const wrong = tamper(fwd, (x) => {
      const seqs = x.key.sequences as number[][]
      seqs[5] = [...(seqs[5] as number[])].reverse()
    })
    expectRejected(SPAN_FWD, wrong, ['key_matches_rule'])
    const unreversed = tamper(bwd, (x) => (x.key = { sequences: bwd.spec.trials }))
    expectRejected(SPAN_BWD, unreversed, ['key_matches_rule', 'state_machine_consistent'])
  })

  it('structure_matches: structural_params that do not describe the stimuli', () => {
    const bad = tamper(cor, (x) => (x.structural_params = { task: 'corsi', trials: [...cor.spec.trials].reverse() }))
    expectRejected(SPAN_CORSI, bad, ['structure_matches'])
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.structural_params = { task: 'corsi', trials: fwd.spec.trials })), ['structure_matches'])
  })

  it('grm_params: wrong a, shifted thresholds, another model, too few thresholds', () => {
    const p = fwd.params as { model: 'grm'; a: number; b: readonly number[] }
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.params = { ...p, a: 1 })), ['grm_params'])
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.params = { ...p, b: p.b.map((b) => b + 0.1) })), ['grm_params'])
    const twoPl = tamper(fwd, (x) => (x.params = { model: '2pl', a: 1.7, b: fwd.difficulty.b_prior }))
    expectRejected(SPAN_FWD, twoPl, ['grm_params', 'state_machine_consistent'])
    const seven = tamper(fwd, (x) => (x.params = { ...p, b: p.b.slice(0, 7) }))
    expectRejected(SPAN_FWD, seven, ['grm_params', 'state_machine_consistent'])
  })

  it('prior_matches: b_prior, sd_prior, features or provenance changed', () => {
    const d = bwd.difficulty
    expectRejected(SPAN_BWD, tamper(bwd, (x) => (x.difficulty = { ...d, b_prior: d.b_prior + 0.2 })), ['prior_matches'])
    expectRejected(SPAN_BWD, tamper(bwd, (x) => (x.difficulty = { ...d, sd_prior: 0.5 })), ['prior_matches'])
    expectRejected(SPAN_BWD, tamper(bwd, (x) => (x.difficulty = { ...d, features: { ...d.features, max_length: 10 } })), ['prior_matches'])
    expectRejected(SPAN_BWD, tamper(bwd, (x) => (x.difficulty = { ...d, provenance: 'made up' })), ['prior_matches'])
  })

  it('stratum_matches: a stratum outside the family band', () => {
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.stratum = 4)), ['stratum_matches'])
    // A b_prior moved into another band fails both the prior and the stratum.
    const d = fwd.difficulty
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (x.difficulty = { ...d, b_prior: 1 })), ['prior_matches', 'stratum_matches'])
  })

  it('expected_time_matches: a different or out-of-range E[T]', () => {
    expectRejected(SPAN_CORSI, tamper(cor, (x) => (x.expected_time_s = 30)), ['expected_time_matches'])
    expectRejected(SPAN_CORSI, tamper(cor, (x) => (x.expected_time_s = cor.expected_time_s + 1e-6)), ['expected_time_matches'])
  })

  it('malformed instances fail with a reason instead of throwing', () => {
    const loose = (x: Mutable) => x as { spec: unknown; key: unknown }
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (loose(x).spec = null)), ['spec_fields'])
    expectRejected(SPAN_FWD, tamper(fwd, (x) => (loose(x).spec = [1, 2])), ['spec_fields'])
    const noKey = tamper(fwd, (x) => (loose(x).key = null))
    expectRejected(SPAN_FWD, noKey, ['key_well_formed', 'key_matches_rule', 'state_machine_consistent'])
    const noPrior = tamper(fwd, (x) => (x.difficulty = null))
    expectRejected(SPAN_FWD, noPrior, ['prior_matches', 'stratum_matches'])
    const hole = tamper(fwd, (x) => (x.structural_params = { task: 'digits_forward', trials: [undefined] }))
    const v = verifySpan(SPAN_FWD, hole)
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/^malformed item/)
  })

  it('verifies against the family it is called for', () => {
    expect(verifySpan(SPAN_BWD, fwd).ok).toBe(false)
    expect(verifySpan(SPAN_FWD, cor).ok).toBe(false)
    expect(spanFwd.verify(bwd as SpanItem).ok).toBe(false)
  })
})
