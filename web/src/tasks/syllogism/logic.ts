/**
 * The exact semantics of the syllogism family (DESIGN §4.2 "formal logic": validity by model enumeration; G2/G3), shared
 * by the generator and the verifier. The bank twin (`hb.gen.syllogism`) implements the same definitions.
 *
 * ## Categorical statements (templates `categorical` and `chain`)
 *
 * Over n ≤ 6 terms, a model is the set of NON-EMPTY regions of the n-term Venn diagram: region r ∈ [0, 2ⁿ) holds the
 * things that are in exactly the terms whose bit is set in r. Every statement is one constraint on that set:
 *
 *     All X are Y        the regions in X and not in Y are all empty      (universal)
 *     No X are Y         the regions in X and in Y are all empty          (universal)
 *     Some X are Y       some region in X and in Y is non-empty           (existential)
 *     Some X are not Y   some region in X and not in Y is non-empty       (existential)
 *
 * and its negation is the other kind on the same regions (All ↔ Some-not, No ↔ Some). A set of such constraints is
 * satisfiable iff every existential region set keeps a region outside the union E of the universal sets (make every
 * region outside E non-empty: existential constraints only gain from more non-empty regions), so satisfiability,
 * entailment (P ⊨ s iff P ∧ ¬s is unsatisfiable) and equivalence are exact, with no search: the method enumerates all
 * 2^(2ⁿ) models implicitly. Region sets are 64-bit masks held as two uint32 halves.
 *
 * **Existential import.** Two readings are checked: the modern one (no term need have members) and the traditional one
 * (every term of the item has members: one existential constraint per term). An item is accepted only if its key is
 * right and every other option is wrong under BOTH readings, so it has one defensible answer either way.
 *
 * ## Propositional statements (template `conditional`)
 *
 * Over m ≤ 5 atoms, a statement is its truth table, a 2^m ≤ 32-bit mask of the rows where it holds: "If p, then q" and
 * "p only if q" are ¬p ∨ q, "p unless q" is "if not q, then p" (p ∨ q), "Either p, or q, or both" is the inclusive
 * p ∨ q, and a fact is its literal. Entailment and equivalence are mask comparisons.
 *
 * **Two readings of "unless".** Some readers hear "p unless q" as exclusive (p exactly when not q: p xor q). As with
 * existential import, a conditional item is kept only if its key answers and every distractor fails under both the
 * inclusive and the exclusive reading. ("Either …, or …, or both" says it is inclusive, so it has one reading.)
 */

import { NONCE_WORDS, QUESTION_TEXT, SCENES, phraseOf, plural, type Proposition, type Question } from './lexicon'

export type Template = 'categorical' | 'chain' | 'conditional'

export const TEMPLATES: readonly Template[] = Object.freeze(['categorical', 'chain', 'conditional'] as const)

/** A categorical form (the traditional letters). */
export type CatForm = 'A' | 'E' | 'I' | 'O'

/** A categorical statement: subject x and predicate y (term indices), in the order the sentence says them. */
export interface CatStatement {
  readonly form: CatForm
  readonly x: number
  readonly y: number
}

/** A literal: an atom (index) or its negation. */
export interface Lit {
  readonly atom: number
  readonly neg: boolean
}

export type CondForm = 'fact' | 'if' | 'only_if' | 'unless' | 'or' | 'and'

/**
 * A propositional statement. `if`: "If a, then b."; `only_if`: "a only if b."; `unless`: "a unless b." (= if not b,
 * then a); `or`: "Either a, or b, or both."; `fact`: "a."; `and` (options only): "A, and b.".
 */
export type CondStatement =
  | { readonly form: 'fact'; readonly a: Lit }
  | { readonly form: 'if' | 'only_if' | 'unless' | 'or' | 'and'; readonly a: Lit; readonly b: Lit }

export type Reading = 0 | 1
/**
 * Categorical: 0 = modern (no existential import), 1 = every term has members. Conditional: 0 = inclusive "unless"
 * (if not b, then a), 1 = exclusive "unless" (a exactly when not b); the other forms read alike under both.
 */
export const READINGS: readonly Reading[] = Object.freeze([0, 1] as const)

// ---------------------------------------------------------------------------------------------------------------
// Categorical semantics
// ---------------------------------------------------------------------------------------------------------------

interface Mask {
  readonly lo: number
  readonly hi: number
}

interface Constraint {
  readonly exists: boolean
  readonly set: Mask
}

/** Most terms of a categorical item (2⁶ = 64 regions). */
export const MAX_TERMS = 6

const termMasks: Mask[][] = []

/** has[t] = the regions inside term t, for n terms. */
function termMasksOf(n: number): readonly Mask[] {
  if (!(Number.isInteger(n) && n >= 2 && n <= MAX_TERMS)) throw new RangeError(`categorical terms must be 2–${MAX_TERMS}, got ${n}`)
  let ms = termMasks[n]
  if (ms === undefined) {
    ms = []
    for (let t = 0; t < n; t++) {
      let lo = 0
      let hi = 0
      for (let r = 0; r < 2 ** n; r++) {
        if (((r >> t) & 1) === 0) continue
        if (r < 32) lo = (lo | (1 << r)) >>> 0
        else hi = (hi | (1 << (r - 32))) >>> 0
      }
      ms.push({ lo, hi })
    }
    termMasks[n] = ms
  }
  return ms
}

const and = (a: Mask, b: Mask): Mask => ({ lo: (a.lo & b.lo) >>> 0, hi: (a.hi & b.hi) >>> 0 })
const andNot = (a: Mask, b: Mask): Mask => ({ lo: (a.lo & ~b.lo) >>> 0, hi: (a.hi & ~b.hi) >>> 0 })
const isEmpty = (a: Mask): boolean => a.lo === 0 && a.hi === 0

function regionSet(n: number, s: CatStatement): Mask {
  const has = termMasksOf(n)
  const x = has[s.x] as Mask
  const y = has[s.y] as Mask
  return s.form === 'A' || s.form === 'O' ? andNot(x, y) : and(x, y)
}

function constraintOf(n: number, s: CatStatement, negate: boolean): Constraint {
  const exists = s.form === 'I' || s.form === 'O'
  return { exists: negate ? !exists : exists, set: regionSet(n, s) }
}

function background(n: number, reading: Reading): Constraint[] {
  return reading === 0 ? [] : termMasksOf(n).map((set) => ({ exists: true, set }))
}

function satisfiable(cs: readonly Constraint[]): boolean {
  let e: Mask = { lo: 0, hi: 0 }
  for (const c of cs) if (!c.exists) e = { lo: (e.lo | c.set.lo) >>> 0, hi: (e.hi | c.set.hi) >>> 0 }
  for (const c of cs) if (c.exists && isEmpty(andNot(c.set, e))) return false
  return true
}

/** The statements (plus `extra`, negated when `negateExtra`) are jointly satisfiable under the reading. */
export function catSat(n: number, premises: readonly CatStatement[], reading: Reading, extra?: CatStatement, negateExtra = false): boolean {
  const cs = [...background(n, reading), ...premises.map((p) => constraintOf(n, p, false))]
  if (extra !== undefined) cs.push(constraintOf(n, extra, negateExtra))
  return satisfiable(cs)
}

/** premises ⊨ s under the reading. */
export function catEntails(n: number, premises: readonly CatStatement[], s: CatStatement, reading: Reading): boolean {
  return !catSat(n, premises, reading, s, true)
}

/** s and t say the same under the reading. */
export function catEquivalent(n: number, s: CatStatement, t: CatStatement, reading: Reading): boolean {
  return catEntails(n, [s], t, reading) && catEntails(n, [t], s, reading)
}

/** Every categorical statement over n terms (4 forms × ordered pairs), forms in A, E, I, O order. */
export function allCatStatements(n: number): CatStatement[] {
  const out: CatStatement[] = []
  for (const form of ['A', 'E', 'I', 'O'] as const) {
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) if (x !== y) out.push({ form, x, y })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Propositional semantics
// ---------------------------------------------------------------------------------------------------------------

/** Most atoms of a conditional item (2⁵ = 32 truth-table rows). */
export const MAX_ATOMS = 5

const fullOf = (m: number): number => (m === 5 ? 0xffffffff : 2 ** (2 ** m) - 1)

function atomMask(m: number, atom: number): number {
  let x = 0
  for (let r = 0; r < 2 ** m; r++) if (((r >> atom) & 1) === 1) x = (x | (1 << r)) >>> 0
  return x
}

function litMask(m: number, l: Lit): number {
  const a = atomMask(m, l.atom)
  return l.neg ? (fullOf(m) & ~a) >>> 0 : a
}

/**
 * The truth table of a statement over m atoms: the rows where it holds, as a mask. The reading only changes "a unless
 * b": reading 0 is the inclusive "if not b, then a" (a ∨ b), reading 1 the exclusive one some people hear, "a exactly
 * when not b" (a xor b). A conditional item is kept only if every option gets the same verdict under both.
 */
export function condMask(m: number, s: CondStatement, reading: Reading = 0): number {
  if (!(Number.isInteger(m) && m >= 1 && m <= MAX_ATOMS)) throw new RangeError(`atoms must be 1–${MAX_ATOMS}, got ${m}`)
  const full = fullOf(m)
  const a = litMask(m, s.a)
  if (s.form === 'fact') return a
  const b = litMask(m, s.b)
  if (s.form === 'if' || s.form === 'only_if') return ((~a | b) & full) >>> 0
  if (s.form === 'and') return (a & b) >>> 0
  if (s.form === 'unless' && reading === 1) return (a ^ b) >>> 0
  return (a | b) >>> 0
}

/** The rows where every premise holds. */
export function condModels(m: number, premises: readonly CondStatement[], reading: Reading = 0): number {
  let x = fullOf(m)
  for (const p of premises) x = (x & condMask(m, p, reading)) >>> 0
  return x
}

export function condSat(m: number, premises: readonly CondStatement[], extra?: CondStatement, reading: Reading = 0): boolean {
  const x = condModels(m, premises, reading)
  return (extra === undefined ? x : (x & condMask(m, extra)) >>> 0) !== 0
}

export function condEntails(m: number, premises: readonly CondStatement[], s: CondStatement, reading: Reading = 0): boolean {
  return (condModels(m, premises, reading) & ~condMask(m, s)) >>> 0 === 0
}

export function condEquivalent(m: number, s: CondStatement, t: CondStatement): boolean {
  return condMask(m, s) === condMask(m, t)
}

const negLit = (l: Lit): Lit => ({ atom: l.atom, neg: !l.neg })
const sameLit = (a: Lit, b: Lit): boolean => a.atom === b.atom && a.neg === b.neg

/**
 * The option candidates over m atoms: every fact, every "If a, then b." and every "A, and b." (distinct atoms, both
 * polarities). A conjunction can be ruled out by rules between atoms the premises leave open ("If p, then q" rules
 * out "p, and not q"), which "could be true" questions need.
 */
export function allCondOptions(m: number): CondStatement[] {
  const lits: Lit[] = []
  for (let a = 0; a < m; a++) for (const neg of [false, true]) lits.push({ atom: a, neg })
  const out: CondStatement[] = lits.map((a) => ({ form: 'fact', a }))
  for (const a of lits) for (const b of lits) if (a.atom !== b.atom) out.push({ form: 'if', a, b })
  for (const a of lits) for (const b of lits) if (a.atom < b.atom) out.push({ form: 'and', a, b })
  return out
}

/** The implications a premise states, as (antecedent, consequent) pairs. */
export function implicationsOf(s: CondStatement): [Lit, Lit][] {
  switch (s.form) {
    case 'fact':
    case 'and':
      return []
    case 'if':
    case 'only_if':
      return [[s.a, s.b]]
    case 'unless':
      return [[negLit(s.b), s.a]]
    case 'or':
      return [
        [negLit(s.a), s.b],
        [negLit(s.b), s.a],
      ]
  }
}

/**
 * A conditional option that the material reading (¬a ∨ b) and the everyday reading of "if" could judge differently,
 * so no option is one: an "If a, then b." option is kept only when the premises settle its antecedent as true (it then
 * says just b, either way) or leave both its parts open (it is then a claim about how two open things hang together:
 * it follows, is ruled out or stays possible alike under both readings). Dropped: a ruled-out antecedent or an
 * already-true consequent (true only "vacuously"), and an open antecedent with a settled consequent ("If the window is
 * open, then the door is locked" when the door is surely not locked: materially just "the window is not open").
 */
export function isVacuousConditional(m: number, premises: readonly CondStatement[], s: CondStatement): boolean {
  if (s.form !== 'if') return false
  // Vacuous under either reading of "unless" (`condMask`) is vacuous.
  return READINGS.some((r) => {
    const holds = (l: Lit): boolean => condEntails(m, premises, { form: 'fact', a: l }, r)
    if (holds(s.a)) return false
    const open = (l: Lit): boolean => !holds(l) && !holds(negLit(l))
    return !(open(s.a) && open(s.b))
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Items: the abstract form, the verdicts, the labels
// ---------------------------------------------------------------------------------------------------------------

export type Statement = CatStatement | CondStatement

/** An item in abstract form: the premises and options in display order. */
export type LogicItem =
  | { readonly kind: 'cat'; readonly n: number; readonly premises: readonly CatStatement[]; readonly options: readonly CatStatement[] }
  | { readonly kind: 'cond'; readonly n: number; readonly premises: readonly CondStatement[]; readonly options: readonly CondStatement[] }

/** What the premises say about one statement under each reading (conditionals: both entries alike). */
export interface Status {
  readonly entailed: readonly [boolean, boolean]
  readonly possible: readonly [boolean, boolean]
}

export function catStatus(n: number, premises: readonly CatStatement[], s: CatStatement): Status {
  return {
    entailed: [catEntails(n, premises, s, 0), catEntails(n, premises, s, 1)],
    possible: [catSat(n, premises, 0, s), catSat(n, premises, 1, s)],
  }
}

/** Conditional status under the inclusive (0) and the exclusive (1) reading of "unless" (`condMask`). */
export function condStatus(m: number, premises: readonly CondStatement[], s: CondStatement): Status {
  return {
    entailed: [condEntails(m, premises, s, 0), condEntails(m, premises, s, 1)],
    possible: [condSat(m, premises, s, 0), condSat(m, premises, s, 1)],
  }
}

/** Whether a statement with this status answers the question under the reading. */
export function answers(q: Question, st: Status, r: Reading): boolean {
  if (q === 'must_true') return st.entailed[r]
  if (q === 'could_true') return st.possible[r]
  return !st.possible[r]
}

/** Two statements of one item are logically the same (categorical: under either reading). */
export function equivalent(item: Pick<LogicItem, 'kind' | 'n'>, s: Statement, t: Statement): boolean {
  if (item.kind === 'cat') {
    const a = s as CatStatement
    const b = t as CatStatement
    return catEquivalent(item.n, a, b, 0) || catEquivalent(item.n, a, b, 1)
  }
  return condEquivalent(item.n, s as CondStatement, t as CondStatement)
}

export function statusOf(item: Pick<LogicItem, 'kind' | 'n' | 'premises'>, s: Statement): Status {
  return item.kind === 'cat'
    ? catStatus(item.n, item.premises as readonly CatStatement[], s as CatStatement)
    : condStatus(item.n, item.premises as readonly CondStatement[], s as CondStatement)
}

/**
 * The key needs the premises together: no single premise settles it (must be true: no premise alone entails it under
 * either reading; must be false: no premise alone rules it out under either reading). Could be true: always true.
 */
export function needsCombination(item: Pick<LogicItem, 'kind' | 'n' | 'premises'>, q: Question, s: Statement): boolean {
  if (q === 'could_true') return true
  for (const p of item.premises) {
    const st = item.kind === 'cat' ? catStatus(item.n, [p as CatStatement], s as CatStatement) : condStatus(item.n, [p as CondStatement], s as CondStatement)
    if (q === 'must_true' && (st.entailed[0] || st.entailed[1])) return false
    if (q === 'must_false' && (!st.possible[0] || !st.possible[1])) return false
  }
  return true
}

/** The terms (categorical) or atoms (conditional) a statement mentions, sorted. */
export function termsOf(s: Statement): number[] {
  if ('x' in s) return [Math.min(s.x, s.y), Math.max(s.x, s.y)]
  if (s.form === 'fact') return [s.a.atom]
  return [Math.min(s.a.atom, s.b.atom), Math.max(s.a.atom, s.b.atom)]
}

/**
 * Why a distractor is wrong or tempting, by the first rule that matches (the generator and the verifier compute the
 * same). First its status: `contradicts_premises` (impossible under both readings), `contradicts_with_import`
 * (categorical: impossible only when every term has members), `follows` (entailed under both readings),
 * `follows_with_import` (categorical: entailed only with members). Otherwise (possible, not entailed) the classic error
 * it invites: categorical `converse_of_premise` (an All / Some-not statement turned round) or `converse_of_key`;
 * conditional `affirming_the_consequent`, `denying_the_antecedent`, `only_if_reversed`, `unless_misread`, `converse`,
 * `inverse`; else `undetermined`.
 */
export function distractorType(item: LogicItem, key: Statement, s: Statement): string {
  if (item.kind === 'cat') {
    const c = s as CatStatement
    const k = key as CatStatement
    const st = catStatus(item.n, item.premises, c)
    if (!st.possible[0]) return 'contradicts_premises'
    if (!st.possible[1]) return 'contradicts_with_import'
    if (st.entailed[0]) return 'follows'
    if (st.entailed[1]) return 'follows_with_import'
    const turnable = c.form === 'A' || c.form === 'O'
    if (turnable && item.premises.some((p) => p.form === c.form && p.x === c.y && p.y === c.x)) return 'converse_of_premise'
    if (turnable && k.form === c.form && k.x === c.y && k.y === c.x) return 'converse_of_key'
    return 'undetermined'
  }
  const m = item.n
  const premises = item.premises
  const c = s as CondStatement
  const st = condStatus(m, premises, c)
  if (!st.possible[0]) return 'contradicts_premises'
  if (st.entailed[0]) return 'follows'
  const pairs = premises.flatMap(implicationsOf)
  const holds = (l: Lit): boolean => condEntails(m, premises, { form: 'fact', a: l })
  if (c.form === 'fact') {
    if (pairs.some(([ante, cons]) => sameLit(c.a, ante) && holds(cons))) return 'affirming_the_consequent'
    if (pairs.some(([ante, cons]) => sameLit(c.a, negLit(cons)) && holds(negLit(ante)))) return 'denying_the_antecedent'
  } else if (c.form === 'if') {
    if (premises.some((p) => p.form === 'only_if' && sameLit(c.a, p.b) && sameLit(c.b, p.a))) return 'only_if_reversed'
    if (premises.some((p) => p.form === 'unless' && sameLit(c.a, p.b) && sameLit(c.b, negLit(p.a)))) return 'unless_misread'
    if (pairs.some(([ante, cons]) => sameLit(c.a, cons) && sameLit(c.b, ante))) return 'converse'
    if (pairs.some(([ante, cons]) => sameLit(c.a, negLit(ante)) && sameLit(c.b, negLit(cons)))) return 'inverse'
  }
  return 'undetermined'
}

const CONTRADICTORY: Readonly<Record<CatForm, CatForm>> = { A: 'O', O: 'A', E: 'I', I: 'E' }

/**
 * s says the opposite of t (s is equivalent to not-t; categorical: under either reading). No option is the opposite of
 * the key: such a pair would tell a test-wise reader that the key is one of the two.
 */
export function negates(item: Pick<LogicItem, 'kind' | 'n'>, s: Statement, t: Statement): boolean {
  if (item.kind === 'cat') {
    const c = t as CatStatement
    const not: CatStatement = { form: CONTRADICTORY[c.form], x: c.x, y: c.y }
    return catEquivalent(item.n, s as CatStatement, not, 0) || catEquivalent(item.n, s as CatStatement, not, 1)
  }
  return condMask(item.n, s as CondStatement) === (fullOf(item.n) & ~condMask(item.n, t as CondStatement)) >>> 0
}

/** The distractor types that name a classic error (preferred when the generator picks distractors). */
export const FALLACY_TYPES: ReadonlySet<string> = new Set([
  'converse_of_premise',
  'converse_of_key',
  'contradicts_with_import',
  'follows_with_import',
  'affirming_the_consequent',
  'denying_the_antecedent',
  'only_if_reversed',
  'unless_misread',
  'converse',
  'inverse',
])

// ---------------------------------------------------------------------------------------------------------------
// Structure (A11): canonical up to renaming the terms or atoms
// ---------------------------------------------------------------------------------------------------------------

/** A statement as JSON: categorical ["A", x, y]; conditional ["if", a, b] / ["fact", a] with literal code 2·atom + neg. */
export type StatementCode = readonly [string, number] | readonly [string, number, number]

function codeOf(s: Statement, perm: readonly number[]): StatementCode {
  if ('x' in s) {
    const x = perm[s.x] as number
    const y = perm[s.y] as number
    return s.form === 'E' || s.form === 'I' ? [s.form, Math.min(x, y), Math.max(x, y)] : [s.form, x, y]
  }
  const lit = (l: Lit): number => 2 * (perm[l.atom] as number) + (l.neg ? 1 : 0)
  if (s.form === 'fact') return ['fact', lit(s.a)]
  const a = lit(s.a)
  const b = lit(s.b)
  return s.form === 'or' || s.form === 'and' ? [s.form, Math.min(a, b), Math.max(a, b)] : [s.form, a, b]
}

const codeText = (c: StatementCode): string => c.join(',')

function permutations(n: number): number[][] {
  if (n === 0) return [[]]
  const out: number[][] = []
  for (const p of permutations(n - 1)) for (let i = 0; i <= p.length; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)])
  return out
}

const permCache: number[][][] = []

/** The structure hashed into family_id (A11): isomorphs (renamed terms, reordered premises, other options) share it. */
export interface SyllogismStructure {
  readonly template: Template
  readonly question: Question
  readonly n_terms: number
  /** The premises, canonical: the renaming with the smallest text, premises sorted by their text. */
  readonly premises: readonly StatementCode[]
  /** The key, under the same renaming. */
  readonly conclusion: StatementCode
}

/**
 * The canonical structure: over every renaming of the n terms (atoms), the premise codes sorted by their text
 * ("A,0,1"; every number is one digit) and joined with "|", then "#" and the key's code; the smallest such text wins
 * (plain code-unit order, which is Python's string order for ASCII).
 */
export function structureOf(template: Template, question: Question, item: Pick<LogicItem, 'n' | 'premises'>, key: Statement): SyllogismStructure {
  const n = item.n
  const perms = (permCache[n] ??= permutations(n))
  let best: { text: string; premises: StatementCode[]; conclusion: StatementCode } | null = null
  for (const perm of perms) {
    const codes = item.premises.map((p) => codeOf(p, perm))
    const texts = codes.map(codeText)
    const order = codes.map((_, i) => i).sort((i, j) => (texts[i] as string) < (texts[j] as string) ? -1 : (texts[i] as string) > (texts[j] as string) ? 1 : 0)
    const conclusion = codeOf(key, perm)
    const text = `${order.map((i) => texts[i]).join('|')}#${codeText(conclusion)}`
    if (best === null || text < best.text) best = { text, premises: order.map((i) => codes[i] as StatementCode), conclusion }
  }
  if (best === null) throw new Error('structureOf(): no renaming')
  return { template, question, n_terms: n, premises: best.premises, conclusion: best.conclusion }
}

// ---------------------------------------------------------------------------------------------------------------
// Text: render and parse (the verifier reads the logic back from the words shown)
// ---------------------------------------------------------------------------------------------------------------

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)

export function catText(s: CatStatement, words: readonly string[]): string {
  const x = plural(words[s.x] as string)
  const y = plural(words[s.y] as string)
  switch (s.form) {
    case 'A':
      return `All ${x} are ${y}.`
    case 'E':
      return `No ${x} are ${y}.`
    case 'I':
      return `Some ${x} are ${y}.`
    case 'O':
      return `Some ${x} are not ${y}.`
  }
}

export function condText(s: CondStatement, props: readonly Proposition[]): string {
  const ph = (l: Lit): string => phraseOf(props[l.atom] as Proposition, l.neg)
  switch (s.form) {
    case 'fact':
      return `${capital(ph(s.a))}.`
    case 'if':
      return `If ${ph(s.a)}, then ${ph(s.b)}.`
    case 'only_if':
      return `${capital(ph(s.a))} only if ${ph(s.b)}.`
    case 'unless':
      return `${capital(ph(s.a))} unless ${ph(s.b)}.`
    case 'or':
      return `Either ${ph(s.a)}, or ${ph(s.b)}, or both.`
    case 'and':
      return `${capital(ph(s.a))}, and ${ph(s.b)}.`
  }
}

const PLURAL_WORDS: ReadonlyMap<string, string> = new Map(NONCE_WORDS.map((w) => [plural(w), w]))

const CAT_RE = /^(All|No|Some) ([a-z]+) are (not )?([a-z]+)\.$/

/** A parsed categorical item: its words (singular, by first appearance) and statements. */
export interface ParsedCat {
  readonly words: readonly string[]
  readonly premises: readonly CatStatement[]
  readonly options: readonly CatStatement[]
}

/** Parse categorical sentences (premises, then options); a string says why they do not parse. */
export function parseCat(premises: readonly string[], options: readonly string[]): ParsedCat | string {
  const words: string[] = []
  const termOf = (pl: string): number | null => {
    const w = PLURAL_WORDS.get(pl)
    if (w === undefined) return null
    const i = words.indexOf(w)
    if (i >= 0) return i
    words.push(w)
    return words.length - 1
  }
  const one = (text: string): CatStatement | string => {
    const m = CAT_RE.exec(text)
    if (!m) return `not a categorical sentence: ${JSON.stringify(text)}`
    const [, q, xs, not, ys] = m as unknown as [string, string, string, string | undefined, string]
    const form: CatForm | null = q === 'All' && !not ? 'A' : q === 'No' && !not ? 'E' : q === 'Some' ? (not ? 'O' : 'I') : null
    if (form === null) return `not a categorical form: ${JSON.stringify(text)}`
    const x = termOf(xs)
    const y = termOf(ys)
    if (x === null || y === null) return `a word not in the made-up list: ${JSON.stringify(text)}`
    if (x === y) return `a statement about one word: ${JSON.stringify(text)}`
    return { form, x, y }
  }
  const ps: CatStatement[] = []
  for (const t of premises) {
    const s = one(t)
    if (typeof s === 'string') return s
    ps.push(s)
  }
  const nPremiseTerms = words.length
  const os: CatStatement[] = []
  for (const t of options) {
    const s = one(t)
    if (typeof s === 'string') return s
    os.push(s)
  }
  if (words.length !== nPremiseTerms) return 'an option uses a word that no statement uses'
  if (words.length > MAX_TERMS) return `more than ${MAX_TERMS} words`
  return { words, premises: ps, options: os }
}

interface LitEntry {
  readonly scene: number
  readonly prop: number
  readonly neg: boolean
}

const LIT_TABLE: ReadonlyMap<string, LitEntry> = new Map<string, LitEntry>(
  SCENES.flatMap((sc, si) =>
    sc.propositions.flatMap((p, pi) => [
      [phraseOf(p, false), { scene: si, prop: pi, neg: false }] as [string, LitEntry],
      [phraseOf(p, true), { scene: si, prop: pi, neg: true }] as [string, LitEntry],
    ]),
  ),
)

/** A parsed conditional item: its scene, its propositions (scene indices, by first appearance) and statements. */
export interface ParsedCond {
  readonly scene: number
  readonly props: readonly number[]
  readonly premises: readonly CondStatement[]
  readonly options: readonly CondStatement[]
}

const COND_PATTERNS: readonly [CondForm, RegExp][] = [
  ['if', /^If (.+), then (.+)\.$/],
  ['or', /^Either (.+), or (.+), or both\.$/],
  ['and', /^(.+), and (.+)\.$/],
  ['only_if', /^(.+) only if (.+)\.$/],
  ['unless', /^(.+) unless (.+)\.$/],
  ['fact', /^(.+)\.$/],
]

export function parseCond(premises: readonly string[], options: readonly string[]): ParsedCond | string {
  const seen = { scene: -1 }
  const props: number[] = []
  const litOf = (phrase: string, capitalised: boolean): Lit | string => {
    if (capitalised && phrase.charAt(0) !== phrase.charAt(0).toUpperCase()) return `no capital: ${JSON.stringify(phrase)}`
    const e = LIT_TABLE.get(capitalised ? lower(phrase) : phrase)
    if (e === undefined) return `not a known statement: ${JSON.stringify(phrase)}`
    if (seen.scene < 0) seen.scene = e.scene
    else if (seen.scene !== e.scene) return 'statements from two scenes'
    let atom = props.indexOf(e.prop)
    if (atom < 0) {
      props.push(e.prop)
      atom = props.length - 1
    }
    return { atom, neg: e.neg }
  }
  const one = (text: string): CondStatement | string => {
    for (const [form, re] of COND_PATTERNS) {
      const m = re.exec(text)
      if (!m) continue
      const lead = form === 'fact' || form === 'only_if' || form === 'unless' || form === 'and'
      const a = litOf(m[1] as string, lead)
      if (typeof a === 'string') {
        if (form === 'fact') return a
        continue
      }
      if (form === 'fact') return { form, a }
      const b = litOf(m[2] as string, false)
      if (typeof b === 'string') return b
      if (a.atom === b.atom) return `a statement about one thing: ${JSON.stringify(text)}`
      return { form, a, b }
    }
    return `not a conditional sentence: ${JSON.stringify(text)}`
  }
  const ps: CondStatement[] = []
  for (const t of premises) {
    const s = one(t)
    if (typeof s === 'string') return s
    ps.push(s)
  }
  const os: CondStatement[] = []
  for (const t of options) {
    const s = one(t)
    if (typeof s === 'string') return s
    os.push(s)
  }
  if (seen.scene < 0) return 'no statements'
  if (props.length > MAX_ATOMS) return `more than ${MAX_ATOMS} propositions`
  return { scene: seen.scene, props, premises: ps, options: os }
}

/** The question type of a question line, or null. */
export function questionOf(text: string): Question | null {
  for (const [q, t] of Object.entries(QUESTION_TEXT)) if (t === text) return q as Question
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// Shape of the premises (difficulty features)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The premises of a categorical item form a simple path over its terms (each links two terms, every term is in one or
 * two premises, all are connected, no cycle): the shape of a syllogism and a sorites.
 */
export function isPath(n: number, premises: readonly CatStatement[]): boolean {
  if (premises.length !== n - 1) return false
  const deg = new Array<number>(n).fill(0)
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] as number)))
  for (const p of premises) {
    deg[p.x] = (deg[p.x] as number) + 1
    deg[p.y] = (deg[p.y] as number) + 1
    const a = find(p.x)
    const b = find(p.y)
    if (a === b) return false
    parent[a] = b
  }
  return deg.every((d) => d >= 1 && d <= 2)
}

/**
 * Junctions where the shared term is the subject of both premises or the predicate of both (a "bent" link, the
 * figures 2 and 3 of a syllogism), over every pair of premises that share a term.
 */
export function bentLinks(premises: readonly CatStatement[]): number {
  let bent = 0
  for (let i = 0; i < premises.length; i++) {
    for (let j = i + 1; j < premises.length; j++) {
      const p = premises[i] as CatStatement
      const q = premises[j] as CatStatement
      for (const t of [p.x, p.y]) {
        if (t !== q.x && t !== q.y) continue
        const pos = (s: CatStatement): number => (s.x === t ? 0 : 1)
        if (pos(p) === pos(q)) bent++
      }
    }
  }
  return bent
}

/**
 * The figure of a two-premise syllogism by where its middle term stands: 1 = subject of one premise and predicate of
 * the other (the traditional figures 1 and 4, told apart only by a conclusion), 2 = predicate of both, 3 = subject of
 * both. 0 for anything else.
 */
export function figureOf(premises: readonly CatStatement[]): number {
  if (premises.length !== 2) return 0
  const [p, q] = premises as [CatStatement, CatStatement]
  const shared = [p.x, p.y].filter((t) => t === q.x || t === q.y)
  if (shared.length !== 1) return 0
  const t = shared[0] as number
  const a = p.x === t ? 0 : 1
  const b = q.x === t ? 0 : 1
  return a !== b ? 1 : a === 1 ? 2 : 3
}

/** The display order walks the chain: every two premises in a row share a term. */
export function inChainOrder(premises: readonly CatStatement[]): boolean {
  for (let i = 0; i + 1 < premises.length; i++) {
    const p = premises[i] as CatStatement
    const q = premises[i + 1] as CatStatement
    if (!(p.x === q.x || p.x === q.y || p.y === q.x || p.y === q.y)) return false
  }
  return true
}
