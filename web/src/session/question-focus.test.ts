import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { QuestionFocus, itemRegionName, type ScreenFacts } from './question-focus'
import type { RunPhase } from './run'

const facts = (phase: RunPhase, segmentIndex: number, problem = false): ScreenFacts => ({ phase, segmentIndex, problem })

describe('QuestionFocus: where focus goes on a new screen (UX-REVIEW D21, provisional default, option B)', () => {
  it('the first question of a part takes the heading, every later one of the same part its own region, numbered from 1', () => {
    const f = new QuestionFocus()
    f.enter('i:1', facts('interstitial', 1))
    expect(f.enter('q:a', facts('item', 1))).toEqual({ target: 'heading', number: 1 })
    expect(f.enter('q:b', facts('item', 1))).toEqual({ target: 'item', number: 2 })
    expect(f.enter('q:c', facts('item', 1))).toEqual({ target: 'item', number: 3 })
  })

  it('a screen that is not a question takes the heading, and the next part starts again at its first question', () => {
    const f = new QuestionFocus()
    for (const phase of ['interstitial', 'block', 'break_offer', 'on_break', 'finished'] as const) {
      expect(f.enter(`x:${phase}`, facts(phase, 0))).toEqual({ target: 'heading', number: 0 })
    }
    f.enter('q:a', facts('item', 2))
    f.enter('q:b', facts('item', 2))
    // A skip, a break and the next part's "Up next" screen come between: the next part's first question is a first question.
    f.enter('b:1', facts('break_offer', 2))
    f.enter('i:3', facts('interstitial', 3))
    expect(f.enter('q:c', facts('item', 3))).toEqual({ target: 'heading', number: 1 })
    expect(f.enter('q:d', facts('item', 3))).toEqual({ target: 'item', number: 2 })
  })

  it('a question after any screen that is not a question is a first question, even in the same part (the part was left and came back, or a block came between)', () => {
    const f = new QuestionFocus()
    f.enter('q:a', facts('item', 1))
    f.enter('q:b', facts('item', 1))
    f.enter('blk', facts('block', 1))
    expect(f.enter('q:c', facts('item', 1))).toEqual({ target: 'heading', number: 1 })
  })

  it('the confidence slider is the screen of its question: the same key gives the same plan, whatever the phase', () => {
    const f = new QuestionFocus()
    f.enter('q:a', facts('item', 1))
    const second = f.enter('q:b', facts('item', 1))
    expect(second.number).toBe(2)
    expect(f.enter('q:b', facts('confidence', 1))).toBe(second)
    expect(f.enter('q:b', facts('item', 1))).toBe(second)
    // ... and it did not count the question twice.
    expect(f.enter('q:c', facts('item', 1)).number).toBe(3)
  })

  describe('a served part waits between its questions (the loading screen)', () => {
    it('the wait for the next question of the part under way takes no focus: the question that follows does, with the next number', () => {
      const f = new QuestionFocus()
      f.enter('i:4', facts('interstitial', 4))
      expect(f.enter('loading', facts('loading', 4))).toEqual({ target: 'heading', number: 0 }) // nothing of the part is up yet
      expect(f.enter('q:a', facts('item', 4))).toEqual({ target: 'heading', number: 1 })
      expect(f.enter('loading', facts('loading', 4))).toEqual({ target: 'none', number: 0 })
      expect(f.enter('q:b', facts('item', 4))).toEqual({ target: 'item', number: 2 })
      expect(f.enter('loading', facts('loading', 4))).toEqual({ target: 'none', number: 0 })
      expect(f.enter('q:c', facts('item', 4))).toEqual({ target: 'item', number: 3 })
    })

    it('a wait that failed is a screen to be told about: it takes the heading, and the question after "Try again" still goes to its region', () => {
      const f = new QuestionFocus()
      f.enter('q:a', facts('item', 4))
      expect(f.enter('loading', facts('loading', 4))).toEqual({ target: 'none', number: 0 })
      expect(f.enter('loading:problem', facts('loading', 4, true))).toEqual({ target: 'heading', number: 0 })
      expect(f.enter('loading', facts('loading', 4))).toEqual({ target: 'none', number: 0 })
      expect(f.enter('q:b', facts('item', 4))).toEqual({ target: 'item', number: 2 })
    })

    it('the wait that opens a new part is not the middle of one', () => {
      const f = new QuestionFocus()
      f.enter('q:a', facts('item', 4))
      f.enter('i:5', facts('interstitial', 5))
      expect(f.enter('loading', facts('loading', 5))).toEqual({ target: 'heading', number: 0 })
      expect(f.enter('q:b', facts('item', 5))).toEqual({ target: 'heading', number: 1 })
    })
  })

  it('names a question by its number, with no total (progress is time, §10)', () => {
    expect(itemRegionName(1)).toBe('Question 1')
    expect(itemRegionName(12)).toBe('Question 12')
    expect(itemRegionName(7)).not.toMatch(/\bof\b|\//)
  })
})

describe('QuestionFocus: properties over random sessions', () => {
  const parts = fc.array(
    fc.record({
      break: fc.boolean(),
      block: fc.boolean(),
      questions: fc.integer({ min: 0, max: 7 }),
      wait: fc.constantFrom('none', 'wait', 'failed'),
    }),
    { minLength: 1, maxLength: 6 },
  )

  it('each part has exactly one question that takes the heading (its first), the others take their regions, numbered 1, 2, 3 ...', () => {
    fc.assert(
      fc.property(parts, (plan) => {
        const f = new QuestionFocus()
        let n = 0
        for (const [part, p] of plan.entries()) {
          if (p.break) expect(f.enter(`k${n++}`, facts('break_offer', part)).target).toBe('heading')
          expect(f.enter(`k${n++}`, facts('interstitial', part)).target).toBe('heading')
          if (p.block) expect(f.enter(`k${n++}`, facts('block', part)).target).toBe('heading')
          const seen: { target: string; number: number }[] = []
          for (let q = 0; q < p.questions; q++) {
            if (q > 0 && p.wait !== 'none') {
              if (p.wait === 'failed') expect(f.enter(`k${n++}`, facts('loading', part, true)).target).toBe('heading')
              expect(f.enter(`k${n++}`, facts('loading', part)).target).toBe('none')
            }
            seen.push(f.enter(`k${n++}`, facts('item', part)))
          }
          // A block comes before the questions here, never between them, so it does not split the part.
          expect(seen.map((s) => s.number)).toEqual(seen.map((_, i) => i + 1))
          expect(seen.map((s) => s.target)).toEqual(seen.map((_, i) => (i === 0 ? 'heading' : 'item')))
        }
      }),
    )
  })

  it('only a question ever takes its region or nothing; a screen that is not a question always takes the heading (a first wait of a part included)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ phase: fc.constantFrom<RunPhase>('item', 'confidence', 'loading'), part: fc.integer({ min: 0, max: 5 }), problem: fc.boolean() }),
            fc.record({ phase: fc.constantFrom<RunPhase>('interstitial', 'block', 'break_offer', 'on_break', 'finished'), part: fc.integer({ min: 0, max: 5 }), problem: fc.constant(false) }),
          ),
          { maxLength: 60 },
        ),
        (screens) => {
          const f = new QuestionFocus()
          screens.forEach((s, i) => {
            const plan = f.enter(`k${i}`, facts(s.phase, s.part, s.problem))
            if (s.phase === 'item' || s.phase === 'confidence') {
              expect(plan.number).toBeGreaterThanOrEqual(1)
              expect(plan.target).toBe(plan.number === 1 ? 'heading' : 'item')
            } else {
              expect(plan.number).toBe(0)
              expect(plan.target === 'heading' || (plan.target === 'none' && s.phase === 'loading' && !s.problem)).toBe(true)
            }
          })
        },
      ),
    )
  })

  it('asking again for a screen that is already up never changes its plan, whatever else is asked in between', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 40 }), (parts) => {
        const f = new QuestionFocus()
        parts.forEach((part, i) => {
          const key = `q:${i}`
          const first = f.enter(key, facts('item', part))
          expect(f.enter(key, facts('confidence', part))).toBe(first)
          expect(f.enter(key, facts('item', part + 1))).toBe(first)
        })
      }),
    )
  })
})
