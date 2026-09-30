/**
 * The A13 language lint covers the topic files (ROADMAP A13, A23, AI.3; DESIGN R-5.6.1, R-17.3).
 *
 * The lint reads every string of `src/tasks/topics-*.json`, and A13 allow-lists no other text, so
 * a clinical word such as "IQ" cannot be a `denied_words` entry (the bank's `hb topics check`
 * applies the same vocabulary to labels before the file is synced), and a label that uses one
 * fails the lint here. This pins both halves.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT, collectFiles, lintText } from './language-lint'

const TOPIC_FILES = ['web/src/tasks/topics-v1.json', 'web/src/tasks/topics-aliases.json', 'web/src/tasks/topics-released-v1.json']

describe('the language lint and the topic files', () => {
  it('scans every topic file', () => {
    const scanned = collectFiles()
    for (const f of TOPIC_FILES) expect(scanned, f).toContain(f)
  })

  it.each(TOPIC_FILES)('%s has no banned word', (f) => {
    expect(lintText(readFileSync(join(REPO_ROOT, f), 'utf8'), f)).toEqual([])
  })

  it.each(['IQ puzzles', 'ADHD strategies', 'Dyslexia friendly maths'])('a label "%s" fails the lint', (label) => {
    const doc = JSON.parse(readFileSync(join(REPO_ROOT, TOPIC_FILES[0] as string), 'utf8')) as { nodes: { label: string }[] }
    doc.nodes[0]!.label = label
    const hits = lintText(JSON.stringify(doc, null, 2), TOPIC_FILES[0] as string)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('a denied_words entry naming IQ would fail it too, so the deny-list does not carry one', () => {
    const doc = JSON.parse(readFileSync(join(REPO_ROOT, TOPIC_FILES[0] as string), 'utf8')) as { denied_words: Record<string, string[]> }
    expect(doc.denied_words.general_ability).not.toContain('iq')
    doc.denied_words.general_ability!.push('iq')
    expect(lintText(JSON.stringify(doc, null, 2), TOPIC_FILES[0] as string).map((h) => h.term)).toContain('iq')
  })
})
