/**
 * A synthetic demo Fermi item for the dev-only page `#/dev/fermi` and its e2e (ROADMAP M5.1; A6).
 * No finite Fermi item is in this repo: the bank keeps every real truth value (DESIGN §4.2, CLAUDE.md),
 * so the entry is exercised on questions made up here whose answer is plain arithmetic ("about how many
 * seconds are there in 3 weeks?"). They are procedural, seeded (A11) and exact (uncertainty 0), carry an
 * id that cannot be a bank id (`demo:fermi:<seed>`), and are never part of a session's pool. The truth
 * is returned beside the spec, never inside it, so a page shows the renderer the spec only, as the
 * server does.
 */

import { createRng, type RngSeed } from '../../engine/prng'
import type { FermiTruth } from './scoring'
import type { FermiSpec } from './spec'
import { unitOf } from './units'

/** A demo question: the spec the renderer gets and the truth only the scorer sees. */
export interface DemoFermiItem {
  /** `demo:fermi:<seed>`: never an A11 bank id. */
  readonly item_id: string
  readonly spec: FermiSpec
  readonly truth: FermiTruth
  /** One line of working, shown after the answer. */
  readonly explanation: string
}

interface Template {
  readonly dimension: string
  /** The unit the question counts in (`n` of it), with its stem word. */
  readonly sources: readonly { readonly symbol: string; readonly word: string }[]
  /** The unit the question asks for. */
  readonly target: { readonly symbol: string; readonly word: string }
  /** Units offered beside the target (the source unit is never offered: it would restate the question). */
  readonly offered: readonly string[]
  readonly n: readonly [number, number]
}

const TEMPLATES: readonly Template[] = [
  {
    dimension: 'time',
    sources: [
      { symbol: 'week', word: 'weeks' },
      { symbol: 'day', word: 'days' },
      { symbol: 'h', word: 'hours' },
    ],
    target: { symbol: 's', word: 'seconds' },
    offered: ['s', 'min', 'h', 'day'],
    n: [2, 12],
  },
  {
    dimension: 'length',
    sources: [
      { symbol: 'mi', word: 'miles' },
      { symbol: 'ft', word: 'feet' },
      { symbol: 'yd', word: 'yards' },
    ],
    target: { symbol: 'm', word: 'metres' },
    offered: ['m', 'km', 'cm'],
    n: [3, 40],
  },
  {
    dimension: 'mass',
    sources: [
      { symbol: 'lb', word: 'pounds' },
      { symbol: 'oz', word: 'ounces' },
    ],
    target: { symbol: 'g', word: 'grams' },
    offered: ['g', 'kg', 'mg'],
    n: [5, 60],
  },
]

/** The seeded demo item: same seed, same question (A11). */
export function demoFermiItem(seed: RngSeed): DemoFermiItem {
  const rng = createRng(`demo:fermi:${String(seed)}`)
  const tpl = rng.pick(TEMPLATES)
  const source = rng.pick(tpl.sources)
  const n = rng.int(tpl.n[0], tpl.n[1])
  const truthValue = Number((n * (unitOf(source.symbol).factor / unitOf(tpl.target.symbol).factor)).toPrecision(12))
  const units = tpl.offered.filter((s) => s !== source.symbol)
  return {
    item_id: `demo:fermi:${String(seed)}`,
    spec: {
      stem: `About how many ${tpl.target.word} are there in ${n} ${source.word}? (A practice question made up for this page.)`,
      dimension: tpl.dimension,
      units,
      interval_pct: 80,
    },
    truth: { true_value: String(truthValue), unit: tpl.target.symbol, true_value_uncertainty_log10: 0 },
    explanation: `${n} ${source.word} is ${truthValue.toLocaleString('en-US')} ${tpl.target.word}.`,
  }
}
