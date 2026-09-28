/**
 * The A13 vocabulary export (ROADMAP M3.2, A13, A17): `web/scripts/language-terms.json` is exactly
 * what `language-terms.ts` produces from `language-lint.ts` now, and, when the bank checkout is
 * present (sibling `humanbench-bank`, or `$HB_BANK_DIR`), its `golden/language_terms.json` is a
 * byte-identical copy (skipped with the path otherwise, e.g. in CI). The bank's
 * `tests/test_crossrepo.py` checks the same copy from its side.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bankDumpsDir } from './dump-lib'
import { BANNED_TERMS, NOT_BANNED, REPO_ROOT } from './language-lint'
import { LANGUAGE_TERMS_PATH, languageTerms, serializeLanguageTerms } from './language-terms'

const committed = (): string => readFileSync(join(REPO_ROOT, LANGUAGE_TERMS_PATH), 'utf8')
const BANK = dirname(dirname(bankDumpsDir()))
const BANK_COPY = join(BANK, 'golden', 'language_terms.json')

describe('A13 vocabulary export for the bank (M3.2, A17)', () => {
  it('carries every banned term with its examples, and every near-miss', () => {
    const data = languageTerms()
    expect(data.banned_terms.map((t) => t.id)).toEqual(BANNED_TERMS.map((t) => t.id))
    expect(data.banned_terms).toEqual(BANNED_TERMS.map((t) => ({ id: t.id, pattern: t.pattern, examples: t.examples, why: t.why })))
    expect(data.not_banned).toEqual(NOT_BANNED)
    expect(data.match.flags).toBe('iu')
  })

  it('the wrap in the export is the one the lint compiles', () => {
    const { wrap, flags } = languageTerms().match
    for (const t of BANNED_TERMS) {
      const re = new RegExp(wrap.replace('<pattern>', t.pattern), flags)
      for (const ex of t.examples) expect(re.test(ex), `${t.id}: ${ex}`).toBe(true)
      for (const word of Object.keys(NOT_BANNED)) expect(re.test(word), `${t.id} must not match ${word}`).toBe(false)
    }
  })

  it('the committed JSON is current (refresh: npm run dump:language-terms)', () => {
    expect(committed()).toBe(serializeLanguageTerms())
    expect(JSON.parse(committed())).toEqual(JSON.parse(JSON.stringify(languageTerms())))
  })

  it('the bank copy is byte-identical', ({ skip }) => {
    skip(!existsSync(join(BANK, 'golden')), `no bank checkout at ${BANK} (the sibling humanbench-bank, or $HB_BANK_DIR), e.g. in CI`)
    expect(existsSync(BANK_COPY), `${BANK_COPY} is missing: run \`uv run hb sync language-terms\` in the bank`).toBe(true)
    expect(readFileSync(BANK_COPY, 'utf8') === committed(), `${BANK_COPY} differs: run \`uv run hb sync language-terms\` in the bank`).toBe(true)
  })
})
