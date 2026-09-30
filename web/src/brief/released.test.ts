/**
 * Every released `hb-brief/N` still reads (AI.6; R-17.11: "all released versions parse"). The frozen
 * files in `__fixtures__/released/hb-brief-N/` are the notes each release wrote, in every text form
 * and as JSON. They are never regenerated: if a wording change, a new grammar version or a validator
 * change makes one stop reading, this test fails, and the fix is an entry in `retired.ts` (for a
 * wording change) or a reader for that version in `parse.ts`, not a new fixture.
 */

import { describe, expect, it } from 'vitest'
import { checkNotes } from './check'
import { PARSERS, parseAnyText, parseJson, parseText } from './parse'

const files = import.meta.glob<string>('./__fixtures__/released/*/*', { query: '?raw', import: 'default', eager: true })
const byVersion = new Map<string, Record<string, string>>()
for (const [path, text] of Object.entries(files)) {
  const m = /released\/(hb-brief-\d+)\/([^/]+)$/.exec(path)
  if (m === null) continue
  byVersion.set(m[1] as string, { ...byVersion.get(m[1] as string), [m[2] as string]: text })
}

describe('released versions', () => {
  it('has frozen fixtures for every version the parser registry knows, in all three text forms and as JSON', () => {
    for (const format of Object.keys(PARSERS)) {
      const dir = format.replace('/', '-')
      const set = byVersion.get(dir)
      expect(set, `no fixtures for ${format}: add __fixtures__/released/${dir}/`).toBeDefined()
      const names = Object.keys(set as Record<string, string>)
      expect(names.some((n) => n.endsWith('.txt')), `${format} short text`).toBe(true)
      expect(names.filter((n) => n.endsWith('.md')).length, `${format} long and skill text`).toBeGreaterThanOrEqual(2)
      expect(names.filter((n) => n.endsWith('.json')).length, `${format} JSON`).toBeGreaterThanOrEqual(3)
    }
  })

  for (const [dir, set] of byVersion) {
    for (const [name, text] of Object.entries(set)) {
      it(`${dir}/${name} reads with no foreign line and no problem, and the checker flags nothing but the words a person typed (profile B's interests)`, () => {
        if (name.endsWith('.json')) {
          const j = parseJson(text)
          expect(j.ok, name).toBe(true)
          const typed = j.ok && j.brief.lines.some((l) => l.id === 'X1' || (l.interests?.length ?? 0) > 0)
          expect(checkNotes(text).flags.map((f) => f.kind), name).toEqual(typed ? ['typed_words'] : [])
          return
        }
        const p = parseAnyText(text)
        expect(p.foreign, name).toEqual([])
        expect(p.problems, name).toEqual([])
        expect(p.format, name).not.toBeNull()
        expect(parseText(text).lines.length).toBeGreaterThan(8)
        const c = checkNotes(text)
        // interests are words a person typed: the checker lists them for reading and never calls such notes clean
        const typed = parseText(text).lines.some((l) => l.id === 'X1' || (l.interests?.length ?? 0) > 0)
        expect(c.flags.map((f) => f.kind), name).toEqual(typed ? ['typed_words'] : [])
        expect(c.verdict).toBe(typed ? 'attention' : 'clean')
      })
    }
  }
})
