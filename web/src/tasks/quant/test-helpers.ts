/**
 * Test-only helpers for the quant family's tests (never imported by app code): find a generated
 * item of a given template variant, and rebuild an item around a hand-made `given` exactly as the
 * generator would, so a negative test changes one thing at a time.
 */

import type { JsonValue } from '../../engine'
import type { QuantItem } from '.'
import { quant } from '.'
import { Fraction } from './fraction'
import { parseEntry } from './numeric'
import { QUANT_PROVENANCE, QUANT_SD_PRIOR, quantBPrior, quantExpectedTime, quantFeatures } from './prior'
import { HINTS, toleranceFor, variantOf, type Given, type VariantDef } from './templates'
import { quantSolve } from './verify'

export function variantDef(template: string, variant: string): VariantDef {
  const v = variantOf(template, variant)
  if (!v) throw new Error(`no variant ${template}/${variant}`)
  return v
}

/** The first generated item (seeds `<template>/<variant>-<i>`) of this template variant. */
export function sampleOf(template: string, variant: string): QuantItem {
  const v = variantDef(template, variant)
  for (let i = 0; i < 5_000; i++) {
    const item = quant.generate(`${template}/${variant}-${i}`, { stratum: v.stratum })
    const sp = item.structural_params as { template: string; variant: string }
    if (sp.template === template && sp.variant === variant) return item
  }
  throw new Error(`no sample of ${template}/${variant}`)
}

/** The first `n` generated items (seeds `<template>/<variant>-n<i>`) of this template variant. */
export function samplesOf(template: string, variant: string, n: number): QuantItem[] {
  const v = variantDef(template, variant)
  const out: QuantItem[] = []
  for (let i = 0; out.length < n && i < 100_000; i++) {
    const item = quant.generate(`${template}/${variant}-n${i}`, { stratum: v.stratum })
    const sp = item.structural_params as { template: string; variant: string }
    if (sp.template === template && sp.variant === variant) out.push(item)
  }
  if (out.length < n) throw new Error(`only ${out.length} samples of ${template}/${variant}`)
  return out
}

/** A deep copy through JSON (what the dump and the bank see). */
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/**
 * `item` with `given` replaced (merged over the old one; `null` deletes a field) and the stem,
 * key, features, prior and time recomputed as the generator would. The key is the generator's
 * answer, else the verifier's, else "0" when neither route can solve the new `given`.
 */
export function withGiven(item: QuantItem, patch: Readonly<Record<string, JsonValue | null>>): QuantItem {
  const sp = item.structural_params as { template: string; variant: string }
  const v = variantDef(sp.template, sp.variant)
  const given: Record<string, JsonValue> = { ...item.spec.given }
  for (const [k, x] of Object.entries(patch)) {
    if (x === null) delete given[k]
    else given[k] = x
  }
  let stem = item.spec.stem
  try {
    stem = v.render(given)
  } catch {
    // keep the old stem when the new given cannot be rendered
  }
  let value: string
  try {
    value = v.compute(given as Given).toString()
  } catch {
    value = quantSolve(v, given as Given)?.toString() ?? '0'
  }
  const nonInteger = value.includes('/')
  const features = quantFeatures(v.template, v.variant, v.stratum, v.offset, nonInteger)
  const b = quantBPrior(features)
  return clone<QuantItem>({
    ...item,
    spec: { stem, hint: HINTS[v.format], input_format: v.format, given },
    key: { value, tol: toleranceFor(v.format) },
    params: { model: '2pl', a: item.params.model === '2pl' ? item.params.a : 1, b },
    difficulty: { features, b_prior: b, sd_prior: QUANT_SD_PRIOR, provenance: QUANT_PROVENANCE },
    expected_time_s: quantExpectedTime(v.stratum as 1 | 2 | 3 | 4, stem),
  })
}

/**
 * Instances of a variant needed before {@link QuantKeyEcho} judges it, and the key concentration
 * (Σp²) above which it stays silent: the values of `KEY_ECHO_MIN_SEEN` and `KEY_ECHO_MAX_CHANCE`
 * in `../testing` (which this module may not import; quant.test.ts checks they agree).
 */
export const QUANT_ECHO_MIN_SEEN = 20
export const QUANT_ECHO_MAX_CHANCE = 0.75

/** The numbers a stem shows ("−3", "3/8", "12.5", the 2 of "x^2"), as exact rationals. */
export function stemNumbers(stem: string): Fraction[] {
  const out: Fraction[] = []
  for (const m of stem.matchAll(/[−-]?\d+(?:\.\d+)?(?:\/\d+)?/g)) {
    const x = parseEntry(m[0])
    if (x !== null) out.push(x)
  }
  return out
}

function leaves(v: unknown, path: string, out: [string, unknown][]): void {
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${path}[${i}]`, out))
  else if (typeof v === 'object' && v !== null) for (const [k, x] of Object.entries(v)) leaves(x, `${path}.${k}`, out)
  else out.push([path, v])
}

/**
 * Run-level check for copies of the key among the numbers of the spec (review fix). The shared
 * `KeyEchoTracker` compares scalars with `===`, and a quant key value is a string ("42") while the
 * quantities in `given` are numbers, so it can never fire here. Per template variant this flags
 * - a leaf of `given` (a number, or a string that reads as one) whose exact value equals the key
 *   in *every* instance of the variant, and
 * - a stem that shows the key as one of its numbers in every instance of the variant,
 * once the variant has ≥ {@link QUANT_ECHO_MIN_SEEN} instances and its keys are not so
 * concentrated that this could be chance (Σp² ≤ {@link QUANT_ECHO_MAX_CHANCE}). Coincidences (a
 * base that happens to equal the answer) break "every instance", so they are not flagged.
 */
export class QuantKeyEcho {
  /** variant → the paths that have equalled the key in every instance so far. */
  private readonly equal = new Map<string, Set<string>>()
  /** variant → key value → count. */
  private readonly keys = new Map<string, Map<string, number>>()

  observe(item: QuantItem): void {
    const sp = item.structural_params as { template?: unknown; variant?: unknown }
    const id = `${String(sp.template)}/${String(sp.variant)}`
    const key = Fraction.parseCanonical(item.key.value)
    if (key === null) return
    const now = new Set<string>()
    const ls: [string, unknown][] = []
    leaves(item.spec.given, 'given', ls)
    for (const [path, v] of ls) {
      const x = typeof v === 'number' ? parseEntry(String(v)) : typeof v === 'string' ? parseEntry(v) : null
      if (x !== null && x.eq(key)) now.add(path)
    }
    if (typeof item.spec.stem === 'string' && stemNumbers(item.spec.stem).some((x) => x.eq(key))) now.add('stem')
    const before = this.equal.get(id)
    this.equal.set(id, before === undefined ? now : new Set([...before].filter((p) => now.has(p))))
    const counts = this.keys.get(id) ?? new Map<string, number>()
    counts.set(item.key.value, (counts.get(item.key.value) ?? 0) + 1)
    this.keys.set(id, counts)
  }

  /** The variants seen often enough to be judged. */
  judged(): string[] {
    return [...this.keys].filter(([, c]) => [...c.values()].reduce((s, v) => s + v, 0) >= QUANT_ECHO_MIN_SEEN).map(([id]) => id)
  }

  /** One line per (variant, path) that copies the key. */
  problems(): string[] {
    const out: string[] = []
    for (const [id, paths] of this.equal) {
      const counts = [...(this.keys.get(id) ?? new Map<string, number>()).values()]
      const seen = counts.reduce((s, v) => s + v, 0)
      if (seen < QUANT_ECHO_MIN_SEEN) continue
      const chance = counts.reduce((s, c) => s + (c / seen) ** 2, 0)
      if (chance > QUANT_ECHO_MAX_CHANCE) continue
      for (const p of paths) out.push(`${id}: ${p === 'stem' ? 'the stem shows' : `${p} equals`} the key in all ${seen} instances`)
    }
    return out.sort()
  }
}
