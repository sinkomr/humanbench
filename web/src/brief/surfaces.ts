/**
 * Where the notes go (proposal §3.1, §3.3 step 5; R-17.10): the destinations, their limits, the
 * install and removal steps, and a staleness warning. The data is `surfaces.json`; limits and menu
 * names change often (one limit changed as recently as July 2026), so the file carries a `checked`
 * date and `surfacesStaleness` warns when it is more than 120 days old (AI.4 acceptance).
 *
 * For agents the default is download-only (proposal §3.3 step 5): the file gets a unique name, and
 * the command that installs it refuses to overwrite an existing file. The command blocks contain
 * no `#` (CLAUDE.md: no comments inside terminal blocks written for the user) and no `rm -rf`.
 */

import raw from './surfaces.json'
import type { Form } from './types'

export type DestinationGroup = 'assistant' | 'agent' | 'other'
export type Os = 'posix' | 'windows'

export type FileSpec =
  | { readonly kind: 'new_file'; readonly posix_dir: string; readonly windows_dir: string; readonly name: string; readonly own_dir: boolean }
  | { readonly kind: 'shared_file'; readonly posix_path: string; readonly windows_path: string }

export interface Destination {
  readonly id: string
  readonly label: string
  readonly group: DestinationGroup
  /** Forms the destination takes; the first that is not `default_form` is an optional alternative. */
  readonly forms: readonly Form[]
  readonly default_form: Form
  /** `json` for the person's own app; every other destination takes text. */
  readonly output?: 'json'
  readonly limit_note: string
  readonly file?: FileSpec
  readonly install: readonly string[]
  readonly remove: readonly string[]
  readonly smoke: { readonly date: string | null; readonly result: 'pass' | 'fail' | 'not_run' }
}

export interface Surfaces {
  readonly format: string
  /** `YYYY-MM-DD`: when the data was last reviewed. */
  readonly checked: string
  readonly limits: Readonly<Record<Form, number>>
  readonly destinations: readonly Destination[]
}

export const SURFACES: Surfaces = raw as unknown as Surfaces
export const DESTINATIONS: readonly Destination[] = SURFACES.destinations
export const STALE_AFTER_DAYS = 120

export function destination(id: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.id === id)
}

/** The form to write for a destination: the requested one if it takes it, else its default. */
export function resolveForm(dest: Destination, requested?: Form): Form {
  return requested !== undefined && dest.forms.includes(requested) ? requested : dest.default_form
}

/** Whole days from `checked` to `today` (both `YYYY-MM-DD`, read as UTC dates). */
export function daysBetween(checked: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${checked}T00:00:00Z`)) / 86_400_000)
}

export interface Staleness {
  readonly stale: boolean
  readonly days: number
  /** A sentence for the page or a build log; empty when fresh. */
  readonly warning: string
}

/** Whether the destination data is older than {@link STALE_AFTER_DAYS} on `today` (`YYYY-MM-DD`). */
export function surfacesStaleness(today: string, surfaces: Pick<Surfaces, 'checked'> = SURFACES): Staleness {
  const days = daysBetween(surfaces.checked, today)
  const stale = !(days <= STALE_AFTER_DAYS)
  return {
    stale,
    days,
    warning: stale ? `The install steps and limits were last checked on ${surfaces.checked}, ${days} days ago. Menu names and limits change, so trust the labels in your own assistant.` : '',
  }
}

/** File name of the download: unique per session so it never collides with an earlier download. */
export function downloadName(dest: Destination, form: Form, asOf: string, token: string): string {
  const stem = dest.output === 'json' ? 'notes' : form === 'skill' ? 'skill' : dest.file?.kind === 'new_file' ? 'rules' : 'notes'
  const ext = dest.output === 'json' ? 'json' : form === 'short' ? 'txt' : 'md'
  return `hb-${stem}-${asOf}-${token}.${ext}`
}

export interface CommandBlock {
  readonly os: Os
  readonly label: string
  /** Moves the downloaded file into place; stops without changing anything if the target exists. */
  readonly install: string
  /** Removes the installed file (and its own folder). */
  readonly remove: string
}

/** Terminal commands for a destination that installs a whole file, else null. */
export function commandBlocks(dest: Destination, downloaded: string): CommandBlock[] | null {
  const f = dest.file
  if (f === undefined || f.kind !== 'new_file') return null
  const posixTarget = `${f.posix_dir}/${f.name}`
  const winTarget = `${f.windows_dir}\\${f.name}`
  const posixInstall = [
    `mkdir -p ${f.posix_dir}`,
    `[ -e ${posixTarget} ] && echo "A file with that name already exists; nothing was changed." || mv ~/Downloads/${downloaded} ${posixTarget}`,
  ]
  const winInstall = [
    `New-Item -ItemType Directory -Force "${f.windows_dir}" | Out-Null`,
    `Move-Item "$HOME\\Downloads\\${downloaded}" "${winTarget}"`,
  ]
  const posixRemove = [`rm ${posixTarget}`, ...(f.own_dir ? [`rmdir ${f.posix_dir}`] : [])]
  const winRemove = [`Remove-Item "${winTarget}"`, ...(f.own_dir ? [`Remove-Item "${f.windows_dir}"`] : [])]
  return [
    { os: 'posix', label: 'macOS or Linux (zsh or bash)', install: posixInstall.join('\n'), remove: posixRemove.join('\n') },
    { os: 'windows', label: 'Windows (PowerShell)', install: winInstall.join('\n'), remove: winRemove.join('\n') },
  ]
}
