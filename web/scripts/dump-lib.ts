/**
 * Library behind `npm run dump:families` (ROADMAP A1, A17): dump ≥ 1,000 TS instances of a
 * procedural family as JSON for the bank's Python cross-check (`hb.gen.base.load_ts_dump`,
 * `golden/ts_dumps/<family>.json`, 0 disagreements required).
 *
 * Usage (paths are relative to the directory you run npm from):
 *
 *   npm run dump:families -- --family <name> [--n 1000] (--out <file> | --bank)
 *   npm run dump:families -- --module <path/to/family/index.ts> [--family <name>] [--n 1000] (--out <file> | --bank)
 *   npm run dump:families -- --all [--module <path>] [--n 1000] (--out-dir <dir> | --bank)
 *
 * `--family` resolves a name in `src/tasks/registry.ts`; `--module` loads an unregistered family
 * module and picks its exported family (by `--family` name if it exports several). `--bank` writes
 * `<bank>/golden/ts_dumps/<family>.json`, where `<bank>` is `$HB_BANK_DIR` or the sibling
 * `humanbench-bank` checkout next to this repo. Seeds are `dump-<i>` for i < n. Every instance
 * must pass `validateItemInstance` and the family's `verify()` before anything is written.
 *
 * Output: `{"family", "generator_version", "count", "items": [ItemInstance JSON]}` with one
 * canonical-JSON item per line (stable diffs).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateItemInstance, type AnyFamily, type ItemInstance } from '../src/tasks/family'
import { canonicalJson } from '../src/tasks/ids'
import { FAMILIES } from '../src/tasks/registry'

/** Seeds of dumped instances: `dump-<i>`. */
export const DUMP_SEED_PREFIX = 'dump-'
/** Default instance count (A1: the bank cross-checks ≥ 1,000). */
export const DEFAULT_DUMP_N = 1000

/** The public repo root (this file is web/scripts/dump-lib.ts). */
export const PUB_ROOT = fileURLToPath(new URL('../../', import.meta.url))

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export interface DumpArgs {
  readonly family?: string
  readonly module?: string
  readonly n: number
  readonly out?: string
  readonly outDir?: string
  readonly bank: boolean
  readonly all: boolean
}

export interface FamilyDump {
  readonly family: string
  readonly generator_version: string
  readonly count: number
  readonly items: readonly ItemInstance<object, object>[]
}

export const USAGE = `usage:
  npm run dump:families -- --family <name> [--n ${DEFAULT_DUMP_N}] (--out <file> | --bank)
  npm run dump:families -- --module <family/index.ts> [--family <name>] [--n ${DEFAULT_DUMP_N}] (--out <file> | --bank)
  npm run dump:families -- --all [--module <path>] [--n ${DEFAULT_DUMP_N}] (--out-dir <dir> | --bank)`

/** Parse CLI arguments (`--key value` or `--key=value`); throws a {@link UsageError}. */
export function parseDumpArgs(argv: readonly string[]): DumpArgs {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  const VALUED = new Set(['family', 'module', 'n', 'out', 'out-dir'])
  const FLAGS = new Set(['bank', 'all'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === '--') continue
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(arg)
    if (!m) throw new UsageError(`unexpected argument ${JSON.stringify(arg)}`)
    const name = m[1] as string
    if (FLAGS.has(name)) {
      if (m[2] !== undefined) throw new UsageError(`--${name} takes no value`)
      flags.add(name)
    } else if (VALUED.has(name)) {
      let v = m[2]
      if (v === undefined && argv[i + 1] !== undefined && !(argv[i + 1] as string).startsWith('--')) v = argv[++i]
      if (v === undefined || v === '') throw new UsageError(`--${name} needs a value`)
      if (values.has(name)) throw new UsageError(`--${name} given twice`)
      values.set(name, v)
    } else {
      throw new UsageError(`unknown option --${name}`)
    }
  }
  const nRaw = values.get('n')
  const n = nRaw === undefined ? DEFAULT_DUMP_N : Number(nRaw)
  if (!(Number.isSafeInteger(n) && n >= 1)) throw new UsageError(`--n must be a positive integer, got ${nRaw}`)
  const args: DumpArgs = {
    n,
    bank: flags.has('bank'),
    all: flags.has('all'),
    ...(values.has('family') ? { family: values.get('family') as string } : {}),
    ...(values.has('module') ? { module: values.get('module') as string } : {}),
    ...(values.has('out') ? { out: values.get('out') as string } : {}),
    ...(values.has('out-dir') ? { outDir: values.get('out-dir') as string } : {}),
  }
  const targets = [args.out !== undefined, args.outDir !== undefined, args.bank].filter(Boolean).length
  if (targets !== 1) throw new UsageError('give exactly one of --out, --out-dir, --bank')
  if (args.all) {
    if (args.family !== undefined) throw new UsageError('--all and --family are exclusive')
    if (args.out !== undefined) throw new UsageError('--all writes one file per family: use --out-dir or --bank')
  } else {
    if (args.family === undefined && args.module === undefined) throw new UsageError('give --family, --module or --all')
    if (args.outDir !== undefined) throw new UsageError('--out-dir needs --all; use --out for one family')
  }
  return args
}

/** Duck-typed check that a module export is a procedural family. */
export function isProceduralFamily(v: unknown): v is AnyFamily {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  return (
    typeof f.name === 'string' &&
    typeof f.generatorVersion === 'string' &&
    typeof f.generate === 'function' &&
    typeof f.verify === 'function' &&
    typeof f.score === 'function' &&
    typeof f.familyIdOf === 'function'
  )
}

/** Every distinct family exported by the module at `path` (named exports and default). */
export async function familiesFromModule(path: string): Promise<AnyFamily[]> {
  if (!existsSync(path)) throw new UsageError(`module not found: ${path}`)
  const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>
  const found: AnyFamily[] = []
  for (const v of Object.values(mod)) if (isProceduralFamily(v) && !found.includes(v)) found.push(v)
  if (found.length === 0) throw new UsageError(`no procedural family exported by ${path}`)
  return found
}

/**
 * Generate, validate and verify seeds `dump-0 … dump-(n−1)`; throws listing the failures. Each
 * instance must also survive the JSON round trip, so the canonical lines written by
 * {@link serializeDump} are exactly what `JSON.stringify` (and the bank's loader) see.
 */
export function buildDump(family: AnyFamily, n: number): FamilyDump {
  const items: ItemInstance<object, object>[] = []
  const failures: string[] = []
  for (let i = 0; i < n && failures.length < 20; i++) {
    const seed = `${DUMP_SEED_PREFIX}${i}`
    try {
      const item = family.generate(seed)
      const problems = validateItemInstance(item, family)
      if (problems.length > 0) failures.push(`${seed}: ${problems.join('; ')}`)
      else if (canonicalJson(JSON.parse(JSON.stringify(item))) !== canonicalJson(item)) {
        failures.push(`${seed}: the JSON round trip changes the item`)
      } else {
        const v = family.verify(item)
        if (!v.ok) failures.push(`${seed}: verify failed: ${v.reason}`)
        else items.push(item)
      }
    } catch (e) {
      failures.push(`${seed}: threw ${String(e)}`)
    }
  }
  if (failures.length > 0) throw new Error(`family ${family.name}: refusing to dump invalid instances:\n  ${failures.join('\n  ')}`)
  return { family: family.name, generator_version: family.generatorVersion, count: items.length, items }
}

/** Dump JSON: header fields, then one canonical-JSON item per line. */
export function serializeDump(dump: FamilyDump): string {
  const head = `{"family":${JSON.stringify(dump.family)},"generator_version":${JSON.stringify(dump.generator_version)},"count":${dump.count},"items":[`
  return `${head}\n${dump.items.map((it) => canonicalJson(it)).join(',\n')}\n]}\n`
}

/** The header keys of a dump, in order (the bank's `DUMP_HEAD_KEYS` too). */
export const DUMP_HEAD_KEYS = ['family', 'generator_version', 'count', 'items'] as const

/**
 * Why the dump text `text` is not what `dump:families` writes for `family` now (the A17
 * staleness check; empty when it is current): the header keys in order, the family name, the
 * generator_version, `count` equal to the number of items and ≥ `minCount` (A1: ≥ 1,000), the
 * seeds `dump-0 … dump-(count−1)` in order, every item equal to `family.generate(seed)` and,
 * last, the exact bytes {@link serializeDump} writes. Only the first differing item is reported.
 */
export function dumpDrift(text: string, family: AnyFamily, minCount: number = DEFAULT_DUMP_N): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return [`not JSON: ${e instanceof Error ? e.message : String(e)}`]
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return ['not a dump object']
  const head = parsed as Record<string, unknown>
  const keys = Object.keys(head)
  if (keys.join() !== DUMP_HEAD_KEYS.join()) return [`header keys [${keys.join(', ')}] ≠ [${DUMP_HEAD_KEYS.join(', ')}]`]
  const problems: string[] = []
  if (head.family !== family.name) problems.push(`family ${JSON.stringify(head.family)} ≠ ${JSON.stringify(family.name)}`)
  if (head.generator_version !== family.generatorVersion) {
    problems.push(`generator_version ${JSON.stringify(head.generator_version)} ≠ ${JSON.stringify(family.generatorVersion)}`)
  }
  if (!Array.isArray(head.items)) return [...problems, 'items is not an array']
  const items = head.items as ItemInstance<object, object>[]
  if (head.count !== items.length) problems.push(`count ${JSON.stringify(head.count)} ≠ ${items.length} items`)
  if (items.length < minCount) problems.push(`${items.length} items < ${minCount} (A1)`)
  if (problems.length > 0) return problems
  for (const [i, it] of items.entries()) {
    const seed = `${DUMP_SEED_PREFIX}${i}`
    const got: unknown = typeof it === 'object' && it !== null ? it.seed : undefined
    if (got !== seed) return [`item ${i}: seed ${JSON.stringify(got)} ≠ ${JSON.stringify(seed)} (seeds run ${DUMP_SEED_PREFIX}0, ${DUMP_SEED_PREFIX}1, … in order)`]
    if (canonicalJson(it) !== canonicalJson(family.generate(seed))) return [`item ${i} (${seed}) differs from the generator`]
  }
  const want = serializeDump({ family: family.name, generator_version: family.generatorVersion, count: items.length, items })
  if (text !== want) return ['the items match, but the text is not in the dump format (a header line, then one canonical-JSON item per line)']
  return []
}

/** `$HB_BANK_DIR/golden/ts_dumps`, or the sibling bank checkout's `golden/ts_dumps` (A17). */
export function bankDumpsDir(env: NodeJS.ProcessEnv = process.env): string {
  const bank = env.HB_BANK_DIR ? resolve(env.HB_BANK_DIR) : resolve(PUB_ROOT, '..', 'humanbench-bank')
  return join(bank, 'golden', 'ts_dumps')
}

export interface MainIo {
  /** Directory relative paths resolve against (npm sets INIT_CWD to where npm was run). */
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly log: (line: string) => void
  readonly error: (line: string) => void
}

const defaultIo = (): MainIo => ({
  cwd: process.env.INIT_CWD ?? process.cwd(),
  env: process.env,
  log: (l) => console.log(l),
  error: (l) => console.error(l),
})

/** CLI entry: returns the process exit code (0 ok, 1 failure, 2 usage error). */
export async function main(argv: readonly string[], io: MainIo = defaultIo()): Promise<number> {
  let args: DumpArgs
  try {
    args = parseDumpArgs(argv)
  } catch (e) {
    io.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`)
    return 2
  }
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(io.cwd, p))
  try {
    let bankDir: string | undefined
    if (args.bank) {
      bankDir = bankDumpsDir(io.env)
      if (!existsSync(bankDir)) {
        throw new UsageError(`bank dumps directory not found: ${bankDir} (check out humanbench-bank next to this repo, set HB_BANK_DIR, or use --out)`)
      }
    }
    let families: AnyFamily[]
    if (args.module !== undefined) {
      const found = await familiesFromModule(abs(args.module))
      if (args.all) families = found
      else if (args.family !== undefined) {
        const f = found.find((x) => x.name === args.family)
        if (!f) throw new UsageError(`module exports no family named ${args.family} (found: ${found.map((x) => x.name).join(', ')})`)
        families = [f]
      } else if (found.length === 1) families = found
      else throw new UsageError(`module exports several families (${found.map((x) => x.name).join(', ')}); pick one with --family`)
    } else if (args.all) {
      families = Object.values(FAMILIES)
      if (families.length === 0) io.log('registry is empty: nothing to dump')
    } else {
      const name = args.family as string
      const f = Object.hasOwn(FAMILIES, name) ? FAMILIES[name] : undefined
      if (!f) {
        const known = Object.keys(FAMILIES)
        throw new UsageError(
          `no registered family ${JSON.stringify(name)} (registered: ${known.length > 0 ? known.join(', ') : 'none'}); use --module for an unregistered family`,
        )
      }
      families = [f]
    }

    for (const family of families) {
      const out =
        args.out !== undefined
          ? abs(args.out)
          : join(bankDir ?? abs(args.outDir as string), `${family.name}.json`)
      const dump = buildDump(family, args.n)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, serializeDump(dump))
      io.log(`wrote ${dump.count} ${family.name} ${family.generatorVersion} instances to ${out}`)
    }
    return 0
  } catch (e) {
    if (e instanceof UsageError) {
      io.error(`${e.message}\n${USAGE}`)
      return 2
    }
    io.error(e instanceof Error ? e.message : String(e))
    return 1
  }
}
