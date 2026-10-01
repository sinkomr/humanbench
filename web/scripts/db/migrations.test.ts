/**
 * The rules M2.1 sets for every migration, checked on the SQL text (no database; `npm test`
 * runs this, `npm run test:db` checks the same things from the catalog):
 *   - every function is created as hb_definer, with search_path pinned to empty;
 *   - every table has RLS enabled;
 *   - nothing is granted to anon or authenticated but EXECUTE on an RPC;
 *   - no migration writes answer keys (CLAUDE.md: no item_keys data in this repo);
 *   - what the migrations hold that mirrors the app (axes, practice priors, recovery words) equals it.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES } from '../../src/engine/axes'
import { RHO_MAX_PRIOR } from '../../src/engine/retest'
import { MIGRATIONS_DIR, readMigrations, type SqlFile } from './sql'

const migrations: SqlFile[] = readMigrations(MIGRATIONS_DIR)
const all = migrations.map((m) => m.sql).join('\n')

/** The SQL with `--` comments removed (and string contents left alone: none of these rules need them). */
const code = (sql: string): string => sql.replace(/--[^\n]*/g, '')

describe('migrations: the set', () => {
  it('has the M2.1 files in order, one concern each', () => {
    expect(migrations.map((m) => m.name)).toEqual([
      '20261001000100_foundation.sql',
      '20261001000200_bank_tables.sql',
      '20261001000300_session_tables.sql',
      '20261001000400_recovery_words.sql',
      '20261001000500_private_functions.sql',
      '20261001000600_rpc_session.sql',
      '20261001000700_rpc_report_survey.sql',
      '20261001000800_rpc_mirror_delete.sql',
      '20261001000900_rpc_rescore.sql',
    ])
  })

  it('opens each file with a comment that cites the task and the requirements', () => {
    for (const m of migrations) expect(m.sql, m.name).toMatch(/^-- M2\.1 \(ROADMAP M2\.1\b[^\n]*(\n--[^\n]*)*?(DESIGN|R-1[12]\.1)/)
  })
})

describe('migrations: functions', () => {
  const functions = migrations.flatMap((m) =>
    [...code(m.sql).matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns\b([\s\S]*?)\bas\s+\$\$/gi)].map((x) => ({ file: m.name, name: x[1]!, header: x[3]!, at: x.index! })),
  )

  it('finds the functions (so the checks below are not vacuous)', () => {
    expect(functions.length).toBeGreaterThan(40)
    expect(functions.filter((f) => f.name.startsWith('public.')).length).toBe(10)
  })

  it('builds no SQL from its arguments: no dynamic EXECUTE (supabase/README.md, pitfall 5)', () => {
    expect(code(all)).not.toMatch(/^\s*execute\s/im)
    expect(code(all)).not.toMatch(/\bset\s+(local\s+)?role\s+(service_role|anon|authenticated|postgres|supabase_admin)\b/i)
  })

  it('pins search_path to empty on every one', () => {
    for (const f of functions) expect(f.header, `${f.file}: ${f.name}`).toMatch(/set\s+search_path\s*=\s*''/i)
  })

  it('creates every function between `set local role hb_definer` and `reset role`', () => {
    for (const m of migrations) {
      const text = code(m.sql)
      const creates = [...text.matchAll(/create\s+(?:or\s+replace\s+)?function\b/gi)].map((x) => x.index!)
      if (creates.length === 0) continue
      const setAt = [...text.matchAll(/set\s+local\s+role\s+hb_definer\s*;/gi)].map((x) => x.index!)
      const resetAt = [...text.matchAll(/reset\s+role\s*;/gi)].map((x) => x.index!)
      expect(setAt.length, m.name).toBe(resetAt.length)
      expect(setAt.length, m.name).toBeGreaterThan(0)
      for (const c of creates) {
        const inside = setAt.some((s, i) => s < c && c < resetAt[i]!)
        expect(inside, `${m.name}: a function is created outside hb_definer's block`).toBe(true)
      }
      // hb_definer may create in `public` only inside the file that needs it
      if (/create\s+function\s+public\./i.test(text)) {
        expect(text, m.name).toMatch(/grant\s+create\s+on\s+schema\s+public\s+to\s+hb_definer\s*;/i)
        expect(text, m.name).toMatch(/revoke\s+create\s+on\s+schema\s+public\s+from\s+hb_definer\s*;/i)
      }
    }
  })

  it('makes exactly the public functions SECURITY DEFINER RPCs, each revoked from everyone and granted to anon and authenticated', () => {
    for (const f of functions.filter((x) => x.name.startsWith('public.'))) {
      expect(f.header, f.name).toMatch(/security\s+definer/i)
      const sig = new RegExp(`(revoke|grant)\\s+(?:all|execute)\\s+on\\s+function\\s+${f.name.replace('.', '\\.')}\\s*\\(`, 'gi')
      const hits = [...code(all).matchAll(sig)].map((x) => x[1]!.toLowerCase())
      expect(hits, f.name).toEqual(['revoke', 'grant'])
    }
    for (const f of functions.filter((x) => x.name.startsWith('hb.'))) {
      expect(code(all), f.name).not.toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${f.name.replace('.', '\\.')}\\b[^;]*\\bto\\s+[^;]*\\b(anon|authenticated|public)\\b`, 'i'))
    }
  })
})

describe('migrations: tables and grants', () => {
  const text = code(all)
  const tables = [...text.matchAll(/create\s+table\s+public\.(\w+)/gi)].map((x) => x[1]!)

  it('enables row level security on every table it creates', () => {
    expect(tables.length).toBe(16)
    for (const t of tables) expect(text, t).toMatch(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, 'i'))
  })

  it('writes no policy for anon, authenticated or PUBLIC', () => {
    for (const p of text.matchAll(/create\s+policy\s+[\w"]+\s+on\s+[\w.]+[\s\S]*?;/gi)) expect(p[0], p[0]).toMatch(/\sto\s+hb_definer\b/i)
    expect(text).not.toMatch(/\bto\s+(anon|authenticated|public)\b[^;]*\busing\b/i)
  })

  it('grants anon and authenticated nothing but EXECUTE on public functions', () => {
    const grants = [...text.matchAll(/\bgrant\b[\s\S]*?;/gi)].map((x) => x[0]).filter((g) => /\bto\s+[^;]*\b(anon|authenticated)\b/i.test(g))
    expect(grants.length).toBeGreaterThan(5)
    for (const g of grants) expect(g, g).toMatch(/^grant\s+execute\s+on\s+function\s+public\./i)
  })

  it('revokes the default grants of the API roles on tables, sequences and functions', () => {
    for (const kind of ['tables', 'sequences', 'functions']) {
      expect(text).toMatch(new RegExp(`alter\\s+default\\s+privileges\\s+for\\s+role\\s+postgres\\s+in\\s+schema\\s+public\\s+revoke\\s+all\\s+on\\s+${kind}\\s+from\\s+anon,\\s*authenticated,\\s*service_role`, 'i'))
    }
    expect(text).toMatch(/alter\s+default\s+privileges\s+for\s+role\s+hb_definer\s+revoke\s+execute\s+on\s+functions\s+from\s+public/i)
  })

  it('has no table or column for the notes (ROADMAP AI.26: "a schema grep finds no notes table")', () => {
    expect(text).not.toMatch(/create\s+table\s+[\w.]*(brief|note|pref)/i)
    for (const col of text.matchAll(/^\s{2}(\w*(?:brief|pref|note)\w*)\s/gim)) expect.fail(`a column named ${col[1]}`)
    // the only mentions of brief_prefs are the checks that keep it out
    for (const m of migrations) for (const line of code(m.sql).split('\n')) if (/brief_prefs/i.test(line)) expect(line, `${m.name}: ${line}`).toMatch(/json_has_key|no_brief_prefs|reject_brief_prefs|brief_prefs_not_accepted|\^brief_prefs\$|Send the data without|Notes settings stay/i)
  })
})

describe('migrations: no key data (CLAUDE.md)', () => {
  it('writes nothing into item_keys: no insert, update, delete or copy against it', () => {
    expect(code(all)).not.toMatch(/\b(insert\s+into|update|delete\s+from|copy|truncate(?:\s+table)?)\s+(?:only\s+)?(?:public\.)?item_keys\b/i)
  })

  it('inserts rows only into app_config and recovery_words', () => {
    const inserted = [...code(all).matchAll(/\binsert\s+into\s+([\w.]+)/gi)].map((x) => x[1]!)
    // (the others are inside function bodies: sessions, exposure_log, responses, flags, ...)
    const topLevel = migrations.filter((m) => /^(\d+)_(bank_tables|recovery_words)\.sql$/.test(m.name)).flatMap((m) => [...code(m.sql).matchAll(/\binsert\s+into\s+([\w.]+)/gi)].map((x) => x[1]!))
    expect(topLevel.sort()).toEqual(['public.app_config', 'public.recovery_words'])
    expect(inserted.length).toBeGreaterThan(topLevel.length)
  })
})

describe('migrations: what mirrors the app', () => {
  it('lists the 17 axes of engine/axes.ts in the axis check', () => {
    const m = /axis text not null check \(axis in \(([^)]*)\)\)/.exec(all)!
    expect([...m[1]!.matchAll(/'([A-Z]+)'/g)].map((x) => x[1])).toEqual([...AXIS_CODES])
  })

  it('seeds the §7.8 practice plateaus of engine/retest.ts and its time constant', () => {
    const rho = /'retest\.rho_max',\s*'(\{[^']*\})'/.exec(all)!
    expect(JSON.parse(rho[1]!)).toEqual({ ...RHO_MAX_PRIOR })
    expect(/'retest\.tau',\s*'([0-9.]+)'/.exec(all)![1]).toBe('1.2')
  })

  it('holds 1,024 recovery words: 4 to 8 lower-case letters, unique, unique first four letters, sorted, idx in order', () => {
    const sql = migrations.find((m) => m.name.endsWith('_recovery_words.sql'))!.sql
    const rows = [...sql.matchAll(/\((\d+), '([a-z]+)'\)/g)].map((x) => [Number(x[1]), x[2]!] as const)
    expect(rows.length).toBe(1024)
    expect(rows.map((r) => r[0])).toEqual(Array.from({ length: 1024 }, (_, i) => i))
    const words = rows.map((r) => r[1])
    for (const w of words) expect(w).toMatch(/^[a-z]{4,8}$/)
    expect(new Set(words).size).toBe(1024)
    expect(new Set(words.map((w) => w.slice(0, 4))).size).toBe(1024)
    expect([...words].sort()).toEqual(words)
  })

  it('keeps the limits of DESIGN §11.2 as settings', () => {
    expect(all).toMatch(/'rate\.sessions_per_day',\s*'5'/)
    expect(all).toMatch(/'session\.max_items',\s*'200'/)
    expect(all).toMatch(/'session\.min_avg_ms',\s*'2000'/)
  })
})

describe('the sources', () => {
  it('carry no secret-shaped value (the wiring test scans too; this checks the new SQL by name)', () => {
    for (const m of migrations) {
      expect(m.sql, m.name).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\./)
      expect(m.sql, m.name).not.toMatch(/service_role_key|secret_key|api[_-]?key\s*[:=]/i)
    }
    expect(readFileSync(new URL('./bank-fixture.ts', import.meta.url), 'utf8')).toMatch(/synthetic item bank[\s\S]*made up[\s*]+at run time/)
  })
})
