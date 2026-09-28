/**
 * `npm run dump:coding-scores -- …` (ROADMAP M1.11, A1, A17): write the coding scoring parity
 * dump (`src/tasks/coding/synthetic.ts`) for the bank's Python scorer. Runs under tsx:
 *
 *   npm run dump:coding-scores -- [--n 1000] (--out <file> | --bank)
 *
 * `--bank` writes `<bank>/golden/ts_dumps/coding_scores.json` next to the item dump `coding.json`
 * (use the same `--n`; `<bank>` is `$HB_BANK_DIR` or the sibling `humanbench-bank` checkout, as
 * for `npm run dump:families`). A relative `--out` resolves against the directory npm was run
 * from. `coding-scores-dump.test.ts` checks the bank copy for drift.
 */

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCORE_DUMP_FILE, buildScoreDump, serializeScoreDump } from '../src/tasks/coding/synthetic'
import { UsageError, bankDumpsDir } from './dump-lib'

export const CODING_SCORES_USAGE = 'usage: npm run dump:coding-scores -- [--n 1000] (--out <file> | --bank)'

/** Parse `[--n N] (--out <file> | --bank)` into the count and the absolute output path. */
export function parseCodingScoresArgs(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv): { n: number; out: string } {
  let n = 1000
  let out: string | undefined
  let bank = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') continue
    if (a === '--bank') bank = true
    else if (a === '--n') n = Number(argv[++i])
    else if (a === '--out') out = argv[++i]
    else throw new UsageError(`unexpected argument ${JSON.stringify(a)}`)
  }
  if (!(Number.isSafeInteger(n) && n >= 1)) throw new UsageError('--n must be a positive integer')
  if (bank === (out !== undefined)) throw new UsageError('give exactly one of --out <file>, --bank')
  return { n, out: out === undefined ? join(bankDumpsDir(env), SCORE_DUMP_FILE) : resolve(cwd, out) }
}

/** CLI entry: returns the process exit code (0 ok, 2 usage error). */
export function main(argv: readonly string[], cwd = process.env.INIT_CWD ?? process.cwd(), env = process.env): number {
  let args: { n: number; out: string }
  try {
    args = parseCodingScoresArgs(argv, cwd, env)
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    console.error(`${e.message}\n${CODING_SCORES_USAGE}`)
    return 2
  }
  writeFileSync(args.out, serializeScoreDump(buildScoreDump(args.n)))
  console.log(`wrote ${args.n} coding parity cases to ${args.out}`)
  return 0
}

// Run only as the CLI entry, so the test can import the parser without writing anything.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2))
}
