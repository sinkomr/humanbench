/**
 * The client of the server (ROADMAP M2.7) against the SQL it calls and the DESIGN text it quotes. The
 * client can be tested only against fakes without a database, so these tests read the migrations and
 * hold the two sides to one contract: every whitelisted RPC is wrapped by the API and by nothing else,
 * the names of the arguments are the SQL's, the kinds, bands and reasons the client knows are the ones
 * the SQL accepts and returns, and the two strings of DESIGN §17.7 that the save screens carry
 * (`anti-coercion`, `mirror`) are the table's, word for word. The database tests (`backend.db.test.ts`)
 * run the same client against the real functions.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COPY } from '../src/brief/copy'
import { ANTI_COERCION, MIRROR_NOTE } from '../src/brief/save-copy'
import { AGE_BANDS, ITEM_PROBLEM_KINDS, createBackendApi } from '../src/backend/api'
import { DONE_REASONS } from '../src/backend/replies'
import { FakeTransport } from '../src/backend/testing'
import { TEST_DEVICE } from '../src/session/bot'
import { REPO_ROOT } from './language-lint'

const MIGRATIONS = join(REPO_ROOT, 'supabase', 'migrations')
const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n')
const design = readFileSync(join(REPO_ROOT, 'docs', 'DESIGN.md'), 'utf8')

interface Rpc {
  readonly args: readonly string[]
  readonly required: readonly string[]
}

/** `create function public.<name>(<args>) returns` for every RPC. */
function rpcs(): Map<string, Rpc> {
  const out = new Map<string, Rpc>()
  for (const m of sql.matchAll(/create function public\.(\w+)\(([\s\S]*?)\)\s*returns/gu)) {
    const args = m[2]!
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a !== '')
      .map((a) => ({ name: a.split(/\s+/u)[0]!, optional: /\bdefault\b/iu.test(a) }))
    out.set(m[1]!, { args: args.map((a) => a.name), required: args.filter((a) => !a.optional).map((a) => a.name) })
  }
  return out
}

describe('the RPCs the API wraps', () => {
  const sqlRpcs = rpcs()

  it('are exactly the ones the migrations expose to the API roles', () => {
    expect([...sqlRpcs.keys()].sort()).toEqual(['delete_my_data', 'finish', 'mirror_get', 'mirror_put', 'next_item', 'report_problem', 'rescore', 'start_session', 'submit', 'submit_survey', 'verify_save'])
  })

  it('send arguments the functions have, and every argument they require', async () => {
    const t = new FakeTransport()
    const api = createBackendApi(t, { sleep: () => Promise.resolve() })
    const save = { schema_version: '1.0.0', bank_version: 'b', anon_id: 'hb_ServerIssuedId1X', created_utc: '2026-10-03T17:20:02Z', sessions: [], seen_items: [], seen_families: [] }
    const TOKEN = 'hbt_ABCDEFGHIJKLMNOPQRSTUV'
    // every optional argument present, then none
    await api.startSession(TEST_DEVICE, save)
    await api.startSession(TEST_DEVICE)
    await api.nextItem(TOKEN, ['MAT'])
    await api.nextItem(TOKEN)
    await api.submit(TOKEN, { itemId: 'i:x', response: '1', rtMs: 5, confidence: 50, clientFlags: { paste: true }, next: true, axes: ['MAT'] })
    await api.submit(TOKEN, { itemId: 'i:x', response: null, rtMs: 5, confidence: null, next: false })
    await api.finish(TOKEN, { paste_events: 0 })
    await api.finish(TOKEN)
    await api.reportProblem(TOKEN, { kind: 'typo', itemId: 'i:x', detail: 'd' })
    await api.reportProblem(TOKEN, { kind: 'notes_requested' })
    await api.submitSurvey(TOKEN, { ageBand: '18-24', englishFirst: true })
    await api.submitSurvey(TOKEN, { ageBand: null, englishFirst: null })
    await api.verifySave(save)
    await api.rescore(save)
    await api.mirrorPut(TOKEN, save, 'phrase')
    await api.mirrorPut(TOKEN, save)
    await api.mirrorGet('hb_ServerIssuedId1X', 'phrase')
    await api.deleteMyData('hb_ServerIssuedId1X', { phrase: 'p', save })
    await api.deleteMyData('hb_ServerIssuedId1X', { phrase: 'p' })
    const seen = new Set<string>()
    for (const c of t.calls) {
      const rpc = sqlRpcs.get(c.fn)
      expect(rpc, c.fn).toBeDefined()
      const sent = Object.keys(JSON.parse(c.body) as object)
      for (const a of sent) expect(rpc!.args, `${c.fn}(${a})`).toContain(a)
      for (const a of rpc!.required) expect(sent, `${c.fn} requires ${a}`).toContain(a)
      seen.add(c.fn)
    }
    expect([...seen].sort()).toEqual([...sqlRpcs.keys()].sort())
    // and every optional argument of every function is used by some call
    for (const [fn, rpc] of sqlRpcs) {
      const used = new Set(t.calls.filter((c) => c.fn === fn).flatMap((c) => Object.keys(JSON.parse(c.body) as object)))
      for (const a of rpc.args) expect(used, `${fn}(${a}) is never sent`).toContain(a)
    }
  })
})

describe('the vocabularies', () => {
  it('report kinds: the five item kinds and the notes request are the ones report_problem accepts', () => {
    const m = /p_kind not in \(([^)]*)\)/u.exec(sql)
    const accepted = [...(m?.[1] ?? '').matchAll(/'(\w+)'/gu)].map((x) => x[1]!)
    expect([...ITEM_PROBLEM_KINDS, 'notes_requested'].sort()).toEqual(accepted.sort())
    expect(accepted).toHaveLength(6)
  })

  it('age bands are the ones submit_survey accepts', () => {
    const m = /p_age_band not in \(([^)]*)\)/u.exec(sql)
    const accepted = [...(m?.[1] ?? '').matchAll(/'([^']+)'/gu)].map((x) => x[1]!)
    expect([...AGE_BANDS]).toEqual(accepted)
  })

  it('reasons for no item are the ones next_item gives', () => {
    const given = new Set([...sql.matchAll(/'done', true, 'reason',\s*'(\w+)'/gu)].map((x) => x[1]!))
    for (const m of sql.matchAll(/case when [\s\S]{0,400}?then '(\w+)' else '(\w+)' end\)/gu)) {
      given.add(m[1]!)
      given.add(m[2]!)
    }
    for (const r of DONE_REASONS) expect([...given], r).toContain(r)
  })

  it('verification reasons are the ones session_verdict gives', () => {
    for (const r of ['unsigned', 'bad_signature', 'unknown_key', 'malformed']) expect(sql, r).toContain(`'${r}'`)
  })
})

describe('DESIGN §17.7 strings on the save screens (AI.26)', () => {
  const row = (key: string): string => {
    const m = new RegExp(`^\\| ${key} \\| (.+) \\| AI\\.[0-9a-z]+ \\|$`, 'mu').exec(design)
    if (m?.[1] === undefined) throw new Error(`no row ${key} in DESIGN §17.7`)
    return m[1]
  }

  it('the anti-coercion line is the table’s, and the notes builder’s', () => {
    expect(ANTI_COERCION).toBe(row('anti-coercion'))
    expect(ANTI_COERCION).toBe(COPY.antiCoercion)
  })

  it('the mirror note is the table’s', () => {
    expect(MIRROR_NOTE).toBe(row('mirror'))
  })
})
