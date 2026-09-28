/**
 * `npm run lint:language [-- <file>...]` (ROADMAP M1.20, A13; DESIGN R-5.6.x): the language lint
 * as a CLI. Runs under tsx; see `language-lint.ts` for what it scans, bans and allows.
 */

import { main } from './language-lint'

process.exitCode = main(process.argv.slice(2), {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
  cwd: process.cwd(),
})
