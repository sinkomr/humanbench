/**
 * Gate statuses (ADR A22; proposal §7.3): the bundled file matches the grammar, carries statuses
 * and names only (no metric numbers, so this repo hosts no benchmark of named models), and a
 * changed wording resets a line type's status.
 */

import { describe, expect, it } from 'vitest'
import raw from './brief-gates.json'
import { DEFAULT_GATES, FLOOR_GATE, checkedWith, defaultStatus, floorGatePassed, lineStatus, parseGateFile, worstStatus, type GateFile } from './gates'
import { TEMPLATES, template } from './grammar'
import { RESULTS_TALK_ID, RESULTS_TALK_V } from './results-talk'
import { TEMPLATES_VERSION } from './types'

const walk = (v: unknown, visit: (x: unknown, path: string) => void, path = ''): void => {
  visit(v, path)
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, visit, `${path}[${i}]`))
  else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) walk(x, visit, `${path}.${k}`)
}

describe('brief-gates.json (pub carries statuses only)', () => {
  it('has no numeric field anywhere: no metric, count, rate or score', () => {
    walk(raw, (x, path) => expect(typeof x, path).not.toBe('number'))
  })

  it('has an entry for every template (except the custom line) at its current wording version, plus the bottom-rung gate and the results-talk preamble', () => {
    const want = TEMPLATES.filter((t) => t.id !== 'X1').map((t) => t.id)
    expect(Object.keys(DEFAULT_GATES.lines).filter((k) => k !== FLOOR_GATE && k !== RESULTS_TALK_ID).sort()).toEqual(want.sort())
    expect(DEFAULT_GATES.lines[RESULTS_TALK_ID]).toEqual({ v: RESULTS_TALK_V, status: 'shipped' })
    for (const id of want) expect(DEFAULT_GATES.lines[id]?.v, id).toBe(template(id).v)
    expect(DEFAULT_GATES.templates).toBe(TEMPLATES_VERSION)
  })

  it('ships the generic lines, marks the person\'s own choices experimental, and blocks K2 and the bottom-rung build gate', () => {
    for (const t of TEMPLATES) {
      if (t.id === 'X1') continue
      const want = t.id === 'K2' ? 'blocked' : t.tier === 'T0' ? 'shipped' : 'experimental'
      expect(lineStatus(DEFAULT_GATES, t.id), t.id).toBe(want)
    }
    expect(DEFAULT_GATES.lines[FLOOR_GATE]?.status).toBe('blocked')
    expect(floorGatePassed(DEFAULT_GATES)).toBe(false)
  })

  it('lists no model family and no smoke result yet', () => {
    expect(Object.values(DEFAULT_GATES.lines).every((e) => e.families === undefined)).toBe(true)
    expect(DEFAULT_GATES.surfaces).toEqual({})
  })
})

describe('lineStatus', () => {
  const base: GateFile = { ...DEFAULT_GATES, lines: { ...DEFAULT_GATES.lines } }

  it('resets to the default when the wording version differs ("the wording is the treatment")', () => {
    const shipped: GateFile = { ...base, lines: { ...base.lines, DS: { v: '1', status: 'shipped' }, K2: { v: '1', status: 'shipped' } } }
    expect(lineStatus(shipped, 'DS')).toBe('shipped')
    expect(lineStatus(shipped, 'K2')).toBe('shipped')
    const stale: GateFile = { ...base, lines: { ...base.lines, DS: { v: '0', status: 'shipped' }, K2: { v: '0', status: 'blocked' } } }
    expect(lineStatus(stale, 'DS')).toBe('experimental')
    // K2 ships only if E7d passed on this wording: a stale or missing entry leaves it blocked, never experimental.
    const staleShipped: GateFile = { ...base, lines: { ...base.lines, K2: { v: '0', status: 'shipped' } } }
    expect(lineStatus(stale, 'K2')).toBe('blocked')
    expect(lineStatus(staleShipped, 'K2')).toBe('blocked')
    expect(lineStatus({ ...base, lines: {} }, 'K2')).toBe('blocked')
    expect(lineStatus({ ...base, lines: {} }, 'F1')).toBe('shipped')
    expect(lineStatus({ ...base, lines: {} }, 'DS')).toBe('experimental')
  })

  it('treats unknown ids as blocked and the custom line as shipped', () => {
    expect(lineStatus(base, 'ZZ')).toBe('blocked')
    expect(lineStatus(base, 'X1')).toBe('shipped')
    expect(defaultStatus('AC1')).toBe('experimental')
  })

  it('opens the floor rule only for a passing gate at the current wording', () => {
    expect(floorGatePassed({ ...base, lines: { ...base.lines, [FLOOR_GATE]: { v: '1', status: 'shipped' } } })).toBe(true)
    expect(floorGatePassed({ ...base, lines: { ...base.lines, [FLOOR_GATE]: { v: '9', status: 'shipped' } } })).toBe(false)
    expect(floorGatePassed({ ...base, lines: { ...base.lines, [FLOOR_GATE]: { v: '1', status: 'experimental' } } })).toBe(false)
  })

  it('reports the families a line type was checked with, only for its current wording', () => {
    const g: GateFile = { ...base, lines: { ...base.lines, DS: { v: '1', status: 'experimental', families: ['Claude', 'Qwen'], checked: '2026-12' }, DB: { v: '0', status: 'shipped', families: ['Claude'] } } }
    expect(checkedWith(g, 'DS')).toEqual({ families: ['Claude', 'Qwen'], month: '2026-12' })
    expect(checkedWith(g, 'DB')).toEqual({ families: [], month: null })
    expect(checkedWith(g, 'F1')).toEqual({ families: [], month: null })
  })

  it('takes the most restrictive of several statuses', () => {
    expect(worstStatus(['shipped', 'experimental'])).toBe('experimental')
    expect(worstStatus(['experimental', 'blocked', 'shipped'])).toBe('blocked')
    expect(worstStatus([])).toBe('shipped')
  })
})

describe('parseGateFile', () => {
  it('accepts the bundled file and rejects malformed ones', () => {
    expect(() => parseGateFile(raw)).not.toThrow()
    for (const bad of [null, [], {}, { ...raw, format: 'x' }, { ...raw, lines: [] }, { ...raw, lines: { F1: { v: 1, status: 'shipped' } } }, { ...raw, lines: { F1: { v: '1', status: 'great' } } }, { ...raw, lines: { F1: { v: '1', status: 'shipped', families: [1] } } }, { ...raw, lines: { F1: { v: '1', status: 'shipped', checked: '2026' } } }, { ...raw, surfaces: { x: { date: '2026-12', result: 'maybe' } } }]) {
      expect(() => parseGateFile(bad)).toThrow(RangeError)
    }
  })
})
