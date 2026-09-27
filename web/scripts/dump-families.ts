/**
 * `npm run dump:families -- …` (ROADMAP A1, A17): dump TS instances of a procedural family for
 * the bank's Python cross-check. Runs under tsx; see `dump-lib.ts` for the options.
 */

import { main } from './dump-lib'

process.exitCode = await main(process.argv.slice(2))
