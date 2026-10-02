/**
 * M2.1 (ROADMAP M2.1; DESIGN §3 row 6, §4.2; ROADMAP A18): the server scores numeric entry with the
 * same grammar and the same exact arithmetic as the app (tasks/quant/numeric.ts) and the bank
 * (hb.gen.quant.entry). The expected values here come from the app's own parseEntry and
 * withinTolerance.
 */

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Fraction } from '../../src/tasks/quant/fraction'
import { parseEntry, withinTolerance } from '../../src/tasks/quant/numeric'
import type { TestDb } from './harness'
import { openTestDb } from './vitest'

let db: TestDb
beforeAll(async () => {
  db = await openTestDb()
})
afterAll(async () => {
  await db.close()
})

const WS = fc.constantFrom('', '', ' ', '\t', '\n', '\u00a0', '  ')
const SIGN = fc.constantFrom('', '', '-', '+', '\u2212')
const digits = (min: number, max: number): fc.Arbitrary<string> => fc.stringMatching(new RegExp(`^[0-9]{${min},${max}}$`))

/** Strings in and around the grammar: mostly valid forms with noise, and some arbitrary text. */
const entryText: fc.Arbitrary<string> = fc.oneof(
  { weight: 1, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.string({ unit: fc.constantFrom('0', '1', '2', '5', '9', '.', ',', '/', ' ', '-', '$', '%', 'x', '\u2212'), maxLength: 12 }) },
  {
    weight: 6,
    arbitrary: fc
      .tuple(
        WS,
        SIGN,
        fc.constantFrom('', '', '$'),
        fc.oneof(
          digits(1, 6),
          fc.tuple(digits(0, 5), digits(0, 4)).map(([i, d]) => `${i}.${d}`),
          digits(1, 3).chain((h) => fc.array(digits(3, 3), { minLength: 1, maxLength: 3 }).map((rest) => [h, ...rest].join(','))),
          fc.tuple(digits(1, 4), digits(1, 4)).map(([n, d]) => `${n}/${d}`),
          fc.tuple(digits(1, 3), WS, digits(1, 3), WS, digits(1, 3)).map(([w, a, n, b, d]) => `${w}${a || ' '}${n}${b}/${d}`),
        ),
        fc.constantFrom('', '', '%'),
        WS,
      )
      .map(([lead, sign, cur, body, pct, trail]) => `${lead}${sign}${cur}${body}${pct}${trail}`),
  },
)

const sameFraction = (ts: Fraction | null, sql: { o_num: string | null; o_den: string | null }): boolean => {
  if (ts === null || sql.o_num === null || sql.o_den === null) return ts === null && sql.o_num === null
  return ts.n * BigInt(sql.o_den) === BigInt(sql.o_num) * ts.d
}

describe('hb.parse_entry', () => {
  it('reads every entry the way the app does (2,000 random entries and the documented examples)', async () => {
    const documented = ['42', '-7', '+3', '12.5', '.5', '3.', '1,533', '12,345.5', '0,5', '-3/8', '6/4', '2 1/3', '-2 1/3', '$5', '5%', '$ 5', '- 5', '1/0', '', ' ', '.', '1,23', '1e3', '１２', '0x10']
    const sample = [...documented, ...fc.sample(entryText, 2000)]
    const { rows } = await db.owner.query<{ i: number; o_num: string | null; o_den: string | null }>(
      `select t.i::int as i, p.o_num::text, p.o_den::text from unnest($1::text[]) with ordinality as t (s, i) cross join lateral hb.parse_entry(t.s) p order by t.i`,
      [sample],
    )
    expect(rows.length).toBe(sample.length)
    const bad: string[] = []
    for (const r of rows) {
      const s = sample[r.i - 1]!
      if (!sameFraction(parseEntry(s), r)) bad.push(JSON.stringify(s))
    }
    expect(bad).toEqual([])
    // and some of them are numbers: the generator is not vacuous
    expect(rows.filter((r) => r.o_num !== null).length).toBeGreaterThan(900)
  })

  it('refuses entries over 32 characters and non-string input', async () => {
    const { rows } = await db.owner.query(`select o_num from hb.parse_entry($1)`, ['1'.repeat(33)])
    expect(rows[0].o_num).toBeNull()
    expect((await db.owner.query(`select o_num from hb.parse_entry(null)`)).rows[0].o_num).toBeNull()
    expect(parseEntry('1'.repeat(33))).toBeNull()
  })
})

describe('hb.numeric_correct', () => {
  const tolText = fc.constantFrom('0', '0.005', '0.01', '0.5', '1', '0.1', '2')
  const keyValue: fc.Arbitrary<{ text: string; frac: Fraction }> = fc
    .tuple(fc.integer({ min: -2000, max: 2000 }), fc.integer({ min: 1, max: 60 }))
    .map(([n, d]) => {
      const f = Fraction.of(n, d)
      return { text: f.toString(), frac: f }
    })

  it('agrees with the app on whether an entry is within the key tolerance (abs and rel, 2,000 cases)', async () => {
    const cases = fc.sample(
      fc.tuple(keyValue, fc.constantFrom('abs', 'rel'), tolText, fc.integer({ min: -3000, max: 3000 }), fc.integer({ min: 1, max: 100 })),
      2000,
    )
    const entries = cases.map(([key, , , n, d]) => {
      // entries close to the key as well as far from it
      const f = key.frac.add(Fraction.of(n, d * 40))
      return f.d === 1n ? f.n.toString() : `${f.n}/${f.d}`
    })
    const keys = cases.map(([key, kind, tol]) => JSON.stringify({ value: key.text, tol: { [kind]: Number(tol) } }))
    const { rows } = await db.owner.query<{ i: number; ok: boolean }>(
      `select t.i::int as i, hb.numeric_correct(t.entry, t.key::jsonb, null) as ok from unnest($1::text[], $2::text[]) with ordinality as t (entry, key, i) order by t.i`,
      [entries, keys],
    )
    let inside = 0
    for (const r of rows) {
      const [key, kind, tol] = cases[r.i - 1]!
      const want = withinTolerance(parseEntry(entries[r.i - 1]!)!, key.frac, { [kind]: Number(tol) } as { abs: number } | { rel: number })
      expect(r.ok, `${entries[r.i - 1]} vs ${key.text} ${kind} ${tol}`).toBe(want)
      if (want) inside++
    }
    // both outcomes are common: the cases are not vacuous
    expect(inside).toBeGreaterThan(200)
    expect(inside).toBeLessThan(1800)
  })

  it('reads the tolerance from the key, else from the item tolerance column, else demands equality', async () => {
    const q = async (entry: string, key: unknown, tol: unknown): Promise<boolean> =>
      (await db.owner.query<{ ok: boolean }>(`select hb.numeric_correct($1, $2::jsonb, $3::jsonb) as ok`, [entry, JSON.stringify(key), tol === null ? null : JSON.stringify(tol)])).rows[0]!.ok
    expect(await q('10.4', { value: '10' }, { abs: 0.5 })).toBe(true)
    expect(await q('10.4', { value: '10', tol: { abs: 0.1 } }, { abs: 0.5 })).toBe(false)
    expect(await q('10', { value: '10' }, null)).toBe(true)
    expect(await q('10.01', { value: '10' }, null)).toBe(false)
    expect(await q('7/2', { value: 3.5 }, null)).toBe(true) // the older numeric key shape
    expect(await q('1', { value: 'not a number' }, null)).toBe(false)
    expect(await q('1', { tol: { abs: 1 } }, null)).toBe(false)
  })
})
