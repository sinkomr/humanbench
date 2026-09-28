/**
 * The renderer gallery / G7 review page is dev-only (ROADMAP M1.13, M1.G7; DESIGN §4.4): the
 * production build of the app must not contain it, and its entry must not pull the page in when
 * built for production (its `import.meta.env.DEV` guard drops the dynamic import). Also checks the
 * `npm run review` script and that the page's entry HTML exists for the dev server.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build, type Rolldown } from 'vite'
import { describe, expect, it } from 'vitest'

const WEB = fileURLToPath(new URL('..', import.meta.url))

/** Strings that only the review page's code carries. */
const REVIEW_MARKERS = ['Procedural item review', 'hb.g7_review', 'review-<family>-<i>', 'Reset renderer', 'InstanceCard']

type Output = Rolldown.RolldownOutput

/**
 * A production build as `npm run build` makes it: vitest sets NODE_ENV=test, under which a Vite
 * build keeps `import.meta.env.DEV` true, so NODE_ENV is production for the build's duration.
 */
async function productionBuild(extra: NonNullable<Parameters<typeof build>[0]>['build'] = {}): Promise<Output[]> {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    return outputsOf(await build({ configFile: `${WEB}vite.config.ts`, root: WEB, mode: 'production', logLevel: 'silent', build: { write: false, ...extra } }))
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prev
  }
}

function outputsOf(result: Awaited<ReturnType<typeof build>>): Output[] {
  return (Array.isArray(result) ? result : [result]) as Output[]
}

function textOf(outputs: Output[]): string {
  return outputs
    .flatMap((o) => o.output)
    .map((c) => (c.type === 'chunk' ? c.code : typeof c.source === 'string' ? c.source : new TextDecoder().decode(c.source)))
    .join('\n')
}

describe('dev-only review page (M1.G7)', () => {
  it('has its dev entry (review.html → src/review/main.ts) and an npm run review script', () => {
    expect(existsSync(`${WEB}review.html`)).toBe(true)
    expect(readFileSync(`${WEB}review.html`, 'utf8')).toContain('/src/review/main.ts')
    const pkg = JSON.parse(readFileSync(`${WEB}package.json`, 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts.review).toMatch(/^vite\b.*review\.html/)
  })

  it('the production app build emits no review page and none of its code', async () => {
    const outputs = await productionBuild()
    const files = outputs.flatMap((o) => o.output.map((c) => c.fileName))
    expect(files).toContain('index.html')
    expect(files.filter((f) => /review/i.test(f))).toEqual([])
    const text = textOf(outputs)
    expect(text).toContain('HumanBench')
    for (const m of REVIEW_MARKERS) expect(text, m).not.toContain(m)
  }, 60_000)

  it('built for production, the review entry drops the page (import.meta.env.DEV guard)', async () => {
    const outputs = await productionBuild({ rollupOptions: { input: `${WEB}src/review/main.ts` } })
    const text = textOf(outputs)
    expect(text).toContain('runs only on the development server')
    for (const m of REVIEW_MARKERS) expect(text, m).not.toContain(m)
    expect(outputs.flatMap((o) => o.output).filter((c) => c.type === 'chunk')).toHaveLength(1)
  }, 60_000)
})
