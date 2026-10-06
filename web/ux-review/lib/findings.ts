/**
 * The findings file every UX reviewer writes (web/ux-review/findings/<reviewer>.json) and the check
 * that it is well formed. Only the shape is checked here (enums, required text, ids, screenshot files);
 * whether a finding is right is for the triage.
 */

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

export const SEVERITIES = ['blocker', 'major', 'minor', 'polish'] as const
export const CATEGORIES = ['bug', 'flow', 'layout', 'visual', 'a11y', 'copy', 'language-a13', 'performance', 'content', 'data-honesty'] as const
export const CONFIDENCES = ['high', 'medium', 'low'] as const

export type Severity = (typeof SEVERITIES)[number]
export type Category = (typeof CATEGORIES)[number]
export type Confidence = (typeof CONFIDENCES)[number]

export interface Finding {
  /** '<PREFIX>-NN', one prefix per file (the reviewer's), e.g. 'PHONE-03'. */
  readonly id: string
  readonly severity: Severity
  readonly category: Category
  /** One line: what is wrong. */
  readonly title: string
  /** The route id (e2e/routes.ts) or URL where it shows. */
  readonly route: string
  /** Browser, device, width, scheme, text zoom: where it was seen. */
  readonly env: string
  /** Screenshot paths relative to the repo root ('web/test-results/ux-review/...'); each must exist. */
  readonly screenshots: readonly string[]
  /** What happens, concretely. */
  readonly observed: string
  /** What should happen instead. */
  readonly expected: string
  /** How to fix it. */
  readonly suggestion: string
  /** Source files likely involved (repo-relative). */
  readonly files: readonly string[]
  /** Requirement or section ids ('R-5.6.1', '§13', 'A13'). */
  readonly spec_refs: readonly string[]
  readonly confidence: Confidence
  /** True when the fix needs a decision from the owner (copy, scope, a spec change), not just an engineer. */
  readonly owner_decision: boolean
}

export interface FindingsFile {
  readonly reviewer: string
  readonly model: string
  /** A few sentences: how the product felt, the main themes. */
  readonly summary: string
  /** What was looked at (routes, devices, widths), so a gap is visible. */
  readonly coverage: readonly string[]
  readonly findings: readonly Finding[]
}

const ID = /^([A-Z][A-Z0-9]*)-(\d{2,})$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** Problems in a findings file (empty: well formed). `repoRoot` is what screenshot paths are relative to. */
export function validateFindings(value: unknown, repoRoot: string): string[] {
  const errors: string[] = []
  if (!isRecord(value)) return ['the file must hold one JSON object {reviewer, model, summary, coverage, findings}']
  for (const key of ['reviewer', 'model', 'summary'] as const) {
    if (!isText(value[key])) errors.push(`${key}: must be a non-empty string`)
  }
  const coverage = value.coverage
  if (!Array.isArray(coverage) || coverage.length === 0) errors.push('coverage: must be a non-empty array of strings (what was looked at)')
  else coverage.forEach((c, i) => isText(c) || errors.push(`coverage[${i}]: must be a non-empty string`))

  const findings = value.findings
  if (!Array.isArray(findings)) return [...errors, 'findings: must be an array']

  const ids = new Set<string>()
  let prefix: string | undefined
  const root = path.resolve(repoRoot)
  findings.forEach((f: unknown, index: number) => {
    if (!isRecord(f)) {
      errors.push(`findings[${index}]: must be an object`)
      return
    }
    const where = `findings[${index}]${isText(f.id) ? ` (${f.id})` : ''}`

    if (!isText(f.id)) errors.push(`${where}.id: must be a non-empty string like "UX-01"`)
    else {
      const m = ID.exec(f.id)
      if (m === null) errors.push(`${where}.id: must look like <PREFIX>-NN (capital letters or digits, a hyphen, two or more digits), got "${f.id}"`)
      else {
        prefix ??= m[1]
        if (m[1] !== prefix) errors.push(`${where}.id: prefix "${m[1]}" differs from "${prefix}", the prefix of the first finding (one prefix per file)`)
      }
      if (ids.has(f.id)) errors.push(`${where}.id: duplicate id`)
      ids.add(f.id)
    }

    const oneOf = (key: 'severity' | 'category' | 'confidence', allowed: readonly string[]): void => {
      const v = f[key]
      if (typeof v !== 'string' || !allowed.includes(v)) errors.push(`${where}.${key}: must be one of ${allowed.join(' | ')} (got ${JSON.stringify(v)})`)
    }
    oneOf('severity', SEVERITIES)
    oneOf('category', CATEGORIES)
    oneOf('confidence', CONFIDENCES)

    for (const key of ['title', 'route', 'env', 'observed', 'expected', 'suggestion'] as const) {
      if (!isText(f[key])) errors.push(`${where}.${key}: must be a non-empty string`)
    }
    if (typeof f.owner_decision !== 'boolean') errors.push(`${where}.owner_decision: must be true or false`)

    for (const key of ['screenshots', 'files', 'spec_refs'] as const) {
      const list = f[key]
      if (!Array.isArray(list)) errors.push(`${where}.${key}: must be an array of strings`)
      else list.forEach((item, i) => isText(item) || errors.push(`${where}.${key}[${i}]: must be a non-empty string`))
    }
    if (Array.isArray(f.screenshots)) {
      f.screenshots.forEach((s: unknown, i: number) => {
        if (!isText(s)) return
        const abs = path.resolve(root, s)
        if (path.isAbsolute(s) || (abs !== root && !abs.startsWith(root + path.sep))) errors.push(`${where}.screenshots[${i}]: must be a path relative to the repo root, got "${s}"`)
        else if (!existsSync(abs) || !statSync(abs).isFile()) errors.push(`${where}.screenshots[${i}]: no such file relative to the repo root: ${s}`)
      })
    }
  })
  return errors
}
