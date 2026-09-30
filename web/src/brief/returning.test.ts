/**
 * The load-time notices (AI.6; proposal §3.3 "Returning later"): the withdrawal notice fires exactly
 * when a gate file withdraws a line the person copied, and says the approved sentence word for word.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import drafts from './__fixtures__/proposal/ui-copy.txt?raw'
import { DEFAULT_GATES, type GateFile } from './gates'
import { TEMPLATES, TEMPLATE_BY_ID } from './grammar'
import { lintLine } from './lint'
import { genericMeaning } from './meaning'
import { outdatedMessage, returningNotices, reviewByMessage, switchedOffLines, withdrawnMessage, isOutdated, isWithdrawn, type CopiedRecord, type CopiedSet } from './returning'
import { BENEFIT_RE } from './testing'
import { TEMPLATES_VERSION } from './types'

const draft = drafts.split('\n').find((l) => l.startsWith('A line in notes you made in'))

const copiedLines = (ids: string[]): CopiedRecord['lines'] => ids.map((id) => ({ id, v: (TEMPLATE_BY_ID.get(id) as { v: string }).v }))
const record = (ids: string[], month = '2026-11'): CopiedRecord => ({ templates: TEMPLATES_VERSION, month, lines: copiedLines(ids) })
const gatesWith = (lines: GateFile['lines']): GateFile => ({ ...DEFAULT_GATES, lines: { ...DEFAULT_GATES.lines, ...lines } })

describe('the withdrawal notice', () => {
  it('is the approved sentence, word for word, for one withdrawn line', () => {
    expect(draft).toBeDefined()
    expect(withdrawnMessage('2026-11')).toBe('A line in notes you made in 2026-11 has been withdrawn. Re-copy your notes to replace it.')
    expect(withdrawnMessage('2026-11')).toBe(draft)
    expect(withdrawnMessage('2027-01', 3)).toBe('Some lines in notes you made in 2027-01 have been withdrawn. Re-copy your notes to replace them.')
  })

  it('fires exactly when the gate file withdraws a line that was copied', () => {
    const copied: CopiedSet[] = [{ copied: record(['F1', 'DS', 'U4']) }]
    const none = returningNotices(copied, DEFAULT_GATES, '2026-12-01')
    expect(none).toEqual([])
    // a copied line is withdrawn: notice, with the ids
    const w = returningNotices(copied, gatesWith({ DS: { v: '1', status: 'blocked' } }), '2026-12-01')
    expect(w).toEqual([{ kind: 'withdrawn', month: '2026-11', lines: ['DS'], message: withdrawnMessage('2026-11') }])
    // a line the person did not copy is withdrawn: nothing
    expect(returningNotices(copied, gatesWith({ DB: { v: '1', status: 'blocked' } }), '2026-12-01')).toEqual([])
    // a copied line only slowed down (experimental), or cleared: nothing
    expect(returningNotices(copied, gatesWith({ DS: { v: '1', status: 'experimental' }, U4: { v: '1', status: 'shipped' } }), '2026-12-01')).toEqual([])
    // two copied lines withdrawn: one notice, in the plural
    const two = returningNotices(copied, gatesWith({ DS: { v: '1', status: 'blocked' }, U4: { v: '1', status: 'blocked' } }), '2026-12-01')
    expect(two).toEqual([{ kind: 'withdrawn', month: '2026-11', lines: ['DS', 'U4'], message: withdrawnMessage('2026-11', 2) }])
  })

  it('fires for any subset of copied lines and any gate file, and for nothing else (property)', () => {
    const ids = TEMPLATES.filter((t) => t.header !== true && t.id !== 'X1').map((t) => t.id)
    fc.assert(
      fc.property(fc.subarray(ids, { maxLength: 12 }), fc.subarray(ids, { maxLength: 12 }), fc.subarray(ids, { maxLength: 6 }), (copiedIds, blocked, soft) => {
        const lines: Record<string, GateFile['lines'][string]> = {}
        for (const id of blocked) lines[id] = { v: '1', status: 'blocked' }
        for (const id of soft) if (!blocked.includes(id)) lines[id] = { v: '1', status: 'experimental' }
        const gates: GateFile = { ...DEFAULT_GATES, lines }
        const got = returningNotices([{ copied: record(copiedIds) }], gates, '2026-12-01').filter((n) => n.kind === 'withdrawn')
        // K2 has no entry to clear it: it is blocked by default unless an entry says otherwise
        const withdrawn = copiedIds.filter((id) => (id in lines ? lines[id]?.status === 'blocked' : id === 'K2'))
        if (withdrawn.length === 0) expect(got).toEqual([])
        else expect(got).toHaveLength(1)
        expect(got[0]?.lines ?? []).toEqual([...new Set(withdrawn)])
      }),
      { numRuns: 500 },
    )
  })

  it('judges the wording that was copied: an entry for other wording does not withdraw it', () => {
    const old: CopiedRecord = { templates: '2026.03', month: '2026-04', lines: [{ id: 'DS', v: '0' }] }
    // the gate blocks wording 1; the person copied wording 0: not withdrawn, but out of date
    const n = returningNotices([{ copied: old }], gatesWith({ DS: { v: '1', status: 'blocked' } }), '2026-05-01')
    expect(n.map((x) => x.kind)).toEqual(['outdated'])
    // the gate blocks the wording that was copied: withdrawn (and not also reported as new wording)
    const m = returningNotices([{ copied: old }], gatesWith({ DS: { v: '0', status: 'blocked' } }), '2026-05-01')
    expect(m.map((x) => x.kind)).toEqual(['withdrawn'])
    expect(isWithdrawn({ id: 'DS', v: '0' }, gatesWith({ DS: { v: '0', status: 'blocked' } }))).toBe(true)
    expect(isWithdrawn({ id: 'DS', v: '1' }, DEFAULT_GATES)).toBe(false)
    expect(isOutdated({ id: 'DS', v: '0' })).toBe(true)
    expect(isOutdated({ id: 'gone', v: '1' })).toBe(true)
    expect(isOutdated({ id: 'DS', v: '1' })).toBe(false)
  })

  it('withdraws a copied K2 line when its gate entry is gone (the type needs a passing check)', () => {
    const noK2: GateFile = { ...DEFAULT_GATES, lines: Object.fromEntries(Object.entries(DEFAULT_GATES.lines).filter(([id]) => id !== 'K2')) }
    expect(returningNotices([{ copied: record(['K2']) }], noK2, '2026-12-01').map((n) => n.kind)).toEqual(['withdrawn'])
    expect(returningNotices([{ copied: record(['K2']) }], gatesWith({ K2: { v: '1', status: 'shipped' } }), '2026-12-01')).toEqual([])
  })
})

describe('the other notices', () => {
  it('says when the review-by month has passed, six months after the notes were made', () => {
    const copied: CopiedSet[] = [{ copied: record(['F1']) }]
    expect(returningNotices(copied, DEFAULT_GATES, '2027-05-31')).toEqual([])
    expect(returningNotices(copied, DEFAULT_GATES, '2027-06-01')).toEqual([{ kind: 'review_by', month: '2026-11', lines: [], message: reviewByMessage('2026-11') }])
    expect(returningNotices(copied, DEFAULT_GATES, '2027-06')).toHaveLength(1)
  })

  it('says when a copied line has new wording, or is gone', () => {
    const copied: CopiedSet[] = [{ copied: { templates: '2026.03', month: '2026-10', lines: [{ id: 'F1', v: '0' }, { id: 'DS', v: '1' }, { id: 'gone', v: '1' }] } }]
    const n = returningNotices(copied, DEFAULT_GATES, '2026-11-01')
    expect(n).toEqual([{ kind: 'outdated', month: '2026-10', lines: ['F1', 'gone'], message: outdatedMessage('2026-10', 2) }])
  })

  it('orders withdrawn, then new wording, then review-by, and labels each set', () => {
    const sets: CopiedSet[] = [
      { label: 'Learning, Claude Project', copied: { templates: '2026.03', month: '2026-01', lines: [{ id: 'F1', v: '0' }] } },
      { label: 'Coding and data, Claude Code', copied: record(['DS'], '2026-02') },
    ]
    const n = returningNotices(sets, gatesWith({ DS: { v: '1', status: 'blocked' } }), '2027-09-01')
    expect(n.map((x) => [x.kind, x.label])).toEqual([
      ['withdrawn', 'Coding and data, Claude Code'],
      ['outdated', 'Learning, Claude Project'],
      ['review_by', 'Learning, Claude Project'],
      ['review_by', 'Coding and data, Claude Code'],
    ])
  })

  it('ignores a record with an unreadable month, and says nothing for nothing copied', () => {
    expect(returningNotices([{ copied: { templates: 'x', month: 'soon', lines: [] } }], DEFAULT_GATES, '2030-01-01')).toEqual([])
    expect(returningNotices([], DEFAULT_GATES, '2030-01-01')).toEqual([])
  })

  it('uses words that pass the language lint and never say or imply benefit', () => {
    for (const t of [withdrawnMessage('2026-11'), withdrawnMessage('2026-11', 2), outdatedMessage('2026-11'), outdatedMessage('2026-11', 2), reviewByMessage('2026-11')]) {
      expect(lintLine(t).filter((h) => h.rule === 'a13'), t).toEqual([])
      expect(BENEFIT_RE.test(t), t).toBe(false)
    }
  })
})

describe('the changelog', () => {
  it('lists the line types that are switched off now: K2 in the bundled gates, and a line a gate file blocks', () => {
    expect(switchedOffLines(DEFAULT_GATES).map((x) => x.id)).toEqual(['K2'])
    expect(switchedOffLines(DEFAULT_GATES)[0]?.says).toBe(genericMeaning('K2'))
    const g = gatesWith({ DS: { v: '1', status: 'blocked' } })
    expect(switchedOffLines(g).map((x) => x.id)).toEqual(['DS', 'K2'])
    expect(switchedOffLines(g).find((x) => x.id === 'DS')?.says).toBe('On the topics you choose: skip the basics and go straight to the method, mentioning a step only if it is unusual.')
  })
})
