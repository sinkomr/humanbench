/**
 * Build-level checks of what the app ships (ROADMAP A14; audit: the tasks barrel pulled every
 * family and the full reading bank into any bundle that imported a helper).
 *
 * Production builds (Vite, minified, in memory) of:
 * - the real app (`index.html`, this repo's `vite.config.ts`);
 * - an entry that imports a helper from the tasks barrel: it must not pull in any family or
 *   passage data (the barrel does not re-export the registry);
 * - an entry that imports the registry and the selector (`engine/selector.ts`, M1.14, which
 *   imports the registry): it must carry the reading passages (so the check is not vacuous)
 *   but none of the verifier-only authoring data
 *   of `passages.json`: no `option_rationales` / `evidence_span` fields, no rationale line, and no
 *   evidence span as a string of its own (the spans are substrings of the passage text, which is
 *   shipped, so only a standalone copy would reveal which sentence keys a question).
 */

import { fileURLToPath } from 'node:url'
import { build, type Plugin, type Rolldown } from 'vite'
import { describe, expect, it } from 'vitest'
import { AUTHORED_PASSAGES } from '../src/tasks/reading/authoring'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const TASKS = fileURLToPath(new URL('../src/tasks/', import.meta.url))
const SAVE = fileURLToPath(new URL('../src/save/', import.meta.url))
const ENGINE = fileURLToPath(new URL('../src/engine/', import.meta.url))

const RATIONALES = AUTHORED_PASSAGES.flatMap((p) => p.questions.flatMap((q) => q.option_rationales))
const EVIDENCE = AUTHORED_PASSAGES.flatMap((p) => p.questions.map((q) => q.evidence_span))
/** A distinctive sentence of every passage: the first paragraph's first 60 characters. */
const PASSAGE_OPENINGS = AUTHORED_PASSAGES.map((p) => (p.paragraphs[0] ?? '').slice(0, 60))

/** All emitted JS and asset text of a build result. */
function textOf(result: Awaited<ReturnType<typeof build>>): string {
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  return outputs
    .flatMap((o) => o.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : typeof chunk.source === 'string' ? chunk.source : new TextDecoder().decode(chunk.source)))
    .join('\n')
}

/** Build `code` as a single-entry production bundle and return its text. */
async function bundle(code: string): Promise<string> {
  const id = '\0hb-bundle-probe'
  const probe: Plugin = {
    name: 'hb-bundle-probe',
    resolveId: (source) => (source === 'hb-bundle-probe' ? id : null),
    load: (source) => (source === id ? code : null),
  }
  const result = await build({
    configFile: false,
    root: WEB,
    logLevel: 'silent',
    plugins: [probe],
    build: { write: false, minify: true, rollupOptions: { input: 'hb-bundle-probe', preserveEntrySignatures: 'strict' } },
  })
  return textOf(result)
}

function authoringLeaks(text: string): string[] {
  const out: string[] = []
  for (const field of ['option_rationales', 'evidence_span']) if (text.includes(field)) out.push(`field ${field}`)
  for (const r of RATIONALES) if (text.includes(r)) out.push(`rationale ${JSON.stringify(r)}`)
  for (const e of EVIDENCE) for (const q of ['"', "'", '`']) if (text.includes(`${q}${e}${q}`)) out.push(`evidence span ${JSON.stringify(e)}`)
  return out
}

describe('production bundles (A14)', () => {
  it('the checks can see authoring data when it is shipped', () => {
    expect(RATIONALES.length).toBe(AUTHORED_PASSAGES.length * 3 * 4)
    expect(authoringLeaks(`const x = ${JSON.stringify(AUTHORED_PASSAGES[0])}`).length).toBeGreaterThan(4)
  })

  it('the app build ships no reading authoring data', async () => {
    const text = textOf(await build({ configFile: `${WEB}vite.config.ts`, root: WEB, mode: 'production', logLevel: 'silent', build: { write: false } }))
    expect(text).toContain('HumanBench')
    expect(authoringLeaks(text)).toEqual([])
  }, 60_000)

  it('a helper from the tasks barrel pulls in no family or passage data', async () => {
    const text = await bundle(`export { itemId, familyId, logit } from ${JSON.stringify(`${TASKS}index.ts`)}`)
    expect(text.length).toBeLessThan(40_000)
    for (const s of PASSAGE_OPENINGS) expect(text).not.toContain(s)
    expect(text).not.toMatch(/mc_image_spec|reading_block|coding_block/)
  }, 60_000)

  it('the save module (M1.17, DESIGN §8) is light: no ajv, no fast-check, no task families', async () => {
    const text = await bundle(`export * from ${JSON.stringify(`${SAVE}index.ts`)}`)
    // Runtime validation is the hand-written mirror of schema/save-v1.json (save/validate.ts), and
    // gzip falls back to save/gzip.ts, so the whole module stays small.
    expect(text).toContain('HMAC-SHA256')
    expect(text.length).toBeLessThan(45_000)
    expect(text).not.toMatch(/ajv|fast-check|json-schema-traverse/i)
    for (const s of PASSAGE_OPENINGS) expect(text).not.toContain(s)
  }, 60_000)

  it('the topic taxonomy (AI.3, A23) is light: no task family, generator or passage data', async () => {
    const text = await bundle(
      `export * from ${JSON.stringify(`${TASKS}topics.ts`)}\n` + `export * from ${JSON.stringify(`${TASKS}quant/topics.ts`)}`,
    )
    // the labels ship (the builder's chips); the quant templates, hints and passages do not
    expect(text).toContain('Chemical equilibrium')
    expect(text).toContain('Series and number puzzles')
    expect(text.length).toBeLessThan(60_000)
    expect(text).not.toContain('Enter an integer, such as 42')
    for (const s of PASSAGE_OPENINGS) expect(text).not.toContain(s)
    expect(text).not.toMatch(/mc_image_spec|reading_block|coding_block/)
  }, 60_000)

  it('the registry and the selector ship the passages but none of their verifier-only data', async () => {
    const text = await bundle(
      `export { FAMILIES } from ${JSON.stringify(`${TASKS}registry.ts`)}\n` +
        `export { selectNext, planSession } from ${JSON.stringify(`${ENGINE}selector.ts`)}`,
    )
    for (const s of PASSAGE_OPENINGS) expect(text).toContain(s)
    expect(authoringLeaks(text)).toEqual([])
  }, 60_000)
})
