/**
 * Check findings files: `npx tsx ux-review/validate-findings.ts ux-review/findings/phone.json ...` (from web/).
 * Prints every problem and exits 1 if any file has one.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateFindings } from './lib/findings'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const files = process.argv.slice(2)

if (files.length === 0) {
  console.error('usage: npx tsx ux-review/validate-findings.ts <findings.json>...')
  process.exit(1)
}

let bad = 0
for (const file of files) {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`${file}: cannot read as JSON: ${error instanceof Error ? error.message : String(error)}`)
    bad++
    continue
  }
  const errors = validateFindings(value, REPO_ROOT)
  if (errors.length === 0) {
    const n = Array.isArray((value as { findings?: unknown }).findings) ? (value as { findings: unknown[] }).findings.length : 0
    console.log(`ok ${file} (${n} findings)`)
  } else {
    bad++
    for (const e of errors) console.error(`${file}: ${e}`)
  }
}
process.exit(bad === 0 ? 0 : 1)
