/**
 * The few Node APIs of the coding parity dump (the `dump-scores.ts` CLI and its drift test).
 * The app's type program has no Node types (tsconfig.app.json), so the APIs are typed here and
 * `node:fs` is loaded by a non-literal dynamic import that only ever runs under Node (tsx,
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

const pathOf = (url: URL): string => decodeURIComponent(url.pathname)
const dirUrl = (dir: string, base: string): URL => new URL(dir.endsWith('/') ? dir : `${dir}/`, `file://${base}/`)

/** Resolve `path` against the current directory (absolute paths are kept). */
export function resolvePath(path: string): string {
  return pathOf(new URL(path, `file://${nodeProcess().cwd()}/`))
}

/**
 * The bank's `golden/ts_dumps/` directory, found as `npm run dump:families --bank` finds it:
 * `$HB_BANK_DIR`, else the `humanbench-bank` checkout beside this repo (A17).
 */
export function bankDumpsDir(): string {
  const env = nodeProcess().env.HB_BANK_DIR
  const bank = env ? dirUrl(env, nodeProcess().cwd()) : new URL('../../../../../humanbench-bank/', import.meta.url)
  return pathOf(new URL('golden/ts_dumps/', bank))
}
