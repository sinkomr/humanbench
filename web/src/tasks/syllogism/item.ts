/**
 * An item of the syllogism family read as logic: the template and question of a spec, its statements parsed back
 * from the words shown, its difficulty features, and the option-only cue checks. Shared by the generator (which
 * builds the spec, then computes the features from it) and the verifier (which recomputes everything from the spec).
 */

import type { Feature } from '../family'
import { INTRO, NEGATION_RE, type Question } from './lexicon'
import {
  bentLinks,
  figureOf,
  inChainOrder,
  parseCat,
  parseCond,
  questionOf,
  termsOf,
  type CatStatement,
  type CondStatement,
  type LogicItem,
  type Statement,
  type Template,
} from './logic'
import type { SyllogismSpec } from './spec'

/** A spec read as logic. */
export interface ReadItem {
  readonly template: Template
  readonly question: Question
  readonly logic: LogicItem
}

/** Read a spec's logic from its text (a string says why it cannot be read). */
export function readSpec(spec: SyllogismSpec): ReadItem | string {
  const question = questionOf(spec.question)
  if (question === null) return 'unknown question line'
  if (spec.intro !== undefined) {
    if (spec.intro !== INTRO) return 'unknown intro line'
    const p = parseCat(spec.premises, spec.options)
    if (typeof p === 'string') return p
    const n = p.words.length
    return { template: spec.premises.length === 2 ? 'categorical' : 'chain', question, logic: { kind: 'cat', n, premises: p.premises, options: p.options } }
  }
  const p = parseCond(spec.premises, spec.options)
  if (typeof p === 'string') return p
  return { template: 'conditional', question, logic: { kind: 'cond', n: p.props.length, premises: p.premises, options: p.options } }
}

const litCount = (s: CondStatement): number => (s.a.neg ? 1 : 0) + (s.form !== 'fact' && s.b.neg ? 1 : 0)

/**
 * The difficulty features of an item (see `prior.ts`): from its template, question, statements in display order and
 * key, plus the sorted reasons of its distractors.
 */
export function featuresOf(read: ReadItem, keyIndex: number, distractorTypes: readonly string[]): Record<string, Feature> {
  const { template, question, logic } = read
  const key = logic.options[keyIndex] as Statement
  const nPremises = logic.premises.length
  const common = {
    template,
    question,
    conditional: logic.kind === 'cond',
    n_premises: nPremises,
    n_terms: logic.n,
    could_true: question === 'could_true',
    must_false: question === 'must_false',
    inference_steps: Math.max(1, nPremises - 1),
    distractor_types: [...distractorTypes].sort().join(','),
  }
  if (logic.kind === 'cat') {
    const ps = logic.premises
    const k = key as CatStatement
    return {
      ...common,
      negative_premises: ps.filter((p) => p.form === 'E' || p.form === 'O').length,
      particular_premises: ps.filter((p) => p.form === 'I' || p.form === 'O').length,
      bent_links: bentLinks(ps),
      figure: template === 'categorical' ? figureOf(ps) : 0,
      scrambled: !inChainOrder(ps),
      key_form: k.form,
      key_particular: k.form === 'I' || k.form === 'O',
      key_negative: k.form === 'E' || k.form === 'O',
      key_conditional: false,
      only_if: 0,
      unless: 0,
      either_or: 0,
      negated_literals: 0,
    }
  }
  const ps = logic.premises
  const k = key as CondStatement
  const lastRule = ps.reduce((acc, p, i) => (p.form === 'fact' ? acc : i), -1)
  return {
    ...common,
    negative_premises: 0,
    particular_premises: 0,
    bent_links: 0,
    figure: 0,
    scrambled: ps.some((p, i) => p.form === 'fact' && i < lastRule),
    key_form: k.form,
    key_particular: false,
    key_negative: litCount(k) > 0,
    key_conditional: k.form === 'if',
    only_if: ps.filter((p) => p.form === 'only_if').length,
    unless: ps.filter((p) => p.form === 'unless').length,
    either_or: ps.filter((p) => p.form === 'or').length,
    negated_literals: ps.reduce((acc, p) => acc + litCount(p), 0),
  }
}

/**
 * The option-only cue checks (G3): the key cannot be picked from the options alone. It is not the one longest or the
 * one shortest option, not the one option with (or without) a "no"/"not", and its pair of terms (or set of atoms) is
 * mentioned by another option too.
 */
export function cueChecks(options: readonly string[], statements: readonly Statement[], keyIndex: number): Record<string, boolean> {
  const lens = options.map((o) => o.length)
  const k = lens[keyIndex] as number
  const max = Math.max(...lens)
  const min = Math.min(...lens)
  const neg = options.map((o) => NEGATION_RE.test(o))
  const pair = statements.map((s) => termsOf(s).join(','))
  const count = <T>(xs: readonly T[], v: T): number => xs.filter((x) => x === v).length
  return {
    cue_key_not_unique_longest: !(k === max && count(lens, max) === 1),
    cue_key_not_unique_shortest: !(k === min && count(lens, min) === 1),
    cue_key_not_unique_in_negation: count(neg, neg[keyIndex]) >= 2,
    cue_key_terms_shared: count(pair, pair[keyIndex]) >= 2,
  }
}
