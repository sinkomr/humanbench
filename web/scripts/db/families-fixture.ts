/**
 * Made-up items of the remaining families for the database tests (ROADMAP M3.11; owner decisions 2026-10-13): Fermi
 * estimates, word-links puzzles, emotion vignettes, situational judgments and logic games, in the shapes the bank's
 * records store (`hb.fermi`, `hb.rat`, `hb.emo`, `hb.sjt`, `hb.gen.logic`; read for their shapes only). Everything is
 * drawn at run time from a seeded PRNG and says it is made up: the "truths", accept lists and rating profiles are
 * PRNG numbers and nonsense words, nothing is, or is derived from, a real item or a real key (CLAUDE.md), and the rows
 * live only in a throw-away database. The nonsense words double as canaries: none may ever appear in a reply.
 */

import { createHash } from 'node:crypto'
import { createRng } from '../../src/engine/prng'
import { fermiParams } from '../../src/tasks/priors'
import type { FixtureItem } from './bank-fixture'

const hex12 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12)
const round3 = (x: number): number => Math.round(x * 1000) / 1000

/** Made-up words of letters only, distinct per seed (canaries: a reply that holds one has leaked a key). */
function nonsense(rng: ReturnType<typeof createRng>, n: number, prefix = 'zq'): string {
  const c = 'bcdfghjklmnpqrstvwxz'
  const v = 'aeiou'
  let out = prefix
  for (let i = 0; i < n; i++) out += (i % 2 === 0 ? c : v)[rng.int(0, (i % 2 === 0 ? c : v).length - 1)]
  return out
}

/** The Fermi truths' made-up unit set: plain counts. */
export const FERMI_UNITS = ['count', 'thousand', 'million', 'billion'] as const

/**
 * Made-up Fermi estimates on FER: a stem that says it is made up, `media` as `fermi_v1` stores it, the truth (a
 * decimal text from the PRNG, in counts, with an uncertainty from 0 to 0.3 dex) as the private key, and the prior row
 * `fermiParams(δ)` in `extra` with a and b null, as the bank's Gaussian rows are.
 */
export function fermiItems(count: number, seed = 'fermi'): FixtureItem[] {
  const rng = createRng(`fermi:${seed}`)
  return Array.from({ length: count }, (_, k): FixtureItem => {
    const familyId = `f:fermi:${hex12(`${seed}:${k}`)}`
    const delta = round3(rng.normal(0, 0.8))
    const p = fermiParams(delta)
    const mantissa = (1 + rng.next() * 8.999).toFixed(4)
    const exponent = rng.int(5, 7) // (truths of a few million: an answer of 3e6 is at most about two dex off)
    const u = [0, 0.05, 0.15, 0.2, 0.3][k % 5]!
    return {
      itemId: `i:fermi:v1:${seed}-${String(k).padStart(3, '0')}`,
      familyId,
      siblingGroup: familyId,
      axis: 'FER',
      facet: 'made_up',
      itemType: 'numeric',
      storedType: 'fermi_estimate',
      model: 'gaussian',
      a: 1,
      b: 0,
      c: null,
      nOptions: 0,
      key: { true_value: `${mantissa}e${exponent}`, unit: 'count', as_of_date: '2026-01-01', true_value_uncertainty_log10: u },
      status: 'live',
      practiceOnly: false,
      generator: undefined,
      expectedTimeS: 45 + 5 * (k % 4),
      nullParams: 'ab',
      extra: { lam: p.lam, d: p.d, sigma: p.sigma },
      payload: {
        stem: `Made-up estimate ${k + 1}: how many placeholder tokens are in made-up heap number ${k + 1}? (No real question.)`,
        media: { renderer: 'fermi_v1', dimension: 'count', units: [...FERMI_UNITS], interval_pct: 80 },
      },
    }
  })
}

/** Made-up word-links puzzles on CRE: three nonsense cues and a nonsense answer with one made-up variant spelling. */
export function ratItems(count: number, seed = 'rat'): FixtureItem[] {
  const rng = createRng(`rat:${seed}`)
  return Array.from({ length: count }, (_, k): FixtureItem => {
    const familyId = `f:rat:${hex12(`${seed}:${k}`)}`
    // the answers have a prefix of their own, so no cue can contain one (a canary must be found only where it leaked)
    const answer = `${nonsense(rng, 5, 'xw')}${k}`.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]!)
    const cues = [nonsense(rng, 4), nonsense(rng, 5), nonsense(rng, 4)]
    return {
      itemId: `i:rat:v1:${cues.join('-')}`,
      familyId,
      siblingGroup: familyId,
      axis: 'CRE',
      facet: 'remote_associates',
      itemType: 'mc',
      storedType: 'rat_triad',
      model: '2pl',
      a: 1,
      b: round3(rng.normal(0, 0.8)),
      c: null,
      nOptions: 0,
      key: { answer, accept: [answer, `${answer}e`] },
      status: 'live',
      practiceOnly: false,
      generator: undefined,
      expectedTimeS: 20,
      payload: { stem: cues.join(' / '), media: { renderer: 'rat_triad_v1', cues } },
    }
  })
}

const EMOTIONS = ['joy', 'pride', 'gratitude', 'hope', 'relief', 'fear', 'anger', 'frustration', 'sadness', 'guilt', 'regret', 'surprise'] as const

/** Made-up emotion vignettes on EMO: a scenario that says it is made up, five feelings, an `{index, emotion}` key (2PL). */
export function vignetteItems(count: number, seed = 'emo'): FixtureItem[] {
  const rng = createRng(`emo:${seed}`)
  return Array.from({ length: count }, (_, k): FixtureItem => {
    const familyId = `f:emo:${hex12(`${seed}:${k}`)}`
    const options = rng.shuffle([...EMOTIONS]).slice(0, 5)
    const index = rng.int(0, 4)
    return {
      itemId: `i:emo:v1:${seed}-${String(k).padStart(3, '0')}`,
      familyId,
      siblingGroup: familyId,
      axis: 'EMO',
      facet: 'appraisal',
      itemType: 'mc',
      storedType: 'emotion_vignette_mc',
      model: '2pl',
      a: 1,
      b: round3(rng.normal(0, 0.8)),
      c: null,
      nOptions: 5,
      key: { index, emotion: options[index]! },
      status: 'live',
      practiceOnly: false,
      generator: undefined,
      expectedTimeS: 22,
      payload: {
        stem: `Made-up situation ${k + 1}: Sam reads placeholder text number ${k + 1}, which says nothing real. How is Sam most likely to feel?`,
        media: { renderer: 'emotion_vignette_v1' },
        options,
      },
    }
  })
}

/**
 * Made-up situational judgments on EMO: a scenario, a question, four responses, a rating profile from the PRNG
 * (`{ratings, best, worst, source}`, the bank's key) and the GRM prior row (a 0.8, thresholds b − 1, b, b + 1; b null).
 */
export function sjtItems(count: number, seed = 'sjt'): FixtureItem[] {
  const rng = createRng(`sjt:${seed}`)
  return Array.from({ length: count }, (_, k): FixtureItem => {
    const familyId = `f:sjt:${hex12(`${seed}:${k}`)}`
    const ratings = Array.from({ length: 4 }, () => Math.round((1 + rng.next() * 3) * 1e6) / 1e6)
    const best = ratings.indexOf(Math.max(...ratings))
    const worst = ratings.indexOf(Math.min(...ratings))
    const b = round3(rng.normal(0, 0.6))
    return {
      itemId: `i:sjt:v1:${seed}-${String(k).padStart(3, '0')}`,
      familyId,
      siblingGroup: familyId,
      axis: 'EMO',
      facet: 'situational_judgment',
      itemType: 'mc',
      storedType: 'sjt_rating',
      model: 'grm',
      a: 0.8,
      b,
      c: null,
      nOptions: 4,
      key: { ratings, best, worst, source: 'author_provisional' },
      status: 'live',
      practiceOnly: false,
      generator: undefined,
      expectedTimeS: 55,
      nullParams: 'b',
      extra: { thresholds: [round3(b - 1), b, round3(b + 1)] },
      payload: {
        stem: `Made-up situation ${k + 1}: you are in placeholder scene ${k + 1}, which describes nothing real.`,
        media: { renderer: 'sjt_rating_v1', question: 'How well would each response work? (made up)' },
        options: ['Made-up response A', 'Made-up response B', 'Made-up response C', 'Made-up response D'].map((r) => `${r} ${k + 1}`),
      },
    }
  })
}

/** Made-up logic games on LG: `games` setups of 3 and 4 questions in turn, each question an `{index}` key (2PL-testlet). */
export function logicGameItems(games: number, seed = 'lg'): FixtureItem[] {
  const rng = createRng(`lg:${seed}`)
  const out: FixtureItem[] = []
  for (let g = 0; g < games; g++) {
    const familyId = `f:lg:${hex12(`${seed}:${g}`)}`
    const setup = `Made-up game ${g + 1} places five tokens (P, Q, R, S and T) in slots 1 through 5. P is before Q. R is not in slot ${1 + (g % 5)}. S and T are not next to each other.`
    const n = 3 + (g % 2)
    for (let q = 0; q < n; q++) {
      out.push({
        itemId: `i:lg:1.0.0:${seed}-${g}/q${q + 1}`,
        familyId,
        siblingGroup: familyId,
        axis: 'LG',
        facet: 'ordering',
        itemType: 'mc',
        storedType: 'mc_logic_game',
        model: '2pl_testlet',
        a: 1,
        b: round3(rng.normal(0, 0.8)),
        c: null,
        nOptions: 5,
        key: { index: rng.int(0, 4) },
        status: 'live',
        practiceOnly: false,
        generator: undefined,
        expectedTimeS: 80,
        payload: {
          stem: `Made-up question ${q + 1} about game ${g + 1}: which placeholder could be true?`,
          media: { renderer: 'logic_game_v1', setup },
          options: ['A', 'B', 'C', 'D', 'E'].map((x) => `Made-up option ${x}`),
        },
      })
    }
  }
  return out
}
