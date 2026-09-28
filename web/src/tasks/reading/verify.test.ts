import { describe, expect, it } from 'vitest'
import { PUBLIC_DOMAIN_BEFORE, countPassageWords, passageChecks, passageText, reading, verifyReading, type PassageRecord, type ReadingItem } from '.'
import { AUTHORED_PASSAGES as PASSAGES, bankProblems, verifyPassage } from './authoring'

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] }
type AnyRecord = Record<string, unknown>

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const base = PASSAGES[0] as PassageRecord

/** A deep copy of the first bank passage after `f` edits it. */
function badPassage(f: (p: Mutable<PassageRecord> & AnyRecord) => void): PassageRecord {
  const p = clone(base) as Mutable<PassageRecord> & AnyRecord
  f(p)
  return p as unknown as PassageRecord
}

/** Longer text needs a longer source span (excerpt_bounds_match: the span only loses whitespace). */
const widen = (p: Mutable<PassageRecord>): void => {
  p.source.offsets.end += 50
}

/** Expect verifyPassage to reject with exactly these failed checks (in any order). */
function expectFails(p: PassageRecord, ...checks: string[]): void {
  const v = verifyPassage(p)
  expect(v.ok).toBe(false)
  const failed = v.reason.replace(/^failed: /, '').split(', ').sort()
  expect(failed).toEqual([...checks].sort())
}

/** A generated Franklin block (the first seed that draws it), so the edits below are concrete. */
const item: ReadingItem = (() => {
  for (let i = 0; ; i++) {
    const it = reading.generate(`verify-negatives-${i}`)
    if (it.spec.passage_id === base.id) return it
  }
})()

/** A deep copy of a generated item after `f` edits it (as loaded from JSON). */
function badItem(f: (x: AnyRecord & { spec: AnyRecord & { questions: AnyRecord[] }; key: AnyRecord }) => void): ReadingItem {
  const x = clone(item) as unknown as AnyRecord & { spec: AnyRecord & { questions: AnyRecord[] }; key: AnyRecord }
  f(x)
  return x as unknown as ReadingItem
}

function expectItemFails(bad: ReadingItem, ...checks: string[]): void {
  const v = verifyReading(bad)
  expect(v.ok).toBe(false)
  for (const c of checks) expect(v.reason).toMatch(new RegExp(`\\b${c}\\b`))
}

describe('verifyPassage: every bank passage passes', () => {
  it('accepts the bank', () => {
    for (const p of PASSAGES) expect(verifyPassage(p).ok, p.id).toBe(true)
    expect(Object.values(passageChecks(base)).every((v) => v)).toBe(true)
  })
})

describe('verifyPassage: negative cases, one per failure reason', () => {
  it('id_valid', () => {
    expectFails(badPassage((p) => (p.id = 'Bad Id')), 'id_valid', 'question_ids_valid')
  })

  it('paragraphs_clean: double space, markup, tab, empty list', () => {
    expectFails(badPassage((p) => ((p.paragraphs[0] = (p.paragraphs[0] as string).replace('small matters', 'small  matters')), widen(p))), 'paragraphs_clean')
    expectFails(badPassage((p) => ((p.paragraphs[0] = (p.paragraphs[0] as string).replace('small matters', '_small_ matters')), widen(p))), 'paragraphs_clean')
    // A tab is not a word separator either, so the recount changes too.
    const tab = verifyPassage(badPassage((p) => (p.paragraphs[0] = (p.paragraphs[0] as string).replace('small matters', 'small\tmatters'))))
    expect(tab.reason).toMatch(/paragraphs_clean/)
    expect(verifyPassage(badPassage((p) => (p.paragraphs = []))).reason).toMatch(/paragraphs_clean/)
  })

  it('no_boilerplate: Gutenberg header, licence or credit text in the passage', () => {
    // Same word count as "On the whole", so only the boilerplate check fails.
    for (const intrusion of ['Project Gutenberg whole', 'License, the whole', 'Copyright the whole', 'Produced by whom']) {
      const bad = badPassage((p) => ((p.paragraphs[1] = (p.paragraphs[1] as string).replace('On the whole', intrusion)), widen(p)))
      expectFails(bad, 'no_boilerplate')
    }
  })

  it('word_count_in_range: too short and too long (with the count updated to match)', () => {
    const recount = (p: Mutable<PassageRecord>): void => {
      p.word_count = countPassageWords(passageText(p.paragraphs))
      p.source.last_words = (p.paragraphs.at(-1) as string).split(' ').slice(-4).join(' ')
      p.source.offsets.end += 200 // the source span must cover the (longer) text
    }
    const short = badPassage((p) => ((p.paragraphs = p.paragraphs.slice(0, 2)), recount(p)))
    expect(short.word_count).toBe(321)
    expectFails(short, 'word_count_in_range')
    // 362 + 8 = 370 words is the inclusive maximum; 362 + 9 = 371 is out.
    const long = badPassage((p) => ((p.paragraphs = [...p.paragraphs, 'And one more sentence of eight words here.']), recount(p)))
    expect(long.word_count).toBe(370)
    expect(verifyPassage(long).ok).toBe(true)
    const tooLong = badPassage((p) => ((p.paragraphs = [...p.paragraphs, 'And one more sentence of nine words right here.']), recount(p)))
    expect(tooLong.word_count).toBe(371)
    expectFails(tooLong, 'word_count_in_range')
  })

  it('word_count_matches: the recorded count disagrees with the recount', () => {
    expectFails(badPassage((p) => (p.word_count += 1)), 'word_count_matches')
  })

  it('provenance_complete: a missing field, mismatched URLs, bad date, sha or offsets', () => {
    expectFails(badPassage((p) => delete (p.source as AnyRecord).title), 'provenance_complete')
    expectFails(badPassage((p) => (p.source.author = ' ')), 'provenance_complete')
    expectFails(badPassage((p) => (p.source.url = 'https://www.gutenberg.org/ebooks/1')), 'provenance_complete')
    expectFails(badPassage((p) => (p.source.text_url = 'https://example.org/pg.txt')), 'provenance_complete')
    expectFails(badPassage((p) => (p.source.gutenberg_ebook = 0)), 'provenance_complete')
    expectFails(badPassage((p) => (p.source.retrieved = '2026-02-30')), 'provenance_complete')
    expectFails(badPassage((p) => (p.source.retrieved = '26 Sep 2026')), 'provenance_complete')
    expectFails(badPassage((p) => (p.source.sha256 = 'abc')), 'provenance_complete')
    expectFails(badPassage((p) => (p.source.offsets = { start: 10, end: 10 })), 'provenance_complete', 'excerpt_bounds_match')
    expect(verifyPassage(badPassage((p) => ((p as AnyRecord).source = null))).ok).toBe(false)
  })

  it('year_before_1928: 1928 and later fail, 1927 passes (the §6.i cutoff is strict)', () => {
    expect(PUBLIC_DOMAIN_BEFORE).toBe(1928)
    expectFails(badPassage((p) => ((p.source.year = 1930), (p.source.era = '1930s'))), 'year_before_1928')
    expectFails(badPassage((p) => ((p.source.year = 1928), (p.source.era = '1920s'))), 'year_before_1928')
    expect(verifyPassage(badPassage((p) => ((p.source.year = 1927), (p.source.era = '1920s')))).ok).toBe(true)
  })

  it('era_matches_year: the era tag is not the decade of the year', () => {
    expectFails(badPassage((p) => (p.source.era = '1780s')), 'era_matches_year')
    expectFails(badPassage((p) => (p.source.era = '18th century')), 'era_matches_year')
  })

  it('excerpt_bounds_match: wrong first/last words or a source span shorter than the text', () => {
    expectFails(badPassage((p) => (p.source.first_words = 'I began now to turn our')), 'excerpt_bounds_match')
    expectFails(badPassage((p) => (p.source.last_words = 'means proposed of avoiding it.')), 'excerpt_bounds_match')
    expectFails(badPassage((p) => (p.source.first_words = 'I began')), 'excerpt_bounds_match')
    expectFails(badPassage((p) => (p.source.offsets = { start: 0, end: 100 })), 'excerpt_bounds_match')
  })

  it('three_questions and question_ids_valid', () => {
    expectFails(badPassage((p) => (p.questions = p.questions.slice(0, 2))), 'three_questions')
    expectFails(
      badPassage((p) => {
        const [a, b] = [p.questions[0], p.questions[1]]
        if (a && b) [a.id, b.id] = [b.id, a.id]
      }),
      'question_ids_valid',
    )
  })

  it('stems_clean: a stem that is not a question or has markup', () => {
    expectFails(badPassage((p) => ((p.questions[0] as AnyRecord).stem = 'Name the fee.')), 'stems_clean')
    expectFails(badPassage((p) => ((p.questions[0] as AnyRecord).stem = 'What [fee]?')), 'stems_clean')
  })

  it('four_options: three or five options', () => {
    expectFails(
      badPassage((p) => {
        const q = p.questions[0] as Mutable<PassageRecord['questions'][number]>
        q.options = q.options.slice(0, 3)
      }),
      'four_options',
    )
    expect(
      verifyPassage(
        badPassage((p) => {
          const q = p.questions[1] as Mutable<PassageRecord['questions'][number]>
          q.options = [...q.options, 'A fifth option']
        }),
      ).reason,
    ).toMatch(/four_options/)
  })

  it('options_clean and options_distinct', () => {
    expectFails(badPassage((p) => ((p.questions[0] as Mutable<PassageRecord['questions'][number]>).options[1] = 'Fifty pounds*')), 'options_clean')
    expectFails(badPassage((p) => ((p.questions[0] as Mutable<PassageRecord['questions'][number]>).options[1] = 'six Shillings a year')), 'options_distinct')
    expectFails(badPassage((p) => ((p.questions[0] as Mutable<PassageRecord['questions'][number]>).options[1] = 'SIX SHILLINGS A YEAR')), 'options_distinct')
  })

  it('key_in_range: out of range, negative, fractional or missing', () => {
    for (const k of [4, -1, 1.5, '0', null]) {
      expectFails(badPassage((p) => ((p.questions[2] as AnyRecord).key_index = k)), 'key_in_range')
    }
  })

  it('evidence_in_passage: not a substring, a newline, fewer than 3 words, missing', () => {
    expectFails(badPassage((p) => ((p.questions[0] as AnyRecord).evidence_span = 'paid him seven shillings a year')), 'evidence_in_passage')
    expectFails(badPassage((p) => ((p.questions[0] as AnyRecord).evidence_span = 'on the property.\n\nAbout this time')), 'evidence_in_passage')
    expectFails(badPassage((p) => ((p.questions[0] as AnyRecord).evidence_span = 'six shillings')), 'evidence_in_passage')
    expectFails(badPassage((p) => delete (p.questions[0] as AnyRecord).evidence_span), 'evidence_in_passage')
  })

  it('rationales_complete: a missing or empty rationale', () => {
    expectFails(
      badPassage((p) => {
        const q = p.questions[1] as Mutable<PassageRecord['questions'][number]>
        q.option_rationales = q.option_rationales.slice(0, 3)
      }),
      'rationales_complete',
    )
    expectFails(badPassage((p) => ((p.questions[1] as Mutable<PassageRecord['questions'][number]>).option_rationales[2] = '')), 'rationales_complete')
  })

  it('does not throw on garbage', () => {
    expect(verifyPassage(null as unknown as PassageRecord).ok).toBe(false)
    expect(verifyPassage({} as PassageRecord).ok).toBe(false)
  })

  it('bankProblems: too few passages and duplicates', () => {
    expect(bankProblems(PASSAGES.slice(0, 5))).toEqual(['the bank has 5 passages; need ≥ 6'])
    const dup = [...PASSAGES, base]
    expect(bankProblems(dup)).toEqual([`duplicate passage id ${base.id}`, `${base.id}: duplicate passage text`])
  })
})

describe('verifyReading: item-level negative cases', () => {
  it('accepts a generated item and its JSON copy', () => {
    expect(verifyReading(item)).toMatchObject({ ok: true, reason: 'ok' })
    expect(verifyReading(clone(item)).ok).toBe(true)
  })

  it('key_matches_bank: a shifted key index', () => {
    expectItemFails(badItem((x) => ((x.key.indices as number[])[1] = (((x.key.indices as number[])[1] as number) + 1) % 4)), 'key_matches_bank')
  })

  it('key_shape: missing, extra or short key fields (the key is { indices } only, 1.2.0)', () => {
    expectItemFails(badItem((x) => (x.key = {})), 'key_shape')
    expectItemFails(badItem((x) => (x.key = { ...x.key, answer: 1 })), 'key_shape')
    // An evidence list in the key is the pre-1.2.0 shape: evidence spans stay out of items (A14).
    expectItemFails(badItem((x) => (x.key = { ...x.key, evidence: ['a', 'b', 'c'] })), 'key_shape')
    expectItemFails(badItem((x) => (x.key.indices = (x.key.indices as number[]).slice(0, 2))), 'key_shape')
  })

  it('items carry no evidence spans or rationales, and the item checks do not need them', () => {
    expect(Object.keys(item.key)).toEqual(['indices'])
    const text = JSON.stringify(item)
    expect(text).not.toMatch(/"(evidence|evidence_span|option_rationales)"/)
    expect(Object.keys(passageChecks(base))).not.toContain('evidence_in_passage')
    expect(Object.keys(verifyPassage(base).checks)).toEqual(expect.arrayContaining(['evidence_in_passage', 'rationales_complete']))
  })

  it('key_in_range: an index past the options', () => {
    expectItemFails(badItem((x) => ((x.key.indices as number[])[0] = 7)), 'key_in_range', 'key_matches_bank')
  })

  it('options_match_bank and options_distinct: a replaced or duplicated option', () => {
    expectItemFails(badItem((x) => ((x.spec.questions[2]?.options as string[])[0] = 'An invented option')), 'options_match_bank')
    expectItemFails(
      badItem((x) => {
        const o = x.spec.questions[2]?.options as string[]
        o[1] = o[0] as string
      }),
      'options_match_bank',
      'options_distinct',
    )
  })

  it('passage_known and spec_matches_bank: unknown passage or edited text', () => {
    expectItemFails(badItem((x) => (x.spec.passage_id = 'no-such-passage')), 'passage_known', 'spec_matches_bank', 'structure_matches')
    expectItemFails(
      badItem((x) => ((x.spec.paragraphs as string[])[0] = ((x.spec.paragraphs as string[])[0] as string).replace('city watch', 'town watch'))),
      'spec_matches_bank',
    )
    expectItemFails(badItem((x) => ((x.spec.questions[0] as AnyRecord).stem = 'What was the fee?')), 'spec_matches_bank')
  })

  it('word_count_matches, no_boilerplate, provenance_complete run on the item content too', () => {
    expectItemFails(badItem((x) => (x.spec.word_count = 999)), 'word_count_matches', 'spec_matches_bank')
    expectItemFails(
      badItem((x) => ((x.spec.paragraphs as string[])[1] = 'The Project Gutenberg eBook of this text.')),
      'no_boilerplate',
      'spec_matches_bank',
    )
    expectItemFails(badItem((x) => delete (x.spec.source as AnyRecord).sha256), 'provenance_complete')
  })

  it('params_match: wrong d, lam, sigma or model', () => {
    const p = item.params as { lam: number; d: number; sigma: number }
    expectItemFails(badItem((x) => (x.params = { ...p, model: 'gaussian', d: p.d + 0.01 })), 'params_match')
    expectItemFails(badItem((x) => (x.params = { ...p, model: 'gaussian', lam: -0.25 })), 'params_match')
    expectItemFails(badItem((x) => (x.params = { ...p, model: 'gaussian', sigma: 0.15 })), 'params_match')
    expectItemFails(badItem((x) => (x.params = { model: '3pl', a: 1, b: 0.4, c: 0.25 })), 'params_match')
    expectItemFails(badItem((x) => (x.options_count = 4)), 'params_match')
  })

  it('prior_matches and stratum_matches: a changed prior, feature or stratum', () => {
    expectItemFails(badItem((x) => ((x.difficulty as AnyRecord).provenance = 'made up')), 'prior_matches')
    expectItemFails(badItem((x) => (((x.difficulty as AnyRecord).features as AnyRecord).words = 1)), 'prior_matches')
    expectItemFails(badItem((x) => ((x.difficulty as AnyRecord).b_prior = 1.6)), 'prior_matches', 'stratum_matches', 'params_match')
    expectItemFails(badItem((x) => (x.stratum = 4)), 'stratum_matches')
  })

  it('structure_matches: family structure of another passage', () => {
    expectItemFails(badItem((x) => (x.structural_params = { passage_id: 'darwin-beagle-1845' })), 'structure_matches')
  })

  it('expected_time_matches: a changed expected time', () => {
    expectItemFails(badItem((x) => (x.expected_time_s = (x.expected_time_s as number) + 1)), 'expected_time_matches')
  })

  it('does not throw on malformed items', () => {
    for (const bad of [
      badItem((x) => ((x as AnyRecord).spec = null)),
      badItem((x) => ((x.spec as AnyRecord).questions = 'none')),
      badItem((x) => ((x as AnyRecord).key = [])),
      badItem((x) => ((x.spec as AnyRecord).paragraphs = 'one string')),
      badItem((x) => ((x as AnyRecord).difficulty = null)),
    ]) {
      const v = verifyReading(bad)
      expect(v.ok).toBe(false)
    }
  })
})
