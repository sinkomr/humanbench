/**
 * The few Node APIs of the coding parity dump (the `dump-scores.ts` CLI and its drift test).
 * The app's type program has no Node types (tsconfig.app.json), so the APIs are typed here and
 * Node modules are loaded by non-literal dynamic imports that only ever run under Node (tsx,
 * vitest). Never imported by the app.
 */

export interface NodeFs {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: 'utf8'): string
  writeFileSync(path: string, data: string): void
}

export interface NodeProcess {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  cwd(): string
}

/** `node:fs`, loaded at run time. */
export async function nodeFs(): Promise<NodeFs> {
  const specifier: string = 'node:fs'
  return (await import(/* @vite-ignore */ specifier)) as NodeFs
}

/** The Node `process` global. */
export function nodeProcess(): NodeProcess {
  return (globalThis as unknown as { process: NodeProcess }).process
}

/** Resolve `path` against the current directory (absolute paths are kept). */
export function resolvePath(path: string): string {
  return decodeURIComponent(new URL(path, `file://${nodeProcess().cwd()}/`).pathname)
}

/** The part of `scripts/dump-lib.ts` used here (a Node-typed module outside the app program). */
interface DumpLib {
  bankDumpsDir(): string
}

/**
 * The bank's `golden/ts_dumps/` directory, with a trailing slash: `bankDumpsDir()` of
 * `scripts/dump-lib.ts` itself (`$HB_BANK_DIR`, else the sibling `humanbench-bank` checkout,
 * A17), so this dump lands exactly where `npm run dump:families --bank` puts the item dump.
 * Loaded at run time because dump-lib is typed against Node and the app program is not.
 */
export async function bankDumpsDir(): Promise<string> {
  const specifier: string = new URL('../../../scripts/dump-lib.ts', import.meta.url).href
  const lib = (await import(/* @vite-ignore */ specifier)) as DumpLib
  return `${lib.bankDumpsDir()}/`
}
