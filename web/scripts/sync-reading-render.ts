/**
 * `npm run sync:reading-render` (ROADMAP M1.12, A14): regenerate
 * `src/tasks/reading/passages.render.json`, the runtime projection of the authored reading bank
 * `passages.json` without the verifier-only `evidence_span` and `option_rationales`. Run it after
 * every edit of `passages.json`; `src/tasks/reading/bank.test.ts` fails while the two disagree.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUTHORED_BANK } from '../src/tasks/reading/authoring'
import { serializeRenderBank, toRenderBank } from '../src/tasks/reading/bank'
import { PUB_ROOT } from './dump-lib'

const RENDER_FILE = join(PUB_ROOT, 'web', 'src', 'tasks', 'reading', 'passages.render.json')

const text = serializeRenderBank(toRenderBank(AUTHORED_BANK))
writeFileSync(RENDER_FILE, text)
console.log(`wrote ${AUTHORED_BANK.passages.length} passages to ${RENDER_FILE}`)
