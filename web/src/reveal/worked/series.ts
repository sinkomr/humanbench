/**
 * Worked solutions of series items (DESIGN §4.2 "Series"; ROADMAP M1.7, M1.R): the rule family
 * and coefficients the generator drew (`structural_params`, `tasks/series/rules.ts`) are turned
 * into the steps a solver would follow: look at the changes, name the rule, apply it to the last
 * term. The answer is computed here by the rule, from the visible terms, not read from the key;
 * `worked.test.ts` checks it equals the key for thousands of generated items.
 */

import { ALPHABET, letterPosition, letterStep, positionLetter, toPosition, type RuleName } from '../../tasks/series/rules'
import type { SeriesItem, SeriesStructure } from '../../tasks/series/types'
import type { WorkedSolution } from './types'
import { addPhrase, list, num, paren, signedNum } from './text'

const diffs = (v: readonly number[]): number[] => v.slice(1).map((x, i) => x - (v[i] as number))

/** "12 + 3 = 15" / "12 − 3 = 9". */
const plus = (from: number, by: number, to: number): string => `${num(from)} ${by < 0 ? '−' : '+'} ${Math.abs(by)} = ${num(to)}`

interface AltOp {
  readonly op: 'add' | 'mul'
  readonly by: number
}

const opPhrase = (o: AltOp): string => (o.op === 'add' ? addPhrase(o.by) : `multiply by ${paren(o.by)}`)
const applyOp = (o: AltOp, x: number): number => (o.op === 'add' ? x + o.by : x * o.by)
const opArrow = (o: AltOp, from: number, to: number): string => (o.op === 'add' ? plus(from, o.by, to) : `${num(from)} × ${paren(o.by)} = ${num(to)}`)

/** Steps and answer of a letter series (positions A = 1 … Z = 26, wrapping). */
function letterSolution(letters: readonly string[], d: number): WorkedSolution {
  const p = letters.map((l) => letterPosition(l))
  if (p.some((x) => x === undefined)) throw new RangeError('a letter series holds letters A–Z')
  const pos = p as number[]
  const changes = pos.slice(1).map((x, i) => letterStep(x - (pos[i] as number)))
  const last = pos[pos.length - 1] as number
  const raw = last + d
  const next = toPosition(raw)
  const wrap = raw !== next
  return {
    steps: [
      `Read each letter as its place in the alphabet (A = 1, B = 2, … Z = ${ALPHABET}): ${letters.join(', ')} is ${list(pos.map(String))}.`,
      `The place changes by ${list(changes.map(signedNum))} from one letter to the next, so it moves ${signedNum(d)} every time. After Z the count starts again at A.`,
      `From the last letter, place ${last}: ${plus(last, d, raw)}${wrap ? `, which wraps around to place ${next}` : ''}. Place ${next} is the letter ${positionLetter(next)}.`,
    ],
    answer: positionLetter(next),
    exact: positionLetter(next),
  }
}

/** The worked solution of a series item. Throws a RangeError when the item's structure is not a known rule. */
export function seriesSolution(item: SeriesItem): WorkedSolution {
  const sp = item.structural_params as unknown as SeriesStructure
  const rule: RuleName = sp.rule
  const c = sp.coefficients as Readonly<Record<string, number | string>>
  if (item.spec.input_format === 'letter') {
    if (rule !== 'letter') throw new RangeError(`a letter series has the rule "letter", not ${rule}`)
    return letterSolution(item.spec.terms, c.d as number)
  }
  const t = item.spec.terms as readonly number[]
  const m = t.length
  const last = t[m - 1] as number
  const d1 = diffs(t)
  const shown = (v: readonly number[]): string => list(v.map(signedNum))

  switch (rule) {
    case 'arithmetic': {
      const d = c.d as number
      return {
        steps: [
          `Look at the change from each term to the next: ${shown(d1)}.`,
          `The change is always ${signedNum(d)}, so the rule is: ${addPhrase(d)} each time.`,
          `Apply it to the last term: ${plus(last, d, last + d)}.`,
        ],
        answer: num(last + d),
        exact: String(last + d),
      }
    }
    case 'quadratic': {
      const s = c.s as number
      const d2 = diffs(d1)
      const lastDiff = d1[d1.length - 1] as number
      const nextDiff = lastDiff + s
      return {
        steps: [
          `Look at the change from each term to the next: ${shown(d1)}. These are not all the same, so look at how the changes change.`,
          `The changes go ${shown(d2)}: they change by ${signedNum(s)} every time.`,
          `The next change is ${plus(lastDiff, s, nextDiff)}, so the next term is ${plus(last, nextDiff, last + nextDiff)}.`,
        ],
        answer: num(last + nextDiff),
        exact: String(last + nextDiff),
      }
    }
    case 'geometric': {
      const r = c.r as number
      return {
        steps: [
          `Each term is a whole-number multiple of the one before: ${num(t[0] as number)} × ${paren(r)} = ${num(t[1] as number)}, then ${num(t[1] as number)} × ${paren(r)} = ${num(t[2] as number)}, and so on.`,
          `The rule is: multiply by ${paren(r)} each time.`,
          `Apply it to the last term: ${num(last)} × ${paren(r)} = ${num(last * r)}.`,
        ],
        answer: num(last * r),
        exact: String(last * r),
      }
    }
    case 'interleaved': {
      const da = c.da as number
      const db = c.db as number
      const first = t.filter((_, i) => i % 2 === 0)
      const second = t.filter((_, i) => i % 2 === 1)
      const places = (start: number): string => list(t.flatMap((_, i) => (i % 2 === start ? [String(i + 1)] : [])))
      const usesFirst = m % 2 === 0 // the blank is term m + 1; odd places belong to the first group
      const prev = t[m - 2] as number
      const step = usesFirst ? da : db
      return {
        steps: [
          `Two sequences are mixed together. Terms ${places(0)} go ${list(first.map(num))}, changing by ${signedNum(da)} each time. Terms ${places(1)} go ${list(second.map(num))}, changing by ${signedNum(db)} each time.`,
          `The blank is term ${m + 1}, so it continues the ${usesFirst ? 'first' : 'second'} sequence. The term before it in that sequence is ${num(prev)}.`,
          `Apply its change: ${plus(prev, step, prev + step)}.`,
        ],
        answer: num(prev + step),
        exact: String(prev + step),
      }
    }
    case 'fibonacci': {
      const k = c.c as number
      const prev = t[m - 2] as number
      const next = prev + last + k
      const plusK = k === 0 ? '' : ` ${k < 0 ? '−' : '+'} ${Math.abs(k)}`
      return {
        steps: [
          `Try adding neighbouring terms: ${num(t[0] as number)} + ${num(t[1] as number)}${plusK} = ${num(t[2] as number)}, and ${num(t[1] as number)} + ${num(t[2] as number)}${plusK} = ${num(t[3] as number)}.`,
          `The rule is: each term is the two before it added together${k === 0 ? '' : `, then ${addPhrase(k)}`}.`,
          `Apply it to the last two terms: ${num(prev)} + ${num(last)}${plusK} = ${num(next)}.`,
        ],
        answer: num(next),
        exact: String(next),
      }
    }
    case 'composite_alt': {
      const a: AltOp = { op: c.op_a as 'add' | 'mul', by: c.by_a as number }
      const b: AltOp = { op: c.op_b as 'add' | 'mul', by: c.by_b as number }
      const nextIsA = (m - 1) % 2 === 0
      const o = nextIsA ? a : b
      const next = applyOp(o, last)
      return {
        steps: [
          `Two different steps take turns. From term 1 to term 2: ${opPhrase(a)} (${opArrow(a, t[0] as number, t[1] as number)}). From term 2 to term 3: ${opPhrase(b)} (${opArrow(b, t[1] as number, t[2] as number)}).`,
          `They keep taking turns in that order. The step from term ${m} to the blank is the ${nextIsA ? 'first' : 'second'} kind: ${opPhrase(o)}.`,
          `Apply it to the last term: ${opArrow(o, last, next)}.`,
        ],
        answer: num(next),
        exact: String(next),
      }
    }
    case 'composite_aff': {
      const mult = c.m as number
      const k = c.c as number
      const next = mult * last + k
      const then = k < 0 ? `− ${-k}` : `+ ${k}`
      return {
        steps: [
          `Each step multiplies by ${paren(mult)} and then does the same addition: ${num(t[0] as number)} × ${paren(mult)} ${then} = ${num(t[1] as number)}, and ${num(t[1] as number)} × ${paren(mult)} ${then} = ${num(t[2] as number)}.`,
          `The rule is: multiply by ${paren(mult)}, then ${addPhrase(k)}.`,
          `Apply it to the last term: ${num(last)} × ${paren(mult)} ${then} = ${num(next)}.`,
        ],
        answer: num(next),
        exact: String(next),
      }
    }
    case 'tribonacci': {
      const k = c.c as number
      const plusK = k === 0 ? '' : ` ${k < 0 ? '−' : '+'} ${Math.abs(k)}`
      const sum3 = (i: number): string => `${num(t[i] as number)} + ${paren(t[i + 1] as number)} + ${paren(t[i + 2] as number)}${plusK}`
      const next = (t[m - 3] as number) + (t[m - 2] as number) + last + k
      return {
        steps: [
          `Try adding the three terms before each one: ${sum3(0)} = ${num(t[3] as number)}, and ${sum3(1)} = ${num(t[4] as number)}.`,
          `The rule is: each term is the three before it added together${k === 0 ? '' : `, then ${addPhrase(k)}`}.`,
          `Apply it to the last three terms: ${sum3(m - 3)} = ${num(next)}.`,
        ],
        answer: num(next),
        exact: String(next),
      }
    }
    case 'diff_fibonacci': {
      const k = c.c as number
      const plusK = k === 0 ? '' : ` ${k < 0 ? '−' : '+'} ${Math.abs(k)}`
      const n1 = d1.length
      const a = d1[n1 - 2] as number
      const b = d1[n1 - 1] as number
      const nextDiff = a + b + k
      return {
        steps: [
          `Look at the change from each term to the next: ${shown(d1)}.`,
          `Each change is the two changes before it added together${k === 0 ? '' : `, then ${addPhrase(k)}`}: ${num(d1[0] as number)} + ${paren(d1[1] as number)}${plusK} = ${num(d1[2] as number)}.`,
          `The next change is ${num(a)} + ${paren(b)}${plusK} = ${num(nextDiff)}, so the next term is ${plus(last, nextDiff, last + nextDiff)}.`,
        ],
        answer: num(last + nextDiff),
        exact: String(last + nextDiff),
      }
    }
    case 'interleaved_ops': {
      const a: AltOp = { op: c.op_a as 'add' | 'mul', by: c.by_a as number }
      const b: AltOp = { op: c.op_b as 'add' | 'mul', by: c.by_b as number }
      const first = t.filter((_, i) => i % 2 === 0)
      const second = t.filter((_, i) => i % 2 === 1)
      const places = (start: number): string => list(t.flatMap((_, i) => (i % 2 === start ? [String(i + 1)] : [])))
      const usesFirst = m % 2 === 0
      const o = usesFirst ? a : b
      const prev = t[m - 2] as number
      const next = applyOp(o, prev)
      return {
        steps: [
          `Two sequences are mixed together, each with its own rule. Terms ${places(0)} go ${list(first.map(num))}: ${opPhrase(a)} each time. Terms ${places(1)} go ${list(second.map(num))}: ${opPhrase(b)} each time.`,
          `The blank is term ${m + 1}, so it continues the ${usesFirst ? 'first' : 'second'} sequence. The term before it in that sequence is ${num(prev)}.`,
          `Apply that sequence's rule: ${opArrow(o, prev, next)}.`,
        ],
        answer: num(next),
        exact: String(next),
      }
    }
    case 'linear_rec': {
      const a = c.a as number
      const b = c.b as number
      const combo = (i: number): string => `${paren(a)} × ${paren(t[i + 1] as number)} + ${paren(b)} × ${paren(t[i] as number)}`
      const next = a * last + b * (t[m - 2] as number)
      return {
        steps: [
          `Each term is made from the two before it: ${paren(a)} times the term just before plus ${paren(b)} times the one before that. For example ${combo(0)} = ${num(t[2] as number)}, and ${combo(1)} = ${num(t[3] as number)}.`,
          `It holds for the later terms too: ${list(t.slice(4).map((x, i) => `${combo(i + 2)} = ${num(x)}`))}.`,
          `Apply it to the last two terms: ${combo(m - 2)} = ${num(next)}.`,
        ],
        answer: num(next),
        exact: String(next),
      }
    }
    case 'affine_index': {
      const mult = c.m as number
      const k = c.c as number
      const d = c.d as number
      const added = t.slice(1).map((x, i) => x - mult * (t[i] as number))
      const lastAdded = added[added.length - 1] as number
      const nextAdded = lastAdded + d
      const next = mult * last + nextAdded
      const then = (x: number): string => (x < 0 ? `− ${-x}` : `+ ${x}`)
      return {
        steps: [
          `Multiply each term by ${paren(mult)} and see what is added to reach the next one: ${num(t[0] as number)} × ${paren(mult)} ${then(added[0] as number)} = ${num(t[1] as number)}, and ${num(t[1] as number)} × ${paren(mult)} ${then(added[1] as number)} = ${num(t[2] as number)}.`,
          `The amounts added go ${list(added.map(num))}: they start at ${num(k)} and change by ${signedNum(d)} each time. The next amount is ${plus(lastAdded, d, nextAdded)}.`,
          `Apply it to the last term: ${num(last)} × ${paren(mult)} ${then(nextAdded)} = ${num(next)}.`,
        ],
        answer: num(next),
        exact: String(next),
      }
    }
    case 'cycle3': {
      const ops: AltOp[] = [
        { op: c.op_a as 'add' | 'mul', by: c.by_a as number },
        { op: c.op_b as 'add' | 'mul', by: c.by_b as number },
        { op: c.op_c as 'add' | 'mul', by: c.by_c as number },
      ]
      const phase = (m - 1) % 3
      const o = ops[phase] as AltOp
      const next = applyOp(o, last)
      const nth = ['first', 'second', 'third'][phase] as string
      const shownOp = (i: number): string => `${opPhrase(ops[i] as AltOp)} (${opArrow(ops[i] as AltOp, t[i] as number, t[i + 1] as number)})`
      return {
        steps: [
          `Three different steps take turns. From term 1 to term 2: ${shownOp(0)}. From term 2 to term 3: ${shownOp(1)}. From term 3 to term 4: ${shownOp(2)}.`,
          `They repeat in that order: from term 4 the first step comes again (${opArrow(ops[0] as AltOp, t[3] as number, t[4] as number)}). The step from term ${m} to the blank is the ${nth} kind: ${opPhrase(o)}.`,
          `Apply it to the last term: ${opArrow(o, last, next)}.`,
        ],
        answer: num(next),
        exact: String(next),
      }
    }
    case 'letter':
      throw new RangeError('the rule "letter" belongs to a letter series')
  }
}
