/**
 * Write the coding scoring parity dump (see `synthetic.ts`) for the bank (A1, A17). Run from
 * `web/` (a relative `--out` resolves against the current directory):
 *
 *   npx tsx src/tasks/coding/dump-scores.ts [--n 1000] (--out <file> | --bank)
 *
 * `--bank` writes `<bank>/golden/ts_dumps/coding_scores.json` next to the item dump
 * `coding.json` (use the same `--n`; `<bank>` is `$HB_BANK_DIR` or the sibling
 * `humanbench-bank` checkout, as for `npm run dump:families`). A Node CLI: never imported by
 * the app or by tests.
 */

import { bankDumpsDir, nodeFs, nodeProcess, resolvePath } from './node-io'
import { SCORE_DUMP_FILE, buildScoreDump, serializeScoreDump } from './synthetic'

async function parse(argv: readonly string[]): Promise<{ n: number; out: string }> {
  let n = 1000
  let out: string | undefined
  let bank = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') continue
    if (a === '--bank') bank = true
    else if (a === '--n') n = Number(argv[++i])
    else if (a === '--out') out = argv[++i]
    else throw new Error(`unexpected argument ${JSON.stringify(a)}`)
  }
  if (!(Number.isSafeInteger(n) && n >= 1)) throw new Error('--n must be a positive integer')
  if (bank === (out !== undefined)) throw new Error('give exactly one of --out <file>, --bank')
  return { n, out: out === undefined ? `${await bankDumpsDir()}${SCORE_DUMP_FILE}` : resolvePath(out) }
}

const { n, out } = await parse(nodeProcess().argv.slice(2))
const fs = await nodeFs()
fs.writeFileSync(out, serializeScoreDump(buildScoreDump(n)))
console.log(`wrote ${n} coding parity cases to ${out}`)
