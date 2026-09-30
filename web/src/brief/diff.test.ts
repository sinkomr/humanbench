/**
 * The out-of-date diff (AI.6): a longest-common-subsequence line diff that never reorders, marks
 * exactly the lines that changed, and pairs a removed and an added line only when they belong together.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildBrief } from './build'
import { CHANGED_MIN_SIMILARITY, MAX_DIFF_LINES, changedCount, diffLines, diffText, similarity, type DiffOp } from './diff'
import { PROFILE_B_LONG } from './profiles'

const lcsLength = (a: readonly string[], b: readonly string[]): number => {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) t[i]![j] = a[i - 1] === b[j - 1] ? t[i - 1]![j - 1]! + 1 : Math.max(t[i - 1]![j]!, t[i]![j - 1]!)
  return t[a.length]![b.length]!
}

/** The old side and the new side a diff describes, with the line numbers each op claims. */
function sides(ops: readonly DiffOp[]): { old: [number, string][]; neu: [number, string][] } {
  const old: [number, string][] = []
  const neu: [number, string][] = []
  for (const o of ops) {
    if (o.kind === 'same') (old.push([o.old, o.text]), neu.push([o.new, o.text]))
    else if (o.kind === 'removed') old.push([o.old, o.text])
    else if (o.kind === 'added') neu.push([o.new, o.text])
    else (old.push([o.old, o.from]), neu.push([o.new, o.to]))
  }
  return { old, neu }
}

const arbLines = fc.array(fc.constantFrom('a', 'b', 'c', 'd', 'e', '- Keep answers short.', '- Keep answers brief.', '- Use plain words.', ''), { maxLength: 30 })

describe('diffLines', () => {
  it('describes the old text and the new text exactly, in order, with correct line numbers, and keeps a longest common subsequence', () => {
    fc.assert(
      fc.property(arbLines, arbLines, (a, b) => {
        const ops = diffLines(a, b)
        const { old, neu } = sides(ops)
        expect(old.map(([, t]) => t)).toEqual(a)
        expect(neu.map(([, t]) => t)).toEqual(b)
        expect(old.map(([n]) => n)).toEqual(a.map((_, i) => i + 1))
        expect(neu.map(([n]) => n)).toEqual(b.map((_, i) => i + 1))
        expect(ops.filter((o) => o.kind === 'same').length).toBe(lcsLength(a, b))
        // a changed op really is a different pair of lines
        for (const o of ops) if (o.kind === 'changed') expect(o.from).not.toBe(o.to)
      }),
      { numRuns: 1500 },
    )
  })

  it('is empty for two empty texts and all "same" for equal texts', () => {
    expect(diffLines([], [])).toEqual([])
    const same = diffLines(['a', 'b'], ['a', 'b'])
    expect(same.every((o) => o.kind === 'same')).toBe(true)
    expect(changedCount(same)).toBe(0)
    expect(diffLines([], ['x'])).toEqual([{ kind: 'added', new: 1, text: 'x' }])
    expect(diffLines(['x'], [])).toEqual([{ kind: 'removed', old: 1, text: 'x' }])
  })

  it('reads two lines of one gap as one changed line when they are alike, else as a removal and an addition', () => {
    const alike = diffLines(['keep', '- Keep answers short and offer more detail.', 'end'], ['keep', '- Keep answers short and give more detail at the end.', 'end'])
    expect(alike.map((o) => o.kind)).toEqual(['same', 'changed', 'same'])
    const unlike = diffLines(['keep', '- Alpha beta gamma.', 'end'], ['keep', '- Delta epsilon zeta.', 'end'])
    expect(unlike.map((o) => o.kind)).toEqual(['same', 'removed', 'added', 'same'])
    expect(similarity('- Keep answers short.', '- Keep answers short.')).toBe(1)
    expect(similarity('', 'x')).toBe(0)
    expect(similarity('alpha beta', 'gamma delta')).toBeLessThan(CHANGED_MIN_SIMILARITY)
  })

  it('never compares more than MAX_DIFF_LINES lines', () => {
    const many = Array.from({ length: MAX_DIFF_LINES + 50 }, (_, i) => `line ${i}`)
    expect(diffLines(many, many).length).toBe(MAX_DIFF_LINES)
  })
})

describe('diffText on real notes marks the changed lines and only those', () => {
  const notes = buildBrief({ prefs: PROFILE_B_LONG.prefs, extras: PROFILE_B_LONG.extras, form: 'long', asOf: '2026-11' }).text
  const lines = notes.split('\n')
  const bullets = lines.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('- '))

  it('marks one edited line, at its own line number', () => {
    fc.assert(
      fc.property(fc.nat(bullets.length - 1), (k) => {
        const [text, i] = bullets[k] as readonly [string, number]
        const edited = [...lines]
        edited[i] = `${text} Then stop.`
        const ops = diffText(notes, edited.join('\n'), 'long')
        const changed = ops.filter((o) => o.kind !== 'same')
        expect(changed).toEqual([{ kind: 'changed', old: i + 1, new: i + 1, from: text, to: `${text} Then stop.` }])
      }),
    )
  })

  it('marks a deleted line and an inserted line', () => {
    fc.assert(
      fc.property(fc.nat(bullets.length - 1), (k) => {
        const [text, i] = bullets[k] as readonly [string, number]
        const without = lines.filter((_, j) => j !== i)
        expect(diffText(notes, without.join('\n'), 'long').filter((o) => o.kind !== 'same')).toEqual([{ kind: 'removed', old: i + 1, text }])
        expect(diffText(without.join('\n'), notes, 'long').filter((o) => o.kind !== 'same')).toEqual([{ kind: 'added', new: i + 1, text }])
      }),
    )
  })

  it('marks several edits at once, each on its own line, and counts them', () => {
    const edited = [...lines]
    const picks = [1, 4, bullets.length - 1].map((k) => bullets[k] as readonly [string, number])
    for (const [text, i] of picks) edited[i] = text.replace('.', ' today.')
    const ops = diffText(notes, edited.join('\n'), 'long')
    expect(ops.filter((o) => o.kind === 'changed').map((o) => (o.kind === 'changed' ? o.old : 0))).toEqual(picks.map(([, i]) => i + 1))
    expect(changedCount(ops)).toBe(3)
    expect(diffText(`${notes}\n`, notes, 'long').every((o) => o.kind === 'same')).toBe(true)
    expect(diffText(notes.replace(/\n/g, '\r\n'), notes, 'long').every((o) => o.kind === 'same')).toBe(true)
  })
})
