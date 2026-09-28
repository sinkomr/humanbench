/**
 * A17 copy check: when the bank checkout is present (sibling `humanbench-bank`, or
 * `$HB_BANK_DIR`), every file in its `golden/ts_dumps/` must be exactly what this repo produces
 * now. A stale file fails here with the command that refreshes it; without the bank (CI) the
 * checks skip with the path they looked at.
 *
 * - `<family>.json` dumps are checked by {@link dumpDrift}: header, count = number of items
 *   (≥ 1,000, A1), seeds `dump-0 …` in order, every item, and the bytes. Families are resolved
 *   from the registry and, for families not registered yet, from every family module
 *   `src/tasks/<dir>/index.ts`, so an implementer's `--module` dump is drift-checked before
 *   integration. Every registered family (and the toy family) must have a dump.
 * - Parity files that are not family dumps are listed in {@link PARITY_FILES} with the test that
 *   keeps each current, and must be present. Any other file there fails: every cross-repo copy
 *   needs a check.
 *
 * (The bank → pub direction, `golden/*.json` → `src/engine/__fixtures__/`, is checked by
 * `sync-golden.test.ts` here and by the bank's `tests/test_crossrepo.py`.)
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { example } from '../src/tasks/_example'
import type { AnyFamily } from '../src/tasks/family'
import { FAMILIES } from '../src/tasks/registry'
import { serializeAnalysisFixture } from '../src/tasks/series/analysis-fixture'
import { PUB_ROOT, UsageError, bankDumpsDir, buildDump, dumpDrift, familiesFromModule, serializeDump } from './dump-lib'

const DIR = bankDumpsDir()
const BANK = dirname(dirname(DIR))
const present = existsSync(DIR)
const NO_BANK = `no bank checkout at ${BANK} (the sibling humanbench-bank, or $HB_BANK_DIR), e.g. in CI`
const files = present ? readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : []
const WEB = join(PUB_ROOT, 'web')
const TASKS_DIR = join(WEB, 'src', 'tasks')

const SERIES_ANALYSIS_REFRESH = `npx tsx -e "import('./src/tasks/series/analysis-fixture.ts').then((m) => process.stdout.write(m.serializeAnalysisFixture()))" > ${join(DIR, 'series.analysis.json')}`

/**
 * The files in the bank's `golden/ts_dumps/` that are not family dumps, each with the test
 * (relative to `web/`) that fails when the bank copy is stale.
 */
const PARITY_FILES: Readonly<Record<string, string>> = {
  'coding_scores.json': 'scripts/coding-scores-dump.test.ts',
  'rt_simple_scores.json': 'scripts/rt-scores-dump.test.ts',
  'rt_choice4_scores.json': 'scripts/rt-scores-dump.test.ts',
  'series.analysis.json': 'scripts/ts-dumps-sync.test.ts',
}

interface Known {
  readonly family: AnyFamily
  /** The dump:families source flag that regenerates the dump. */
  readonly source: string
}

/** Registered families first, then the family modules in `src/tasks/<dir>/index.ts`. */
async function knownFamilies(): Promise<Map<string, Known>> {
  const known = new Map<string, Known>()
  for (const [name, family] of Object.entries(FAMILIES)) known.set(name, { family, source: `--family ${name}` })
  for (const entry of readdirSync(TASKS_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const index = join(TASKS_DIR, entry.name, 'index.ts')
    if (!entry.isDirectory() || !existsSync(index)) continue
    let found: AnyFamily[]
    try {
      found = await familiesFromModule(index)
    } catch (e) {
      if (e instanceof UsageError) continue // a directory without a family (e.g. shared helpers)
      throw e
    }
    for (const family of found) {
      if (!known.has(family.name)) known.set(family.name, { family, source: `--module src/tasks/${entry.name}/index.ts` })
    }
  }
  return known
}

describe('A17: bank golden/ts_dumps match what this repo produces', () => {
  it('resolves registered families and unregistered family modules (incl. the toy family)', async () => {
    const known = await knownFamilies()
    expect(known.get('example')?.source).toBe('--module src/tasks/_example/index.ts')
    for (const name of Object.keys(FAMILIES)) expect(known.get(name)?.source).toBe(`--family ${name}`)
  })

  it('lists parity-file checks that exist and are not family names', async () => {
    const known = await knownFamilies()
    for (const [file, test] of Object.entries(PARITY_FILES)) {
      expect(existsSync(join(WEB, test)), `${file}: its check ${test} is missing`).toBe(true)
      expect(known.has(file.slice(0, -'.json'.length)), `${file} is a family dump`).toBe(false)
    }
  })

  it('every registered family and the toy family have a dump', ({ skip }) => {
    skip(!present, NO_BANK)
    const missing = [...Object.keys(FAMILIES), example.name].filter((name) => !files.includes(`${name}.json`))
    const how = missing.map((name) => `npm run dump:families -- ${name === example.name ? '--module src/tasks/_example/index.ts' : `--family ${name}`} --bank`)
    expect(missing, `missing in ${DIR}: ${how.join('; ')}`).toEqual([])
  })

  it('every parity file is there (so its own check cannot skip)', ({ skip }) => {
    skip(!present, NO_BANK)
    const missing = Object.keys(PARITY_FILES).filter((f) => !files.includes(f))
    expect(missing, `missing in ${DIR}; see the README for the commands that write them`).toEqual([])
  })

  it('every file there is a known family dump or a checked parity file', async ({ skip }) => {
    skip(!present, NO_BANK)
    const known = await knownFamilies()
    const unchecked = files.filter((f) => !known.has(f.slice(0, -'.json'.length)) && !Object.hasOwn(PARITY_FILES, f))
    expect(
      unchecked,
      `no staleness check for these files in ${DIR}: add the family (or its module) here, list a parity file in PARITY_FILES with its test, or check out matching branches of both repos`,
    ).toEqual([])
  })

  it(`every family dump regenerates exactly (header, count, seeds, items, bytes)`, async ({ skip }) => {
    skip(!present, NO_BANK)
    const known = await knownFamilies()
    const problems: string[] = []
    let checked = 0
    for (const file of files) {
      const k = known.get(file.slice(0, -'.json'.length))
      if (!k) continue // a parity file (checked below or by its own test; unknown files fail above)
      const text = readFileSync(join(DIR, file), 'utf8')
      const count = (JSON.parse(text) as { count?: unknown }).count
      const refresh = `npm run dump:families -- ${k.source} --n ${typeof count === 'number' ? count : 1000} --bank`
      for (const p of dumpDrift(text, k.family)) problems.push(`${file}: ${p}; refresh with ${refresh}`)
      checked++
    }
    expect(problems).toEqual([])
    expect(checked).toBeGreaterThanOrEqual(Object.keys(FAMILIES).length + 1) // never vacuous: see above
  }, 120_000)

  it('the series analysis fixture regenerates exactly', ({ skip }) => {
    skip(!present, NO_BANK)
    const path = join(DIR, 'series.analysis.json')
    expect(existsSync(path), `${path} is missing: run (from web/) ${SERIES_ANALYSIS_REFRESH}`).toBe(true)
    const stale = `stale ${path}: run (from web/) ${SERIES_ANALYSIS_REFRESH}, then update ANALYSIS_FIXTURE_DIGEST in series.test.ts`
    expect(readFileSync(path, 'utf8') === serializeAnalysisFixture(), stale).toBe(true)
  }, 60_000)
})

describe('dumpDrift (the A17 staleness check itself)', () => {
  const N = 5
  const good = serializeDump(buildDump(example, N))
  const drift = (text: string): string[] => dumpDrift(text, example, N)
  const lines = good.split('\n') // header, N item lines, "]}", ""
  const withLines = (items: string[]): string => [lines[0], ...items, ...lines.slice(N + 1)].join('\n')
  const itemLines = lines.slice(1, N + 1).map((l) => l.replace(/,$/, ''))
  const joinItems = (items: string[]): string[] => items.map((l, i) => (i < items.length - 1 ? `${l},` : l))

  it('accepts the current dump', () => {
    expect(drift(good)).toEqual([])
  })

  it('rejects a truncated dump that keeps its header count', () => {
    expect(dumpDrift(withLines(joinItems(itemLines.slice(0, 3))), example, 3)).toEqual([`count ${N} ≠ 3 items`])
  })

  it('rejects a header count that disagrees with the items', () => {
    expect(drift(good.replace(`"count":${N}`, `"count":${N + 1}`))).toEqual([`count ${N + 1} ≠ ${N} items`])
  })

  it('rejects fewer than the minimum number of items (A1)', () => {
    expect(dumpDrift(good, example)).toEqual([`${N} items < 1000 (A1)`])
  })

  it('rejects seeds out of order and a missing seed', () => {
    const swapped = [itemLines[1], itemLines[0], ...itemLines.slice(2)] as string[]
    expect(drift(withLines(joinItems(swapped)))[0]).toMatch(/^item 0: seed "dump-1" ≠ "dump-0"/)
    const shifted = buildDump(example, N + 1).items.slice(1)
    const text = serializeDump({ family: example.name, generator_version: example.generatorVersion, count: N, items: shifted })
    expect(drift(text)[0]).toMatch(/^item 0: seed "dump-1" ≠ "dump-0"/)
  })

  it('rejects an item the generator no longer produces', () => {
    const item = JSON.parse(itemLines[2] as string) as { spec: { options: number[] } }
    item.spec.options = [...item.spec.options].reverse()
    const edited = [...itemLines]
    edited[2] = JSON.stringify(item)
    expect(drift(withLines(joinItems(edited)))).toEqual(['item 2 (dump-2) differs from the generator'])
  })

  it('rejects a wrong family, generator_version or header shape', () => {
    expect(drift(good.replace('"generator_version":"', '"generator_version":"0.'))[0]).toMatch(/^generator_version "0\./)
    expect(drift(good.replace('"family":"example"', '"family":"other"'))).toEqual(['family "other" ≠ "example"'])
    expect(drift(good.replace('{"family":"example",', '{"family":"example","extra":1,'))[0]).toMatch(/^header keys/)
    expect(drift('{"family":')[0]).toMatch(/^not JSON/)
    expect(drift('[]')).toEqual(['not a dump object'])
  })

  it('rejects the same items in another layout', () => {
    expect(drift(JSON.stringify(JSON.parse(good)))).toEqual([
      'the items match, but the text is not in the dump format (a header line, then one canonical-JSON item per line)',
    ])
    expect(drift(`${good}\n`)).toHaveLength(1)
  })
})
