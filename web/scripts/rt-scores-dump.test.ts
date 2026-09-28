/**
 * The rt scoring parity dump CLI (`dump-rt-scores.ts`) and the A17 copy check: the bank's
 * `golden/ts_dumps/rt_scores.json` must be byte for byte what this repo produces now (skipped when
 * the bank checkout is absent, e.g. in CI). Refresh from `web/` with
 * `npx tsx scripts/dump-rt-scores.ts --n 1000 --bank`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rt } from '../src/tasks/rt'
import { RT_SCORE_DUMP_FILE, RT_SCORE_DUMP_SEED_PREFIX, buildRtScoreDump, serializeRtScoreDump } from '../src/tasks/rt/synthetic'
import { DUMP_SEED_PREFIX, UsageError, bankDumpsDir } from './dump-lib'
import { parseRtScoresArgs, rtScoresTarget } from './dump-rt-scores'

const WEB = fileURLToPath(new URL('../', import.meta.url))
const BANK_FILE = join(bankDumpsDir(), RT_SCORE_DUMP_FILE)
const ITEMS_FILE = join(bankDumpsDir(), 'rt.json')
const present = existsSync(BANK_FILE)

describe('dump-rt-scores CLI', () => {
  it('parses --n with exactly one of --out and --bank', () => {
    expect(parseRtScoresArgs(['--', '--n', '12', '--out', 'x.json'])).toEqual({ n: 12, out: 'x.json', bank: false })
    expect(parseRtScoresArgs(['--bank'])).toEqual({ n: 1000, bank: true })
    for (const bad of [[], ['--bank', '--out', 'x'], ['--n', '0', '--bank'], ['--n', '1.5', '--bank'], ['--out'], ['--bank', '--all']]) {
      expect(() => parseRtScoresArgs(bad), JSON.stringify(bad)).toThrow(UsageError)
    }
  })

  it('writes to --out resolved against the cwd, or next to rt.json in the bank', () => {
    expect(rtScoresTarget({ n: 1, out: 'a/b.json', bank: false }, '/tmp/w')).toBe('/tmp/w/a/b.json')
    expect(rtScoresTarget({ n: 1, out: '/abs.json', bank: false }, '/tmp/w')).toBe('/abs.json')
    const dir = mkdtempSync(join(tmpdir(), 'hb-rt-bank-'))
    expect(() => rtScoresTarget({ n: 1, bank: true }, '/tmp/w', { HB_BANK_DIR: dir })).toThrow(/bank dumps directory not found/)
  })

  it('uses the dump:families seeds, so case i is item i of rt.json', () => {
    expect(RT_SCORE_DUMP_SEED_PREFIX).toBe(DUMP_SEED_PREFIX)
  })

  it('writes the dump when run as the entry script (this file imports it without writing)', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'hb-rt-scores-')), 'rt_scores.json')
    execFileSync(join(WEB, 'node_modules', '.bin', 'tsx'), ['scripts/dump-rt-scores.ts', '--n', '3', '--out', out], { cwd: WEB, stdio: 'pipe' })
    expect(readFileSync(out, 'utf8')).toBe(serializeRtScoreDump(buildRtScoreDump(3)))
  }, 60_000)
})

describe('A17: the bank copy of rt_scores.json', () => {
  it.skipIf(!present)(`${BANK_FILE} regenerates exactly and matches rt.json`, () => {
    const text = readFileSync(BANK_FILE, 'utf8')
    const { count, generator_version } = JSON.parse(text) as { count: number; generator_version: string }
    expect(count).toBeGreaterThanOrEqual(1_000)
    expect(generator_version).toBe(rt.generatorVersion)
    expect(text === serializeRtScoreDump(buildRtScoreDump(count)), 'stale: npx tsx scripts/dump-rt-scores.ts --n 1000 --bank').toBe(true)
    const items = JSON.parse(readFileSync(ITEMS_FILE, 'utf8')) as { generator_version: string; count: number }
    expect(items.generator_version).toBe(generator_version)
    expect(items.count).toBeGreaterThanOrEqual(count)
  }, 60_000)
})
