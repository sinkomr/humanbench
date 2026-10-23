/**
 * The syllogism generator (DESIGN §3 row 2, §4.2; ROADMAP A1, A9, A11): five-option formal-deduction items from three
 * templates, drawn only from the seeded stream.
 *
 * 1. `categorical`: two statements over three made-up words (All / No / Some / Some … not, every figure);
 * 2. `chain`: 3–5 statements over 4–6 made-up words linked in a chain (a sorites), with negative and particular
 *    statements, listed along the chain or scrambled;
 * 3. `conditional`: 2–4 everyday statements over 2–5 propositions of one scene, built on a chain of 1–3 implications
 *    ("If …, then …", "… only if …", "… unless …", "Either …, or …, or both", or the contrapositive), an optional side
 *    rule that sets up a fallacy, and usually a plain fact.
 *
 * Each draw picks a template and a question ("must be true", "could be true", "must be false") with weights that
 * depend on the requested stratum, draws the statements, then lists every candidate option over the item's terms
 * (`logic.ts`), keeps those not equivalent to a statement (and, for conditionals, not true only by the material
 * reading), and takes the key from those that answer the question under both readings of existential import and needs
 * the statements together, the distractors from those that fail under both (classic errors weighted 3:1), until the
 * option-only cue checks pass. The draw is kept when the v0 prior's stratum is the one requested; otherwise the next
 * draw follows (natural pool: the stratum is drawn uniformly first).
 */

import type { BuiltItem, BuildContext } from '../family'
import type { Rng } from '../../engine/prng'
import type { Stratum } from '../ids'
import { stratumOfB } from '../priors'
import { INTRO, NONCE_WORDS, QUESTION_TEXT, SCENES, type Question } from './lexicon'
import {
  FALLACY_TYPES,
  MAX_ATOMS,
  allCatStatements,
  allCondOptions,
  answers,
  catSat,
  catText,
  condSat,
  condText,
  distractorType,
  equivalent,
  isVacuousConditional,
  needsCombination,
  negates,
  statusOf,
  structureOf,
  termsOf,
  type CatForm,
  type CatStatement,
  type CondStatement,
  type Lit,
  type LogicItem,
  type Statement,
  type Template,
} from './logic'
import { cueChecks, featuresOf, readSpec } from './item'
import { SYLLOGISM_PROVENANCE, SYLLOGISM_SD_PRIOR, syllogismBPrior, syllogismExpectedTime } from './prior'
import { SYLLOGISM_OPTIONS, type SyllogismKey, type SyllogismSpec } from './spec'

export const SYLLOGISM_STRATA: readonly Stratum[] = Object.freeze([1, 2, 3, 4, 5, 6] as const)

type Weights<T> = readonly (readonly [T, number])[]

/** [SPEC] Template weights per requested stratum (the prior decides the stratum; these only aim the draws). */
const TEMPLATE_WEIGHTS: Readonly<Record<Stratum, Weights<Template>>> = {
  1: [['categorical', 1], ['conditional', 1]],
  2: [['categorical', 2], ['chain', 1], ['conditional', 2]],
  3: [['categorical', 1], ['chain', 1], ['conditional', 1]],
  4: [['categorical', 1], ['chain', 2], ['conditional', 2]],
  5: [['categorical', 1], ['chain', 2], ['conditional', 2]],
  6: [['chain', 1], ['conditional', 1]],
}

const QUESTION_WEIGHTS: Readonly<Record<Stratum, Weights<Question>>> = {
  1: [['must_true', 1]],
  2: [['must_true', 3], ['could_true', 1]],
  3: [['must_true', 2], ['could_true', 2], ['must_false', 1]],
  4: [['must_true', 1], ['could_true', 1], ['must_false', 1]],
  5: [['must_true', 1], ['could_true', 2], ['must_false', 2]],
  6: [['must_true', 1], ['could_true', 2], ['must_false', 3]],
}

/** Statements of a chain item per requested stratum. */
const CHAIN_PREMISES: Readonly<Record<Stratum, readonly number[]>> = {
  1: [3],
  2: [3],
  3: [3, 4],
  4: [3, 4, 5],
  5: [4, 5],
  6: [5],
}

/** Implication links of a conditional item per requested stratum. */
const COND_LINKS: Readonly<Record<Stratum, readonly number[]>> = {
  1: [1],
  2: [1, 2],
  3: [1, 2],
  4: [2, 3],
  5: [2, 3],
  6: [3],
}

/** Draws per item before giving up (a draw is cheap: exact checks on ≤ 64-bit masks). */
export const MAX_DRAWS = 4000
const SELECT_TRIES = 30

function weighted<T>(rng: Rng, ws: Weights<T>): T {
  const total = ws.reduce((a, [, w]) => a + w, 0)
  let r = rng.next() * total
  for (const [v, w] of ws) {
    if (r < w) return v
    r -= w
  }
  return (ws[ws.length - 1] as readonly [T, number])[0]
}

/** n made-up words with different first letters. */
function pickWords(rng: Rng, n: number): string[] {
  const out: string[] = []
  for (const w of rng.shuffle(NONCE_WORDS)) {
    if (out.length === n) break
    if (!out.some((o) => o[0] === w[0])) out.push(w)
  }
  return out
}

const CAT_FORMS: Weights<CatForm> = [
  ['A', 9],
  ['E', 4],
  ['I', 4],
  ['O', 3],
]

/** One link between terms a and b in a random form and direction. */
function randomLink(rng: Rng, a: number, b: number): CatStatement {
  const form = weighted(rng, CAT_FORMS)
  return rng.next() < 0.5 ? { form, x: a, y: b } : { form, x: b, y: a }
}

/**
 * A chain proposal with an end-to-end conclusion: All-links forward, then at most one negative link (No, either
 * direction), then All-links backward; the first link may be particular (Some, or Some … not when it is also the
 * negative one); sometimes one link is redrawn at random. The exact check decides what follows.
 */
function provableChain(rng: Rng, n: number): CatStatement[] {
  const links = n - 1
  const negAt = rng.next() < 0.45 ? -1 : rng.int(0, links - 1)
  const particular = rng.next() < 0.35
  const out: CatStatement[] = []
  for (let i = 0; i < links; i++) {
    const fwd = negAt < 0 || i < negAt
    if (i === negAt) out.push(rng.next() < 0.5 ? { form: 'E', x: i, y: i + 1 } : { form: 'E', x: i + 1, y: i })
    else out.push(fwd ? { form: 'A', x: i, y: i + 1 } : { form: 'A', x: i + 1, y: i })
  }
  if (particular) {
    if (negAt === 0) out[0] = { form: 'O', x: 0, y: 1 }
    else out[0] = rng.next() < 0.5 ? { form: 'I', x: 0, y: 1 } : { form: 'I', x: 1, y: 0 }
  }
  if (rng.next() < 0.25) {
    const i = rng.int(0, links - 1)
    out[i] = randomLink(rng, i, i + 1)
  }
  return out
}

function randomChain(rng: Rng, n: number): CatStatement[] {
  return Array.from({ length: n - 1 }, (_, i) => randomLink(rng, i, i + 1))
}

/** [SPEC] Chance that a chain is listed out of chain order, per requested stratum. */
const SCRAMBLE: Readonly<Record<Stratum, number>> = { 1: 0, 2: 0.1, 3: 0.3, 4: 0.5, 5: 0.6, 6: 0.7 }

/** A draft: the abstract item before its words, with the key and its candidates. */
interface Draft {
  readonly template: Template
  readonly question: Question
  readonly logic: LogicItem
  readonly key: Statement
  readonly pool: readonly Statement[]
  readonly text: (s: Statement) => string
  readonly intro: boolean
}

/** The key and distractor candidates of a set of statements, or null when there are too few. */
function candidates(
  rng: Rng,
  logic: LogicItem,
  question: Question,
  all: readonly Statement[],
  keyFilter: (s: Statement) => boolean,
  prefer: (s: Statement) => boolean,
): { key: Statement; pool: Statement[] } | null {
  const keys: Statement[] = []
  const pool: Statement[] = []
  for (const s of all) {
    const st = statusOf(logic, s)
    const a0 = answers(question, st, 0)
    const a1 = answers(question, st, 1)
    if (a0 && a1) {
      if (keyFilter(s) && needsCombination(logic, question, s)) keys.push(s)
    } else if (!a0 && !a1) pool.push(s)
  }
  if (keys.length === 0 || pool.length < SYLLOGISM_OPTIONS - 1) return null
  const preferred = keys.filter(prefer)
  return { key: rng.pick(preferred.length > 0 ? preferred : keys), pool }
}

function drawCat(rng: Rng, k: Stratum, template: Template, question: Question): Draft | null {
  const nPremises = template === 'categorical' ? 2 : rng.pick(CHAIN_PREMISES[k])
  const n = nPremises + 1
  const chain = question === 'must_true' && (template === 'chain' || rng.next() < 0.5) ? provableChain(rng, n) : randomChain(rng, n)
  if (!catSat(n, chain, 1)) return null
  let shown: CatStatement[]
  if (template === 'categorical') shown = rng.shuffle(chain)
  else if (rng.next() < SCRAMBLE[k]) shown = rng.shuffle(chain)
  else shown = rng.next() < 0.5 ? chain : [...chain].reverse()
  const logic: LogicItem = { kind: 'cat', n, premises: shown, options: [] }
  const linked = new Set(shown.map((p) => termsOf(p).join(',')))
  const all = allCatStatements(n).filter((s) => !shown.some((p) => equivalent(logic, s, p)))
  const ends = `0,${n - 1}`
  const c = candidates(
    rng,
    logic,
    question,
    all,
    (s) => !linked.has(termsOf(s).join(',')),
    (s) => (question === 'must_true' ? termsOf(s).join(',') === ends : question === 'could_true' ? !statusOf(logic, s).entailed[1] : true),
  )
  if (c === null) return null
  const words = pickWords(rng, n)
  return { template, question, logic, key: c.key, pool: c.pool, text: (s) => catText(s as CatStatement, words), intro: true }
}

/** [SPEC] Chance of a side rule (a fallacy set-up over one more proposition) and of a scrambled fact, per stratum. */
const SIDE: Readonly<Record<Stratum, number>> = { 1: 0, 2: 0.3, 3: 0.4, 4: 0.5, 5: 0.5, 6: 0.6 }
const COND_SCRAMBLE: Readonly<Record<Stratum, number>> = { 1: 0, 2: 0, 3: 0.2, 4: 0.3, 5: 0.4, 6: 0.5 }

type LinkForm = 'if' | 'contra' | 'only_if' | 'or' | 'unless'

const neg = (l: Lit): Lit => ({ atom: l.atom, neg: !l.neg })

/** The link a → b in one of the surface forms (unless needs a negative a, so its clause is positive). */
function linkOf(rng: Rng, k: Stratum, a: Lit, b: Lit): CondStatement {
  const hard = k >= 5
  const forms: [LinkForm, number][] = [
    ['if', k <= 1 ? 6 : hard ? 1 : 3],
    ['contra', k <= 2 ? 0 : 1],
    ['only_if', k <= 1 ? 0 : hard ? 3 : 2],
    ['or', k <= 1 ? 0 : hard ? 2 : 1],
  ]
  if (a.neg) forms.push(['unless', k <= 2 ? 0 : hard ? 4 : 2])
  switch (weighted(rng, forms.filter(([, w]) => w > 0))) {
    case 'if':
      return { form: 'if', a, b }
    case 'contra':
      return { form: 'if', a: neg(b), b: neg(a) }
    case 'only_if':
      return { form: 'only_if', a, b }
    case 'or':
      return rng.next() < 0.5 ? { form: 'or', a: neg(a), b } : { form: 'or', a: b, b: neg(a) }
    case 'unless':
      return { form: 'unless', a: b, b: neg(a) }
  }
}

function drawCond(rng: Rng, k: Stratum, question: Question): Draft | null {
  const links = rng.pick(COND_LINKS[k])
  let side = rng.next() < SIDE[k] ? 1 : 0
  const modes = question === 'must_true' && links >= 2 ? (['forward', 'backward', 'none'] as const) : (['forward', 'backward'] as const)
  const mode = rng.pick(modes)
  if (links + (mode === 'none' ? 0 : 1) + side > 4) side = 0
  // One more proposition than the statements use, for the options alone (an unsupported claim to rule out).
  const m = Math.min(MAX_ATOMS, links + 2 + side)
  const negP = k <= 1 ? 0.1 : k >= 5 ? 0.45 : 0.3
  const lits: Lit[] = Array.from({ length: links + 1 }, (_, i) => ({ atom: i, neg: rng.next() < negP }))
  const rules: CondStatement[] = []
  for (let i = 0; i < links; i++) rules.push(linkOf(rng, k, lits[i] as Lit, lits[i + 1] as Lit))
  if (side === 1) {
    const z: Lit = { atom: links + 1, neg: rng.next() < negP }
    const target = lits[rng.int(0, links)] as Lit
    const rule: CondStatement = rng.next() < 0.6 || k <= 2 ? { form: 'if', a: z, b: target } : { form: 'only_if', a: z, b: target }
    rules.splice(rng.int(0, rules.length), 0, rule)
  }
  const premises = [...rules]
  if (mode !== 'none') {
    const fact: CondStatement = { form: 'fact', a: mode === 'forward' ? (lits[0] as Lit) : neg(lits[links] as Lit) }
    const at = rng.next() < COND_SCRAMBLE[k] ? rng.int(0, rules.length - 1) : rules.length
    premises.splice(at, 0, fact)
  }
  if (premises.length < 2 || !condSat(m, premises, undefined, 0) || !condSat(m, premises, undefined, 1)) return null
  const logic: LogicItem = { kind: 'cond', n: m, premises, options: [] }
  const all = allCondOptions(m).filter((s) => !premises.some((p) => equivalent(logic, s, p)) && !isVacuousConditional(m, premises, s))
  const c = candidates(
    rng,
    logic,
    question,
    all,
    () => true,
    (s) => (question === 'could_true' ? !statusOf(logic, s).entailed[0] : true),
  )
  if (c === null) return null
  const scene = rng.pick(SCENES)
  const props = rng.shuffle(scene.propositions).slice(0, m)
  return { template: 'conditional', question, logic, key: c.key, pool: c.pool, text: (s) => condText(s as CondStatement, props), intro: false }
}

/** The four distractors and the display order, or null when no draw passes the cue checks. */
function chooseOptions(rng: Rng, d: Draft): { order: Statement[]; keyIndex: number } | null {
  const pool = d.pool.filter((s) => !negates(d.logic, s, d.key))
  if (pool.length < SYLLOGISM_OPTIONS - 1) return null
  const weights = pool.map((s) => (FALLACY_TYPES.has(distractorType(d.logic, d.key, s)) ? 3 : 1))
  for (let t = 0; t < SELECT_TRIES; t++) {
    const avail = pool.map((_, i) => i)
    const chosen: Statement[] = []
    while (chosen.length < SYLLOGISM_OPTIONS - 1 && avail.length > 0) {
      const total = avail.reduce((a, i) => a + (weights[i] as number), 0)
      let r = rng.next() * total
      let at = avail.length - 1
      for (let j = 0; j < avail.length; j++) {
        const w = weights[avail[j] as number] as number
        if (r < w) {
          at = j
          break
        }
        r -= w
      }
      const s = pool[avail[at] as number] as Statement
      avail.splice(at, 1)
      if (chosen.some((c) => equivalent(d.logic, c, s))) continue
      chosen.push(s)
    }
    if (chosen.length < SYLLOGISM_OPTIONS - 1) return null
    const order = rng.shuffle([d.key, ...chosen])
    const keyIndex = order.indexOf(d.key)
    const texts = order.map(d.text)
    if (new Set(texts).size !== texts.length) continue
    if (Object.values(cueChecks(texts, order, keyIndex)).every((v) => v)) return { order, keyIndex }
  }
  return null
}

function draw(rng: Rng, k: Stratum): BuiltItem<SyllogismSpec, SyllogismKey> | null {
  const template = weighted(rng, TEMPLATE_WEIGHTS[k])
  const question = weighted(rng, QUESTION_WEIGHTS[k])
  const d = template === 'conditional' ? drawCond(rng, k, question) : drawCat(rng, k, template, question)
  if (d === null) return null
  // The prior needs only the statements, the question and the key: check the stratum before choosing distractors.
  const early = featuresOf({ template, question, logic: { ...d.logic, options: [d.key] } as LogicItem }, 0, [])
  if (stratumOfB(syllogismBPrior(early)) !== k) return null
  const chosen = chooseOptions(rng, d)
  if (chosen === null) return null
  const spec: SyllogismSpec = {
    ...(d.intro ? { intro: INTRO } : {}),
    premises: d.logic.premises.map(d.text),
    question: QUESTION_TEXT[question],
    options: chosen.order.map(d.text),
  }
  const read = readSpec(spec)
  if (typeof read === 'string') throw new Error(`syllogism: a generated spec does not read back: ${read}`)
  const key = read.logic.options[chosen.keyIndex] as Statement
  const types = read.logic.options.filter((_, i) => i !== chosen.keyIndex).map((s) => distractorType(read.logic, key, s))
  const features = featuresOf(read, chosen.keyIndex, types)
  const bPrior = syllogismBPrior(features)
  const stratum = stratumOfB(bPrior)
  if (stratum !== k) throw new Error('syllogism: the prior moved between the draft and the item')
  return {
    stratum,
    spec,
    key: { index: chosen.keyIndex },
    structural_params: structureOf(read.template, read.question, read.logic, key) as unknown as BuiltItem<SyllogismSpec, SyllogismKey>['structural_params'],
    options_count: SYLLOGISM_OPTIONS,
    difficulty: { features, b_prior: bPrior, sd_prior: SYLLOGISM_SD_PRIOR, provenance: SYLLOGISM_PROVENANCE },
    expected_time_s: syllogismExpectedTime(spec),
  }
}

export function buildSyllogism(rng: Rng, ctx: BuildContext): BuiltItem<SyllogismSpec, SyllogismKey> {
  const k = ctx.stratum ?? rng.pick(SYLLOGISM_STRATA)
  for (let i = 0; i < MAX_DRAWS; i++) {
    const item = draw(rng, k)
    if (item !== null) return item
  }
  throw new Error(`syllogism: no item for stratum ${k} in ${MAX_DRAWS} draws (seed ${ctx.seed})`)
}
