import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, type AxisCode } from '../engine/axes'
import { newAnonId } from '../save/ids'
import { saveWithSession } from '../save/create'
import { rescoreSessions } from '../save/rescore'
import { assertValidSave } from '../save/validate'
import { SAVE_CTX } from './constants'
import { Bot } from './bot'

/** One thing a person, a browser or the clock might do to the run, in any order. */
type Op =
  | { t: 'step' }
  | { t: 'tick' }
  | { t: 'wait'; s: number }
  | { t: 'skip'; axis: AxisCode | null }
  | { t: 'finish' }
  | { t: 'junk_item'; v: unknown }
  | { t: 'junk_block'; v: unknown }
  | { t: 'conf'; pct: number }
  | { t: 'take_break' }
  | { t: 'resume' }
  | { t: 'decline' }
  | { t: 'hidden' }
  | { t: 'visible' }
  | { t: 'paste' }
  | { t: 'shown'; ms: number }
  | { t: 'unavailable' }
  | { t: 'start' }

const junk = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(Number.NaN),
  fc.integer({ min: -3, max: 12 }),
  fc.string({ maxLength: 8 }),
  fc.constant({}),
  fc.constant([]),
  fc.constant({ rt_ms: [1, 2], choice: [0] }),
)

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 12, arbitrary: fc.constant<Op>({ t: 'step' }) },
  { weight: 3, arbitrary: fc.constant<Op>({ t: 'tick' }) },
  { weight: 3, arbitrary: fc.double({ min: 0, max: 900, noNaN: true }).map((s): Op => ({ t: 'wait', s })) },
  { weight: 2, arbitrary: fc.option(fc.constantFrom(...AXIS_CODES), { nil: null }).map((axis): Op => ({ t: 'skip', axis })) },
  { weight: 1, arbitrary: fc.constant<Op>({ t: 'finish' }) },
  { weight: 2, arbitrary: junk.map((v): Op => ({ t: 'junk_item', v })) },
  { weight: 2, arbitrary: junk.map((v): Op => ({ t: 'junk_block', v })) },
  { weight: 2, arbitrary: fc.integer({ min: -5, max: 120 }).map((pct): Op => ({ t: 'conf', pct })) },
  { weight: 1, arbitrary: fc.constant<Op>({ t: 'take_break' }) },
  { weight: 1, arbitrary: fc.constant<Op>({ t: 'resume' }) },
  { weight: 1, arbitrary: fc.constant<Op>({ t: 'decline' }) },
  { weight: 1, arbitrary: fc.constant<Op>({ t: 'hidden' }) },
  { weight: 1, arbitrary: fc.constant<Op>({ t: 'visible' }) },
  { weight: 1, arbitrary: fc.constant<Op>({ t: 'paste' }) },
  { weight: 1, arbitrary: fc.double({ min: -10, max: 1e7, noNaN: true }).map((ms): Op => ({ t: 'shown', ms })) },
  { weight: 1, arbitrary: fc.constant<Op>({ t: 'unavailable' }) },
  { weight: 2, arbitrary: fc.constant<Op>({ t: 'start' }) },
)

function apply(bot: Bot, op: Op): void {
  const r = bot.run
  switch (op.t) {
    case 'step':
      bot.step()
      break
    case 'tick':
      r.tick()
      break
    case 'wait':
      bot.wait(op.s)
      break
    case 'skip':
      if (op.axis === null) r.skipAxis()
      else r.skipAxis(op.axis)
      break
    case 'finish':
      r.finishEarly()
      break
    case 'junk_item':
      r.itemResponded(op.v)
      break
    case 'junk_block':
      r.blockResponded(op.v)
      break
    case 'conf':
      r.confirmConfidence(op.pct)
      break
    case 'take_break':
      r.takeBreak()
      break
    case 'resume':
      r.resume()
      break
    case 'decline':
      r.declineBreak()
      break
    case 'hidden':
      r.noteVisibility('hidden')
      break
    case 'visible':
      r.noteVisibility('visible')
      break
    case 'paste':
      r.notePaste()
      break
    case 'shown':
      r.itemShown(op.ms)
      break
    case 'unavailable':
      r.itemUnavailable()
      break
    case 'start':
      r.startSegment()
      break
  }
}

describe('SessionRun under arbitrary event sequences (fuzz)', () => {
  it('never throws, keeps time and the record monotone, and always yields a valid, re-scorable save', () => {
    let n = 0
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 70 }), fc.integer({ min: 0, max: 3 }), (ops, config) => {
        const bot = new Bot(
          { sessionId: `s_FUZZ${String(n++).padStart(11, '0')}`, ...(config === 1 ? { breakAtS: 60 } : config === 2 ? { hardStopS: 900 } : config === 3 ? { sessionNumber: 2 } : {}) },
          { theta: undefined },
        )
        let lastElapsed = 0
        let lastResponses = 0
        let finished = false
        for (const op of ops) {
          apply(bot, op)
          const v = bot.view()
          expect(v.elapsedS).toBeGreaterThanOrEqual(lastElapsed - 1e-9)
          lastElapsed = v.elapsedS
          const st = bot.run.sessionState()
          expect(st.responses.length).toBeGreaterThanOrEqual(lastResponses)
          lastResponses = st.responses.length
          // Once finished, nothing changes it.
          if (finished) expect(v.phase).toBe('finished')
          finished = v.phase === 'finished'
          // The UI never sees a key.
          expect(JSON.stringify(v)).not.toMatch(/"(key|params|difficulty|structural_params)"/)
          // Phases and their data agree.
          expect(v.item !== null).toBe(v.phase === 'item' || v.phase === 'confidence')
          expect(v.block !== null).toBe(v.phase === 'block')
          expect(v.confidence !== null).toBe(v.phase === 'confidence')
        }
        const st = bot.run.sessionState()
        const save = saveWithSession(null, st, { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: newAnonId() })
        assertValidSave(save)
        const re = rescoreSessions(save)
        const noCal = bot.run.result().observations.filter((o) => o.axis !== 'CAL')
        expect(re.n_scored).toBe(noCal.length)
        // The record has one tuple per counted unit, each id once.
        const ids = st.responses.map((t) => t[0])
        expect(new Set(ids).size).toBe(ids.length)
      }),
      { numRuns: 120 },
    )
  }, 120_000)
})
