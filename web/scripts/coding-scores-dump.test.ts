/**
 * The coding scoring parity dump (`synthetic.ts`, A1/A17): what it covers, and a copy check
 * that the bank's `golden/ts_dumps/coding_scores.json` is exactly what this repo produces now
 * (skipped when the bank checkout is absent, e.g. in CI). Refresh with
 * `npm run dump:coding-scores -- --n 1000 --bank` from `web/`.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODING_SEQUENCE_LENGTH, coding, codingOutcome } from '../src/tasks/coding'
import { DUMP_STREAMS, SCORE_DUMP_FILE, buildScoreDump, serializeScoreDump, type ScoreDump } from '../src/tasks/coding/synthetic'
import { CODING_SCORES_USAGE, main, parseCodingScoresArgs } from './dump-coding-scores'
import { UsageError, bankDumpsDir } from './dump-lib'

const path = join(bankDumpsDir(), SCORE_DUMP_FILE)
const present = fs.existsSync(path)

describe('coding scoring parity dump (M1.11, A1, A17)', () => {
  const dump = buildScoreDump(DUMP_STREAMS.length * 3)
  const outcomes = dump.cases.map((c) => c.outcome)

  it('cycles through every stream kind over the dumped blocks dump-<i>', () => {
    expect(dump.cases.map((c) => c.stream)).toEqual([...DUMP_STREAMS, ...DUMP_STREAMS, ...DUMP_STREAMS].map((s) => s.name))
    expect(dump.cases.map((c) => c.item_id)).toEqual(dump.cases.map((_, i) => `i:coding:1.0.0:dump-${i}`))
    expect(dump).toMatchObject({ family: 'coding', generator_version: coding.generatorVersion, items_file: 'coding.json' })
  })

  it('covers every outcome shape the bank scorer must reproduce', () => {
    expect(outcomes.some((o) => o.observation === null && o.attempted === 0)).toBe(true) // empty
    expect(outcomes.some((o) => o.observation === null && o.errors > 0)).toBe(true) // all wrong
    expect(outcomes.some((o) => o.correct === 1)).toBe(true)
    expect(outcomes.some((o) => o.high_error_rate)).toBe(true)
    expect(outcomes.some((o) => !o.high_error_rate && o.error_rate === 0.2)).toBe(true)
    expect(outcomes.some((o) => o.exhausted)).toBe(true)
    expect(outcomes.some((o) => o.late > 0)).toBe(true)
    // Every stimulus answered but some late: not exhausted (exhausted counts in-window responses).
    const tails = dump.cases.filter((c) => c.responses.length === CODING_SEQUENCE_LENGTH && c.outcome.late > 0)
    expect(tails.length).toBeGreaterThan(0)
    expect(tails.every((c) => !c.outcome.exhausted)).toBe(true)
    expect(outcomes.filter((o) => o.observation !== null).length).toBeGreaterThan(outcomes.length / 2)
  })

  it('each case is the outcome of its own stream on its own block', () => {
    for (const [i, c] of dump.cases.entries()) {
      expect(codingOutcome(coding.generate(`dump-${i}`), c.responses)).toEqual(c.outcome)
    }
  })

  it('serialises one canonical case per line and survives JSON', () => {
    const text = serializeScoreDump(dump)
    expect(text.split('\n')).toHaveLength(dump.cases.length + 3)
    expect(JSON.parse(text) as ScoreDump).toEqual(JSON.parse(JSON.stringify(dump)))
  })

  it.skipIf(!present)(`the bank copy ${path} regenerates exactly`, () => {
    const text = fs.readFileSync(path, 'utf8')
    const { count } = JSON.parse(text) as { count: number }
    expect(count).toBeGreaterThanOrEqual(1_000)
    expect(text === serializeScoreDump(buildScoreDump(count)), 'stale: npm run dump:coding-scores -- --n 1000 --bank').toBe(true)
  })
})

describe('npm run dump:coding-scores (the CLI in scripts/, A17)', () => {
  const env = { HB_BANK_DIR: '/tmp/some-bank' }

  it('parses --n and exactly one of --out / --bank', () => {
    expect(parseCodingScoresArgs(['--', '--n', '5', '--out', 'x.json'], '/work', env)).toEqual({ n: 5, out: '/work/x.json' })
    expect(parseCodingScoresArgs(['--bank'], '/work', env)).toEqual({ n: 1000, out: join('/tmp/some-bank', 'golden', 'ts_dumps', SCORE_DUMP_FILE) })
    for (const bad of [[], ['--bank', '--out', 'x'], ['--n', '0', '--bank'], ['--n', '1.5', '--bank'], ['--what']]) {
      expect(() => parseCodingScoresArgs(bad, '/work', env), bad.join(' ')).toThrow(UsageError)
    }
  })

  it('writes exactly the serialised dump', () => {
    const dir = fs.mkdtempSync(join(fs.realpathSync(os.tmpdir()), 'hb-coding-scores-'))
    try {
      expect(main(['--n', '4', '--out', 'out.json'], dir, env)).toBe(0)
      expect(fs.readFileSync(join(dir, 'out.json'), 'utf8')).toBe(serializeScoreDump(buildScoreDump(4)))
      expect(main(['--bogus'], dir, env)).toBe(2)
      expect(CODING_SCORES_USAGE).toContain('--bank')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
