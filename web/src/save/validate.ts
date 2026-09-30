/**
 * Runtime validator for save files v1, a hand-written mirror of `schema/save-v1.json` (DESIGN §8).
 *
 * Why not ajv at runtime: ajv compiles schemas with `new Function` (blocked by a strict CSP) and
 * adds ~35 KB gzipped to a static MVP whose schema is small and fixed. ajv is a dev dependency
 * instead: `schema.test.ts` validates the §8 example with it and checks that this validator and
 * ajv agree on generated valid files, targeted mutations and random JSON.
 *
 * The one intended difference: JSON nested deeper than 64 levels is rejected here (the schema
 * cannot express depth), because the RFC 8785 canonicaliser (`jcs.ts`) refuses it.
 */

import {
  BRIEF_DESTINATION_RE,
  BRIEF_FIT_ID_RE,
  BRIEF_FORMS,
  BRIEF_GROUPS_VERSION_RE,
  BRIEF_LENGTHS,
  BRIEF_LINE_KEY_RE,
  BRIEF_MAX_FIT,
  BRIEF_MAX_LINES,
  BRIEF_MAX_PHRASING,
  BRIEF_MAX_REV,
  BRIEF_MAX_SLOTS,
  BRIEF_MAX_TOPICS,
  BRIEF_MAX_ZONES,
  BRIEF_MODES,
  BRIEF_MONTH_RE,
  BRIEF_PRESETS,
  BRIEF_SETTINGS,
  BRIEF_TEMPLATES_STAMP_RE,
  BRIEF_TEMPLATE_ID_RE,
  BRIEF_TIERS,
  BRIEF_TOPICS_VERSION_RE,
  BRIEF_TOPIC_ID_RE,
  BRIEF_VERDICTS,
  BRIEF_WORDING_V_RE,
} from './brief-prefs'
import { isIJsonString } from './jcs'
import type { SaveFileV1, SaveSession } from './types'

export type ValidationResult = { ok: true; save: SaveFileV1 } | { ok: false; errors: string[] }

// Patterns: the same sources as the schema (JSON-escaped there), compiled with the `u` flag as
// JSON Schema (ECMA-262) and ajv do.
export const SCHEMA_VERSION_RE = /^1\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/u
export const VERSION_TAG_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/u
export const ANON_ID_RE = /^hb_[0-9A-Za-z]{16,17}$/u
/**
 * A real UTC calendar second in 1970–9999 (`clock.ts`): month lengths and Gregorian leap years
 * are in the pattern, so `2026-02-30` and `2026-02-29` fail here and in the schema alike, and a
 * match always round-trips through `Date` (`create.test.ts` checks every day of 1960–2500).
 */
export const UTC_SECONDS_RE =
  /^(?:(?:19[7-9][0-9]|[2-9][0-9]{3})-(?:(?:0[1-9]|1[0-2])-(?:0[1-9]|1[0-9]|2[0-8])|(?:0[13-9]|1[0-2])-(?:29|30)|(?:0[13578]|1[02])-31)|(?:19(?:7[26]|8[048]|9[26])|[2-9][0-9](?:0[48]|[2468][048]|[13579][26])|(?:[2468][048]|[3579][26])00)-02-29)T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/u
export const SESSION_ID_RE = /^s_[0-9A-Za-z]{8,32}$/u
const ITEM_ID_RE = /^i:[^\uD800-\uDFFF]+$/u
const FAMILY_ID_RE = /^f:[^\uD800-\uDFFF]+$/u
// A family name only (§8 privacy: no precise user agent): no digits or dots, so no version string.
const FAMILY_NAME_RE = /^[A-Za-z][A-Za-z _-]{0,31}$/u
const FLAG_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/u
const KID_RE = /^[0-9A-Za-z._-]{1,64}$/u
const MAC_RE = /^[0-9A-Za-z+/=._-]{1,512}$/u

const MAX_DEPTH = 64

/**
 * Depth of a response payload or tuple extra inside a save (file → sessions → session →
 * responses → tuple → payload), so {@link MAX_DEPTH} matches the canonicaliser's limit exactly.
 */
const RESPONSE_DEPTH = 5

type Obj = Record<string, unknown>

/** Length in Unicode code points, as JSON Schema's minLength/maxLength count. */
function cpLength(s: string): number {
  let n = 0
  for (const _ of s) n++
  return n
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v)

class Checker {
  readonly errors: string[] = []

  fail(path: string, msg: string): false {
    this.errors.push(`${path || '/'}: ${msg}`)
    return false
  }

  /** Exactly the listed keys: all `required` present, nothing outside `required ∪ optional`. */
  keys(v: Obj, path: string, required: readonly string[], optional: readonly string[] = []): boolean {
    let ok = true
    for (const k of required) if (!Object.hasOwn(v, k)) ok = this.fail(path, `missing "${k}"`)
    for (const k of Object.keys(v)) {
      if (!required.includes(k) && !optional.includes(k)) ok = this.fail(path, `unexpected "${k}"`)
    }
    return ok
  }

  str(v: unknown, path: string, re: RegExp, min = 0, max = Infinity): boolean {
    if (typeof v !== 'string') return this.fail(path, 'must be a string')
    const n = cpLength(v)
    if (n < min || n > max) return this.fail(path, `length must be ${min}–${max}`)
    if (!re.test(v)) return this.fail(path, `must match ${re.source}`)
    return true
  }

  text(v: unknown, path: string, min = 0, max = Infinity): boolean {
    return this.str(v, path, /^/u, min, max) && (isIJsonString(v as string) || this.fail(path, 'unpaired surrogate'))
  }

  /** Any I-JSON value (schema `$defs/json`). */
  json(v: unknown, path: string, depth = 0): boolean {
    if (depth > MAX_DEPTH) return this.fail(path, `nesting deeper than ${MAX_DEPTH}`)
    if (v === null || typeof v === 'boolean') return true
    if (typeof v === 'number') return Number.isFinite(v) || this.fail(path, 'non-finite number')
    if (typeof v === 'string') return isIJsonString(v) || this.fail(path, 'unpaired surrogate')
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (!(i in v)) return this.fail(`${path}/${i}`, 'array hole')
        if (!this.json(v[i], `${path}/${i}`, depth + 1)) return false
      }
      return true
    }
    if (isObj(v)) {
      const proto = Object.getPrototypeOf(v) as unknown
      if (proto !== Object.prototype && proto !== null) return this.fail(path, 'not a plain object')
      for (const [k, x] of Object.entries(v)) {
        if (!isIJsonString(k)) return this.fail(path, 'key with an unpaired surrogate')
        if (!this.json(x, `${path}/${k}`, depth + 1)) return false
      }
      return true
    }
    return this.fail(path, `${typeof v} is not JSON`)
  }

  array(v: unknown, path: string, each: (x: unknown, p: string) => boolean): boolean {
    if (!Array.isArray(v)) return this.fail(path, 'must be an array')
    let ok = true
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) ok = this.fail(`${path}/${i}`, 'array hole')
      else if (!each(v[i], `${path}/${i}`)) ok = false
    }
    return ok
  }

  /** A file-level sig, or with `bound` an A16 session sig, which also names its `anon_id`. */
  sig(v: unknown, path: string, bound = false): boolean {
    if (!isObj(v)) return this.fail(path, 'must be an object')
    let ok = this.keys(v, path, bound ? ['alg', 'kid', 'mac', 'anon_id'] : ['alg', 'kid', 'mac'])
    if (Object.hasOwn(v, 'alg') && v.alg !== 'HMAC-SHA256') ok = this.fail(`${path}/alg`, 'must be "HMAC-SHA256"')
    if (Object.hasOwn(v, 'kid')) ok = this.str(v.kid, `${path}/kid`, KID_RE) && ok
    if (Object.hasOwn(v, 'mac')) ok = this.str(v.mac, `${path}/mac`, MAC_RE) && ok
    if (bound && Object.hasOwn(v, 'anon_id')) ok = this.str(v.anon_id, `${path}/anon_id`, ANON_ID_RE) && ok
    return ok
  }

  device(v: unknown, path: string): boolean {
    if (!isObj(v)) return this.fail(path, 'must be an object')
    const req = ['class', 'input', 'os_family', 'browser_family', 'refresh_hz_est', 'timer_res_ms', 'viewport']
    let ok = this.keys(v, path, req)
    const has = (k: string): boolean => Object.hasOwn(v, k)
    if (has('class') && !['desktop', 'tablet', 'phone', 'other'].includes(v.class as string)) ok = this.fail(`${path}/class`, 'unknown device class')
    if (has('input') && !['mouse', 'touch', 'keyboard', 'pen', 'other'].includes(v.input as string)) ok = this.fail(`${path}/input`, 'unknown input mode')
    if (has('os_family')) ok = this.str(v.os_family, `${path}/os_family`, FAMILY_NAME_RE) && ok
    if (has('browser_family')) ok = this.str(v.browser_family, `${path}/browser_family`, FAMILY_NAME_RE) && ok
    if (has('refresh_hz_est') && v.refresh_hz_est !== null && !(isNum(v.refresh_hz_est) && v.refresh_hz_est > 0)) {
      ok = this.fail(`${path}/refresh_hz_est`, 'must be a number > 0 or null')
    }
    if (has('timer_res_ms') && v.timer_res_ms !== null && !(isNum(v.timer_res_ms) && v.timer_res_ms >= 0)) {
      ok = this.fail(`${path}/timer_res_ms`, 'must be a number ≥ 0 or null')
    }
    if (has('viewport')) {
      const vp = v.viewport
      if (!Array.isArray(vp) || vp.length !== 2 || !vp.every((x) => isInt(x) && x >= 0)) ok = this.fail(`${path}/viewport`, 'must be [width, height] integers ≥ 0')
    }
    return ok
  }

  flags(v: unknown, path: string): boolean {
    if (!isObj(v)) return this.fail(path, 'must be an object')
    let ok = true
    for (const [k, x] of Object.entries(v)) {
      const p = `${path}/${k}`
      if (!FLAG_NAME_RE.test(k)) ok = this.fail(p, 'flag names are snake_case')
      if (k === 'visibility_hidden_s') {
        if (!(isNum(x) && x >= 0)) ok = this.fail(p, 'must be a number ≥ 0')
      } else if (k === 'paste_events' || k === 'fast_guess_n') {
        if (!(isInt(x) && x >= 0)) ok = this.fail(p, 'must be an integer ≥ 0')
      } else if (!(x === null || typeof x === 'boolean' || isNum(x))) {
        ok = this.fail(p, 'must be a number, boolean or null')
      }
    }
    return ok
  }

  response(v: unknown, path: string): boolean {
    if (!Array.isArray(v)) return this.fail(path, 'must be an array')
    if (v.length !== 6 && v.length !== 7) return this.fail(path, 'must have 6 or 7 elements')
    for (let i = 0; i < v.length; i++) if (!(i in v)) return this.fail(`${path}/${i}`, 'array hole')
    const [itemId, pretest, response, correct, rtMs, conf] = v as unknown[]
    let ok = this.str(itemId, `${path}/0`, ITEM_ID_RE, 3, 256)
    if (pretest !== 0 && pretest !== 1) ok = this.fail(`${path}/1`, 'pretest must be 0 or 1')
    ok = this.json(response, `${path}/2`, RESPONSE_DEPTH) && ok
    if (correct !== 0 && correct !== 1 && correct !== null) ok = this.fail(`${path}/3`, 'correct must be 0, 1 or null')
    if (!(isNum(rtMs) && rtMs >= 0)) ok = this.fail(`${path}/4`, 'rt_ms must be a number ≥ 0')
    if (conf !== null && !(isNum(conf) && conf >= 0 && conf <= 100)) ok = this.fail(`${path}/5`, 'confidence_pct must be 0–100 or null')
    if (v.length === 7) ok = this.json(v[6], `${path}/6`, RESPONSE_DEPTH) && ok
    return ok
  }

  session(v: unknown, path: string): boolean {
    if (!isObj(v)) return this.fail(path, 'must be an object')
    let ok = this.keys(v, path, ['session_id', 'started_utc', 'duration_s', 'device', 'flags', 'responses'], ['sig'])
    const has = (k: string): boolean => Object.hasOwn(v, k)
    if (has('session_id')) ok = this.str(v.session_id, `${path}/session_id`, SESSION_ID_RE) && ok
    if (has('started_utc')) ok = this.str(v.started_utc, `${path}/started_utc`, UTC_SECONDS_RE) && ok
    if (has('duration_s') && !(isNum(v.duration_s) && v.duration_s >= 0)) ok = this.fail(`${path}/duration_s`, 'must be a number ≥ 0')
    if (has('device')) ok = this.device(v.device, `${path}/device`) && ok
    if (has('flags')) ok = this.flags(v.flags, `${path}/flags`) && ok
    if (has('responses')) ok = this.array(v.responses, `${path}/responses`, (x, p) => this.response(x, p)) && ok
    if (has('sig')) ok = this.sig(v.sig, `${path}/sig`, true) && ok
    return ok
  }

  posterior(v: unknown, path: string): boolean {
    if (!isObj(v)) return this.fail(path, 'must be an object')
    let ok = this.keys(v, path, ['param_version', 'axes', 'mean', 'cov_lower'])
    if (Object.hasOwn(v, 'param_version')) ok = this.str(v.param_version, `${path}/param_version`, VERSION_TAG_RE) && ok
    if (Object.hasOwn(v, 'axes')) ok = this.array(v.axes, `${path}/axes`, (x, p) => this.text(x, p, 1, 16)) && ok
    for (const k of ['mean', 'cov_lower'] as const) {
      if (Object.hasOwn(v, k)) ok = this.array(v[k], `${path}/${k}`, (x, p) => isNum(x) || this.fail(p, 'must be a number')) && ok
    }
    return ok
  }

  /** An array of at most `max` distinct strings, each matching `re` (schema: maxItems, uniqueItems, items.pattern). */
  idList(v: unknown, path: string, re: RegExp, max: number): boolean {
    if (!Array.isArray(v)) return this.fail(path, 'must be an array')
    let ok = true
    if (v.length > max) ok = this.fail(path, `at most ${max} items`)
    ok = this.array(v, path, (x, p) => this.str(x, p, re)) && ok
    if (ok && new Set(v).size !== v.length) ok = this.fail(path, 'items must be unique')
    return ok
  }

  /** An object of at most `max` entries whose keys match `keyRe` and whose values are in `values` or match `valueRe`. */
  idMap(v: unknown, path: string, keyRe: RegExp, max: number, value: (x: unknown, p: string) => boolean): boolean {
    if (!isObj(v)) return this.fail(path, 'must be an object')
    let ok = true
    const keys = Object.keys(v)
    if (keys.length > max) ok = this.fail(path, `at most ${max} entries`)
    for (const k of keys) {
      if (!keyRe.test(k)) ok = this.fail(`${path}/${k}`, `key must match ${keyRe.source}`)
      ok = value(v[k], `${path}/${k}`) && ok
    }
    return ok
  }

  enumOf(v: unknown, path: string, allowed: readonly string[]): boolean {
    return (typeof v === 'string' && allowed.includes(v)) || this.fail(path, `must be one of ${allowed.join(', ')}`)
  }

  intBetween(v: unknown, path: string, min: number, max: number): boolean {
    return (isInt(v) && v >= min && v <= max) || this.fail(path, `must be an integer ${min}–${max}`)
  }

  briefCopied(v: unknown, path: string): boolean {
    if (!isObj(v)) return this.fail(path, 'must be an object')
    let ok = this.keys(v, path, ['templates', 'month', 'lines'])
    if (Object.hasOwn(v, 'templates')) ok = this.str(v.templates, `${path}/templates`, BRIEF_TEMPLATES_STAMP_RE) && ok
    if (Object.hasOwn(v, 'month')) ok = this.str(v.month, `${path}/month`, BRIEF_MONTH_RE) && ok
    if (Object.hasOwn(v, 'lines')) {
      if (Array.isArray(v.lines) && v.lines.length > BRIEF_MAX_LINES) ok = this.fail(`${path}/lines`, `at most ${BRIEF_MAX_LINES} items`)
      ok =
        this.array(v.lines, `${path}/lines`, (x, p) => {
          if (!isObj(x)) return this.fail(p, 'must be an object')
          let good = this.keys(x, p, ['id', 'v'])
          if (Object.hasOwn(x, 'id')) good = this.str(x.id, `${p}/id`, BRIEF_TEMPLATE_ID_RE) && good
          if (Object.hasOwn(x, 'v')) good = this.str(x.v, `${p}/v`, BRIEF_WORDING_V_RE) && good
          return good
        }) && ok
    }
    return ok
  }

  briefContext(v: unknown, path: string): boolean {
    if (!isObj(v)) return this.fail(path, 'must be an object')
    const has = (k: string): boolean => Object.hasOwn(v, k)
    if (has('removed')) {
      // A set the person removed: only its slot and rev remain (schema `brief_context_removed`).
      let ok = this.keys(v, path, ['slot', 'rev', 'removed'])
      if (has('slot')) ok = this.intBetween(v.slot, `${path}/slot`, 1, BRIEF_MAX_SLOTS) && ok
      if (has('rev')) ok = this.intBetween(v.rev, `${path}/rev`, 0, BRIEF_MAX_REV) && ok
      if (v.removed !== true) ok = this.fail(`${path}/removed`, 'must be true')
      return ok
    }
    let ok = this.keys(v, path, ['slot', 'preset', 'destination', 'tier', 'mode', 'length', 'topics', 'lines_on', 'lines_off', 'rev'], ['form', 'topics_off', 'phrasing', 'copied'])
    if (has('slot')) ok = this.intBetween(v.slot, `${path}/slot`, 1, BRIEF_MAX_SLOTS) && ok
    if (has('preset')) ok = this.enumOf(v.preset, `${path}/preset`, BRIEF_PRESETS) && ok
    if (has('destination')) ok = this.str(v.destination, `${path}/destination`, BRIEF_DESTINATION_RE) && ok
    if (has('form')) ok = this.enumOf(v.form, `${path}/form`, BRIEF_FORMS) && ok
    if (has('tier')) ok = this.enumOf(v.tier, `${path}/tier`, BRIEF_TIERS) && ok
    if (has('mode')) ok = this.enumOf(v.mode, `${path}/mode`, BRIEF_MODES) && ok
    if (has('length')) ok = this.enumOf(v.length, `${path}/length`, BRIEF_LENGTHS) && ok
    if (has('topics')) ok = this.idMap(v.topics, `${path}/topics`, BRIEF_TOPIC_ID_RE, BRIEF_MAX_TOPICS, (x, p) => this.enumOf(x, p, BRIEF_SETTINGS)) && ok
    if (has('topics_off')) ok = this.idList(v.topics_off, `${path}/topics_off`, BRIEF_TOPIC_ID_RE, BRIEF_MAX_TOPICS) && ok
    if (has('lines_on')) ok = this.idList(v.lines_on, `${path}/lines_on`, BRIEF_LINE_KEY_RE, BRIEF_MAX_LINES) && ok
    if (has('lines_off')) ok = this.idList(v.lines_off, `${path}/lines_off`, BRIEF_LINE_KEY_RE, BRIEF_MAX_LINES) && ok
    if (has('phrasing')) ok = this.idMap(v.phrasing, `${path}/phrasing`, BRIEF_LINE_KEY_RE, BRIEF_MAX_PHRASING, (x, p) => this.str(x, p, BRIEF_TEMPLATE_ID_RE)) && ok
    if (has('copied')) ok = this.briefCopied(v.copied, `${path}/copied`) && ok
    if (has('rev')) ok = this.intBetween(v.rev, `${path}/rev`, 0, BRIEF_MAX_REV) && ok
    return ok
  }

  briefFit(v: unknown, path: string): boolean {
    if (!isObj(v)) return this.fail(path, 'must be an object')
    let ok = this.keys(v, path, ['id', 'topic', 'verdict', 'month'])
    if (Object.hasOwn(v, 'id')) ok = this.str(v.id, `${path}/id`, BRIEF_FIT_ID_RE) && ok
    if (Object.hasOwn(v, 'topic')) ok = this.str(v.topic, `${path}/topic`, BRIEF_TOPIC_ID_RE) && ok
    if (Object.hasOwn(v, 'verdict')) ok = this.enumOf(v.verdict, `${path}/verdict`, BRIEF_VERDICTS) && ok
    if (Object.hasOwn(v, 'month')) ok = this.str(v.month, `${path}/month`, BRIEF_MONTH_RE) && ok
    return ok
  }

  /** `brief_prefs` (schema `$defs/brief_prefs`): every string is an enum, an id, a version or a month. */
  briefPrefs(v: unknown, path: string): boolean {
    if (!isObj(v)) return this.fail(path, 'must be an object')
    const has = (k: string): boolean => Object.hasOwn(v, k)
    let ok = this.keys(v, path, ['v', 'topics', 'groups', 'notes_as_of', 'contexts', 'fit_log'], ['last_zones'])
    if (has('v') && v.v !== 1) ok = this.fail(`${path}/v`, 'must be 1')
    if (has('topics')) ok = this.str(v.topics, `${path}/topics`, BRIEF_TOPICS_VERSION_RE) && ok
    if (has('groups')) ok = this.str(v.groups, `${path}/groups`, BRIEF_GROUPS_VERSION_RE) && ok
    if (has('notes_as_of')) ok = this.str(v.notes_as_of, `${path}/notes_as_of`, BRIEF_MONTH_RE) && ok
    if (has('contexts')) {
      if (Array.isArray(v.contexts) && v.contexts.length > BRIEF_MAX_SLOTS) ok = this.fail(`${path}/contexts`, `at most ${BRIEF_MAX_SLOTS} items`)
      ok = this.array(v.contexts, `${path}/contexts`, (x, p) => this.briefContext(x, p)) && ok
    }
    if (has('fit_log')) {
      if (Array.isArray(v.fit_log) && v.fit_log.length > BRIEF_MAX_FIT) ok = this.fail(`${path}/fit_log`, `at most ${BRIEF_MAX_FIT} items`)
      ok = this.array(v.fit_log, `${path}/fit_log`, (x, p) => this.briefFit(x, p)) && ok
    }
    if (has('last_zones')) ok = this.idMap(v.last_zones, `${path}/last_zones`, BRIEF_TOPIC_ID_RE, BRIEF_MAX_ZONES, (x, p) => this.enumOf(x, p, BRIEF_SETTINGS)) && ok
    return ok
  }

  save(v: unknown): boolean {
    if (!isObj(v)) return this.fail('', 'a save file must be a JSON object')
    const req = ['schema_version', 'bank_version', 'anon_id', 'created_utc', 'sessions', 'seen_items', 'seen_families']
    let ok = this.keys(v, '', req, ['$schema', 'posterior_cache', 'brief_prefs', 'sig'])
    const has = (k: string): boolean => Object.hasOwn(v, k)
    if (has('$schema')) ok = this.text(v.$schema, '/$schema', 0, 512) && ok
    if (has('schema_version')) ok = this.str(v.schema_version, '/schema_version', SCHEMA_VERSION_RE) && ok
    if (has('bank_version')) ok = this.str(v.bank_version, '/bank_version', VERSION_TAG_RE) && ok
    if (has('anon_id')) ok = this.str(v.anon_id, '/anon_id', ANON_ID_RE) && ok
    if (has('created_utc')) ok = this.str(v.created_utc, '/created_utc', UTC_SECONDS_RE) && ok
    if (has('sessions')) ok = this.array(v.sessions, '/sessions', (x, p) => this.session(x, p)) && ok
    if (has('seen_items')) ok = this.array(v.seen_items, '/seen_items', (x, p) => this.str(x, p, ITEM_ID_RE, 3, 256)) && ok
    if (has('seen_families')) ok = this.array(v.seen_families, '/seen_families', (x, p) => this.str(x, p, FAMILY_ID_RE, 3, 256)) && ok
    if (has('posterior_cache')) ok = this.posterior(v.posterior_cache, '/posterior_cache') && ok
    if (has('brief_prefs')) ok = this.briefPrefs(v.brief_prefs, '/brief_prefs') && ok
    if (has('sig')) ok = this.sig(v.sig, '/sig') && ok
    return ok
  }
}

/** Validate an already-migrated v1 document against the schema (errors carry JSON-pointer paths). */
export function validateSave(doc: unknown): ValidationResult {
  const c = new Checker()
  return c.save(doc) ? { ok: true, save: doc as SaveFileV1 } : { ok: false, errors: c.errors }
}

/** Like {@link validateSave} but throws a TypeError listing the errors (for app-built saves). */
export function assertValidSave(doc: unknown): SaveFileV1 {
  const r = validateSave(doc)
  if (!r.ok) throw new TypeError(`invalid save file: ${r.errors.slice(0, 5).join('; ')}`)
  return r.save
}

/**
 * Check one session record (`$defs/session`) as it would sit in a file, and throw a TypeError
 * listing the errors if it is invalid. Runs on the caller's raw values, before any JSON copy.
 */
export function assertValidSession(v: unknown, path = '/sessions/0'): SaveSession {
  const c = new Checker()
  if (!c.session(v, path)) throw new TypeError(`invalid session: ${c.errors.slice(0, 5).join('; ')}`)
  return v as SaveSession
}
