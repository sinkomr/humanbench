/**
 * Reading notes back (R-17.11: "`parse(render(p)) = p`; all released versions parse"). The parser
 * recognises every line of the closed grammar, keeps a typed line that passes the lint as a custom
 * line (X1), and reports everything else as foreign with the reasons. It never throws on odd input,
 * so the checker (AI.6) can run it on notes pasted from anywhere.
 *
 * Released grammar versions register in {@link PARSERS}; `parseAnyText` tries each and keeps the
 * reading with the fewest foreign lines, and `parseJson` dispatches on the `format` field, so
 * notes written by an older release keep parsing after the grammar moves on.
 */

import { KNOWN_HEADINGS, NOTES_TITLE, SKILL_DESCRIPTIONS, SKILL_NAME, parseHeaderBody } from './grammar'
import { lintLine, type LintRule } from './lint'
import { matchLine } from './match'
import { validateBrief } from './validate'
import { BRIEF_FORMAT, type Brief, type BriefFormat, type BriefLine, type Form, type LineId } from './types'

export interface ForeignLine {
  /** 1-based line number in the text. */
  readonly line: number
  readonly text: string
  /** Why it is foreign: lint rules that fired, or `off-grammar` for a line that is not a bullet or heading we know. */
  readonly reasons: readonly (LintRule | 'off-grammar' | 'unknown-heading')[]
}

export interface ParsedNotes {
  /** The grammar version the notes read as, or null when the header did not read as any release. */
  readonly format: BriefFormat | null
  readonly form: Form
  readonly as_of: string | null
  readonly revisit: string | null
  /** Lines in order of appearance, without gate statuses (the text carries none). */
  readonly lines: readonly BriefLine[]
  readonly foreign: readonly ForeignLine[]
  readonly headings: readonly string[]
  /** Lines whose wording belongs to the other form (a long-form line in short notes). */
  readonly offForm: readonly LineId[]
  /** Set for a Skill file whose front matter is not ours. */
  readonly problems: readonly string[]
}

const BULLET = /^- (.+)$/u
const HEADING = /^## (.+)$/u

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/gu, '\n').split('\n')
}

/** Parse notes of the `hb-brief/1` grammar. */
export function parseText(text: string): ParsedNotes {
  const raw = splitLines(text)
  const problems: string[] = []
  const foreign: ForeignLine[] = []
  const lines: BriefLine[] = []
  const headings: string[] = []
  const offForm: LineId[] = []
  let i = 0
  let form: Form = 'short'

  if (raw[0] === '---') {
    form = 'skill'
    const end = raw.indexOf('---', 1)
    const fm = end < 0 ? [] : raw.slice(1, end)
    if (end < 0) problems.push('front matter is not closed')
    const name = fm.find((l) => l.startsWith('name: '))?.slice(6)
    const description = fm.find((l) => l.startsWith('description: '))?.slice(13)
    if (name !== SKILL_NAME) problems.push('skill name is not ours')
    if (description === undefined || !Object.values(SKILL_DESCRIPTIONS).includes(description)) problems.push('skill description is not one of ours')
    if (fm.some((l) => !/^(?:name|description): /u.test(l))) problems.push('front matter has other keys')
    i = end < 0 ? raw.length : end + 1
    while (i < raw.length && raw[i] === '') i++
  }
  // Header: one line for short notes, a title and a body for long ones.
  let asOf: string | null = null
  let revisit: string | null = null
  let headerOk = false
  const first = raw[i] ?? ''
  if (first === `# ${NOTES_TITLE}`) {
    if (form !== 'skill') form = 'long'
    const h = parseHeaderBody(raw[i + 1] ?? '')
    if (h?.capital === true) {
      ;({ asOf, revisit } = h)
      headerOk = true
      i += 2
    } else {
      i += 1
    }
  } else if (first.startsWith(`${NOTES_TITLE}: `)) {
    const h = parseHeaderBody(first.slice(NOTES_TITLE.length + 2))
    if (h !== null && !h.capital) {
      ;({ asOf, revisit } = h)
      headerOk = true
      i += 1
    }
  }
  if (!headerOk) problems.push('header is missing or not ours')
  else lines.push({ id: 'H' })

  for (; i < raw.length; i++) {
    const t = raw[i] as string
    if (t.trim() === '') continue
    const lineNo = i + 1
    const h = HEADING.exec(t)
    if (h && form !== 'short') {
      const name = h[1] as string
      headings.push(name)
      if (!KNOWN_HEADINGS.has(name)) foreign.push({ line: lineNo, text: t, reasons: ['unknown-heading'] })
      continue
    }
    const b = BULLET.exec(t)
    if (!b) {
      foreign.push({ line: lineNo, text: t, reasons: ['off-grammar'] })
      continue
    }
    const content = b[1] as string
    const m = matchLine(content, form)
    if (m) {
      lines.push(m.line)
      if (m.offForm) offForm.push(m.line.id)
      continue
    }
    const hits = lintLine(content)
    if (hits.length > 0) foreign.push({ line: lineNo, text: t, reasons: [...new Set(hits.map((x) => x.rule))] })
    else lines.push({ id: 'X1', text: content, custom: true })
  }
  return { format: headerOk ? BRIEF_FORMAT : null, form, as_of: asOf, revisit, lines, foreign, headings, offForm, problems }
}

/** Released grammar parsers by format. Add the next release's parser here; never remove one. */
export const PARSERS: Readonly<Record<string, (text: string) => ParsedNotes>> = { [BRIEF_FORMAT]: parseText }

/** Parse notes against every released grammar and keep the reading with the fewest foreign lines. */
export function parseAnyText(text: string): ParsedNotes {
  let best: ParsedNotes | undefined
  for (const parse of Object.values(PARSERS)) {
    const p = parse(text)
    if (best === undefined || p.foreign.length + p.problems.length < best.foreign.length + best.problems.length) best = p
  }
  return best as ParsedNotes
}

export type JsonParse = { readonly ok: true; readonly brief: Brief } | { readonly ok: false; readonly errors: readonly string[] }

/** Parse `hb-brief/N` JSON. An unknown format is reported as made by a newer or other version. */
export function parseJson(text: string): JsonParse {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['not valid JSON'] }
  }
  const format = typeof doc === 'object' && doc !== null ? (doc as { format?: unknown }).format : undefined
  if (typeof format !== 'string' || !(format in PARSERS)) return { ok: false, errors: [`format ${JSON.stringify(format)} is not a released hb-brief version`] }
  const v = validateBrief(doc)
  return v.ok ? { ok: true, brief: v.brief } : { ok: false, errors: v.errors }
}
