/**
 * Write the rt scoring parity dump (`src/tasks/rt/synthetic.ts`) for the bank (M1.10; A1, A17).
 * Run from `web/`:
 *
 *   npx tsx scripts/dump-rt-scores.ts [--n 1000] (--out <file> | --bank)
 *
 * `--bank` writes `<bank>/golden/ts_dumps/rt_scores.json` next to the item dump `rt.json` (use
 * the same `--n`; `<bank>` is `$HB_BANK_DIR` or the sibling `humanbench-bank` checkout, as for
 * `npm run dump:families`). A relative `--out` resolves against the directory npm/npx ran in.
 * Importing this module writes nothing; only running it as the entry script does.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RT_SCORE_DUMP_FILE, buildRtScoreDump, serializeRtScoreDump } from '../src/tasks/rt/synthetic'
import { DEFAULT_DUMP_N, UsageError, bankDumpsDir } from './dump-lib'

export const RT_SCORES_USAGE = `usage: npx tsx scripts/dump-rt-scores.ts [--n ${DEFAULT_DUMP_N}] (--out <file> | --bank)`

export interface RtScoresArgs {
  readonly n: number
  readonly out?: string
  readonly bank: boolean
}

/** Parse `--n <k>`, `--out <file>`, `--bank` (exactly one of the last two); throws a {@link UsageError}. */
export function parseRtScoresArgs(argv: readonly string[]): RtScoresArgs {
  let n = DEFAULT_DUMP_N
  let out: string | undefined
  let bank = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--') continue
    if (a === '--bank') bank = true
    else if (a === '--n' || a === '--out') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`)
      if (a === '--n') n = Number(v)
      else out = v
    } else throw new UsageError(`unexpected argument ${JSON.stringify(a)}`)
  }
  if (!(Number.isSafeInteger(n) && n >= 1)) throw new UsageError('--n must be a positive integer')
  if (bank === (out !== undefined)) throw new UsageError('give exactly one of --out <file>, --bank')
  return { n, bank, ...(out === undefined ? {} : { out }) }
}

/** The file the dump goes to: `--out` (resolved against `cwd`) or the bank's `golden/ts_dumps/rt_scores.json`. */
export function rtScoresTarget(args: RtScoresArgs, cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  if (args.out !== undefined) return isAbsolute(args.out) ? args.out : resolve(cwd, args.out)
  const dir = bankDumpsDir(env)
  if (!existsSync(dir)) throw new UsageError(`bank dumps directory not found: ${dir} (check out humanbench-bank next to this repo, set HB_BANK_DIR, or use --out)`)
  return join(dir, RT_SCORE_DUMP_FILE)
}

function main(): number {
  try {
    const args = parseRtScoresArgs(process.argv.slice(2))
    const out = rtScoresTarget(args, process.env.INIT_CWD ?? process.cwd())
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, serializeRtScoreDump(buildRtScoreDump(args.n)))
    console.log(`wrote ${args.n} rt parity cases to ${out}`)
    return 0
  } catch (e) {
    console.error(e instanceof UsageError ? `${e.message}\n${RT_SCORES_USAGE}` : String(e))
    return e instanceof UsageError ? 2 : 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
