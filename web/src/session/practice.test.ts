import { describe, expect, it } from 'vitest'
import { resolveItem } from '../tasks/registry'
import { PRACTICE_FAMILIES, PracticeRun, answerText } from './practice'
import { SpyStorage } from './bot'

/** The right response to a practice item: it is in memory, as for any item; the view never has it. */
function rightResponse(itemId: string): unknown {
  const item = resolveItem(itemId)!
  const key = item.key as { index?: number; value?: string; letter?: string }
  return key.index !== undefined ? key.index : (key.value ?? key.letter)
}

describe('practice mode (DESIGN §10: feedback only here, never counted)', () => {
  it('has four easy questions, one per kind, that regenerate from their ids', () => {
    const p = new PracticeRun('s_PRACTICE0000001')
    const v = p.view()
    expect(v.total).toBe(4)
    expect(PRACTICE_FAMILIES).toEqual(['matrices', 'series', 'quant', 'rotation'])
    expect(v.phase).toBe('item')
    expect(v.number).toBe(1)
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const it = p.view().item!
      ids.push(it.item_id)
      expect(resolveItem(it.item_id)).not.toBeNull()
      p.itemResponded(rightResponse(it.item_id))
      p.next()
    }
    expect(ids.map((id) => id.split(':')[1])).toEqual(['matrices', 'series', 'quant', 'rotation'])
    expect(p.view().phase).toBe('done')
  })

  it('shows what was right after the answer, and only then: one press, no step between', () => {
    const p = new PracticeRun('s_PRACTICE0000002')
    const it = p.view().item!
    expect(JSON.stringify(p.view())).not.toMatch(/"key"|"params"|"difficulty"/)
    expect(p.view().feedback).toBeNull()
    p.itemResponded(rightResponse(it.item_id))
    const fb = p.view().feedback!
    expect(fb.correct).toBe(true)
    expect(fb.answer).toMatch(/^[A-F]$/) // matrices: an option letter
    expect(p.view().phase).toBe('feedback')
  })

  it('says when the answer was not right, and what it was', () => {
    const p = new PracticeRun('s_PRACTICE0000003')
    const item = resolveItem(p.view().item!.item_id)!
    const wrong = ((item.key as { index: number }).index + 1) % item.options_count!
    p.itemResponded(wrong)
    expect(p.view().feedback).toMatchObject({ correct: false })
    expect(p.view().feedback!.answer).toBe('ABCDEF'[(item.key as { index: number }).index])
  })

  it('offers the optional confidence scale on each question, with the counted session\'s floor, and not with the feedback', () => {
    const p = new PracticeRun('s_PRACTICE0000004')
    for (let i = 0; i < 4; i++) {
      const v = p.view()
      expect(v.confidence).toEqual({ floorPct: v.item!.options_count === undefined ? 0 : Math.ceil(100 / v.item!.options_count), optionsCount: v.item!.options_count ?? null })
      p.itemResponded(rightResponse(v.item!.item_id))
      expect(p.view().phase).toBe('feedback')
      expect(p.view().confidence).toBeNull()
      p.next()
    }
    const q = new PracticeRun('s_PRACTICE0000011')
    q.itemUnavailable()
    expect(q.view().confidence).toBeNull()
  })

  it('ignores a malformed response, and calls at the wrong time', () => {
    const p = new PracticeRun('s_PRACTICE0000005')
    p.itemResponded({ nope: 1 })
    expect(p.view().phase).toBe('item')
    p.next()
    expect(p.view().phase).toBe('item')
    expect(p.view().number).toBe(1)
  })

  it('an item that cannot be drawn can be passed over', () => {
    const p = new PracticeRun('s_PRACTICE0000006')
    p.itemUnavailable()
    expect(p.view().unavailable).toBe(true)
    p.itemResponded(0)
    expect(p.view().phase).toBe('item')
    p.next()
    expect(p.view()).toMatchObject({ number: 2, unavailable: false, phase: 'item' })
  })

  it('notifies its listeners of a change until they unsubscribe (leaving practice is the screen\'s own ondone, UX-004)', () => {
    const p = new PracticeRun('s_PRACTICE0000007')
    let n = 0
    const off = p.subscribe(() => n++)
    p.itemUnavailable()
    expect(n).toBe(1)
    p.itemUnavailable()
    expect(n).toBe(1)
    p.next()
    expect(n).toBe(2)
    off()
    p.itemUnavailable()
    expect(n).toBe(2)
  })

  it('reports the families it used, so the counted session can leave them out', () => {
    const p = new PracticeRun('s_PRACTICE0000008')
    const ids = p.familyIds()
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    for (const id of ids) expect(id).toMatch(/^f:/)
  })

  it('never touches storage (it does not know about any)', () => {
    const s = new SpyStorage()
    const p = new PracticeRun('s_PRACTICE0000009')
    p.itemResponded(0)
    expect(s.calls).toEqual([])
  })

  it('names the right answer of each key shape', () => {
    expect(answerText({ key: { index: 2 } })).toBe('C')
    expect(answerText({ key: { value: '-7/2', tol: { abs: 0 } } })).toBe('-7/2')
    expect(answerText({ key: { letter: 'K' } })).toBe('K')
    expect(answerText({ key: {} })).toBe('')
  })

  it('leaves out a family that does not exist', () => {
    const p = new PracticeRun('s_PRACTICE0000010', ['matrices', 'nope'])
    expect(p.view().total).toBe(1)
    expect(new PracticeRun('s_PRACTICE0000011', []).view().phase).toBe('done')
  })
})
