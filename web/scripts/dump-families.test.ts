import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { example } from '../src/tasks/_example'
import { canonicalJson } from '../src/tasks/ids'
import { validateItemInstance } from '../src/tasks/family'
import {
  DEFAULT_DUMP_N,
  UsageError,
  bankDumpsDir,
  buildDump,
  familiesFromModule,
  isProceduralFamily,
  main,
  parseDumpArgs,
  serializeDump,
  type MainIo,
} from './dump-lib'

const WEB = fileURLToPath(new URL('../', import.meta.url))
const EXAMPLE_MODULE = join(WEB, 'src/tasks/_example/index.ts')
const tmp = (): string => mkdtempSync(join(tmpdir(), 'hb-dump-'))

function captureIo(cwd: string, env: NodeJS.ProcessEnv = {}): MainIo & { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { cwd, env, out, err, log: (l) => out.push(l), error: (l) => err.push(l) }
}

describe('parseDumpArgs', () => {
  it('parses the documented forms', () => {
    expect(parseDumpArgs(['--', '--family', 'rot', '--n', '1000', '--out', 'x.json'])).toEqual({
      family: 'rot',
      n: 1000,
      out: 'x.json',
      bank: false,
      all: false,
    })
    expect(parseDumpArgs(['--module=src/x/index.ts', '--bank'])).toEqual({
      module: 'src/x/index.ts',
      n: DEFAULT_DUMP_N,
      bank: true,
      all: false,
    })
    expect(parseDumpArgs(['--all', '--out-dir', 'dumps'])).toMatchObject({ all: true, outDir: 'dumps' })
  })

  it.each([
    [[], /exactly one of/],
    [['--family', 'rot'], /exactly one of/],
    [['--family', 'rot', '--out', 'a', '--bank'], /exactly one of/],
    [['--out', 'a'], /--family, --module or --all/],
    [['--family', 'rot', '--out-dir', 'd'], /--out-dir needs --all/],
    [['--all', '--family', 'rot', '--bank'], /exclusive/],
    [['--all', '--out', 'a'], /--out-dir or --bank/],
    [['--family', 'rot', '--n', '0', '--bank'], /positive integer/],
    [['--family', 'rot', '--n', '1.5', '--bank'], /positive integer/],
    [['--family', '--bank'], /unknown option|needs a value/],
    [['--family'], /needs a value/],
    [['--fam', 'rot'], /unknown option --fam/],
    [['rot'], /unexpected argument/],
    [['--bank=yes', '--family', 'rot'], /takes no value/],
    [['--family', 'a', '--family', 'b', '--bank'], /given twice/],
  ])('rejects %j', (argv, re) => {
    expect(() => parseDumpArgs(argv)).toThrow(UsageError)
    expect(() => parseDumpArgs(argv)).toThrow(re)
  })
})

describe('buildDump / serializeDump', () => {
  it('dumps seeds dump-<i>, every item valid and verified, one canonical item per line', () => {
    const dump = buildDump(example, 30)
    expect(dump.family).toBe('example')
    expect(dump.generator_version).toBe(example.generatorVersion)
    expect(dump.count).toBe(30)
    expect(dump.items.map((it) => it.seed)).toEqual(Array.from({ length: 30 }, (_, i) => `dump-${i}`))
    const text = serializeDump(dump)
    const lines = text.trimEnd().split('\n')
    expect(lines).toHaveLength(32)
    expect(lines[1]).toBe(`${canonicalJson(dump.items[0])},`)
    const parsed = JSON.parse(text) as { family: string; generator_version: string; count: number; items: unknown[] }
    expect(Object.keys(parsed)).toEqual(['family', 'generator_version', 'count', 'items'])
    expect(parsed.items).toEqual(dump.items)
    for (const it of parsed.items) expect(validateItemInstance(it, example)).toEqual([])
  })

  it('refuses to dump a family whose instances fail verify', () => {
    const broken = { ...example, verify: () => ({ ok: false, reason: 'nope', checks: {} }) }
    expect(() => buildDump(broken, 5)).toThrow(/refusing to dump.*\n.*dump-0: verify failed: nope/)
  })

  it('refuses instances that do not survive the JSON round trip', () => {
    const hidden = {
      ...example,
      generate: (seed: string) => {
        const item = example.generate(seed)
        const spec = { ...item.spec }
        Object.defineProperty(spec, 'toJSON', { value: () => ({}), enumerable: false })
        return { ...item, spec }
      },
    }
    expect(() => buildDump(hidden, 3)).toThrow(/dump-0: the JSON round trip changes the item/)
  })
})

describe('family modules', () => {
  it('finds the exported family (named + default deduplicated)', async () => {
    const found = await familiesFromModule(EXAMPLE_MODULE)
    expect(found).toEqual([example])
    expect(isProceduralFamily(example)).toBe(true)
    expect(isProceduralFamily({ name: 'x' })).toBe(false)
    await expect(familiesFromModule(join(WEB, 'nope.ts'))).rejects.toThrow(/module not found/)
    await expect(familiesFromModule(join(WEB, 'src/tasks/ids.ts'))).rejects.toThrow(/no procedural family/)
  })

  it('bankDumpsDir honours HB_BANK_DIR, else the sibling checkout', () => {
    expect(bankDumpsDir({ HB_BANK_DIR: '/x/bank' })).toBe('/x/bank/golden/ts_dumps')
    expect(bankDumpsDir({})).toBe(resolve(WEB, '../../humanbench-bank/golden/ts_dumps'))
  })
})

describe('main', () => {
  it('writes a --module dump relative to the invoking directory', async () => {
    const dir = tmp()
    const io = captureIo(WEB)
    const code = await main(['--module', 'src/tasks/_example/index.ts', '--n', '12', '--out', join(dir, 'ex.json')], io)
    expect(io.err).toEqual([])
    expect(code).toBe(0)
    const dump = JSON.parse(readFileSync(join(dir, 'ex.json'), 'utf8')) as { count: number }
    expect(dump.count).toBe(12)
  })

  it('writes <family>.json into the bank dumps dir with --bank and into --out-dir with --all', async () => {
    const bank = tmp()
    mkdirSync(join(bank, 'golden', 'ts_dumps'), { recursive: true })
    const io = captureIo(WEB, { HB_BANK_DIR: bank })
    expect(await main(['--module', EXAMPLE_MODULE, '--family', 'example', '--n', '3', '--bank'], io)).toBe(0)
    expect(JSON.parse(readFileSync(join(bank, 'golden/ts_dumps/example.json'), 'utf8'))).toMatchObject({ count: 3 })
    const outDir = join(tmp(), 'nested')
    expect(await main(['--all', '--module', EXAMPLE_MODULE, '--n', '2', '--out-dir', outDir], io)).toBe(0)
    expect(JSON.parse(readFileSync(join(outDir, 'example.json'), 'utf8'))).toMatchObject({ count: 2 })
  })

  it('exits 2 on usage errors and unknown or missing families', async () => {
    const io = captureIo(WEB, { HB_BANK_DIR: join(tmp(), 'no-bank') })
    expect(await main(['--n', '3'], io)).toBe(2)
    expect(await main(['--family', 'nope', '--out', 'x.json'], io)).toBe(2)
    expect(io.err.join('\n')).toMatch(/no registered family "nope"/)
    expect(await main(['--module', EXAMPLE_MODULE, '--family', 'other', '--out', 'x.json'], io)).toBe(2)
    expect(await main(['--module', EXAMPLE_MODULE, '--bank'], io)).toBe(2)
    expect(io.err.join('\n')).toMatch(/bank dumps directory not found/)
  })

  it('exits 1 when a family fails verification', async () => {
    const dir = tmp()
    const mod = join(dir, 'broken.ts')
    writeFileSync(
      mod,
      `import { example } from ${JSON.stringify(EXAMPLE_MODULE)}\nexport const broken = { ...example, verify: () => ({ ok: false, reason: 'bad', checks: {} }) }\n`,
    )
    const io = captureIo(dir)
    expect(await main(['--module', 'broken.ts', '--n', '2', '--out', 'b.json'], io)).toBe(1)
    expect(io.err.join('\n')).toMatch(/refusing to dump/)
  })
})

describe('npm run dump:families (tsx, end to end)', () => {
  it('runs the CLI under tsx with the TS path setup', () => {
    const out = join(tmp(), 'example.json')
    const stdout = execFileSync(
      process.execPath,
      [join(WEB, 'node_modules/tsx/dist/cli.mjs'), 'scripts/dump-families.ts', '--', '--module', EXAMPLE_MODULE, '--n', '7', '--out', out],
      { cwd: WEB, env: { ...process.env, INIT_CWD: WEB }, encoding: 'utf8' },
    )
    expect(stdout).toMatch(/wrote 7 example 1\.1\.0 instances/)
    const dump = JSON.parse(readFileSync(out, 'utf8')) as { items: { item_id: string }[] }
    expect(dump.items[6]?.item_id).toBe(`i:example:${example.generatorVersion}:dump-6`)
    expect(JSON.stringify(dump.items[0])).toBe(JSON.stringify(JSON.parse(canonicalJson(example.generate('dump-0')))))
  }, 30_000)
})
