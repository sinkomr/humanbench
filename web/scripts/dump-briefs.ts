/**
 * `npm run dump:briefs` (ROADMAP AI.4; proposal §7.3): write the notes the behaviour harness
 * (AI.12a, bank) runs assistants against, as JSON. Deterministic for a given month.
 *
 *   npm run dump:briefs -- --as-of 2026-11 [--out <file>]
 *
 * Without `--out` the JSON goes to standard output. A relative `--out` resolves against the
 * directory npm ran in. Importing this module writes nothing.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDump, serializeDump } from '../src/brief/dump'
import { MONTH_RE } from '../src/brief/types'

export const DUMP_BRIEFS_USAGE = 'usage: npm run dump:briefs -- --as-of YYYY-MM [--out <file>]'

export interface DumpBriefsArgs {
  readonly asOf: string
  readonly out?: string
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/** Parse `--as-of <YYYY-MM>` (required) and `--out <file>`; throws a {@link UsageError}. */
export function parseDumpBriefsArgs(argv: readonly string[]): DumpBriefsArgs {
  let asOf: string | undefined
  let out: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--') continue
    if (a === '--as-of' || a === '--out') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`)
      if (a === '--as-of') asOf = v
      else out = v
    } else throw new UsageError(`unexpected argument ${JSON.stringify(a)}`)
  }
  if (asOf === undefined) throw new UsageError('--as-of is required')
  if (!MONTH_RE.test(asOf)) throw new UsageError('--as-of must be a YYYY-MM month')
  return { asOf, ...(out === undefined ? {} : { out }) }
}

function main(): number {
  try {
    const args = parseDumpBriefsArgs(process.argv.slice(2))
    const text = serializeDump(buildDump(args.asOf))
    if (args.out === undefined) process.stdout.write(text)
    else {
      const path = isAbsolute(args.out) ? args.out : resolve(process.env.INIT_CWD ?? process.cwd(), args.out)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
      console.error(`wrote ${path}`)
    }
    return 0
  } catch (e) {
    console.error(e instanceof UsageError ? `${e.message}\n${DUMP_BRIEFS_USAGE}` : String(e))
    return e instanceof UsageError ? 2 : 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
