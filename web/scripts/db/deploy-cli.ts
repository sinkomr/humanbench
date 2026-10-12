/**
 * `npm run db:deploy` (ROADMAP M2.6): applies `supabase/migrations` to the database whose connection
 * string is in an env file, and records each file (see deploy.ts). Nothing runs this but a person: no
 * workflow, no test, no other script.
 *
 *   npm run db:deploy -- status --env-file <path>    what is applied and what is pending; changes nothing
 *   npm run db:deploy -- apply  --env-file <path>    apply the pending files, one transaction each
 *
 *   --env-file <path>   a file with a line SUPABASE_DB_URL='...' (the Session pooler string, role
 *                       `postgres`). Keep it outside both repositories. The value is read here and never
 *                       printed; do not pass it on the command line or export it in a shell.
 *   --key <NAME>        another variable name in that file
 *   --ca-file <path>    verify the server's certificate against this CA (the project's, from the
 *                       dashboard). Without it a remote connection is encrypted but the server is not
 *                       verified, and the command says so.
 */

import { readFileSync } from 'node:fs'
import pg from 'pg'
import { deploy, hostOf, isLocalHost, parseEnvValue, planDeploy, readLedger, redactor, secretsOf } from './deploy'
import { readMigrations } from './sql'

const USAGE = `usage: npm run db:deploy -- status|apply --env-file <path> [--key <NAME>] [--ca-file <path>]`

function option(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...args] = argv
  const envFile = option(args, '--env-file')
  if ((command !== 'status' && command !== 'apply') || envFile === undefined) {
    console.error(USAGE)
    return 2
  }
  const key = option(args, '--key') ?? 'SUPABASE_DB_URL'
  const url = parseEnvValue(readFileSync(envFile, 'utf8'), key)
  if (url === undefined || url === '') {
    console.error(`${envFile}: no ${key}=... line`)
    return 2
  }
  const redact = redactor(secretsOf(url))
  const host = hostOf(url) ?? ''
  const caFile = option(args, '--ca-file')
  const ssl = isLocalHost(host) ? false : caFile === undefined ? { rejectUnauthorized: false } : { ca: readFileSync(caFile, 'utf8') }
  if (ssl !== false && caFile === undefined) console.error('TLS without --ca-file: the connection is encrypted, the server is not verified.')

  const db = new pg.Client({ connectionString: url, ssl, application_name: 'hb-deploy', connectionTimeoutMillis: 20_000 })
  db.on('error', () => undefined)
  try {
    await db.connect()
    const who = await db.query<{ u: string; d: string; v: string }>(`select current_user as u, current_database() as d, current_setting('server_version') as v`)
    const w = who.rows[0] as { u: string; d: string; v: string }
    console.error(`connected as ${w.u} to database ${w.d} (PostgreSQL ${w.v})`)
    const files = readMigrations()
    if (command === 'status') {
      const plan = planDeploy(files, await readLedger(db))
      for (const name of plan.applied) console.log(`applied  ${name}`)
      for (const f of plan.pending) console.log(`pending  ${f.name}`)
      for (const p of plan.problems) console.log(`PROBLEM  ${redact(p)}`)
      return plan.problems.length > 0 ? 1 : 0
    }
    const result = await deploy(db, files, (line) => console.log(line))
    console.log(`done: ${result.applied.length} applied, ${result.skipped.length} already applied`)
    return 0
  } catch (e) {
    console.error(redact(e instanceof Error ? e.message : String(e)))
    return 1
  } finally {
    await db.end().catch(() => undefined)
  }
}

process.exit(await main(process.argv.slice(2)))
