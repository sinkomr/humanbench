/**
 * Cross-repo topic taxonomy (ROADMAP A23, AI.3; A17): the bank owns `schema/topics-v1.json`,
 * `schema/topics-aliases.json` and the frozen ledger `schema/topics-released-v1.json`, and
 * `scripts/sync-topics.sh` copies them into `src/tasks/`. The
 * copies must be byte-identical to the bank files whenever the sibling bank repo is present
 * (skipped with the path otherwise, e.g. in CI). The bank's `tests/test_crossrepo.py` checks the
 * same copies from its side.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bankDumpsDir } from './dump-lib'

const WEB = resolve(import.meta.dirname, '..')
const SCRIPT = join(WEB, 'scripts', 'sync-topics.sh')
const TASKS = join(WEB, 'src', 'tasks')
/** `$HB_BANK_DIR`, else the sibling `humanbench-bank` (as for the dumps). */
const BANK = dirname(dirname(bankDumpsDir()))
const FILES = ['topics-v1.json', 'topics-aliases.json', 'topics-released-v1.json'] as const

describe('topic taxonomy files match the sibling bank repo (A17)', () => {
  it('has both copies committed next to topics.ts', () => {
    for (const f of FILES) expect(existsSync(join(TASKS, f)), f).toBe(true)
    expect(existsSync(join(TASKS, 'topics.ts'))).toBe(true)
  })

  it('copies are byte-identical to the bank files', ({ skip }) => {
    skip(!existsSync(join(BANK, 'schema')), `no bank checkout at ${BANK} (the sibling humanbench-bank, or $HB_BANK_DIR), e.g. in CI`)
    for (const f of FILES) {
      const mine = readFileSync(join(TASKS, f))
      const bank = readFileSync(join(BANK, 'schema', f))
      expect(mine.equals(bank), `${f} differs from ${BANK}/schema/${f}; run npm run sync:topics`).toBe(true)
    }
  })

  it('names the sync command in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['sync:topics']).toBe('sh scripts/sync-topics.sh')
  })
})

describe('scripts/sync-topics.sh', () => {
  const tmps: string[] = []
  const mkTmp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-sync-topics-'))
    tmps.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of tmps.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const run = (env: Record<string, string>): string => execFileSync('sh', [SCRIPT], { env: { ...process.env, ...env }, encoding: 'utf8' })

  it('copies every file byte for byte', () => {
    const tmp = mkTmp()
    const bank = join(tmp, 'bank')
    const dest = join(tmp, 'dest')
    mkdirSync(join(bank, 'schema'), { recursive: true })
    for (const f of FILES) writeFileSync(join(bank, 'schema', f), `{"file": "${f}", "x": 0.35}\n`)
    run({ HB_BANK_DIR: bank, HB_TOPICS_DIR: dest })
    expect(readdirSync(dest).sort()).toEqual([...FILES].sort())
    for (const f of FILES) expect(readFileSync(join(dest, f)).equals(readFileSync(join(bank, 'schema', f)))).toBe(true)
  })

  it('copies nothing and fails when the bank lacks one of the files', () => {
    const tmp = mkTmp()
    const bank = join(tmp, 'bank')
    const dest = join(tmp, 'dest')
    mkdirSync(join(bank, 'schema'), { recursive: true })
    mkdirSync(dest)
    writeFileSync(join(bank, 'schema', 'topics-v1.json'), '{"new": true}\n')
    writeFileSync(join(dest, 'topics-v1.json'), '{"old": true}\n')
    const res = spawnSync('sh', [SCRIPT], { env: { ...process.env, HB_BANK_DIR: bank, HB_TOPICS_DIR: dest }, encoding: 'utf8' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('lacks: topics-aliases.json topics-released-v1.json')
    expect(res.stdout).toContain('not a git checkout')
    expect(readdirSync(dest)).toEqual(['topics-v1.json'])
    expect(readFileSync(join(dest, 'topics-v1.json'), 'utf8')).toBe('{"old": true}\n')
  })

  it('leaves the files alone when there is no bank repo', () => {
    const tmp = mkTmp()
    const dest = join(tmp, 'dest')
    const out = run({ HB_BANK_DIR: join(tmp, 'missing'), HB_TOPICS_DIR: dest })
    expect(out).toContain('no bank repo')
    expect(existsSync(dest)).toBe(false)
  })
})
