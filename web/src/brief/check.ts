/**
 * The checker (AI.6; proposal §3.2 "Checker (in-app)", §6 rows 14-15; requirement R-17.11; gate
 * metric E11): paste any notes, and it says in plain words what they tell the assistant and which
 * lines are foreign, edited, out of date or withdrawn. It reads every released `hb-brief/N`
 * (`parse.ts`), and runs entirely on the device: the pasted text is never stored or sent.
 *
 * What it flags (`verdict: 'attention'`, one `Flag` per kind):
 * - `foreign_line`: a line that is not one of the standard lines and breaks a rule (a web address,
 *   a number, hidden or look-alike characters, wording about the person, a clinical word, wording that
 *   tries to steer the assistant, or a line that is not a bullet or heading of the format at all);
 * - `not_ours`, `front_matter`, `missing_clause`: the header is missing or changed, a Skill file's
 *   front matter is not the builder's, or one of the fixed clauses F1-F4 has been taken out;
 * - `typed_words`: a line that is not one of the builder's fixed wordings, or a line that has words a
 *   person typed in it (interests): the lint cannot tell a reworded steer from a harmless line of the
 *   person's own, so the checker never calls such notes clean and says to read those lines yourself;
 * - `over_limit`: more characters than the form allows (1,500 short, 5,000 long and Skill);
 * - `withdrawn`: a line whose type the gate file now blocks (`gates.ts`);
 * - `outdated`: a line in wording that has since changed (`retired.ts`), or a JSON made with an older
 *   release; the report then carries the same notes in the current wording and the diff;
 * - `review_by`: the notes' review-by month has passed;
 * - `save_file`, `invalid_json`: what was pasted is a save file or a save code (never paste those
 *   into an assistant), or JSON that is not `hb-brief/N`.
 * A line that passes every rule and is not a standard line is listed as `kind: 'own'`, and flagged as
 * `typed_words` with the others. What the lint catches is shown as `foreign`, with reasons; what it does not
 * catch is exactly the wording nobody thought of, so no rule is the only thing between such a line and a
 * "clean" verdict. Notes made with the builder and no line of the person's own read as clean.
 *
 * Pure and deterministic: the current day comes in as `today`, and nothing here reads a clock.
 */

import { diffText, similarity, type DiffOp } from './diff'
import { DEFAULT_GATES, lineStatus, type GateFile } from './gates'
import { TEMPLATES, wording } from './grammar'
import type { LintRule } from './lint'
import { meaningOf } from './meaning'
import { parseAnyText, parseJson, type ParsedNotes } from './parse'
import { RETIRED_WORDINGS, type RetiredWording } from './retired'
import { lineText, renderText } from './render'
import { BRIEF_FORMAT, FORM_LIMITS, TEMPLATES_VERSION, type BriefFormat, type BriefLine, type Form, type LineId, type LineStatus } from './types'

/** Text longer than this is not read past (a paste that size is not notes made here). */
export const MAX_CHECK_CHARS = 20_000
/** How much of a foreign line is echoed back, so a huge line cannot flood the page. */
export const MAX_ECHO_CHARS = 160
/** A line this alike a standard line (word overlap) is listed as an edited version of it. */
export const EDITED_MIN_SIMILARITY = 0.6

export type LineKind = 'header' | 'standard' | 'own' | 'foreign' | 'heading'

export interface LineFinding {
  /** 1-based line number in the pasted text; 0 for a line read from JSON. */
  readonly line: number
  /** The line as pasted, with every character outside plain ASCII shown as `[U+XXXX]`, and capped. */
  readonly text: string
  readonly kind: LineKind
  readonly id?: LineId
  /** What the line tells the assistant, in plain words; null for a foreign line. */
  readonly says: string | null
  /** Gate status of a standard line: shipped, still being checked (experimental) or blocked. */
  readonly status?: LineStatus
  /** Set when the line is in older wording: the wording version it had. */
  readonly outdatedV?: string
  /** Written for the other form (a long-form line in short notes). */
  readonly offForm?: boolean
  /** The line holds words a person typed (a line of their own, or interests), which no fixed wording vouches for. */
  readonly typed?: true
  /** Why a foreign line is flagged, in plain words. */
  readonly reasons: readonly string[]
  /** For a foreign or own line: the standard line it looks like an edit of. */
  readonly editedFrom?: LineId
}

export type FlagKind =
  | 'foreign_line'
  | 'typed_words'
  | 'not_ours'
  | 'front_matter'
  | 'missing_clause'
  | 'over_limit'
  | 'withdrawn'
  | 'outdated'
  | 'review_by'
  | 'save_file'
  | 'invalid_json'

export interface Flag {
  readonly kind: FlagKind
  /** In plain words, for the person who pasted the notes. */
  readonly message: string
  /** The 1-based lines it is about, when it is about lines. */
  readonly lines: readonly number[]
}

export interface CheckReport {
  readonly source: 'empty' | 'text' | 'json' | 'other'
  readonly form: Form | null
  readonly format: BriefFormat | null
  readonly verdict: 'clean' | 'attention'
  /** One sentence for the top of the result. */
  readonly summary: string
  readonly lines: readonly LineFinding[]
  readonly flags: readonly Flag[]
  readonly chars: number
  /** The limit of the form, when the form is known. */
  readonly limit: number | null
  /** Set when some lines are in older wording: the notes in the current wording, and what changed. */
  readonly updated: { readonly text: string; readonly diff: readonly DiffOp[] } | null
}

export interface CheckOptions {
  readonly gates?: GateFile
  /** Today, `YYYY-MM-DD` or `YYYY-MM`. Without it the review-by month is not checked. */
  readonly today?: string
  readonly retired?: readonly RetiredWording[]
}

/** Why a line was flagged, worded for the reader of the notes (the lint's own messages speak to the writer). */
export const REASON_TEXT: Readonly<Record<LintRule | 'off-grammar' | 'unknown-heading' | 'too-long', string>> = {
  ascii: 'Has characters outside plain English letters and punctuation. Hidden or look-alike characters can disguise text.',
  digit: 'Has a number. Notes carry no numbers except a month.',
  url: 'Has a web or email address.',
  markup: 'Has symbols used for formatting or code.',
  trait: 'Describes how good, weak, quick or slow someone is.',
  level: 'Mentions a level, grade, rank or score.',
  self: 'Describes the person rather than the wording wanted.',
  education: 'Mentions schooling or background.',
  language: 'Mentions first-language or background details.',
  brand: 'Mentions a product name or a technical scoring word.',
  override: 'Tries to change the assistant\'s rules, give it a new role, or make it reveal or run something.',
  a13: 'Uses a word that is not allowed in these notes.',
  'off-grammar': 'Is not a line of the notes format (a list item starting with a dash).',
  'unknown-heading': 'Is a heading that is not part of the notes format.',
  'too-long': 'Is longer than a line of your own is allowed to be.',
}

const FRONT_MATTER_TEXT: Readonly<Record<string, string>> = {
  'front matter is not closed': 'The file starts with front matter that is never closed.',
  'skill name is not ours': 'The skill name is not the one the builder writes.',
  'skill description is not one of ours': 'The skill description is not one the builder writes. It decides when the assistant loads the file.',
  'front matter has other keys': 'The front matter has entries the builder does not write.',
}

/** `text` with every character outside printable ASCII shown as `[U+XXXX]`, capped at {@link MAX_ECHO_CHARS}. */
export function visibleText(text: string): string {
  let out = ''
  for (const ch of text) {
    const c = ch.codePointAt(0) as number
    out += c >= 0x20 && c <= 0x7e ? ch : `[U+${c.toString(16).toUpperCase().padStart(4, '0')}]`
    if (out.length > MAX_ECHO_CHARS * 2) break
  }
  return out.length > MAX_ECHO_CHARS ? `${out.slice(0, MAX_ECHO_CHARS)}...` : out
}

const SLOT_MARKERS = /\{(?:Topics|topics|interests|custom)\}/gu

/** The standard line a piece of text looks like an edit of, or undefined. */
export function nearestTemplate(content: string, form: Form): LineId | undefined {
  let best: { id: LineId; score: number } | undefined
  for (const t of TEMPLATES) {
    if (t.id === 'X1' || t.header === true) continue
    const w = wording(t, form) ?? t.long
    if (w === null) continue
    const score = similarity(content, w.replace(SLOT_MARKERS, ''))
    if (best === undefined || score > best.score) best = { id: t.id, score }
  }
  return best !== undefined && best.score >= EDITED_MIN_SIMILARITY ? best.id : undefined
}

const monthOf = (d: string): string => d.slice(0, 7)

/** A standard line's finding, from the parsed line. */
function standardFinding(line: BriefLine, n: number, text: string, gates: GateFile, extra: { offForm: boolean; outdatedV?: string }): LineFinding {
  const status = lineStatus(gates, line.id)
  return {
    line: n,
    text,
    kind: line.id === 'H' ? 'header' : line.id === 'X1' ? 'own' : 'standard',
    id: line.id,
    says: meaningOf(line),
    status,
    ...(hasTypedWords(line) ? { typed: true as const } : {}),
    ...(extra.outdatedV === undefined ? {} : { outdatedV: extra.outdatedV }),
    ...(extra.offForm ? { offForm: true } : {}),
    reasons: [],
  }
}

/** A line with words a person typed: a line of their own (X1) or interests (I1). Topic lists come from a fixed vocabulary. */
const hasTypedWords = (line: BriefLine): boolean => line.id === 'X1' || line.custom === true || (line.interests?.length ?? 0) > 0

/** The flag for lines that hold typed words (`lines` are 1-based text lines, empty for JSON). */
function typedFlag(count: number, lines: readonly number[]): Flag {
  const it = plural(count, 'it', 'them')
  return {
    kind: 'typed_words',
    message: `${count} ${plural(count, 'line is', 'lines are')} not ${plural(count, 'a standard line', 'standard lines')} of the builder, or ${plural(count, 'holds', 'hold')} words someone typed. ${plural(count, 'It may be a line', 'They may be lines')} you typed yourself in the builder; if you did not, someone else added ${it}. No rule can tell a harmless line from a reworded instruction, so read ${it} yourself before you paste.`,
    lines,
  }
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** Check pasted text: notes in any released text form, or `hb-brief/N` JSON. Never throws. */
export function checkNotes(input: string, opts: CheckOptions = {}): CheckReport {
  const gates = opts.gates ?? DEFAULT_GATES
  const retired = opts.retired ?? RETIRED_WORDINGS
  // Length as the builder counts it: line breaks as one character (Windows adds a second), no trailing blank space
  // (a downloaded file ends with a newline), so notes exactly at the limit are not flagged for the way they were saved.
  const chars = input.replace(/\r\n?/gu, '\n').replace(/\s+$/u, '').length
  const trimmed = input.trim()
  if (trimmed === '') return report({ source: 'empty', form: null, format: null, lines: [], flags: [], chars, limit: null, updated: null }, 'Paste some notes to check them.')

  const flags: Flag[] = []
  const tooLong = chars > MAX_CHECK_CHARS
  const text = tooLong ? input.slice(0, MAX_CHECK_CHARS) : input

  // A save file or save code is not notes, and must not be pasted into an assistant either.
  if (looksLikeSave(trimmed)) {
    flags.push({ kind: 'save_file', message: 'This looks like a HumanBench save file or save code, not notes. It holds your raw answers. Keep it out of chats with an assistant.', lines: [] })
    return report({ source: 'other', form: null, format: null, lines: [], flags, chars, limit: null, updated: null }, 'This is not a set of notes.')
  }
  if (trimmed.startsWith('{')) return checkJson(text, chars, flags, opts, gates)

  const p = parseAnyText(text, retired)
  const form = p.form
  const limit = FORM_LIMITS[form]
  const rawLines = text.replace(/\r\n?/gu, '\n').split('\n')

  // Every parsed line, then every foreign line, put back in the order they appear in the text.
  const offForm = new Set<LineId>(p.offForm)
  const retiredByLine = new Map(p.retired.map((r) => [r.line, r]))
  const findings: LineFinding[] = p.lines.map((line, k) => {
    const n = p.lineNos[k] as number
    const raw = rawLines[n - 1] as string
    const r = retiredByLine.get(n)
    const f = standardFinding(line, n, visibleText(raw), gates, { offForm: offForm.has(line.id), ...(r === undefined ? {} : { outdatedV: r.v }) })
    if (f.kind !== 'own') return f
    const editedFrom = nearestTemplate(raw.replace(/^- /u, ''), form)
    return editedFrom === undefined ? f : { ...f, editedFrom }
  })
  for (const f of p.foreign) {
    const raw = rawLines[f.line - 1] as string
    const editedFrom = nearestTemplate(raw.replace(/^- /u, ''), form)
    findings.push({ line: f.line, text: visibleText(raw), kind: 'foreign', says: null, reasons: f.reasons.map((r) => REASON_TEXT[r]), ...(editedFrom === undefined ? {} : { editedFrom }) })
  }
  findings.sort((a, b) => a.line - b.line)

  // Flags.
  if (tooLong) flags.push({ kind: 'over_limit', message: `Only the first ${MAX_CHECK_CHARS.toLocaleString('en-US')} characters were read. Notes made here are at most ${FORM_LIMITS.long.toLocaleString('en-US')}.`, lines: [] })
  else if (chars > limit) flags.push({ kind: 'over_limit', message: `${chars.toLocaleString('en-US')} characters; ${form === 'short' ? 'short notes' : 'long notes and Skill files'} are at most ${limit.toLocaleString('en-US')}. Something may have been added.`, lines: [] })
  if (p.format === null) flags.push({ kind: 'not_ours', message: 'The first lines are not the header the builder writes, so these may not be notes made here.', lines: [] })
  for (const problem of p.problems) {
    const msg = FRONT_MATTER_TEXT[problem]
    if (msg !== undefined) flags.push({ kind: 'front_matter', message: msg, lines: [] })
  }
  const foreignLines = findings.filter((f) => f.kind === 'foreign').map((f) => f.line)
  const typedLines = findings.filter((f) => f.typed === true).map((f) => f.line)
  if (foreignLines.length > 0) {
    const one = foreignLines.length === 1
    flags.push({
      kind: 'foreign_line',
      message: `${foreignLines.length} ${plural(foreignLines.length, 'line is', 'lines are')} not part of the notes format and break${one ? 's' : ''} a rule. Do not paste ${plural(foreignLines.length, 'it', 'them')} into an assistant.`,
      lines: foreignLines,
    })
  }
  if (typedLines.length > 0) flags.push(typedFlag(typedLines.length, typedLines))
  if (p.format !== null) {
    const ids = new Set(p.lines.map((l) => l.id))
    const missing = ['F1', 'F2', 'F3', 'F4'].filter((id) => !ids.has(id))
    if (missing.length > 0) flags.push({ kind: 'missing_clause', message: `The fixed ${plural(missing.length, 'line', 'lines')} ${missing.join(', ')} ${plural(missing.length, 'is', 'are')} missing. They keep answers accurate and keep you in charge, so the builder always writes them.`, lines: [] })
  }
  const withdrawn = findings.filter((f) => f.status === 'blocked')
  if (withdrawn.length > 0) {
    flags.push({ kind: 'withdrawn', message: `${withdrawn.length} ${plural(withdrawn.length, 'line has', 'lines have')} been switched off in this version of the builder. Make the notes again to leave ${plural(withdrawn.length, 'it', 'them')} out.`, lines: withdrawn.map((f) => f.line) })
  }
  const old = findings.filter((f) => f.outdatedV !== undefined)
  let updated: CheckReport['updated'] = null
  if (old.length > 0) {
    flags.push({ kind: 'outdated', message: `${old.length} ${plural(old.length, 'line uses', 'lines use')} older wording. Below is what ${plural(old.length, 'it', 'they')} would read as now.`, lines: old.map((f) => f.line) })
    updated = updatedNotes(rawLines, form, p)
  }
  if (opts.today !== undefined && p.revisit !== null && monthOf(opts.today) > p.revisit) {
    flags.push({ kind: 'review_by', message: `The notes ask to be looked at again after ${p.revisit}. Check they still say what you want, then copy them again if you change anything.`, lines: [] })
  }

  return report({ source: 'text', form, format: p.format, lines: findings, flags, chars, limit, updated })
}

/** The lines of `rawLines` with every older-wording line replaced by its current wording; other lines are kept as they are. */
function updatedNotes(rawLines: readonly string[], form: Form, p: ParsedNotes): { text: string; diff: DiffOp[] } {
  const now = new Map<number, string>()
  for (const r of p.retired) {
    const line = p.lines[p.lineNos.indexOf(r.line)]
    const current = line === undefined ? null : lineText(line, form)
    if (current !== null) now.set(r.line, `- ${current}`)
  }
  const before = rawLines.join('\n')
  const after = rawLines.map((l, i) => now.get(i + 1) ?? l).join('\n')
  return { text: after, diff: diffText(before, after, form) }
}

function checkJson(text: string, chars: number, flags: Flag[], opts: CheckOptions, gates: GateFile): CheckReport {
  const parsed = parseJson(text)
  if (!parsed.ok) {
    flags.push({ kind: 'invalid_json', message: `This is not notes in the JSON format (${parsed.errors.slice(0, 3).map(visibleText).join('; ')}).`, lines: [] })
    return report({ source: 'other', form: null, format: null, lines: [], flags, chars, limit: null, updated: null }, 'This is not a set of notes.')
  }
  const b = parsed.brief
  const findings: LineFinding[] = b.lines.map((l, i) => ({
    line: 0,
    text: `line ${i + 1}: ${l.id}`,
    kind: l.id === 'H' ? 'header' : l.id === 'X1' ? 'own' : 'standard',
    id: l.id,
    says: meaningOf(l),
    status: lineStatus(gates, l.id),
    ...(hasTypedWords(l) ? { typed: true as const } : {}),
    reasons: [],
  }))
  const rendered = renderText(b)
  const limit = FORM_LIMITS[b.form]
  if (rendered.length > limit) flags.push({ kind: 'over_limit', message: `The notes these lines make are ${rendered.length.toLocaleString('en-US')} characters; ${b.form === 'short' ? 'short notes' : 'long notes and Skill files'} are at most ${limit.toLocaleString('en-US')}.`, lines: [] })
  const typed = findings.filter((f) => f.typed === true).length
  if (typed > 0) flags.push(typedFlag(typed, []))
  const withdrawn = findings.filter((f) => f.status === 'blocked')
  if (withdrawn.length > 0) flags.push({ kind: 'withdrawn', message: `${withdrawn.length} ${plural(withdrawn.length, 'line has', 'lines have')} been switched off in this version of the builder. Make the notes again to leave ${plural(withdrawn.length, 'it', 'them')} out.`, lines: [] })
  if (b.templates !== TEMPLATES_VERSION) flags.push({ kind: 'outdated', message: `These lines were made with the ${b.templates} release of the builder; the current one is ${TEMPLATES_VERSION}. Make the notes again to use the current wording.`, lines: [] })
  if (opts.today !== undefined && monthOf(opts.today) > b.revisit) flags.push({ kind: 'review_by', message: `The notes ask to be looked at again after ${b.revisit}. Check they still say what you want, then copy them again if you change anything.`, lines: [] })
  return report({ source: 'json', form: b.form, format: BRIEF_FORMAT, lines: findings, flags, chars, limit, updated: null })
}

function report(r: Omit<CheckReport, 'verdict' | 'summary'>, summary?: string): CheckReport {
  const verdict = r.flags.length === 0 ? 'clean' : 'attention'
  if (summary !== undefined) return { ...r, verdict, summary }
  const standard = r.lines.filter((l) => l.kind === 'standard' || l.kind === 'header').length
  const text =
    verdict === 'clean'
      ? `These read as notes made with the builder: ${standard} standard ${plural(standard, 'line', 'lines')}, and nothing that needs a second look.`
      : `${r.flags.length} ${plural(r.flags.length, 'thing needs', 'things need')} a look before these go into an assistant.`
  return { ...r, verdict, summary: text }
}

/** True when the text is a save file (JSON with the save's own keys) or a save code (gzip in base64). */
export function looksLikeSave(trimmed: string): boolean {
  if (trimmed.startsWith('{')) {
    try {
      const o = JSON.parse(trimmed) as unknown
      return typeof o === 'object' && o !== null && ('sessions' in o || 'anon_id' in o || 'seen_items' in o)
    } catch {
      return false
    }
  }
  return /^H4sI[A-Za-z0-9_+/=\s-]{40,}$/u.test(trimmed)
}

