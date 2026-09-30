/**
 * The brief lint (R-17.2 "instructions, not traits", R-17.3 closed grammar; proposal §6 rows 1, 14,
 * 15, 20; gate metric E12: 0 violations on every rendered note). It runs over the text of the
 * notes, over each typed line (interests, custom lines) before it is accepted, and in the checker.
 *
 * A note may contain:
 * - printable ASCII only;
 * - digits only inside a `YYYY-MM` month;
 * - no web address, no markup characters inside a line (the only markup is the `#` heading, `-`
 *   list and `---` front matter that `lintNotes` strips before it looks at the content);
 * - no wording about how good, weak, quick or slow the person is, no level or score words, no
 *   education or first-language cues (the trigger that made assistants worse and condescending in
 *   the study behind proposal §2.2 point 1), and no product, axis or estimate words;
 * - no wording that tries to steer the assistant away from the notes' own clauses or towards an
 *   action (ignore/forget/override instructions, a new role, revealing a prompt or a key, running a
 *   command): the prompt-injection shapes of proposal §6 rows 14 and 15;
 * - nothing on the A13 list (ROADMAP A13, `scripts/language-terms.json`, DESIGN R-5.6.1).
 *
 * The rules are deliberately blunt: a false alarm on a typed line only asks the person to reword,
 * while a miss would put a trait into the notes.
 */

import a13 from '../../scripts/language-terms.json'
import { MONTH_RE } from './types'

export type LintRule = 'ascii' | 'digit' | 'url' | 'markup' | 'trait' | 'level' | 'self' | 'education' | 'language' | 'brand' | 'override' | 'a13'

export interface LintHit {
  readonly rule: LintRule
  readonly match: string
  /** 0-based index of the match in the linted text. */
  readonly index: number
  /** 1-based line of the match in the linted text. */
  readonly line: number
}

interface Rule {
  readonly rule: Exclude<LintRule, 'ascii' | 'digit' | 'a13'>
  readonly re: RegExp
}

const RULES: readonly Rule[] = [
  { rule: 'url', re: /https?:|ftp:|:\/\/|www\.|\]\(|@|\b[a-z0-9-]+\.(?:com|org|net|io|edu|gov|co|app|dev|ai|me|info|uk|us|de|ly|gg|xyz|sh|md)\b|[a-z]\.[a-z]/giu },
  { rule: 'markup', re: /[#*_`[\]<>|\\{}~^]/gu },
  {
    rule: 'trait',
    re: /\b(?:low|weak|weaker|weakest|poor|poorly|slow|slower|below average|above average|struggl\w*|limited|novice|beginner|behind|gifted|talented|smart|clever|bright|dumb|stupid|genius|advanced|remedial|basic level|newbie|dummy|idiot\w*|fool\w*)\b/giu,
  },
  {
    rule: 'level',
    re: /\b(?:levels?|abilit(?:y|ies)|aptitude|competen(?:ce|cy)|proficien\w*|numeracy|literacy|intelligen\w*|iq|scores?|scored|scoring|percentiles?|ranks?|ranked|ranking|grades?|graded|ratings?|theta|sd|standard deviation|deciles?|quartiles?|terciles?)\b/giu,
  },
  {
    // First person plus a self-description ("I am bad at ...", "my memory is ...").
    rule: 'self',
    re: /\b(?:i|i'm|i am|i've|i have|my)\b[^.]{0,25}\b(?:bad|good|great|terrible|awful|hopeless|useless|weak|strong|struggle\w*|fail\w*|vocabulary|reading|memory|speed|math|maths|brain)\b/giu,
  },
  {
    rule: 'education',
    re: /\b(?:education\w*|uneducated|degrees?|college|university|universities|school\w*|high-school|graduates?|undergrad\w*|phd|doctorate|masters|bachelors?|diploma|dropouts?|students?|teenagers?|teens?|elderly)\b/giu,
  },
  { rule: 'language', re: /\b(?:native|non-native|second language|first language|mother tongue|esl|efl|english learner|foreign|immigrants?|accent)\b/giu },
  { rule: 'brand', re: /\b(?:humanbench|human bench|hb-brief|blob|axis|axes|estimates?|estimated|posterior|bayesian)\b/giu },
  // Steering wording (R-17.3, proposal §6 rows 14-15). Each pattern needs an instruction-override shape
  // (a verb that drops or replaces the rules, aimed at an instruction noun), so a hobby, a subject or an
  // ordinary coding sentence ("ignore any typos", "explain what eval does", "never print api keys") is not
  // caught. These are a courtesy for the person typing: the checker does not rely on them, because it flags
  // every line that is not a standard line however it is worded (check.ts, `typed_words`).
  {
    rule: 'override',
    re: /\b(?:ignore|disregard|forget|override|overrule|bypass|disobey|stop following|no longer follow|(?:do not|don't|dont|never) follow)\b[^.\n]{0,40}?\b(?:instructions?|rules?|guidelines?|directions?|prompts?|polic(?:y|ies)|restrictions?|filters?|guardrails?|safeguards?|safety|notes|preferences)\b/giu,
  },
  {
    rule: 'override',
    re: /\b(?:ignore|disregard|forget)\s+(?:the\s+)?(?:above|previous|prior|preceding)\b|\b(?:ignore|disregard|forget)\s+(?:everything|anything|all)\s+(?:above|before|previously|earlier|so far|you (?:were|have been|know)|i (?:said|told)|that (?:was|came))\b/giu,
  },
  { rule: 'override', re: /\b(?:system|developer|hidden|secret)\s+(?:prompt|message|instructions?)\b|\b(?:original|initial)\s+(?:prompt|instructions?)\b|\b(?:jailbreak\w*|dan mode|developer mode|god mode|prompt injection|unfiltered|uncensored)\b|\b(?:without|no)\s+(?:any\s+)?(?:restrictions?|guardrails?|safeguards?|censorship)\b/giu },
  {
    rule: 'override',
    re: /\b(?:you are now|you are no longer|you will now|you must now|from now on,? you|pretend (?:that )?you|pretend to be (?:the |an? )?(?:developer|admin\w*|system|root|owner|human)|act as (?:if|though) you|act as (?:the |an? |my )?(?:developer|admin\w*|system|root|operator|owner|unrestricted|unfiltered)|role-?play as (?:the |an? )?(?:developer|admin\w*|system|root)|new (?:instructions?|persona))\b/giu,
  },
  // Revealing or sending out secrets. A negated sentence ("never leak secrets into logs") is a protective
  // instruction, not a steer, so a negation just before the verb (up to two words back) lets it through.
  {
    rule: 'override',
    re: /(?<!\b(?:never|not|don't|dont|without|avoid|no)\s+(?:\w+\s+){0,2})\b(?:reveal|leak|expose|exfiltrate|disclose|repeat back|print out)\b[^.\n]{0,40}?\b(?:prompt|instructions?|conversation|chat history|secrets?|passwords?|credentials?|tokens?|memory|memories)\b/giu,
  },
  {
    rule: 'override',
    re: /(?<!\b(?:never|not|don't|dont|without|avoid|no)\s+(?:\w+\s+){0,2})\b(?:paste|send|share|give|provide|type|enter|post|tell)\s+(?:me\s+)?your\s+(?:\w+\s+){0,2}(?:passwords?|api keys?|secret keys?|private keys?|credentials?|tokens?|ssh keys?)\b/giu,
  },
  {
    rule: 'override',
    re: /\b(?:execute|run|install|download|visit|click|fetch|open)\s+(?:this|that|any|every|the following|the attached|the linked)\s+(?:command|script|link|website|url|payload|file)\b|\b(?:execute|run)\s+(?:the|any|every)\s+(?:command|script)s?\s+(?:in|from)\s+(?:my|the|any|a)\b/giu,
  },
]

/** A13 vocabulary, compiled once with the lint's own boundary rule ("between letters", ROADMAP A13). */
const A13: readonly { id: string; re: RegExp }[] = a13.banned_terms.map((t) => ({
  id: t.id,
  re: new RegExp(`(?<!\\p{L})(?:${t.pattern})(?!\\p{L})`, 'giu'),
}))

/** A `YYYY-MM` month inside text: the only digits allowed. */
const MONTH_IN_TEXT = /(?<![0-9])(?:19|20|21)\d\d-(?:0[1-9]|1[0-2])(?![0-9])/gu

function lineOf(text: string, index: number): number {
  let n = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

function scan(text: string, rules: readonly Rule[], hits: LintHit[]): void {
  for (const { rule, re } of rules) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) hits.push({ rule, match: m[0], index: m.index ?? 0, line: lineOf(text, m.index ?? 0) })
  }
}

/** Every violation in one piece of content (a line's text, without list or heading markers). */
export function lintLine(text: string): LintHit[] {
  const hits: LintHit[] = []
  for (const m of text.matchAll(/[^\x20-\x7E\n]/gu)) hits.push({ rule: 'ascii', match: m[0], index: m.index ?? 0, line: lineOf(text, m.index ?? 0) })
  // Digits: mask the allowed months first (same length, so indexes stay right).
  const masked = text.replace(MONTH_IN_TEXT, (s) => '#'.repeat(s.length))
  for (const m of masked.matchAll(/[0-9]+/gu)) hits.push({ rule: 'digit', match: m[0], index: m.index ?? 0, line: lineOf(text, m.index ?? 0) })
  // The masked months are not markup: lint the rest with them blanked out.
  const rest = text.replace(MONTH_IN_TEXT, (s) => ' '.repeat(s.length))
  scan(rest, RULES, hits)
  for (const { id, re } of A13) {
    re.lastIndex = 0
    for (const m of rest.matchAll(re)) hits.push({ rule: 'a13', match: `${id}: ${m[0]}`, index: m.index ?? 0, line: lineOf(text, m.index ?? 0) })
  }
  return hits.sort((a, b) => a.index - b.index)
}

/** `true` when `text` is a valid `YYYY-MM` month. */
export const isMonth = (text: string): boolean => MONTH_RE.test(text)

/**
 * The content of each line of finished notes, with the structure the renderer adds removed:
 * `#`/`##` headings, `- ` list markers and the `---` front matter fences (its `name:` and
 * `description:` keys are kept as content). Returns `[content, 1-based line]` pairs.
 */
export function contentLines(text: string): [string, number][] {
  const out: [string, number][] = []
  text.split('\n').forEach((raw, i) => {
    let line = raw
    if (/^---\s*$/u.test(line)) return
    line = line.replace(/^#{1,2}\s+/u, '').replace(/^-\s+/u, '')
    if (line.trim() !== '') out.push([line, i + 1])
  })
  return out
}

/** All violations in finished notes (any form), each with its line number in `text`. */
export function lintNotes(text: string): LintHit[] {
  const hits: LintHit[] = []
  for (const [content, line] of contentLines(text)) for (const h of lintLine(content)) hits.push({ ...h, line })
  return hits
}

/** One-line reasons, worded for the person who typed the line (no digits, no clinical terms). */
export const LINT_MESSAGES: Readonly<Record<LintRule, string>> = {
  ascii: 'Use plain letters and punctuation only (no accents, symbols or other alphabets).',
  digit: 'Leave out numbers. Notes carry no numbers except a month.',
  url: 'Leave out web addresses and email addresses.',
  markup: 'Leave out symbols such as hash signs, stars, brackets and underscores.',
  trait: 'Describe how you want answers, not how good or weak you are at something.',
  level: 'Leave out levels, grades, ranks and scores.',
  self: 'Describe how you want answers, not what you are like.',
  education: 'Leave out schooling and background. Notes describe wording and depth only.',
  language: 'Leave out first-language or background details. The notes already apply in any language.',
  brand: 'Leave out product names, estimates and technical scoring words.',
  override: 'Leave out wording that tells the assistant to drop its rules, take a new role, reveal something or run something. Describe wording, depth and checking only.',
  a13: 'That wording is not allowed here.',
}

/** The distinct messages for a set of hits, in order of first appearance. */
export function lintMessages(hits: readonly LintHit[]): string[] {
  return [...new Set(hits.map((h) => LINT_MESSAGES[h.rule]))]
}
