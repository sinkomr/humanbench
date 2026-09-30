/**
 * Matching one written line back to its template (the parsing half of the closed grammar, R-17.11).
 * Lines without slots match by exact wording; lines with a topic or interest slot match by a
 * pattern built from the wording, and the slot must itself read as a valid list. No template
 * wording is shared in a form (`grammar.test.ts`), so a match is unique.
 *
 * Wording that has been released and then changed (`retired.ts`) matches too, after the current
 * wording, and the match says which wording version it was (`retiredV`), so notes copied from an
 * earlier release still read as their lines and can be shown as out of date (AI.6).
 */

import { TEMPLATES, slotsOf, wording, type Slot, type Template } from './grammar'
import { parseInterestList } from './interests'
import { RETIRED_WORDINGS, type RetiredWording } from './retired'
import { parseTopicLabels } from './topics'
import type { BriefLine, Form, LineId } from './types'

interface Compiled {
  readonly id: LineId
  readonly text: string
  readonly slot: Slot | null
  readonly re: RegExp | null
  /** The wording version of a retired wording; undefined for the current one. */
  readonly retiredV: string | undefined
}

interface Table {
  readonly exact: Map<string, Compiled>
  readonly slotted: Compiled[]
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

function add(table: Table, id: LineId, text: string, retiredV: string | undefined): void {
  const slots = slotsOf(text)
  if (slots.length === 0) {
    if (!table.exact.has(text)) table.exact.set(text, { id, text, slot: null, re: null, retiredV })
    return
  }
  const [slot] = slots as [Slot]
  const pattern = escapeRe(text).replace(/\\\{(?:Topics|topics|interests)\\\}/u, '(.+?)')
  table.slotted.push({ id, text, slot, re: new RegExp(`^${pattern}$`, 'u'), retiredV })
}

/** Current wording first, then retired wording, so a current match always wins. */
function compile(form: 'short' | 'long', retired: readonly RetiredWording[]): Table {
  const table: Table = { exact: new Map(), slotted: [] }
  for (const t of TEMPLATES as readonly Template[]) {
    const text = wording(t, form)
    if (text !== null && t.id !== 'X1') add(table, t.id, text, undefined)
  }
  for (const r of retired) {
    const text = form === 'short' && r.short !== undefined ? r.short : r.long
    if (text !== null) add(table, r.id, text, r.v)
  }
  return table
}

const CACHE = new WeakMap<readonly RetiredWording[], Partial<Record<'short' | 'long', Table>>>()
function forForm(form: 'short' | 'long', retired: readonly RetiredWording[]): Table {
  let byForm = CACHE.get(retired)
  if (byForm === undefined) {
    byForm = {}
    CACHE.set(retired, byForm)
  }
  return (byForm[form] ??= compile(form, retired))
}

function fill(c: Compiled, captured: string): BriefLine | null {
  if (c.slot === 'Topics' || c.slot === 'topics') {
    const topics = parseTopicLabels(captured, c.slot === 'Topics')
    return topics === null ? null : { id: c.id, topics }
  }
  if (c.slot === 'interests') {
    const interests = parseInterestList(captured)
    return interests === null ? null : { id: c.id, interests }
  }
  return null
}

export interface LineMatch {
  readonly line: BriefLine
  /** True when the wording belongs to another form (for example a long-form line in short notes). */
  readonly offForm: boolean
  /** Set when the text is an older wording of the line (`retired.ts`): the wording version it had. */
  readonly retiredV?: string
}

const canon = (f: Form): 'short' | 'long' => (f === 'skill' ? 'long' : f)

const withV = (m: LineMatch, c: Compiled): LineMatch => (c.retiredV === undefined ? m : { ...m, retiredV: c.retiredV })

/**
 * The template line a bullet's text reads as in `form`, else in the other form, else null.
 * `retired` is the list of released wording that has since changed (default: `RETIRED_WORDINGS`).
 */
export function matchLine(text: string, form: Form, retired: readonly RetiredWording[] = RETIRED_WORDINGS): LineMatch | null {
  const own = canon(form)
  const keys: readonly ('short' | 'long')[] = own === 'short' ? ['short', 'long'] : ['long', 'short']
  // Current wording in either form beats retired wording in either form.
  for (const wantRetired of [false, true]) {
    if (wantRetired && retired.length === 0) break
    for (const k of keys) {
      const { exact, slotted } = forForm(k, retired)
      const hit = exact.get(text)
      if (hit && (hit.retiredV !== undefined) === wantRetired) return withV({ line: { id: hit.id }, offForm: k !== own }, hit)
      for (const c of slotted) {
        if ((c.retiredV !== undefined) !== wantRetired) continue
        const m = c.re?.exec(text)
        if (!m) continue
        const line = fill(c, m[1] as string)
        if (line) return withV({ line, offForm: k !== own }, c)
      }
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
