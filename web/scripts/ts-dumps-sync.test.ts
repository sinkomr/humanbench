/**
 * A17 copy check: when the bank checkout is present (sibling `humanbench-bank`, or
 * `$HB_BANK_DIR`), every `golden/ts_dumps/<family>.json` there must be exactly what this repo's
 * generator produces now. A stale dump fails here with the command that refreshes it; dumps of
 * families this repo does not know (yet) are skipped. In CI the bank is absent and this skips.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { example } from '../src/tasks/_example'
import type { AnyFamily } from '../src/tasks/family'
import { canonicalJson } from '../src/tasks/ids'
import { FAMILIES } from '../src/tasks/registry'
import { bankDumpsDir } from './dump-lib'

const DIR = bankDumpsDir()
const present = existsSync(DIR)
const files = present ? readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : []

/** Registered families plus the toy family, whose dump proves the cross-check path (M1.F). */
const known: Record<string, AnyFamily> = { ...FAMILIES, [example.name]: example }

interface Dump {
  family: string
  generator_version: string
  count: number
  items: { seed: string }[]
}

describe('A17: bank golden/ts_dumps match the TS generators', () => {
  it.skipIf(!present)(`every known family's dump in ${DIR} regenerates exactly`, () => {
    const problems: string[] = []
    for (const file of files) {
      const name = file.slice(0, -'.json'.length)
      const family = known[name]
      if (!family) continue // not registered in this checkout yet
      const dump = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Dump
      const source = name in FAMILIES ? `--family ${name}` : '--module src/tasks/_example/index.ts'
      const refresh = `npm run dump:families -- ${source} --n ${dump.count} --bank`
      if (dump.family !== name) problems.push(`${file}: family ${dump.family} does not match the file name`)
      if (dump.generator_version !== family.generatorVersion) {
        problems.push(`${file}: generator_version ${dump.generator_version} ≠ ${family.generatorVersion}; refresh with ${refresh}`)
        continue
      }
      const stale = dump.items.findIndex((it) => canonicalJson(it) !== canonicalJson(family.generate(it.seed)))
      if (stale >= 0) problems.push(`${file}: item ${stale} differs from the generator; refresh with ${refresh}`)
    }
    expect(problems).toEqual([])
  })

  it.skipIf(!present)('the toy family dump is present (the bank cross-check fixture)', () => {
    expect(files).toContain('example.json')
  })
})
