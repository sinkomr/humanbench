/**
 * The "Why this line?" drawer (proposal §3.3 step 4; R-17.8). Only the person sees it. Its wording
 * depends on the basis of the line: in Part 1 every line is a fixed clause, a default for everyone,
 * or the person's own setting. It says how sure the line is, what the research does and does not
 * support, which assistants and destination it was checked with (never implying the person's own
 * assistant was tested when it was not), and what would change it. It shows no estimate, level or
 * count: the only digits it can contain are the months of a gate run.
 */

import { checkedWith, lineStatus, type GateFile } from './gates'
import { template, type Basis } from './grammar'
import type { Destination } from './surfaces'
import type { LineId } from './types'

export interface DrawerRow {
  readonly label: string
  readonly text: string
}

const WHY: Readonly<Record<Basis, string>> = {
  fixed: 'It is a fixed clause of every set of notes. It asks the assistant to stay accurate and puts your requests in the chat first.',
  default: 'It is a default for everyone in this kind of use.',
  self_set: 'You chose it.',
}
const SURE: Readonly<Record<Basis, string>> = {
  fixed: 'It is not tuned to you.',
  default: 'A general default, not tuned to you.',
  self_set: 'It is your own setting.',
}
const CHANGE: Readonly<Record<Basis, string>> = {
  fixed: 'Nothing: it cannot be switched off.',
  default: 'You, at any time. You can also choose another wording, or switch it off.',
  self_set: 'You, at any time.',
}

const list = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** What was checked, worded so it never implies more than was run. */
export function checkedText(gates: GateFile, ids: readonly LineId[], destination?: Pick<Destination, 'id' | 'label' | 'smoke'>): string {
  const parts: string[] = []
  const seen = ids.map((id) => checkedWith(gates, id)).find((c) => c.families.length > 0)
  parts.push(seen === undefined ? 'Checked with: not yet checked.' : `Checked with: ${list(seen.families)}${seen.month === null ? '' : ` (${seen.month})`}.`)
  if (destination !== undefined) {
    const s = gates.surfaces[destination.id] ?? (destination.smoke.date === null ? undefined : { date: destination.smoke.date, result: destination.smoke.result })
    if (s === undefined || s.result === 'not_run') parts.push(`On ${destination.label}: not yet checked.`)
    else parts.push(`On ${destination.label}: checked ${s.date}, ${s.result === 'pass' ? 'worked as expected' : 'did not pass'}.`)
  }
  return parts.join(' ')
}

/** The drawer for a line made from `ids` (two for a merged line). */
export function drawerRows(ids: readonly LineId[], gates: GateFile, destination?: Pick<Destination, 'id' | 'label' | 'smoke'>): DrawerRow[] {
  const ts = ids.map(template)
  const first = ts[0]
  if (first === undefined) return []
  // A merged line is as tentative as its most personal part.
  const basis: Basis = ts.some((t) => t.basis === 'self_set') ? 'self_set' : ts.some((t) => t.basis === 'default') ? 'default' : 'fixed'
  const research = [...new Set(ts.map((t) => t.research))].join(' ')
  const status = ids.map((id) => lineStatus(gates, id)).includes('experimental') ? ' This kind of line has not been through the checks yet, so it is marked experimental.' : ''
  return [
    { label: 'Why this line', text: WHY[basis] },
    { label: 'How sure', text: `${SURE[basis]}${status}` },
    { label: 'What the research says', text: research },
    { label: 'Checked with', text: checkedText(gates, ids, destination) },
    { label: 'What would change it', text: CHANGE[basis] },
  ]
}
