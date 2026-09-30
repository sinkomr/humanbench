/**
 * Writing a brief out (proposal §3.2, §4.9). One pure function per artifact: no clock, no
 * randomness, no network, so the same brief always gives the same bytes (V0 generator invariant).
 *
 * - `short`: plain ASCII, the header on one line, then one `- ` bullet per line. No headings.
 * - `long`: Markdown with only `#` headings and `-` lists (section headings from `HEADINGS`).
 * - `skill`: the long form behind `SKILL.md` front matter (`name`, `description`).
 * - JSON `hb-brief/1`: the brief itself, with a fixed key order. It mirrors the text exactly:
 *   line ids, slot values, months and statuses only; no zone fields, no basis, no hidden topic
 *   lists (R-17.3, proposal §5.5).
 *
 * The lines are never reordered here: `build.ts` puts them in print order, and `parse.ts` reads
 * them back in the order they appear, so `parse(render(b))` returns `b`'s lines.
 */

import { PRESET_INFO } from './contexts'
import { HEADINGS, TEMPLATE_BY_ID, headerLines, skillFrontMatter, wording, type PrintGroup } from './grammar'
import { joinInterests } from './interests'
import { joinTopicLabels } from './topics'
import type { Brief, BriefLine, Form } from './types'

/** The written text of one line in a form, or null when the line has no wording there. */
export function lineText(line: BriefLine, form: Form): string | null {
  const t = TEMPLATE_BY_ID.get(line.id)
  if (t === undefined) return null
  const w = wording(t, form)
  if (w === null) return null
  return w
    .replace('{Topics}', () => joinTopicLabels(line.topics ?? [], true))
    .replace('{topics}', () => joinTopicLabels(line.topics ?? [], false))
    .replace('{interests}', () => joinInterests(line.interests ?? []))
    .replace('{custom}', () => line.text ?? '')
}

const GROUP_ORDER: readonly PrintGroup[] = ['always', 'style', 'topic', 'work', 'extras']

/** The group a line prints in. */
export function groupOf(line: BriefLine): PrintGroup {
  return TEMPLATE_BY_ID.get(line.id)?.group ?? 'extras'
}

/** Heading of a group in the long form; some depend on what the group holds (proposal §4.9). */
export function headingFor(group: PrintGroup, lines: readonly BriefLine[], brief: Pick<Brief, 'context'>): string {
  switch (group) {
    case 'always':
      return HEADINGS.always
    case 'style':
      return PRESET_INFO[brief.context].readingHeading ? HEADINGS.styleReading : HEADINGS.style
    case 'topic':
      return HEADINGS.topic
    case 'work':
      return lines.some((l) => TEMPLATE_BY_ID.get(l.id)?.section === 'S5') ? HEADINGS.work : HEADINGS.modes
    case 'extras':
      return lines.some((l) => l.id === 'X1') ? HEADINGS.extras : HEADINGS.examples
  }
}

/** The notes as text, in the brief's own form. Lines without wording in that form are skipped. */
export function renderText(brief: Brief): string {
  const form = brief.form
  const groups = new Map<PrintGroup, BriefLine[]>(GROUP_ORDER.map((g) => [g, []]))
  for (const l of brief.lines) groups.get(groupOf(l))?.push(l)
  const out: string[] = []
  if (form === 'skill') out.push(...skillFrontMatter(brief.context), '')
  out.push(...headerLines(form, brief.as_of, brief.revisit))
  for (const g of GROUP_ORDER) {
    const lines = groups.get(g) ?? []
    const bullets = lines.map((l) => lineText(l, form)).filter((t): t is string => t !== null)
    if (bullets.length === 0) continue
    if (form !== 'short') out.push('', `## ${headingFor(g, lines, brief)}`)
    for (const b of bullets) out.push(`- ${b}`)
  }
  return out.join('\n')
}

/** The plain object the JSON serialises, keys in the schema's order. */
export function briefObject(brief: Brief): Record<string, unknown> {
  return {
    format: brief.format,
    templates: brief.templates,
    topics: brief.topics,
    groups: brief.groups,
    as_of: brief.as_of,
    revisit: brief.revisit,
    context: brief.context,
    form: brief.form,
    tier: brief.tier,
    mode_default: brief.mode_default,
    length: brief.length,
    lines: brief.lines.map((l) => ({
      id: l.id,
      ...(l.topics === undefined ? {} : { topics: [...l.topics] }),
      ...(l.interests === undefined ? {} : { interests: [...l.interests] }),
      ...(l.text === undefined ? {} : { text: l.text }),
      ...(l.custom === undefined ? {} : { custom: true }),
      ...(l.status === undefined ? {} : { status: l.status }),
    })),
    keywords: { ...brief.keywords },
    generator: { ...brief.generator },
  }
}

/** `hb-brief/1` JSON text (two-space indent, no trailing newline). */
export function renderJson(brief: Brief): string {
  return JSON.stringify(briefObject(brief), null, 2)
}

/** What the file on disk holds: the text plus a final newline. */
export const asFile = (text: string): string => `${text}\n`
