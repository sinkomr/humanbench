/**
 * The coding scoring parity dump (`synthetic.ts`, A1/A17): what it covers, and a copy check
 * that the bank's `golden/ts_dumps/coding_scores.json` is exactly what this repo produces now
 * (skipped when the bank checkout is absent, e.g. in CI). Refresh with
 * `npx tsx src/tasks/coding/dump-scores.ts --n 1000 --bank` from `web/`.
 */

import { describe, expect, it } from 'vitest'
import { CODING_SEQUENCE_LENGTH, coding, codingOutcome } from '.'
import { bankDumpsDir, nodeFs } from './node-io'
import { DUMP_STREAMS, SCORE_DUMP_FILE, buildScoreDump, serializeScoreDump, type ScoreDump } from './synthetic'

const fs = await nodeFs()
const path = `${await bankDumpsDir()}${SCORE_DUMP_FILE}`
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
    expect(text === serializeScoreDump(buildScoreDump(count)), 'stale: npx tsx src/tasks/coding/dump-scores.ts --n 1000 --bank').toBe(true)
  })
})
