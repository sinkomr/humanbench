/**
 * Matching one written line back to its template (the parsing half of the closed grammar, R-17.11).
 * Lines without slots match by exact wording; lines with a topic or interest slot match by a
 * pattern built from the wording, and the slot must itself read as a valid list. No template
 * wording is shared in a form (`grammar.test.ts`), so a match is unique.
 */

import { TEMPLATES, slotsOf, wording, type Slot, type Template } from './grammar'
import { parseInterestList } from './interests'
import { parseTopicLabels } from './topics'
import type { BriefLine, Form, LineId } from './types'

interface Compiled {
  readonly t: Template
  readonly form: Form
  readonly text: string
  readonly slot: Slot | null
  readonly re: RegExp | null
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

function compile(form: Form): { exact: Map<string, Compiled>; slotted: Compiled[] } {
  const exact = new Map<string, Compiled>()
  const slotted: Compiled[] = []
  for (const t of TEMPLATES) {
    const text = wording(t, form)
    if (text === null || t.id === 'X1') continue
    const slots = slotsOf(text)
    if (slots.length === 0) {
      exact.set(text, { t, form, text, slot: null, re: null })
      continue
    }
    const [slot] = slots as [Slot]
    const pattern = escapeRe(text).replace(/\\\{(?:Topics|topics|interests)\\\}/u, '(.+?)')
    slotted.push({ t, form, text, slot, re: new RegExp(`^${pattern}$`, 'u') })
  }
  return { exact, slotted }
}

const CACHE: Partial<Record<'short' | 'long', ReturnType<typeof compile>>> = {}
const forForm = (form: 'short' | 'long'): ReturnType<typeof compile> => (CACHE[form] ??= compile(form))

function fill(c: Compiled, captured: string): BriefLine | null {
  if (c.slot === 'Topics' || c.slot === 'topics') {
    const topics = parseTopicLabels(captured, c.slot === 'Topics')
    return topics === null ? null : { id: c.t.id, topics }
  }
  if (c.slot === 'interests') {
    const interests = parseInterestList(captured)
    return interests === null ? null : { id: c.t.id, interests }
  }
  return null
}

export interface LineMatch {
  readonly line: BriefLine
  /** True when the wording belongs to another form (for example a long-form line in short notes). */
  readonly offForm: boolean
}

const canon = (f: Form): 'short' | 'long' => (f === 'skill' ? 'long' : f)

/** The template line a bullet's text reads as in `form`, else in the other form, else null. */
export function matchLine(text: string, form: Form): LineMatch | null {
  const own = canon(form)
  const keys: readonly ('short' | 'long')[] = own === 'short' ? ['short', 'long'] : ['long', 'short']
  for (const k of keys) {
    const { exact, slotted } = forForm(k)
    const hit = exact.get(text)
    if (hit) return { line: { id: hit.t.id }, offForm: k !== own }
    for (const c of slotted) {
      const m = c.re?.exec(text)
      if (!m) continue
      const line = fill(c, m[1] as string)
      if (line) return { line, offForm: k !== own }
    }
  }
  return null
}

/** Whether `text` reads as a standard template line in any form (a custom line may not). */
export const isTemplateLine = (text: string): boolean => matchLine(text, 'long') !== null

/** Ids of every template that has a wording in `form`. */
export function idsInForm(form: Form): LineId[] {
  return TEMPLATES.filter((t) => wording(t, form) !== null).map((t) => t.id)
}
