/**
 * The harness dump (ROADMAP AI.4; proposal §7.3): deterministic, every note lint-clean and within
 * its limit, floor-rule settings recorded, and the CLI writes exactly what the library builds.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DUMP_CONTEXTS, DUMP_FORMAT, buildDump, serializeDump } from '../src/brief/dump'
import { lintNotes } from '../src/brief/lint'
import { PREAMBLE } from '../src/brief/results-talk'
import { FORM_LIMITS, PRESETS } from '../src/brief/types'
import { UsageError, parseDumpBriefsArgs } from './dump-briefs'

const WEB = fileURLToPath(new URL('../', import.meta.url))

describe('buildDump', () => {
  const dump = buildDump('2026-11')

  it('has the named profiles first, then one entry per context x pattern x mode x length', () => {
    expect(dump.format).toBe(DUMP_FORMAT)
    expect(dump.count).toBe(4 + PRESETS.length * 4 * 2 * 2)
    expect(dump.briefs).toHaveLength(dump.count)
    expect(dump.briefs.slice(0, 4).map((b) => b.name)).toEqual(['A-coding-skill', 'B-learning-short', 'B-learning-long', 'C-reading-own-settings'])
    expect(new Set(dump.briefs.map((b) => b.name)).size).toBe(dump.count)
    expect([...new Set(dump.briefs.map((b) => b.context))].sort()).toEqual([...DUMP_CONTEXTS].sort())
  })

  it('is byte-identical on a second build (reproducible)', () => {
    expect(serializeDump(buildDump('2026-11'))).toBe(serializeDump(dump))
    expect(serializeDump(buildDump('2027-01'))).not.toBe(serializeDump(dump))
  })

  it('includes only notes with 0 lint violations, within their limit, dated as asked', () => {
    for (const b of dump.briefs) {
      expect(lintNotes(b.text), b.name).toEqual([])
      expect(b.lint_violations).toBe(0)
      expect(b.chars).toBe(b.text.length)
      expect(b.chars, b.name).toBeLessThanOrEqual(FORM_LIMITS[b.form])
      expect(b.text, b.name).toContain('Written 2026-11.')
    }
  })

  it('records what each topic line states after the floor rule, and whether it is written in that form', () => {
    const b = dump.briefs.find((x) => x.name === 'B-learning-short')!
    expect(b.topics['quant/arith_fractions_percent']).toEqual({ set: 'build', effective: 'ask_first', written: false })
    expect(b.topics['quant/probability_counting']).toEqual({ set: 'build', effective: 'build', written: true })
    const c = dump.briefs.find((x) => x.name === 'C-reading-own-settings')!
    expect(c.topics['kst/biology']).toEqual({ set: 'skip', effective: 'skip', written: true })
    expect(c.topics['lr/notation']?.effective).toBe('build')
  })

  it('carries the results-talk preamble for the E22 arm: its id, wording version and exact text', () => {
    expect(dump.results_talk).toEqual({ id: 'RT', v: '1', text: PREAMBLE, chars: 340 })
    expect(serializeDump(dump)).toContain('"results_talk"')
  })

  it('carries the JSON that mirrors each text, and no result-derived field', () => {
    for (const b of dump.briefs) {
      expect((b.json.lines as { id: string }[]).map((l) => l.id), b.name).toEqual(b.line_ids)
      expect(JSON.stringify(b.json), b.name).not.toMatch(/theta|percentile|score|estimate/)
    }
  })
})

describe('dump:briefs CLI', () => {
  it('requires --as-of as a month and takes an optional --out', () => {
    expect(parseDumpBriefsArgs(['--', '--as-of', '2026-11'])).toEqual({ asOf: '2026-11' })
    expect(parseDumpBriefsArgs(['--as-of', '2026-11', '--out', 'x.json'])).toEqual({ asOf: '2026-11', out: 'x.json' })
    for (const bad of [[], ['--as-of'], ['--as-of', 'soon'], ['--as-of', '2026-13'], ['--out', 'x'], ['--as-of', '2026-11', '--bank'], ['--as-of', '2026-11', '--out']]) {
      expect(() => parseDumpBriefsArgs(bad), JSON.stringify(bad)).toThrow(UsageError)
    }
  })

  it('writes exactly what the library builds when run as the entry script', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'hb-briefs-')), 'briefs.json')
    execFileSync(join(WEB, 'node_modules', '.bin', 'tsx'), ['scripts/dump-briefs.ts', '--as-of', '2026-11', '--out', out], { cwd: WEB, stdio: 'pipe' })
    expect(readFileSync(out, 'utf8')).toBe(serializeDump(buildDump('2026-11')))
  }, 60_000)
})
