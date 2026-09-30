/**
 * Validation of `hb-brief/1` JSON: a hand-written mirror of `schema/brief-v1.json`, the way
 * `save/validate.ts` mirrors the save schema (ajv would add weight and needs `new Function`).
 * `validateBriefShape` is exactly the schema; `validateBrief` adds the grammar's own rules
 * (known line ids, topic ids, slot values, custom lines that pass the lint). `validate.test.ts`
 * checks the shape validator against ajv on generated documents and single-rule mutations.
 */

import { TEMPLATE_BY_ID } from './grammar'
import { isInterest, MAX_INTERESTS } from './interests'
import { lintLine } from './lint'
import { isTopicId, canonicalTopics } from './topics'
import { BRIEF_FORMAT, LENGTHS, MODES, MONTH_RE, PRESETS, type Brief, type ContextPreset, type Length, type Mode } from './types'

export type BriefValidation = { readonly ok: true; readonly brief: Brief } | { readonly ok: false; readonly errors: string[] }

const ID_RE = /^[A-Za-z][A-Za-z0-9.]{0,15}$/u
const TOPIC_RE = /^[a-z]+\/[a-z0-9_]+(?:\/[a-z0-9_]+)?$/u
const KEYWORD_RE = /^[a-z][a-z ]{0,20}$/u
const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/u
const TEMPLATES_RE = /^\d{4}\.\d{2}$/u
const TOPICS_RE = /^topics-v[0-9]+$/u
const GROUPS_RE = /^g[0-9]+$/u
const TEXT_RE = /^[\x20-\x7E]{3,200}$/u
const TOP_KEYS = ['format', 'templates', 'topics', 'groups', 'as_of', 'revisit', 'context', 'form', 'tier', 'mode_default', 'length', 'lines', 'keywords', 'generator']
const LINE_KEYS = ['id', 'topics', 'interests', 'text', 'custom', 'status']
export const MAX_LINES = 60

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown, re: RegExp): v is string => typeof v === 'string' && re.test(v)

/** Structural errors against the JSON Schema (`schema/brief-v1.json`); empty when it validates. */
export function validateBriefShape(doc: unknown): string[] {
  const e: string[] = []
  if (!isObj(doc)) return ['not an object']
  for (const k of Object.keys(doc)) if (!TOP_KEYS.includes(k)) e.push(`unknown key ${k}`)
  for (const k of TOP_KEYS) if (!(k in doc)) e.push(`missing ${k}`)
  if (doc.format !== BRIEF_FORMAT) e.push('format')
  if (!isStr(doc.templates, TEMPLATES_RE)) e.push('templates')
  if (!isStr(doc.topics, TOPICS_RE)) e.push('topics')
  if (!isStr(doc.groups, GROUPS_RE)) e.push('groups')
  if (!isStr(doc.as_of, MONTH_RE)) e.push('as_of')
  if (!isStr(doc.revisit, MONTH_RE)) e.push('revisit')
  if (!PRESETS.includes(doc.context as ContextPreset)) e.push('context')
  if (!['short', 'long', 'skill'].includes(doc.form as string)) e.push('form')
  if (!['T1', 'T2'].includes(doc.tier as string)) e.push('tier')
  if (!MODES.includes(doc.mode_default as Mode)) e.push('mode_default')
  if (!LENGTHS.includes(doc.length as Length)) e.push('length')
  if (!Array.isArray(doc.lines) || doc.lines.length > MAX_LINES) e.push('lines')
  else doc.lines.forEach((l, i) => shapeLine(l, i, e))
  if (!isObj(doc.keywords)) e.push('keywords')
  else for (const [k, v] of Object.entries(doc.keywords)) if (!KEYWORD_RE.test(k) || typeof v !== 'string' || !KEYWORD_RE.test(v)) e.push(`keywords.${k}`)
  if (!isObj(doc.generator)) e.push('generator')
  else {
    const g = doc.generator
    for (const k of Object.keys(g)) if (!['version', 'zone_rule', 'param_version'].includes(k)) e.push(`generator.${k}`)
    for (const k of ['version', 'zone_rule', 'param_version']) if (!isStr(g[k], VERSION_RE)) e.push(`generator.${k}`)
  }
  return e
}

function shapeLine(l: unknown, i: number, e: string[]): void {
  const at = `lines[${i}]`
  if (!isObj(l)) {
    e.push(`${at}: not an object`)
    return
  }
  for (const k of Object.keys(l)) if (!LINE_KEYS.includes(k)) e.push(`${at}: unknown key ${k}`)
  if (!isStr(l.id, ID_RE)) e.push(`${at}.id`)
  if ('topics' in l && !(Array.isArray(l.topics) && l.topics.length >= 1 && l.topics.length <= 25 && new Set(l.topics).size === l.topics.length && l.topics.every((t) => isStr(t, TOPIC_RE)))) e.push(`${at}.topics`)
  if ('interests' in l && !(Array.isArray(l.interests) && l.interests.length >= 1 && l.interests.length <= MAX_INTERESTS && new Set(l.interests).size === l.interests.length && l.interests.every((t) => isStr(t, /^[a-z][a-z' -]{1,23}$/u)))) e.push(`${at}.interests`)
  if ('text' in l && !isStr(l.text, TEXT_RE)) e.push(`${at}.text`)
  if ('custom' in l && l.custom !== true) e.push(`${at}.custom`)
  if ('status' in l && l.status !== 'experimental') e.push(`${at}.status`)
}

/** Shape plus grammar rules; returns the typed brief when everything holds. */
export function validateBrief(doc: unknown): BriefValidation {
  const errors = validateBriefShape(doc)
  if (errors.length > 0) return { ok: false, errors }
  const d = doc as Record<string, unknown> & { lines: Record<string, unknown>[] }
  d.lines.forEach((l, i) => {
    const at = `lines[${i}]`
    const id = l.id as string
    const t = TEMPLATE_BY_ID.get(id)
    if (t === undefined) {
      errors.push(`${at}: unknown line ${id}`)
      return
    }
    const wantsTopics = t.long?.includes('{Topics}') === true || t.long?.includes('{topics}') === true
    const wantsInterests = t.long?.includes('{interests}') === true
    if (wantsTopics !== ('topics' in l)) errors.push(`${at}: topics ${wantsTopics ? 'required' : 'not allowed'} for ${id}`)
    if (wantsInterests !== ('interests' in l)) errors.push(`${at}: interests ${wantsInterests ? 'required' : 'not allowed'} for ${id}`)
    if (id === 'X1' !== ('text' in l)) errors.push(`${at}: text is for X1 only`)
    if (id === 'X1' !== ('custom' in l)) errors.push(`${at}: custom is for X1 only`)
    if (Array.isArray(l.topics)) {
      const ts = l.topics as string[]
      if (!ts.every(isTopicId)) errors.push(`${at}: unknown topic`)
      else if (canonicalTopics(ts).join() !== ts.join()) errors.push(`${at}: topics not in taxonomy order`)
    }
    if (Array.isArray(l.interests) && !(l.interests as string[]).every((s) => isInterest(s) && lintLine(s).length === 0)) errors.push(`${at}: bad interest`)
    if (typeof l.text === 'string' && lintLine(l.text).length > 0) errors.push(`${at}: custom text breaks the lint`)
  })
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, brief: d as unknown as Brief }
}

