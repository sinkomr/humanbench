/**
 * M2.1 (ROADMAP M2.1; DESIGN §12, R-11.1, R-12.1): the schema as the catalog sees it. RLS on every
 * table, nothing granted to anon or authenticated, EXECUTE only for the whitelisted RPCs, every
 * function owned by the restricted role with a pinned search_path, and the settings that mirror the
 * app (axes, retest priors). The behaviour of the RPCs is in rpc-*.db.test.ts.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AXIS_CODES } from '../../src/engine/axes'
import { RHO_MAX_PRIOR } from '../../src/engine/retest'
import { FACET_MIN_ITEMS } from '../../src/viz/facets'
import { AUTHENTICATED, SERVICE_ROLE, type TestDb } from './harness'
import { from } from './rpc-support'
import { exposedSurface, names } from './surface'
import { PERMISSION_DENIED, openTestDb, pgCode, rejectedWith } from './vitest'

let db: TestDb
beforeAll(async () => {
  db = await openTestDb()
})
afterAll(async () => {
  await db.close()
})

const ANON = from('203.0.113.9')

/** The only functions an API role may call (ROADMAP M2.1; M2.4 repeats this as its own acceptance). */
const RPCS = [
  'public.delete_my_data',
  'public.finish',
  'public.mirror_get',
  'public.mirror_put',
  'public.next_item',
  'public.report_problem',
  'public.rescore',
  'public.start_session',
  'public.submit',
  'public.submit_survey',
]

const TABLES = [
  'app_config',
  'calibration_runs',
  'exposure_log',
  'flags',
  'item_exposure',
  'item_families',
  'item_keys',
  'item_parameters',
  'items',
  'mirror',
  'rate_limits',
  'rate_salts',
  'recovery_words',
  'responses',
  'sessions',
  'survey',
]

/** Functions of public and hb that PUBLIC may execute (a NULL proacl is PostgreSQL's default: PUBLIC may). */
async function publicExecutableFunctions(): Promise<string[]> {
  const { rows } = await db.owner.query<{ name: string }>(
    `select n.nspname || '.' || p.proname as name
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'hb')
        and coalesce(exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'), true)
      order by 1`,
  )
  return rows.map((r) => r.name)
}

describe('tables', () => {
  it('has the DESIGN §12 tables and the mirror, rate, survey and exposure-log tables, nothing else', async () => {
    const { rows } = await db.owner.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') order by 1`,
    )
    expect(rows.map((r) => r.relname)).toEqual(TABLES)
  })

  it('enables RLS on every table, in every schema the migrations touch', async () => {
    const { rows } = await db.owner.query<{ nspname: string; relname: string; relrowsecurity: boolean }>(
      `select n.nspname, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('public', 'hb') and c.relkind in ('r', 'p') order by 1, 2`,
    )
    expect(rows.length).toBe(TABLES.length)
    for (const r of rows) expect(r.relrowsecurity, `${r.nspname}.${r.relname}`).toBe(true)
  })

  it('writes no policy for anon, authenticated or PUBLIC: the only role with policies is hb_definer', async () => {
    const { rows } = await db.owner.query<{ tablename: string; policyname: string; roles: string[] }>(`select tablename, policyname, roles::text[] as roles from pg_policies where schemaname = 'public'`)
    expect(rows.length).toBeGreaterThan(10)
    for (const r of rows) expect(r.roles, `${r.tablename}.${r.policyname}`).toEqual(['hb_definer'])
    // every table has at least one (hb_definer reads it), except the ones nothing reads through an RPC
    const covered = new Set(rows.map((r) => r.tablename))
    for (const t of TABLES.filter((t) => t !== 'calibration_runs')) expect(covered.has(t), t).toBe(true)
  })

  it('gives anon and authenticated no table, no sequence and no function but the RPCs', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const surface = await exposedSurface(db, role, ['public', 'hb'])
      expect(surface.tables, role).toEqual([])
      expect(surface.sequences, role).toEqual([])
      expect(names(surface.functions), role).toEqual(RPCS)
    }
  })

  it('lets service_role do what the bank pipeline needs and no more', async () => {
    const surface = await exposedSurface(db, 'service_role')
    const byTable = Object.fromEntries(surface.tables.map((t) => [t.name, t.privileges.join(',')]))
    expect(byTable).toEqual({
      app_config: 'select,insert,update',
      calibration_runs: 'select,insert,update',
      exposure_log: 'select',
      flags: 'select,insert,update',
      item_exposure: 'select',
      item_families: 'select,insert,update',
      item_keys: 'select,insert,update',
      item_parameters: 'select,insert,update',
      items: 'select,insert,update',
      responses: 'select',
      sessions: 'select',
      survey: 'select',
    })
    expect(surface.sequences.map((s) => s.name)).toEqual(['calibration_runs_run_id_seq', 'flags_flag_id_seq'])
    // Nothing in the mirror or the rate tables, and no RPC.
    expect(names(surface.functions)).toEqual([])
    // Its only reach into hb is the pure check the items CHECK constraint runs.
    expect(names((await exposedSurface(db, 'service_role', ['hb'])).functions)).toEqual(['hb.no_key_fields'])
  })

  it('gives hb_definer the select / insert / update it needs, and not DELETE on the bank, DDL, or any bank write', async () => {
    const rows = (
      await db.owner.query<{ relname: string; privs: string[] }>(
        `select c.relname,
                array_remove(array[
                  case when has_table_privilege('hb_definer', c.oid, 'SELECT') then 'select' end,
                  case when has_table_privilege('hb_definer', c.oid, 'INSERT') then 'insert' end,
                  case when has_table_privilege('hb_definer', c.oid, 'UPDATE') then 'update' end,
                  case when has_table_privilege('hb_definer', c.oid, 'DELETE') then 'delete' end,
                  case when has_table_privilege('hb_definer', c.oid, 'TRUNCATE') then 'truncate' end
                ], null) as privs
           from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`,
      )
    ).rows
    const privs = Object.fromEntries(rows.map((r) => [r.relname, r.privs.join(',')]))
    for (const bank of ['item_families', 'items', 'item_keys', 'item_parameters', 'app_config', 'recovery_words']) expect(privs[bank], bank).toBe('select')
    expect(privs.calibration_runs).toBe('')
    expect(privs.sessions).toBe('select,insert,update,delete')
    expect(privs.mirror).toBe('select,insert,update,delete')
    for (const t of Object.keys(privs)) expect(privs[t]!.includes('truncate'), t).toBe(false)
    // and it does not own anything it could redefine
    const owned = await db.owner.query(`select c.relname from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'hb_definer'`)
    expect(owned.rows).toEqual([])
    expect((await db.owner.query(`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication from pg_roles where rolname = 'hb_definer'`)).rows).toEqual([
      { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: false, rolreplication: false },
    ])
  })

  it('refuses a plain select from anon and authenticated on every table with permission denied', async () => {
    for (const t of TABLES) {
      expect(await rejectedWith(db.query(ANON, `select * from public.${t} limit 1`)), `anon ${t}`).toBe(PERMISSION_DENIED)
      expect(await rejectedWith(db.query(AUTHENTICATED, `select * from public.${t} limit 1`)), `authenticated ${t}`).toBe(PERMISSION_DENIED)
    }
  })
})

describe('functions', () => {
  it('are all owned by hb_definer with search_path pinned to empty; RPCs are SECURITY DEFINER, helpers are not (bar the key-field check that bank writes run)', async () => {
    const { rows } = await db.owner.query<{ schema: string; name: string; definer: boolean; owner: string; config: string[] | null; kind: string }>(
      `select n.nspname as schema, p.proname as name, p.prosecdef as definer, r.rolname as owner, p.proconfig as config, p.prokind as kind
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
        where n.nspname in ('public', 'hb') order by 1, 2`,
    )
    expect(rows.length).toBeGreaterThan(30)
    for (const f of rows) {
      const id = `${f.schema}.${f.name}`
      expect(f.owner, id).toBe('hb_definer')
      expect(f.config, id).toEqual(['search_path=""'])
      expect(f.definer, id).toBe(f.schema === 'public' || id === 'hb.no_key_fields')
      expect(f.kind, id).toBe('f')
    }
    expect(rows.filter((f) => f.schema === 'public').map((f) => `public.${f.name}`)).toEqual(RPCS)
  })

  it('revokes EXECUTE from PUBLIC on every function (a new function is not callable by default)', async () => {
    expect(await publicExecutableFunctions()).toEqual([])
  })

  it('does not let an API role call a helper, or reach the hb schema', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const ctx = role === 'anon' ? ANON : AUTHENTICATED
      expect(await rejectedWith(db.query(ctx, `select hb.cfg('rate.sessions_per_day')`)), role).toBe(PERMISSION_DENIED)
      expect(await rejectedWith(db.query(ctx, `select hb.fail(400, 'x')`)), role).toBe(PERMISSION_DENIED)
    }
    expect(await rejectedWith(db.query(SERVICE_ROLE, `select hb.cfg('rate.sessions_per_day')`))).toBe(PERMISSION_DENIED)
  })

  it('leaves a function that a later migration creates as postgres, forgetting hb_definer, callable by no API role (fail closed)', async () => {
    // as `postgres` creates it, in public: the migration role's default privileges grant no API role and not PUBLIC either.
    await db.owner.query(`create table public.t_later (x int)`)
    await db.owner.query(`create function public.t_later_fn() returns int language sql as $$ select 1 $$`)
    try {
      const anonTables = (await exposedSurface(db, 'anon')).tables.map((t) => t.name)
      expect(anonTables).not.toContain('t_later')
      expect(await rejectedWith(db.query(ANON, `select * from public.t_later`))).toBe(PERMISSION_DENIED)
      for (const role of ['anon', 'authenticated', 'service_role'] as const) {
        const { rows } = await db.owner.query<{ can: boolean }>(`select has_function_privilege($1, 'public.t_later_fn()', 'execute') as can`, [role])
        expect(rows[0]!.can, role).toBe(false)
      }
      expect(await rejectedWith(db.query(ANON, `select public.t_later_fn()`))).toBe(PERMISSION_DENIED)
      expect(await publicExecutableFunctions()).not.toContain('public.t_later_fn')
    } finally {
      await db.owner.query(`drop function public.t_later_fn()`)
      await db.owner.query(`drop table public.t_later`)
    }
  })

  it('has a catalog check that would see a function left executable by PUBLIC (the check itself is tested)', async () => {
    await db.owner.query(`create function public.t_open_fn() returns int language sql as $$ select 1 $$`)
    try {
      await db.owner.query(`grant execute on function public.t_open_fn() to public`)
      expect(await publicExecutableFunctions()).toEqual(['public.t_open_fn'])
    } finally {
      await db.owner.query(`drop function public.t_open_fn()`)
    }
    expect(await publicExecutableFunctions()).toEqual([])
  })
})

describe('settings that mirror the app', () => {
  it('has the 17 axes of engine/axes.ts as the only values of item_families.axis', async () => {
    const { rows } = await db.owner.query<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c where c.conrelid = 'public.item_families'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%axis%'`,
    )
    expect(rows.length).toBe(1)
    const listed = [...rows[0]!.def.matchAll(/'([A-Z]{2,3})'::text/g)].map((m) => m[1])
    expect(listed).toEqual([...AXIS_CODES])
  })

  it('has the §7.8 practice-gain plateaus of engine/retest.ts (RHO_MAX_PRIOR) and its time constant', async () => {
    const { rows } = await db.owner.query<{ key: string; value: unknown }>(`select key, value from public.app_config where key in ('retest.rho_max', 'retest.tau')`)
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(cfg['retest.rho_max']).toEqual({ ...RHO_MAX_PRIOR })
    expect(cfg['retest.tau']).toBe(1.2)
  })

  it('keeps the limits of DESIGN §11.2 as settings: 5 sessions a day, 200 items, 2 s per item', async () => {
    const { rows } = await db.owner.query<{ key: string; value: unknown }>(`select key, value from public.app_config`)
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(cfg['rate.sessions_per_day']).toBe(5)
    expect(cfg['session.max_items']).toBe(200)
    expect(cfg['session.min_avg_ms']).toBe(2000)
  })

  it('ships rescore withholding and rounding what would read out a single answer (R-11.1, DESIGN §10; owner decision 2026-10-01)', async () => {
    const { rows } = await db.owner.query<{ key: string; value: unknown }>(`select key, value from public.app_config`)
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    // an axis from 5 scored items, a facet from the 5 of A12 (the app's own FACET_MIN_ITEMS)
    expect(cfg['rescore.min_axis_items']).toBe(5)
    expect(cfg['rescore.min_facet_items']).toBe(FACET_MIN_ITEMS)
    // the mean to a tenth, the sd up to a twentieth of an SD unit
    expect(cfg['rescore.mean_step']).toBe(0.1)
    expect(cfg['rescore.sd_step']).toBe(0.05)
    // 5 sessions a day per address leave room for 20 calls and, per anon_id, 10
    expect(cfg['rate.rescores_per_day']).toBe(20)
    expect(cfg['rate.rescores_per_anon_day']).toBe(10)
    // and the switch that put the verdict of each answer into the finish reply does not exist
    expect(Object.keys(cfg).filter((k) => /include_correct|verdict/.test(k))).toEqual([])
  })
})

describe('item_families.sibling_group (ROADMAP A11, A18)', () => {
  const fam = (id: string, extra = ''): string =>
    `insert into public.item_families (family_id, ${extra ? 'sibling_group, ' : ''}axis, source, license, created_by) values ('${id}', ${extra ? `'${extra}', ` : ''}'QR', '{}', 'CC0', 'test:schema') returning sibling_group`

  it('defaults to the family_id, whoever inserts, and keeps an explicit group', async () => {
    const owner = await db.owner.query(fam('f:tst:aaaaaaaaaaaa'))
    expect(owner.rows).toEqual([{ sibling_group: 'f:tst:aaaaaaaaaaaa' }])
    const svc = await db.query(SERVICE_ROLE, fam('f:tst:bbbbbbbbbbbb'))
    expect(svc.rows).toEqual([{ sibling_group: 'f:tst:bbbbbbbbbbbb' }])
    const grouped = await db.owner.query(fam('f:tst:cccccccccccc', 'g:tst:template_one'))
    expect(grouped.rows).toEqual([{ sibling_group: 'g:tst:template_one' }])
  })

  it('is never null, and takes only a family id or g:<family>:<label>', async () => {
    expect((await db.owner.query(`update public.item_families set sibling_group = null where family_id = 'f:tst:cccccccccccc' returning sibling_group`)).rows).toEqual([{ sibling_group: 'f:tst:cccccccccccc' }])
    expect(pgCode(await db.owner.query(fam('f:tst:dddddddddddd', 'not a group')).catch((e: unknown) => e))).toBe('23514')
  })

  it('carries the AI.2 tag columns with their defaults', async () => {
    const { rows } = await db.owner.query(`select topic, curriculum_level, notation, ladder_probe, practice_only from public.item_families where family_id = 'f:tst:aaaaaaaaaaaa'`)
    expect(rows).toEqual([{ topic: null, curriculum_level: null, notation: [], ladder_probe: false, practice_only: false }])
  })
})

describe('items.payload (R-11.1)', () => {
  const insert = (payload: unknown): Promise<unknown> =>
    db.query(
      SERVICE_ROLE,
      `insert into public.items (item_id, family_id, item_type, payload, verification, provenance) values ('i:tst:pl:' || floor(random() * 1e9)::text, 'f:tst:aaaaaaaaaaaa', 'mc', $1::jsonb, '{}', '{}')`,
      [JSON.stringify(payload)],
    )

  it('takes a stem, media and options', async () => {
    await expect(insert({ stem: 'Test', media: { renderer: 'test', cells: [[0, 1]] }, options: ['A', 'B'] })).resolves.toBeDefined()
  })

  it('refuses a payload with any other top-level field', async () => {
    expect(pgCode(await insert({ stem: 'x', verification: {} }).catch((e: unknown) => e))).toBe('23514')
  })

  it.each([['key'], ['Answer'], ['correct'], ['solutions'], ['rationale'], ['tolerance'], ['option_weights']])('refuses a payload with a field named %s, however deep', async (name) => {
    expect(pgCode(await insert({ stem: 'x', media: { cells: [{ deep: { [name]: 1 } }] } }).catch((e: unknown) => e))).toBe('23514')
  })
})

describe('recovery words', () => {
  it('is 1,024 plain lower-case words, 4 to 8 letters, each first four letters unique, in order', async () => {
    const { rows } = await db.owner.query<{ idx: number; word: string }>(`select idx, word from public.recovery_words order by idx`)
    expect(rows.length).toBe(1024)
    expect(rows.map((r) => r.idx)).toEqual(Array.from({ length: 1024 }, (_, i) => i))
    const words = rows.map((r) => r.word)
    expect(new Set(words).size).toBe(1024)
    expect(new Set(words.map((w) => w.slice(0, 4))).size).toBe(1024)
    for (const w of words) expect(w).toMatch(/^[a-z]{4,8}$/)
    expect([...words].sort()).toEqual(words)
  })
})

// ------------------------------------------------------------------------------------ columns

const REPO = fileURLToPath(new URL('../../../', import.meta.url))

/** Splits `text` at commas outside parentheses. */
function topLevelCommas(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(from, i))
      from = i + 1
    }
  }
  parts.push(text.slice(from))
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

/** table -> [column, declared type] from the SQL block of DESIGN §12. */
function designTables(): Map<string, [string, string][]> {
  const design = readFileSync(join(REPO, 'docs/DESIGN.md'), 'utf8')
  const section = design.slice(design.indexOf('## 12. Data model'))
  const block = /```sql\n([\s\S]*?)```/.exec(section)![1]!
  const tables = new Map<string, [string, string][]>()
  for (const m of block.matchAll(/create table (\w+) \(([\s\S]*?)\);/g)) {
    const cols: [string, string][] = []
    for (const part of topLevelCommas(m[2]!)) {
      const first = part.split(/\s+/)[0]!
      if (['primary', 'check', 'unique', 'foreign', 'constraint'].includes(first)) continue
      cols.push([first, part.split(/\s+/)[1]!.replace(/\(.*$/, '')])
    }
    tables.set(m[1]!, cols)
  }
  return tables
}

/** information_schema data_type(s) a declared SQL type may come out as. */
const DATA_TYPES: Record<string, string[]> = {
  text: ['text'],
  int: ['integer'],
  integer: ['integer'],
  smallint: ['smallint'],
  bigint: ['bigint'],
  bigserial: ['bigint'],
  boolean: ['boolean'],
  bool: ['boolean'],
  jsonb: ['jsonb'],
  timestamptz: ['timestamp with time zone'],
  char: ['character'],
  real: ['real', 'double precision'], // item_parameters uses double precision on purpose (migration header)
  'text[]': ['ARRAY'],
}

async function columnsOf(table: string): Promise<Map<string, string>> {
  const { rows } = await db.owner.query<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [table],
  )
  return new Map(rows.map((r) => [r.column_name, r.data_type]))
}

describe('the columns DESIGN §12 and the bank name', () => {
  it('has every table and column of the DESIGN §12 SQL block, with the declared type', async () => {
    const tables = designTables()
    expect([...tables.keys()].sort()).toEqual(['calibration_runs', 'flags', 'item_families', 'item_keys', 'item_parameters', 'items', 'responses', 'sessions'])
    for (const [table, cols] of tables) {
      const have = await columnsOf(table)
      for (const [col, type] of cols) {
        expect(have.has(col), `${table}.${col}`).toBe(true)
        expect(DATA_TYPES[type] ?? [type], `${table}.${col} (${type})`).toContain(have.get(col))
      }
    }
  })

  it('has the columns the bank routes its records to, which §12 has no column for (hb.items.rows, AI.2, A11)', async () => {
    const fam = await columnsOf('item_families')
    for (const c of ['sibling_group', 'topic', 'curriculum_level', 'notation', 'ladder_probe', 'practice_only']) expect(fam.has(c), `item_families.${c}`).toBe(true)
    expect((await columnsOf('items')).has('server_tags')).toBe(true)
  })

  const bankPush = join(REPO, '..', 'humanbench-bank', 'src', 'hb', 'load', 'push.py')
  it.skipIf(!existsSync(bankPush))('has every column of the bank push COLUMNS table (bank repo next door), with a compatible type', async () => {
    const text = readFileSync(bankPush, 'utf8')
    const block = /COLUMNS:[^=]*= \{([\s\S]*?)\n\}/.exec(text)![1]!
    const tables = [...block.matchAll(/"(\w+)": \(([\s\S]*?)\n    \),/g)]
    expect(tables.map((t) => t[1])).toEqual(['item_families', 'items', 'item_keys', 'item_parameters'])
    for (const t of tables) {
      const have = await columnsOf(t[1]!)
      const cols = [...t[2]!.matchAll(/\("(\w+)", "([^"]+)"\)/g)]
      expect(cols.length).toBeGreaterThan(4)
      for (const [, col, type] of cols) {
        expect(have.has(col!), `${t[1]}.${col}`).toBe(true)
        // the bank types a value as text where §12 has char(1) (gold_tier): a text value assigns to it
        const accepted = type === 'text' ? ['text', 'character'] : (DATA_TYPES[type!] ?? [type!])
        expect(accepted, `${t[1]}.${col} (${type})`).toContain(have.get(col!))
      }
    }
  })
})
