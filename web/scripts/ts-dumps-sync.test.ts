/**
 * A17 copy check: when the bank checkout is present (sibling `humanbench-bank`, or
 * `$HB_BANK_DIR`), every `golden/ts_dumps/<family>.json` there must be exactly what this repo's
 * generator produces now. A stale dump fails here with the command that refreshes it.
 *
 * Families are resolved from the registry and, for families not registered yet, from every
 * family module `src/tasks/<dir>/index.ts`, so an implementer's `--module` dump is drift-checked
 * before integration. Dumps of families this checkout does not have at all are skipped. In CI
 * the bank is absent and this skips. (The bank → pub direction, `golden/*.json` →
 * `src/engine/__fixtures__/`, has its own sync script and test from M1.3.)
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AnyFamily } from '../src/tasks/family'
import { canonicalJson } from '../src/tasks/ids'
import { FAMILIES } from '../src/tasks/registry'
import { PUB_ROOT, UsageError, bankDumpsDir, familiesFromModule } from './dump-lib'

const DIR = bankDumpsDir()
const present = existsSync(DIR)
const files = present ? readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : []
const TASKS_DIR = join(PUB_ROOT, 'web', 'src', 'tasks')

interface Known {
  readonly family: AnyFamily
  /** The dump:families source flag that regenerates the dump. */
  readonly source: string
}

/** Registered families first, then the family modules in `src/tasks/<dir>/index.ts`. */
async function knownFamilies(): Promise<Map<string, Known>> {
  const known = new Map<string, Known>()
  for (const [name, family] of Object.entries(FAMILIES)) known.set(name, { family, source: `--family ${name}` })
  for (const entry of readdirSync(TASKS_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const index = join(TASKS_DIR, entry.name, 'index.ts')
    if (!entry.isDirectory() || !existsSync(index)) continue
    let found: AnyFamily[]
    try {
      found = await familiesFromModule(index)
    } catch (e) {
      if (e instanceof UsageError) continue // a directory without a family (e.g. shared helpers)
      throw e
    }
    for (const family of found) {
      if (!known.has(family.name)) known.set(family.name, { family, source: `--module src/tasks/${entry.name}/index.ts` })
    }
  }
  return known
}

interface Dump {
  family: string
  generator_version: string
  count: number
  items: { seed: string }[]
}

describe('A17: bank golden/ts_dumps match the TS generators', () => {
  it('resolves registered families and unregistered family modules (incl. the toy family)', async () => {
    const known = await knownFamilies()
    expect(known.get('example')?.source).toBe('--module src/tasks/_example/index.ts')
    for (const name of Object.keys(FAMILIES)) expect(known.get(name)?.source).toBe(`--family ${name}`)
  })

  it.skipIf(!present)(`every known family's dump in ${DIR} regenerates exactly`, async () => {
    const known = await knownFamilies()
    const problems: string[] = []
    for (const file of files) {
      const name = file.slice(0, -'.json'.length)
      const k = known.get(name)
      if (!k) continue // no such family in this checkout yet
      const dump = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Dump
      const refresh = `npm run dump:families -- ${k.source} --n ${dump.count} --bank`
      if (dump.family !== name) problems.push(`${file}: family ${dump.family} does not match the file name`)
      if (dump.generator_version !== k.family.generatorVersion) {
        problems.push(`${file}: generator_version ${dump.generator_version} ≠ ${k.family.generatorVersion}; refresh with ${refresh}`)
        continue
      }
      const stale = dump.items.findIndex((it) => canonicalJson(it) !== canonicalJson(k.family.generate(it.seed)))
      if (stale >= 0) problems.push(`${file}: item ${stale} differs from the generator; refresh with ${refresh}`)
    }
    expect(problems).toEqual([])
  })

  it.skipIf(!present)('the toy family dump is present (the bank cross-check fixture)', () => {
    expect(files).toContain('example.json')
  })
})
