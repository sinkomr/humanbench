/**
 * The RT scoring parity dump CLI (`dump-rt-scores.ts`) and the A17 copy check: the bank's
 * `golden/ts_dumps/<family>_scores.json` for each RT family (`rt_simple`, `rt_choice4`, M1.F2)
 * must be byte for byte what this repo produces now (skipped when the bank checkout is absent,
 * e.g. in CI). Refresh from `web/` with `npx tsx scripts/dump-rt-scores.ts --n 1000 --bank`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { RT_FAMILY_LIST } from '../src/tasks/rt'
import { RT_SCORE_DUMP_SEED_PREFIX, buildRtScoreDump, rtScoreDumpFile, serializeRtScoreDump } from '../src/tasks/rt/synthetic'
import { DUMP_SEED_PREFIX, UsageError, bankDumpsDir } from './dump-lib'
import { parseRtScoresArgs, rtScoresDir } from './dump-rt-scores'

const WEB = fileURLToPath(new URL('../', import.meta.url))

describe('dump-rt-scores CLI', () => {
  it('parses --n with exactly one of --out-dir and --bank', () => {
    expect(parseRtScoresArgs(['--', '--n', '12', '--out-dir', 'x'])).toEqual({ n: 12, outDir: 'x', bank: false })
    expect(parseRtScoresArgs(['--bank'])).toEqual({ n: 1000, bank: true })
    for (const bad of [[], ['--bank', '--out-dir', 'x'], ['--n', '0', '--bank'], ['--n', '1.5', '--bank'], ['--out-dir'], ['--bank', '--all'], ['--out', 'x.json']]) {
      expect(() => parseRtScoresArgs(bad), JSON.stringify(bad)).toThrow(UsageError)
    }
  })

  it('writes to --out-dir resolved against the cwd, or to the bank dumps directory', () => {
    expect(rtScoresDir({ n: 1, outDir: 'a/b', bank: false }, '/tmp/w')).toBe('/tmp/w/a/b')
    expect(rtScoresDir({ n: 1, outDir: '/abs', bank: false }, '/tmp/w')).toBe('/abs')
    const dir = mkdtempSync(join(tmpdir(), 'hb-rt-bank-'))
    expect(() => rtScoresDir({ n: 1, bank: true }, '/tmp/w', { HB_BANK_DIR: dir })).toThrow(/bank dumps directory not found/)
  })

  it('uses the dump:families seeds, so case i is item i of <family>.json', () => {
    expect(RT_SCORE_DUMP_SEED_PREFIX).toBe(DUMP_SEED_PREFIX)
  })

  it('writes one dump per RT family when run as the entry script (this file imports it without writing)', () => {
    const out = mkdtempSync(join(tmpdir(), 'hb-rt-scores-'))
    execFileSync(join(WEB, 'node_modules', '.bin', 'tsx'), ['scripts/dump-rt-scores.ts', '--n', '3', '--out-dir', out], { cwd: WEB, stdio: 'pipe' })
    for (const family of RT_FAMILY_LIST) {
      expect(readFileSync(join(out, rtScoreDumpFile(family.name)), 'utf8')).toBe(serializeRtScoreDump(buildRtScoreDump(family, 3)))
    }
  }, 60_000)
})

describe.each(RT_FAMILY_LIST.map((f) => [f.name, f] as const))('A17: the bank copy of %s_scores.json', (name, family) => {
  const file = join(bankDumpsDir(), rtScoreDumpFile(name))
  const itemsFile = join(bankDumpsDir(), `${name}.json`)
  it.skipIf(!existsSync(file))(`${file} regenerates exactly and matches ${name}.json`, () => {
    const text = readFileSync(file, 'utf8')
    const { count, generator_version } = JSON.parse(text) as { count: number; generator_version: string }
    expect(count).toBeGreaterThanOrEqual(1_000)
    expect(generator_version).toBe(family.generatorVersion)
    expect(text === serializeRtScoreDump(buildRtScoreDump(family, count)), 'stale: npx tsx scripts/dump-rt-scores.ts --n 1000 --bank').toBe(true)
    const items = JSON.parse(readFileSync(itemsFile, 'utf8')) as { generator_version: string; count: number }
    expect(items.generator_version).toBe(generator_version)
    expect(items.count).toBeGreaterThanOrEqual(count)
  }, 60_000)
})
