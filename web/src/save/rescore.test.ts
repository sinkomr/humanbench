import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, AXIS_INDEX, N_AXES } from '../engine/axes'
import { createRng } from '../engine/prng'
import { RHO_MAX_PRIOR, rescoreRetest, retestGain } from '../engine/retest'
import { scoreAll } from '../engine/scorer'
import type { Observation, ResponseTuple } from '../engine/types'
import { calibrationObservation } from '../tasks/calibration'
import type { ItemInstance } from '../tasks/family'
import { matrices } from '../tasks/matrices'
import { rotation } from '../tasks/rotation'
import { CAL_NORMS } from '../tasks/priors'
import { rtSimple } from '../tasks/rt'
import { rtValidResponse } from '../tasks/rt/synthetic'
import * as saveBarrel from './index'
import { isUsableCache } from './merge'
import { blockResponseOf, itemAxis, posteriorCacheOf, registryObservation, rescoreSessions, type ResponseResolver } from './rescore'
import { TEST_CTX } from './testing'
import { CONTINUATION_FLAG, SCHEMA_URL, SCHEMA_VERSION, type SaveFileV1, type SaveSession, type SessionFlags } from './types'
import { assertValidSave } from './validate'

type AnyItem = ItemInstance<object, object>
// S1 is the earlier session (day 1) but has the larger id, so only start times order them.
const S1 = 's_0000000b'
const S2 = 's_0000000a'
const keyIndex = (item: AnyItem): number => (item.key as { index: number }).index

/** The observation the resolver must produce for a keyed MC item answered `y`. */
function mcObservation(item: AnyItem, y: 0 | 1): Observation {
  const p = item.params
  if (p.model === '3pl') return { kind: '3pl', axis: item.axis, a: p.a, b: p.b, c: p.c, y }
  if (p.model === '2pl') return { kind: '2pl', axis: item.axis, a: p.a, b: p.b, y }
  throw new Error(`unexpected model ${p.model}`)
}

/** A response tuple answering an MC item right (y = 1) or wrong; `stored` overrides the stored correct. */
function mcTuple(item: AnyItem, y: 0 | 1, stored: 0 | 1 | null = y): ResponseTuple {
  const k = item.options_count ?? 4
  const idx = keyIndex(item)
  return [item.item_id, 0, y === 1 ? idx : (idx + 1) % k, stored, 30_000, null]
}

const session = (id: string, day: number, responses: ResponseTuple[]): SaveSession => ({
  session_id: id,
  started_utc: `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`,
  duration_s: 1800,
  device: { class: 'desktop', input: 'keyboard', os_family: 'macOS', browser_family: 'Safari', refresh_hz_est: 120, timer_res_ms: 1, viewport: [1512, 861] },
  flags: {},
  responses,
})

const saveOf = (sessions: SaveSession[]): SaveFileV1 =>
  assertValidSave({
    $schema: SCHEMA_URL,
    schema_version: SCHEMA_VERSION,
    bank_version: TEST_CTX.bank_version,
    anon_id: 'hb_7Q3m9Kx2Vw5rT8pL',
    created_utc: '2026-10-20T10:00:00Z',
    sessions,
    seen_items: [],
    seen_families: [],
  })

const rot = (seed: string): AnyItem => rotation.generate(seed) as AnyItem
const mat = (seed: string): AnyItem => matrices.generate(seed) as AnyItem

describe('registryObservation (response tuple → observation)', () => {
  it('regenerates a 3PL (rotation) and a 2PL (matrices) item and re-scores the stored response', () => {
    const r = rot('rq-1')
    const m = mat('rq-2')
    expect(r.params.model).toBe('3pl')
    expect(m.params.model).toBe('2pl')
    expect(registryObservation(mcTuple(r, 1))).toEqual({ observation: mcObservation(r, 1) })
    expect(registryObservation(mcTuple(m, 0))).toEqual({ observation: mcObservation(m, 0) })
  })

  it('the raw response wins over a stored correct that disagrees (§7.8: raw data are authoritative)', () => {
    const r = rot('rq-3')
    expect(registryObservation(mcTuple(r, 1, 0))).toEqual({ observation: mcObservation(r, 1) })
  })

  it('a response the family cannot read keeps the stored correct (a time-out), or is skipped without one', () => {
    const r = rot('rq-4')
    expect(registryObservation([r.item_id, 0, null, 0, 180_000, null])).toEqual({ observation: mcObservation(r, 0) })
    expect(registryObservation([r.item_id, 0, null, null, 180_000, null])).toMatchObject({ skip: 'malformed' })
  })

  it('skips pretest responses and ids this build cannot regenerate (A11, A18)', () => {
    const r = rot('rq-5')
    expect(registryObservation([r.item_id, 1, keyIndex(r), 1, 1000, null])).toEqual({ skip: 'pretest' })
    for (const id of ['i:mat:f0182:v3', 'i:rotation:0.0.1:s1', `${r.item_id.replace(/:([^:]+):rq-5$/, ':$1+py:rq-5')}`, 'not-an-id']) {
      expect(registryObservation([id, 0, 0, 1, 1000, null]), id).toEqual({ skip: 'unresolved' })
    }
  })

  it('scores a block with its family: an RT block becomes its Gaussian observation', () => {
    const item = rtSimple.generate('rq-rt') as AnyItem
    const response = rtValidResponse(item as never, createRng('rq-rt-resp'))
    const want = rtSimple.score(item as never, response).observation
    expect(want?.kind).toBe('gaussian')
    expect(registryObservation([item.item_id, 0, response as never, null, 60_000, null])).toEqual({ observation: want })
    expect(registryObservation([item.item_id, 0, 'trials', null, 60_000, null])).toMatchObject({ skip: 'malformed' })
    // The §8 example's layout: "trials" with the block's data in `extra` (engine/types.ts ResponseTuple).
    expect(registryObservation([item.item_id, 0, 'trials', null, 60_000, null, response as never])).toEqual({ observation: want })
    expect(registryObservation([item.item_id, 0, 'trials', null, 18_211, null, [243, 251, 238]])).toMatchObject({ skip: 'malformed' }) // no choices
    const empty = { rt_ms: Array(30).fill(null), choice: Array(30).fill(null) }
    expect(registryObservation([item.item_id, 0, empty, null, 60_000, null])).toMatchObject({ skip: 'no_observation', detail: expect.stringContaining('too_few_valid_trials') })
  })
})

describe('blockResponseOf and itemAxis', () => {
  it('reads a block from `response`, or from `extra` behind "trials" (§8 example)', () => {
    expect(blockResponseOf(['i:rt_simple:2.0.0:x', 0, { rt_ms: [] }, null, 1, null])).toEqual({ rt_ms: [] })
    expect(blockResponseOf(['i:rt_simple:2.0.0:x', 0, 'trials', null, 1, null, { rt_ms: [1] }])).toEqual({ rt_ms: [1] })
    expect(blockResponseOf(['i:rt_simple:2.0.0:x', 0, 'trials', null, 1, null])).toBe('trials')
    expect(blockResponseOf(['i:rt_simple:2.0.0:x', 0, 'other', null, 1, null, { rt_ms: [1] }])).toBe('other')
  })

  it('names the axis of a registered family whatever the generator version; undefined otherwise', () => {
    const r = rot('ax-1')
    expect(itemAxis(r.item_id)).toBe('SPA')
    expect(itemAxis(r.item_id.replace(`:${rotation.generatorVersion}:`, ':0.9.0:'))).toBe('SPA')
    expect(itemAxis(r.item_id.replace(`:${rotation.generatorVersion}:`, `:${rotation.generatorVersion}+py:`))).toBe('SPA')
    expect(itemAxis(mat('ax-2').item_id)).toBe('MAT')
    expect(itemAxis(rtSimple.generate('ax-3').item_id)).toBe('RT')
    for (const id of ['i:mat:f0182:v3', 'not-an-id', 'i:toString:1.0.0:x', '']) expect(itemAxis(id), id).toBeUndefined()
  })
})

describe('rescoreSessions (§7.8 re-scoring of a multi-session save, M1.Q)', () => {
  const s1Items = ['a', 'b', 'c', 'd'].map((x) => rot(`s1-${x}`))
  const s2Items = ['a', 'b', 'c', 'd'].map((x) => rot(`s2-${x}`))
  const m1 = mat('s1-m')
  const rtItem = rtSimple.generate('s1-rt') as AnyItem
  const rtResponse = rtValidResponse(rtItem as never, createRng('s1-rt-resp'))
  const save = saveOf([
    // Listed out of time order on purpose: re-scoring orders by started_utc (§8 merge order).
    session(S2, 8, s2Items.map((it, i) => mcTuple(it, i % 2 === 0 ? 1 : 0))),
    session(S1, 1, [
      ...s1Items.map((it) => mcTuple(it, 1)),
      mcTuple(m1, 1),
      [rtItem.item_id, 0, rtResponse as never, null, 60_000, null],
      [s1Items[0]!.item_id, 1, 0, 0, 1000, null], // pretest
      ['i:mat:f0182:v3', 0, 'C', 1, 41_250, 80], // the §8 example id: not a registered generator
    ]),
  ])

  it('orders sessions by time, numbers tests per axis and applies ρ_k(s)', () => {
    const r = rescoreSessions(save)
    expect(r.sessions.map((s) => s.session_id)).toEqual([S1, S2])
    expect(r.sessions[0]!.ordinals).toEqual({ MAT: 1, SPA: 1, RT: 1 })
    expect(r.sessions[1]!.ordinals).toEqual({ SPA: 2 })
    expect(r.sessions[1]!.rho).toEqual({ SPA: retestGain(RHO_MAX_PRIOR.SPA, 2) })
    expect(r.next_ordinals).toMatchObject({ SPA: 3, MAT: 2, RT: 2, KST: 1 })
    expect(r.practice_adjusted).toBe(true)
    expect(r.n_scored).toBe(10)
    expect(r.skipped).toEqual([
      { session_id: S1, index: 6, item_id: s1Items[0]!.item_id, reason: 'pretest' },
      { session_id: S1, index: 7, item_id: 'i:mat:f0182:v3', reason: 'unresolved' },
    ])
  })

  it('equals the engine retest scorer on the same observations', () => {
    const rtObs = rtSimple.score(rtItem as never, rtResponse).observation!
    const want = rescoreRetest([
      { session_id: S1, started_utc: '2026-10-01T10:00:00Z', observations: [...s1Items.map((it) => mcObservation(it, 1)), mcObservation(m1, 1), rtObs] },
      { session_id: S2, started_utc: '2026-10-08T10:00:00Z', observations: s2Items.map((it, i) => mcObservation(it, i % 2 === 0 ? 1 : 0)) },
    ])
    const got = rescoreSessions(save)
    expect(got.theta).toEqual(want.theta)
    expect(got.cov).toEqual(want.cov)
    expect(got.eap).toEqual(want.eap)
  })

  it('does not modify the save', () => {
    const before = JSON.stringify(save)
    rescoreSessions(save)
    expect(JSON.stringify(save)).toBe(before)
  })

  it('a single-session save re-scores exactly as the plain scorer', () => {
    const one = saveOf([session(S1, 1, s1Items.map((it) => mcTuple(it, 1)))])
    const plain = scoreAll(s1Items.map((it) => mcObservation(it, 1)))
    const r = rescoreSessions(one)
    expect(r.theta).toEqual(plain.theta)
    expect(r.cov).toEqual(plain.cov)
  })

  it('practice credit lowers the second session’s evidence: θ̂_SPA below the ρ = 0 pooled score', () => {
    const same = saveOf([session(S1, 1, s1Items.map((it) => mcTuple(it, 1))), session(S2, 8, s1Items.map((it) => mcTuple(it, 1)))])
    const pooled = rescoreSessions(same, { rhoMax: { SPA: 0 } })
    const adjusted = rescoreSessions(same)
    expect(adjusted.theta[AXIS_INDEX.SPA]!).toBeLessThan(pooled.theta[AXIS_INDEX.SPA]!)
  })

  it('a first session this build cannot score still counts as a test: the next one is s = 2 (exposure)', () => {
    const later = session(S2, 8, s2Items.map((it) => mcTuple(it, 1)))
    const oldVersion = (it: AnyItem): string => it.item_id.replace(`:${rotation.generatorVersion}:`, ':0.9.0:')
    const unresolved = session(S1, 1, s1Items.map((it): ResponseTuple => [oldVersion(it), 0, keyIndex(it), 1, 30_000, null]))
    const pretestOnly = session(S1, 1, s1Items.map((it): ResponseTuple => [it.item_id, 1, keyIndex(it), 1, 30_000, null]))
    const alone = rescoreSessions(saveOf([later]))
    expect(alone.sessions[0]!.ordinals).toEqual({ SPA: 1 })
    for (const first of [unresolved, pretestOnly]) {
      const r = rescoreSessions(saveOf([later, first]))
      expect(r.sessions.map((s) => s.ordinals)).toEqual([{ SPA: 1 }, { SPA: 2 }])
      expect(r.sessions[1]!.rho).toEqual({ SPA: retestGain(RHO_MAX_PRIOR.SPA, 2) })
      expect(r.next_ordinals.SPA).toBe(3)
      expect(r.n_scored).toBe(4)
      expect(new Set(r.skipped.map((x) => x.reason))).toEqual(new Set([first === unresolved ? 'unresolved' : 'pretest']))
      // The same SPA responses now carry the ρ(2) practice shift (direction aside: 3PL terms are not log-concave).
      expect(r.theta[AXIS_INDEX.SPA]).not.toBe(alone.theta[AXIS_INDEX.SPA])
    }
  })

  it('a skip from an injected resolver may name the axis (families this build does not know)', () => {
    const exposedMat = saveOf([session(S1, 1, [['i:mat:f0182:v3', 0, 'C', 1, 41_250, 80]]), session(S2, 8, [mcTuple(m1, 1)])])
    expect(rescoreSessions(exposedMat).sessions.map((s) => s.ordinals)).toEqual([{}, { MAT: 1 }])
    const resolve: ResponseResolver = (t) => (t[0] === 'i:mat:f0182:v3' ? { skip: 'unresolved', axis: 'MAT' } : registryObservation(t))
    expect(rescoreSessions(exposedMat, { resolve }).sessions.map((s) => s.ordinals)).toEqual([{ MAT: 1 }, { MAT: 2 }])
  })

  it('takes an injected resolver (server params for items this build cannot regenerate, M2)', () => {
    const resolve: ResponseResolver = (t) =>
      t[0] === 'i:mat:f0182:v3' ? { observation: { kind: '2pl', axis: 'MAT', a: 1.3, b: 0.2, y: t[3] === 1 ? 1 : 0 } } : registryObservation(t)
    const r = rescoreSessions(save, { resolve })
    expect(r.n_scored).toBe(11)
    expect(r.skipped.map((s) => s.reason)).toEqual(['pretest'])
  })

  it('property: sessions are exchangeable in the file (only start times order them), and ρ^max = 0 pools them', () => {
    const pool = [...s1Items, ...s2Items, m1]
    const sessionArb = fc.array(fc.tuple(fc.integer({ min: 0, max: pool.length - 1 }), fc.constantFrom<0 | 1>(0, 1)), { minLength: 1, maxLength: 5 })
    fc.assert(
      fc.property(fc.array(sessionArb, { minLength: 1, maxLength: 4 }), (per) => {
        // Ids in the reverse of time order: only start times order the sessions.
        const sessions = per.map((rs, i) => session(`s_${String(90 - i).padStart(8, '0')}`, i + 1, rs.map(([j, y]) => mcTuple(pool[j]!, y))))
        const a = rescoreSessions(saveOf(sessions))
        const b = rescoreSessions(saveOf([...sessions].reverse()))
        expect(b.theta).toEqual(a.theta)
        const flat = per.flatMap((rs) => rs.map(([j, y]) => mcObservation(pool[j]!, y)))
        const zero = rescoreSessions(saveOf(sessions), { rhoMax: Object.fromEntries(AXIS_CODES.map((k) => [k, 0])) })
        const plain = scoreAll(flat)
        zero.theta.forEach((v, i) => expect(v).toBeCloseTo(plain.theta[i]!, 12))
      }),
      { numRuns: 25 },
    )
  })
})

describe('rescoreSessions: continuation sessions (CONTINUATION_FLAG, §7.8)', () => {
  const first = ['a', 'b', 'c'].map((x) => rot(`ct1-${x}`))
  const rest = ['a', 'b', 'c'].map((x) => rot(`ct2-${x}`))
  const m = mat('ct-m')
  /** `session()` at `hour` on `day`, with `flags`. */
  const at = (id: string, day: number, hour: number, responses: ResponseTuple[], flags: SessionFlags = {}): SaveSession => ({
    ...session(id, day, responses),
    started_utc: `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`,
    flags,
  })
  const firstPart = first.map((it) => mcTuple(it, 1))
  const secondPart = [...rest.map((it, i) => mcTuple(it, i % 2 === 0 ? 1 : 0)), mcTuple(m, 1)]

  it('a session flagged as a continuation shares its sitting’s test numbers: no practice adjustment between the parts', () => {
    const save = saveOf([at(S2, 1, 11, secondPart, { [CONTINUATION_FLAG]: true }), at(S1, 1, 10, firstPart), at('s_0000000z', 8, 10, firstPart)])
    const r = rescoreSessions(save)
    expect(r.sessions.map((s) => [s.session_id, s.continuation, s.ordinals])).toEqual([
      [S1, undefined, { SPA: 1 }],
      [S2, true, { MAT: 1, SPA: 1 }],
      ['s_0000000z', undefined, { SPA: 2 }],
    ])
    expect(r.sessions[1]!.rho).toEqual({ MAT: 0, SPA: 0 })
    expect(r.next_ordinals).toMatchObject({ SPA: 3, MAT: 2 })
    // The two parts score exactly as one session holding both.
    const whole = rescoreSessions(saveOf([at(S1, 1, 10, [...firstPart, ...secondPart]), at('s_0000000z', 8, 10, firstPart)]))
    expect(r.theta).toEqual(whole.theta)
    expect(r.cov).toEqual(whole.cov)
    expect(r.eap).toEqual(whole.eap)
    // Without the flag the second part is a retest of the first.
    const unflagged = rescoreSessions(saveOf([at(S1, 1, 10, firstPart), at(S2, 1, 11, secondPart), at('s_0000000z', 8, 10, firstPart)]))
    expect(unflagged.sessions.map((s) => s.ordinals)).toEqual([{ SPA: 1 }, { MAT: 1, SPA: 2 }, { SPA: 3 }])
  })

  it('only `true` marks a continuation, and the flag on the first session is ignored', () => {
    const plain = rescoreSessions(saveOf([at(S1, 1, 10, firstPart), at(S2, 1, 11, secondPart)]))
    const variants: [SessionFlags, SessionFlags][] = [
      [{}, { [CONTINUATION_FLAG]: false }],
      [{}, { [CONTINUATION_FLAG]: 1 }],
      [{}, { [CONTINUATION_FLAG]: null }],
      [{ [CONTINUATION_FLAG]: true }, {}],
    ]
    for (const [f1, f2] of variants) {
      const r = rescoreSessions(saveOf([at(S1, 1, 10, firstPart, f1), at(S2, 1, 11, secondPart, f2)]))
      expect(r.sessions, JSON.stringify([f1, f2])).toEqual(plain.sessions)
      expect(r.theta).toEqual(plain.theta)
      expect(r.cov).toEqual(plain.cov)
    }
  })

  it('property: a save without continuation flags scores as before; a continuation flag never raises a test number', () => {
    const pool = [...first, ...rest, m]
    const flagArb = fc.constantFrom<SessionFlags>({}, { [CONTINUATION_FLAG]: false }, { [CONTINUATION_FLAG]: 0 }, { [CONTINUATION_FLAG]: null }, { [CONTINUATION_FLAG]: true })
    const sessionArb = fc.record({ rs: fc.array(fc.tuple(fc.integer({ min: 0, max: pool.length - 1 }), fc.constantFrom<0 | 1>(0, 1)), { maxLength: 4 }), flags: flagArb })
    fc.assert(
      fc.property(fc.array(sessionArb, { minLength: 1, maxLength: 5 }), (per) => {
        const build = (flags: (f: SessionFlags) => SessionFlags): SaveFileV1 =>
          saveOf(per.map(({ rs, flags: f }, i) => at(`s_${String(90 - i).padStart(8, '0')}`, 1 + Math.floor(i / 2), 10 + i, rs.map(([j, y]) => mcTuple(pool[j]!, y)), flags(f))))
        const none = rescoreSessions(build(() => ({})))
        const notTrue = rescoreSessions(build((f) => (f[CONTINUATION_FLAG] === true ? {} : f)))
        expect(notTrue.sessions).toEqual(none.sessions)
        expect(notTrue.theta).toEqual(none.theta)
        expect(none.sessions.some((s) => s.continuation !== undefined)).toBe(false)
        const marked = rescoreSessions(build((f) => f))
        marked.sessions.forEach((s, i) => {
          const before = none.sessions[i]!
          expect(s.session_id).toBe(before.session_id)
          expect(Object.keys(s.ordinals)).toEqual(Object.keys(before.ordinals))
          for (const [k, n] of Object.entries(s.ordinals)) expect(n).toBeLessThanOrEqual(before.ordinals[k as keyof typeof before.ordinals]!)
        })
        for (const k of AXIS_CODES) expect(marked.next_ordinals[k]).toBeLessThanOrEqual(none.next_ordinals[k])
      }),
      { numRuns: 30 },
    )
  })
})

describe('rescoreSessions: the calibration observation (§7.1, M1.15 review)', () => {
  const rated = (t: ResponseTuple, pct: number): ResponseTuple => [t[0], t[1], t[2], t[3], t[4], pct]
  const n = CAL_NORMS.min_responses
  const items = Array.from({ length: n + 2 }, (_, i) => rot(`cal-${i}`))
  /** Answers alternate right / wrong; confidences cycle through 55, 70, 85, 95. */
  const answers = (list: AnyItem[]): ResponseTuple[] => list.map((it, i) => rated(mcTuple(it, i % 2 === 0 ? 1 : 0), [55, 70, 85, 95][i % 4]!))
  it('adds the session’s CAL observation once it has min_responses rated answers: exactly what the session flow shows', () => {
    const tuples = answers(items)
    const r = rescoreSessions(saveOf([session(S1, 1, tuples)]))
    const cal = calibrationObservation(tuples.map((t) => ({ pct: t[5] as number, correct: t[3] as 0 | 1 })))!
    const itemObs = tuples.map((t) => (registryObservation(t) as { observation: Observation }).observation)
    const byHand = rescoreRetest([{ session_id: S1, started_utc: '2026-10-01T10:00:00Z', observations: [...itemObs, cal] }])
    expect(r.n_scored).toBe(items.length + 1)
    for (let i = 0; i < N_AXES; i++) expect(r.theta[i], AXIS_CODES[i]).toBeCloseTo(byHand.theta[i]!, 12)
    expect(r.eap.CAL).toBeDefined()
    // The ratings are raw data: without them the same answers carry no CAL evidence.
    const unrated = tuples.map((t): ResponseTuple => [t[0], t[1], t[2], t[3], t[4], null])
    const bare = rescoreSessions(saveOf([session(S1, 1, unrated)]))
    expect(bare.n_scored).toBe(items.length)
    expect(bare.eap.CAL).toBeUndefined()
    expect(r.theta[AXIS_INDEX.CAL]).not.toBe(bare.theta[AXIS_INDEX.CAL])
  })

  it('needs min_responses rated answers: fewer give none', () => {
    const few = answers(items).map((t, i) => (i < n - 1 ? t : ([t[0], t[1], t[2], t[3], t[4], null] as ResponseTuple)))
    const r = rescoreSessions(saveOf([session(S1, 1, few)]))
    expect(r.n_scored).toBe(items.length)
    expect(r.eap.CAL).toBeUndefined()
  })

  it('leaves pretest responses out, and takes the outcome from the re-scored response over a stored correct that disagrees', () => {
    const tuples = answers(items)
    const withPretest = [...tuples, rated([items[0]!.item_id, 1, keyIndex(items[0]!), 1, 1000, null], 99)]
    expect(rescoreSessions(saveOf([session(S1, 1, withPretest)])).theta[AXIS_INDEX.CAL]).toBeCloseTo(rescoreSessions(saveOf([session(S1, 1, tuples)])).theta[AXIS_INDEX.CAL]!, 12)
    // Stored `correct` flipped on every tuple: the raw responses still say what they said.
    const flipped = tuples.map((t) => [t[0], t[1], t[2], t[3] === 1 ? 0 : 1, t[4], t[5]] as ResponseTuple)
    expect(rescoreSessions(saveOf([session(S1, 1, flipped)])).theta[AXIS_INDEX.CAL]).toBeCloseTo(rescoreSessions(saveOf([session(S1, 1, tuples)])).theta[AXIS_INDEX.CAL]!, 12)
  })

  it('is per session: two sessions of a few ratings each are two separate short sessions, not one CAL observation', () => {
    const half = Math.floor(n / 2)
    const r = rescoreSessions(saveOf([session(S1, 1, answers(items.slice(0, half))), session(S2, 8, answers(items.slice(half, 2 * half)))]))
    expect(r.eap.CAL).toBeUndefined()
  })
})

describe('posteriorCacheOf (§8 posterior_cache)', () => {
  it('is a usable cache over every axis: θ̂ and the lower triangle of the covariance', () => {
    const r = rescoreSessions(saveOf([session(S1, 1, [mcTuple(rot('pc-1'), 1)])]))
    const cache = posteriorCacheOf(r, TEST_CTX.param_version)
    expect(isUsableCache(cache, TEST_CTX.param_version)).toBe(true)
    expect(cache.axes).toEqual([...AXIS_CODES])
    expect(cache.mean).toEqual(r.theta)
    expect(cache.cov_lower).toHaveLength((N_AXES * (N_AXES + 1)) / 2)
    expect(cache.cov_lower[2]).toBe(r.cov[1]![1]) // row-major lower triangle: (0,0), (1,0), (1,1), …
    expect(() => posteriorCacheOf({ theta: [0], cov: [[1]] }, 'p')).toThrow(RangeError)
  })
})

describe('save barrel', () => {
  it('does not re-export the re-scorer, which imports the task registry (bundle size, scripts/bundle.test.ts)', () => {
    for (const n of ['rescoreSessions', 'registryObservation', 'posteriorCacheOf']) expect(saveBarrel).not.toHaveProperty(n)
  })
})
