/**
 * Item tags stay out of what a person sees or saves (ROADMAP A23, AI.2 = M3.1b; DESIGN R-17.3).
 *
 * `curriculum_level` orders rungs in a facet ladder and is "public-safe, never rendered into
 * notes": no line of the notes, the save file, a chart or a share card may carry a school level
 * (education-level cues, proposal §6 row 20). The item tags themselves are bank-side; the public
 * repo only gains the `ladder_probe` and `practice_only` family flags (`tasks/family.ts`). So the
 * surfaces that render or persist something must not mention the tag at all, and this guard
 * covers the notes builder (`src/brief/`, AI.4) before it exists.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '..', 'src')

/** Directories and files that render text, draw, or write the save file (or will: `brief/`). */
const SURFACES = ['brief', 'save', 'viz', 'render', 'review', 'copy.ts', 'App.svelte', 'main.ts'] as const
const LEVEL = /curriculum[\s_-]?level/i
/** The one enum value no ordinary code would spell, so a hard-coded level list is caught too. */
const LEVEL_VALUE = /intro_college/

function files(path: string): string[] {
  let stat
  try {
    stat = statSync(path)
  } catch {
    return []
  }
  if (stat.isFile()) return [path]
  return readdirSync(path).flatMap((name) => files(join(path, name)))
}

const isTest = (path: string): boolean => /\.(test|spec)\.[cm]?[jt]s$/.test(path) || path.split(sep).includes('__fixtures__')

const surfaceFiles = SURFACES.flatMap((s) => files(join(SRC, s))).filter((f) => !isTest(f) && /\.(ts|svelte|json|css|html)$/.test(f))

describe('curriculum_level never reaches a rendered or saved surface (A23, R-17.3)', () => {
  it('scans the app surfaces (a guard that finds no files would pass vacuously)', () => {
    const rel = surfaceFiles.map((f) => relative(SRC, f))
    expect(rel).toContain('copy.ts')
    expect(rel).toContain('App.svelte')
    expect(rel.some((f) => f.startsWith(`save${sep}`))).toBe(true)
    expect(rel.some((f) => f.startsWith(`viz${sep}`))).toBe(true)
  })

  it.each(surfaceFiles.map((f) => [relative(SRC, f), f] as const))('%s does not name the curriculum level', (_name, path) => {
    const text = readFileSync(path, 'utf8')
    expect(text).not.toMatch(LEVEL)
  })

  it('no surface hard-codes the level vocabulary', () => {
    for (const f of surfaceFiles) expect(readFileSync(f, 'utf8'), relative(SRC, f)).not.toMatch(LEVEL_VALUE)
  })

  it('the guard itself catches a mention', () => {
    expect(LEVEL.test('exportNotes({ curriculum_level: "hs" })')).toBe(true)
    expect(LEVEL.test('const curriculumLevel = 2')).toBe(true)
    expect(LEVEL.test('const curriculum_level = 2')).toBe(true)
    expect(LEVEL.test('the curriculum level of the item')).toBe(true)
    expect(LEVEL.test('a facet ladder')).toBe(false)
  })
})

describe('the public repo adds only the family flags (A23, AI.2)', () => {
  it('names no bank-only tag in the item wire format', async () => {
    const { validateItemInstance } = await import('../src/tasks/family')
    for (const tag of ['topic', 'curriculum_level', 'notation', 'question_type', 'inference_steps', 'jargon_terms']) {
      expect(validateItemInstance({ [tag]: 'x' }).join()).toMatch(new RegExp(`unknown field ${tag}`))
    }
  })
})
