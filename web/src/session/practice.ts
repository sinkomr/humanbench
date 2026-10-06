/**
 * Practice mode (ROADMAP M1.15; DESIGN §10 "Procedural items show feedback only in an optional
 * 'practice mode' that doesn't count"): a few easy procedural power items, one per kind, each with
 * the confidence slider and then feedback on the answer. Nothing here is counted or kept: no
 * response reaches a save, an autosave, the integrity logs or the score, and the families it used
 * are only excluded from the counted session that follows (the practice items are already seen).
 * The feedback names the right answer; it is shown after the answer only, never in the item.
 */

import type { AnyItem } from '../engine/selector'
import { optionLetter } from '../render/choice/keys'
import { MalformedResponseError, type AnyFamily } from '../tasks/family'
import { getFamily } from '../tasks/registry'
import { confidenceFloorPct, confidenceStartPct, isConfidencePct } from './calibration'

/** The practice items, in order: a matrix, a series, a number problem and a rotation. */
export const PRACTICE_FAMILIES: readonly string[] = Object.freeze(['matrices', 'series', 'quant', 'rotation'])

export type PracticePhase = 'item' | 'confidence' | 'feedback' | 'done'

export interface PracticeFeedback {
  readonly correct: boolean
  /** The right answer in words: an option letter, a number or a letter. */
  readonly answer: string
}

/** What the UI may see of the practice item on screen (no key, no parameters). */
export interface PracticeItem {
  readonly item_id: string
  readonly family: string
  readonly axis: string
  readonly spec: object
  readonly options_count?: number
}

export interface PracticeView {
  readonly phase: PracticePhase
  /** 1-based number of the item on screen, and how many there are. */
  readonly number: number
  readonly total: number
  readonly item: PracticeItem | null
  readonly confidence: { readonly floorPct: number; readonly startPct: number; readonly optionsCount: number | null } | null
  readonly feedback: PracticeFeedback | null
  readonly unavailable: boolean
}

/** The right answer of `item` in words (MC: the option letter; entry: the value or the letter). */
export function answerText(item: Pick<AnyItem, 'key'>): string {
  const key = item.key as { index?: unknown; value?: unknown; letter?: unknown }
  if (typeof key.index === 'number' && Number.isInteger(key.index)) return optionLetter(key.index)
  if (typeof key.value === 'string') return key.value
  if (typeof key.letter === 'string') return key.letter
  return ''
}

export class PracticeRun {
  readonly #items: AnyItem[]
  #index = 0
  #phase: PracticePhase = 'item'
  #pending: { correct: boolean } | null = null
  #feedback: PracticeFeedback | null = null
  #unavailable = false
  readonly #listeners = new Set<() => void>()

  /**
   * The practice items are drawn from `seed` (stratum = each family's easiest one). A family that is
   * not registered is left out.
   */
  constructor(seed: string, families: readonly string[] = PRACTICE_FAMILIES) {
    this.#items = families.flatMap((name) => {
      const f = getFamily(name)
      return f === undefined || f.kind !== 'item' ? [] : [f.generate(`${seed}.practice.${name}`, { stratum: f.strata[0]! })]
    })
    if (this.#items.length === 0) this.#phase = 'done'
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #emit(): void {
    for (const fn of [...this.#listeners]) fn()
  }

  /** family_ids of the practice items: the counted session leaves them out. */
  familyIds(): string[] {
    return this.#items.map((i) => i.family_id)
  }

  view(): PracticeView {
    const item = this.#phase === 'done' ? null : (this.#items[this.#index] ?? null)
    let confidence: PracticeView['confidence'] = null
    if (this.#phase === 'confidence' && item !== null) {
      const floorPct = confidenceFloorPct(item.options_count)
      confidence = { floorPct, startPct: confidenceStartPct(floorPct), optionsCount: item.options_count ?? null }
    }
    return {
      phase: this.#phase,
      number: Math.min(this.#index + 1, this.#items.length),
      total: this.#items.length,
      item:
        item === null
          ? null
          : { item_id: item.item_id, family: item.family, axis: item.axis, spec: item.spec, ...(item.options_count === undefined ? {} : { options_count: item.options_count }) },
      confidence,
      feedback: this.#feedback,
      unavailable: this.#unavailable,
    }
  }

  /** The renderer cannot draw the item: the person can move on. */
  itemUnavailable(): void {
    if (this.#phase !== 'item' || this.#unavailable) return
    this.#unavailable = true
    this.#emit()
  }

  itemResponded(response: unknown): void {
    if (this.#phase !== 'item' || this.#unavailable) return
    const item = this.#items[this.#index]
    if (item === undefined) return
    const family: AnyFamily = getFamily(item.family)!
    let correct: 0 | 1 | null
    try {
      correct = (family.score(item as never, response as never) as { correct: 0 | 1 | null }).correct
    } catch (e) {
      if (e instanceof MalformedResponseError) return
      throw e
    }
    this.#pending = { correct: correct === 1 }
    this.#phase = 'confidence'
    this.#emit()
  }

  /** The person rated their confidence; the feedback follows. */
  confirmConfidence(pct: number): void {
    const item = this.#items[this.#index]
    if (this.#phase !== 'confidence' || item === undefined || this.#pending === null) return
    if (!isConfidencePct(pct, confidenceFloorPct(item.options_count))) return
    this.#feedback = { correct: this.#pending.correct, answer: answerText(item) }
    this.#pending = null
    this.#phase = 'feedback'
    this.#emit()
  }

  /** Next practice item (from the feedback, or past an item that cannot be drawn). */
  next(): void {
    if (this.#phase !== 'feedback' && !(this.#phase === 'item' && this.#unavailable)) return
    this.#feedback = null
    this.#unavailable = false
    this.#index++
    this.#phase = this.#index >= this.#items.length ? 'done' : 'item'
    this.#emit()
  }
}
