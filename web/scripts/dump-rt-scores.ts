/**
 * Write the RT scoring parity dumps (`src/tasks/rt/synthetic.ts`) for the bank (M1.10, M1.F2;
 * A1, A17): one per RT block family, `<family>_scores.json` beside its item dump
 * `<family>.json` (`rt_simple`, `rt_choice4`). Run from `web/`:
 *
 *   npx tsx scripts/dump-rt-scores.ts [--n 1000] (--out-dir <dir> | --bank)
 *
 * `--bank` writes into `<bank>/golden/ts_dumps/` (use the same `--n` as the item dumps; `<bank>`
 * is `$HB_BANK_DIR` or the sibling `humanbench-bank` checkout, as for `npm run dump:families`).
 * A relative `--out-dir` resolves against the directory npm/npx ran in. Importing this module
 * writes nothing; only running it as the entry script does.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RT_FAMILY_LIST } from '../src/tasks/rt'
import { buildRtScoreDump, rtScoreDumpFile, serializeRtScoreDump } from '../src/tasks/rt/synthetic'
import { DEFAULT_DUMP_N, UsageError, bankDumpsDir } from './dump-lib'

export const RT_SCORES_USAGE = `usage: npx tsx scripts/dump-rt-scores.ts [--n ${DEFAULT_DUMP_N}] (--out-dir <dir> | --bank)`

export interface RtScoresArgs {
  readonly n: number
  readonly outDir?: string
  readonly bank: boolean
}

/** Parse `--n <k>`, `--out-dir <dir>`, `--bank` (exactly one of the last two); throws a {@link UsageError}. */
export function parseRtScoresArgs(argv: readonly string[]): RtScoresArgs {
  let n = DEFAULT_DUMP_N
  let outDir: string | undefined
  let bank = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--') continue
    if (a === '--bank') bank = true
    else if (a === '--n' || a === '--out-dir') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`)
      if (a === '--n') n = Number(v)
      else outDir = v
    } else throw new UsageError(`unexpected argument ${JSON.stringify(a)}`)
  }
  if (!(Number.isSafeInteger(n) && n >= 1)) throw new UsageError('--n must be a positive integer')
  if (bank === (outDir !== undefined)) throw new UsageError('give exactly one of --out-dir <dir>, --bank')
  return { n, bank, ...(outDir === undefined ? {} : { outDir }) }
}

/** The directory the dumps go to: `--out-dir` (resolved against `cwd`) or the bank's `golden/ts_dumps/`. */
export function rtScoresDir(args: RtScoresArgs, cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  if (args.outDir !== undefined) return isAbsolute(args.outDir) ? args.outDir : resolve(cwd, args.outDir)
  const dir = bankDumpsDir(env)
  if (!existsSync(dir)) throw new UsageError(`bank dumps directory not found: ${dir} (check out humanbench-bank next to this repo, set HB_BANK_DIR, or use --out-dir)`)
  return dir
}

function main(): number {
  try {
    const args = parseRtScoresArgs(process.argv.slice(2))
    const dir = rtScoresDir(args, process.env.INIT_CWD ?? process.cwd())
    mkdirSync(dir, { recursive: true })
    for (const family of RT_FAMILY_LIST) {
      const out = join(dir, rtScoreDumpFile(family.name))
      writeFileSync(out, serializeRtScoreDump(buildRtScoreDump(family, args.n)))
      console.log(`wrote ${args.n} ${family.name} parity cases to ${out}`)
    }
    return 0
  } catch (e) {
    console.error(e instanceof UsageError ? `${e.message}\n${RT_SCORES_USAGE}` : String(e))
    return e instanceof UsageError ? 2 : 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
