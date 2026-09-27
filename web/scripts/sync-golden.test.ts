/**
 * Cross-repo fixtures (ROADMAP A17): the bank golden files copied into
 * src/engine/__fixtures__/ by scripts/sync-golden.sh must be byte-identical to the bank's own
 * copies whenever the sibling bank repo is present (skipped otherwise, e.g. in CI).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const WEB = resolve(import.meta.dirname, '..')
const SCRIPT = join(WEB, 'scripts', 'sync-golden.sh')
const FIXTURES = join(WEB, 'src', 'engine', '__fixtures__')
const BANK = process.env.HB_BANK_DIR ?? resolve(WEB, '..', '..', 'humanbench-bank')
const FILES = ['sigma_v2.json', 'scoring_v1.json'] as const

describe('golden fixtures match the sibling bank repo (A17)', () => {
  it('has both fixture copies committed', () => {
    for (const f of FILES) expect(existsSync(join(FIXTURES, f)), f).toBe(true)
  })

  it.skipIf(!existsSync(join(BANK, 'golden')))('copies are byte-identical to the bank files', () => {
    for (const f of FILES) {
      const mine = readFileSync(join(FIXTURES, f))
      const bank = readFileSync(join(BANK, 'golden', f))
      expect(mine.equals(bank), `${f} differs from ${BANK}/golden/${f}; run npm run sync:golden`).toBe(true)
    }
  })
})

describe('scripts/sync-golden.sh', () => {
  const tmps: string[] = []
  const mkTmp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-sync-'))
    tmps.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of tmps.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const run = (env: Record<string, string>): string =>
    execFileSync('sh', [SCRIPT], { env: { ...process.env, ...env }, encoding: 'utf8' })

  it('copies both golden files byte for byte', () => {
    const tmp = mkTmp()
    const bank = join(tmp, 'bank')
    const dest = join(tmp, 'dest')
    mkdirSync(join(bank, 'golden'), { recursive: true })
    for (const f of FILES) writeFileSync(join(bank, 'golden', f), `{"file": "${f}", "x": 0.35}\n`)
    run({ HB_BANK_DIR: bank, HB_FIXTURES_DIR: dest })
    expect(readdirSync(dest).sort()).toEqual([...FILES].sort())
    for (const f of FILES) {
      expect(readFileSync(join(dest, f)).equals(readFileSync(join(bank, 'golden', f)))).toBe(true)
    }
  })

  it('leaves the fixtures alone when there is no bank repo', () => {
    const tmp = mkTmp()
    const dest = join(tmp, 'dest')
    const out = run({ HB_BANK_DIR: join(tmp, 'missing'), HB_FIXTURES_DIR: dest })
    expect(out).toContain('no bank repo')
    expect(existsSync(dest)).toBe(false)
  })
})
