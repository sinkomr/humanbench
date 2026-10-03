/**
 * Language lint (ROADMAP M1.20, A13; DESIGN R-5.6.1–R-5.6.5, §5.6, §13). HumanBench measures
 * skills, not conditions, so no user-facing text in this public repo may use clinical or
 * diagnostic vocabulary. `npm test` runs it (`language-lint.test.ts`), and `npm run lint:language`
 * (`lint-language.ts`) prints each hit.
 *
 * **What is scanned** ({@link collectFiles}), as repo-relative posix paths: every text file under
 * `web/src` (the share-card renderer, M1.18, will land there too) except tests (`*.test.*`,
 * `*.spec.*`) and `__fixtures__/` test data; `web/public`; the repo-root `schema/` (the build
 * publishes its JSON at `<base>schema/`, DESIGN §8); every `web/*.html` ({@link SCAN_FILES},
 * `pages.test.ts`); `README.md` and `web/README.md`. Per file type ({@link segmentsOf}):
 * - `.ts`/`.js` (and `.tsx`/`.jsx`) and the `<script>` blocks of `.svelte`/`.html`: string
 *   literals, template literal text and JSX text, parsed with the TypeScript compiler, so comments,
 *   identifiers and import paths never match;
 * - `.svelte`/`.html` markup outside `<script>` (text, attributes, `{…}` expressions, styles),
 *   `.md`, `.svg`, `.css`, `.txt`: the whole text, minus HTML and CSS comments;
 * - `.json`: every string value (keys are data, not copy).
 *
 * **What is banned** ({@link BANNED_TERMS}): each term with its word forms, the reason, and
 * examples the tests check it catches. Matching is case-insensitive and between letters: anything
 * but a letter (space, punctuation, a digit, `_`) delimits, so "non-diagnostic" and "adhd_screen"
 * match but "IQR" does not. {@link NOT_BANNED} records near-misses that were left out on purpose,
 * and the tests check they stay unflagged.
 *
 * **What is allowed** ({@link ALLOWED_TEXT}): exactly three texts are masked before matching,
 * case-sensitively but ignoring how whitespace wraps (Markdown and HTML may break lines). Change
 * one character and they no longer mask.
 * - The R-5.6.5 resource sentence (`RESOURCE_LINE` in `src/copy.ts`), the first allow-listed
 *   constant. {@link lintFiles} also fails when any other scanned file spells it out: import it.
 *   Rendering it only in the results footer, never on a share card, is M1.R/M1.18's rule.
 * - The §13 disclaimer (`DISCLAIMER`), the one place "clinical" (and "IQ", which it disowns) may
 *   appear. It may be quoted anywhere (README, the no-JS fallback).
 * - The R-5.6.2 Emotion Reading tooltip (`EMO_TOOLTIP` in `src/copy.ts`), the third text, added by
 *   ROADMAP M6.1 on the authority of DESIGN R-5.6.2 (ROADMAP A13 itself still lists two allowed
 *   texts: the ADR needs the owner's amendment, an open follow-up). R-5.6.2 fixes its words, "… Not a diagnostic or clinical
 *   measure; …", which the lint would otherwise flag ("diagnostic", "clinical"); it explains what the
 *   axis is not, to the person looking at the axis. Like `RESOURCE_LINE` it has a single home, so
 *   `lintFiles` fails when any other scanned file spells it out: import it.
 * `src/copy.test.ts` pins all three word-for-word to docs/DESIGN.md.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { DISCLAIMER, EMO_TOOLTIP, RESOURCE_LINE } from '../src/copy'

/** The public repo root (this file is web/scripts/language-lint.ts). */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

export interface BannedTerm {
  /** Short name used in reports and tests. */
  readonly id: string
  /** Regex source of the word forms; the lint wraps it in `(?<!\p{L})(?:…)(?!\p{L})` and matches case-insensitively. */
  readonly pattern: string
  /** Forms the pattern must catch (tested). */
  readonly examples: readonly string[]
  /** Why it is banned, citing DESIGN/ROADMAP. */
  readonly why: string
}

/** The banned vocabulary (A13, R-5.6.1 "no autism, ADHD, alexithymia or other clinical terms"). */
export const BANNED_TERMS: readonly BannedTerm[] = [
  {
    id: 'autism',
    pattern: 'autis\\w*',
    examples: ['autism', 'autistic', 'Autists'],
    why: 'R-5.6.1 names it. §5.6: a short web test cannot flag autism (PPV about 9% at population base rates), so no copy may imply it can.',
  },
  { id: 'asperger', pattern: 'asperger\\w*', examples: ['Asperger', "Asperger's", 'aspergers'], why: 'A former autism diagnosis label (R-5.6.1 "other clinical terms").' },
  { id: 'asd', pattern: 'asd', examples: ['ASD'], why: 'Acronym of the autism spectrum diagnosis (R-5.6.1).' },
  {
    id: 'on-the-spectrum',
    pattern: 'on\\s+the\\s+spectrum',
    examples: ['on the spectrum', 'On the\nspectrum'],
    why: 'Everyday euphemism for an autism label (R-5.6.1). "spectrum" alone is fine.',
  },
  {
    id: 'adhd',
    pattern: 'adhd',
    examples: ['ADHD', 'adhd'],
    why: 'R-5.6.1 names it; the speed and memory axes (RT, PS, WM) must not read as an attention screen. The older acronym ADD is not listed: it collides with the verb "add".',
  },
  {
    id: 'alexithymia',
    pattern: 'alexithymi\\w*',
    examples: ['alexithymia', 'alexithymic'],
    why: 'R-5.6.1 names it. §5.6: it confounds emotion-reading scores, and that axis stays a skill measure (R-5.6.2).',
  },
  { id: 'dyslexia', pattern: 'dyslexi\\w*', examples: ['dyslexia', 'dyslexic'], why: 'Learning-disorder label; the reading-speed axis (M1.12, A10) must not read as a reading screen.' },
  { id: 'dyscalculia', pattern: 'dyscalculi\\w*', examples: ['dyscalculia', 'dyscalculic'], why: 'Learning-disorder label; the quantitative axis must not read as a maths screen.' },
  { id: 'dyspraxia', pattern: 'dyspraxi\\w*|dysgraphi\\w*', examples: ['dyspraxia', 'dysgraphia'], why: 'Motor and writing disorder labels; RT, Corsi and coding must not read as motor screens.' },
  {
    id: 'neurotype-label',
    pattern: 'neuro(?:diver\\w*|typical\\w*|atypical\\w*)',
    examples: ['neurodivergent', 'neurodiversity', 'Neurotypical', 'neurodiverse'],
    why: 'Labels a person by neurotype (R-5.6.1). The blob describes skills, not who someone is; §5.6 (double empathy): a "neurotypical" key partly measures mismatch.',
  },
  {
    id: 'disability-category',
    pattern: '(?:learning|intellectual|developmental)\\s+(?:disabilit\\w*|difficult\\w*)',
    examples: ['learning disability', 'intellectual disabilities', 'learning difficulties'],
    why: 'Clinical and educational classification categories (R-5.6.1). "disabled" alone is not listed (see NOT_BANNED).',
  },
  {
    id: 'diagnosis',
    pattern: 'diagnos\\w*',
    examples: ['diagnosis', 'diagnoses', 'diagnose', 'diagnosed', 'diagnostic', 'non-diagnostic'],
    why: '§13: the app is not a clinical assessment; R-5.6.3: it never asks about diagnoses. Copy says what the scores are, not which diagnosis they are not (the one exception is the R-5.6.2 tooltip, an allowed text: see the header).',
  },
  { id: 'prognosis', pattern: 'prognos\\w*', examples: ['prognosis', 'prognostic'], why: 'Medical outcome framing (§13: not a basis for decisions about health).' },
  { id: 'disorder', pattern: 'disorder\\w*', examples: ['disorder', 'Disorders', 'disordered'], why: 'The DSM/ICD category noun (R-5.6.1).' },
  {
    id: 'deficit',
    pattern: 'deficits?',
    examples: ['deficit', 'deficits'],
    why: '§5.6: the deficit account is contested and a low score partly measures mismatch; R-5.6.4: lows are never framed as weaknesses. Also the D of ADHD.',
  },
  {
    id: 'impairment',
    pattern: 'impair\\w*',
    examples: ['impairment', 'impaired', 'impairs'],
    why: 'Clinical deficit framing. The §13 skip-axis reasons should say "low vision" or "colour vision", not "visual impairment".',
  },
  { id: 'pathology', pattern: 'patholog\\w*', examples: ['pathology', 'pathological'], why: 'Medical framing of individual differences (R-5.6.1).' },
  { id: 'symptom', pattern: 'symptom\\w*', examples: ['symptom', 'symptoms', 'symptomatic'], why: 'R-5.6.3: no questions about symptoms are asked or stored, and copy must not invite them.' },
  { id: 'syndrome', pattern: 'syndromes?', examples: ['syndrome', 'Syndromes'], why: 'Medical category noun (R-5.6.1).' },
  {
    id: 'clinical',
    pattern: 'clinic\\w*',
    examples: ['clinical', 'clinically', 'clinician', 'clinic'],
    why: 'R-5.6.1 "other clinical terms". A13: allowed only inside the §13 disclaimer ("clinical"), the R-5.6.5 sentence ("clinician") and the R-5.6.2 tooltip ("clinical").',
  },
  {
    id: 'iq',
    pattern: 'iqs?|intelligence\\s+quotients?|mental\\s+age',
    examples: ['IQ', 'iq', 'IQs', 'intelligence quotient', 'mental age'],
    why: '§13: "Not an IQ test". An IQ is a normed score from clinical batteries (§2.1), and M1 shows no norms (A12). Allowed only inside the §13 disclaimer. "IQR" is fine.',
  },
  {
    id: 'screening',
    pattern: 'screen(?:ings?|ers?)',
    examples: ['screening', 'screener', 'Screenings'],
    why: 'Implies a clinical screening instrument, which §5.6 shows a short web test cannot be. "screen" and "screen reader" are fine.',
  },
  { id: 'therapy', pattern: 'therap\\w*', examples: ['therapy', 'therapist', 'therapeutic'], why: 'Treatment framing (§13: not a basis for decisions about health).' },
  {
    id: 'psychiatry',
    pattern: 'psychiatr\\w*|neuropsych\\w*',
    examples: ['psychiatric', 'psychiatrist', 'neuropsychological'],
    why: 'Clinical specialties and their test batteries (§2.1); HumanBench is not one (§13).',
  },
  { id: 'abnormal', pattern: 'abnormal\\w*', examples: ['abnormal', 'abnormally', 'abnormality'], why: 'Clinical deviance framing of a score; say "unusual".' },
  { id: 'retardation', pattern: 'retard\\w*', examples: ['retardation', 'retarded'], why: 'Obsolete clinical label and a slur.' },
  {
    id: 'condition-name',
    pattern: 'dementia\\w*|schizo\\w*|bipolar|ocd|ptsd|psychos[ie]s|psychotic\\w*',
    examples: ['dementia', 'schizophrenia', 'bipolar', 'OCD', 'PTSD', 'psychosis', 'psychotic'],
    why: 'Named psychiatric or neurological conditions (R-5.6.1 "other clinical terms").',
  },
]

/**
 * Near-misses left out on purpose, with the reason. The tests check that none of them is flagged,
 * so a new pattern cannot swallow them by accident.
 */
export const NOT_BANNED: Readonly<Record<string, string>> = {
  add: 'The verb; the old acronym ADD collides with it (ADHD is banned).',
  addition: 'Arithmetic (the quantitative axis).',
  disabled: 'An HTML attribute and accessibility vocabulary.',
  screen: 'Displays; "screen reader" is accessibility copy (§13).',
  'screen reader': 'Accessibility copy (§13).',
  spectrum: 'Ordinary word; only the phrase "on the spectrum" is a label.',
  patient: 'Ordinary adjective ("be patient").',
  health: 'In the §13 disclaimer itself; R-5.6.3 bans asking about it, not the word.',
  anxious: 'Emotion vocabulary the Emotion Reading axis needs (R-5.6.2).',
  sad: 'Emotion vocabulary the Emotion Reading axis needs (R-5.6.2).',
  depressed: 'Emotion vocabulary; also keys "depressed" in input handling.',
  depression: 'Economic history (reading passages) and emotion vocabulary.',
  weakness: 'R-5.6.4 is a share-card rule (M1.18), not a word ban.',
  normal: 'Statistics (normal distribution, §7).',
  IQR: 'Interquartile range.',
  diagram: 'Not a form of "diagnose".',
  diagonal: 'Not a form of "diagnose".',
  impartial: 'Not a form of "impair".',
  clinch: 'Not a form of "clinic".',
  authentic: 'Not a form of "autism".',
}

export interface AllowedText {
  /** The export name in `src/copy.ts`. */
  readonly name: string
  readonly text: string
  /** When set, only this file may spell the text out; everything else imports it. */
  readonly home?: string
  readonly why: string
}

/** The only text allowed to carry banned words (A13), masked before matching. */
export const ALLOWED_TEXT: readonly AllowedText[] = [
  {
    name: 'RESOURCE_LINE',
    text: RESOURCE_LINE,
    home: 'web/src/copy.ts',
    why: 'R-5.6.5: the neutral resource line; an allow-listed constant with one home file (A13).',
  },
  {
    name: 'DISCLAIMER',
    text: DISCLAIMER,
    why: '§13: the non-diagnostic disclaimer; the one place "clinical" (and the disowned "IQ") may appear (A13).',
  },
  {
    name: 'EMO_TOOLTIP',
    text: EMO_TOOLTIP,
    home: 'web/src/copy.ts',
    why: 'R-5.6.2: the Emotion Reading tooltip, word for word; it names "diagnostic" and "clinical" to say what the axis is not (DESIGN R-5.6.2; ROADMAP A13 does not list it yet).',
  },
]

export interface Hit {
  /** {@link BannedTerm.id}. */
  readonly term: string
  /** The matched text, as written. */
  readonly match: string
  /** 1-based line in the file. */
  readonly line: number
  /** JSON path of the string value, for `.json` files. */
  readonly where?: string
}

/** A run of scannable text: `text[0]` is on 1-based line `line` of the file. */
export interface Segment {
  readonly text: string
  readonly line: number
  readonly where?: string
}

export type FileKind = 'script' | 'component' | 'markup' | 'css' | 'json'

/** How a file is scanned, by extension; undefined = not a text file the lint reads. */
export function kindOf(path: string): FileKind | undefined {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'jsx':
      return 'script'
    case 'svelte':
    case 'html':
    case 'htm':
      return 'component'
    case 'md':
    case 'svg':
    case 'txt':
    case 'xml':
    case 'webmanifest':
      return 'markup'
    case 'css':
      return 'css'
    case 'json':
      return 'json'
    default:
      return undefined
  }
}

/** Replaces every character but newlines, so offsets and line numbers survive. */
const blank = (s: string): string => s.replace(/[^\n]/g, ' ')
const blankHtmlComments = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, blank)
const blankCssComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, blank)
const lineAt = (text: string, offset: number): number => {
  let n = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

/** A string literal that names a module rather than holding copy. */
function isModuleSpecifier(node: ts.Node): boolean {
  const p = node.parent
  if (p === undefined) return false
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isModuleDeclaration(p)) return true
  if (ts.isLiteralTypeNode(p) && p.parent !== undefined && ts.isImportTypeNode(p.parent)) return true
  if (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) return true
  return false
}

/** How the TypeScript parser reads a script file, by extension (JSX needs TSX/JSX, or JS). */
function scriptKindOf(fileName: string): ts.ScriptKind {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX
  return /\.[cm]?js$/i.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS
}

/** String literals, template-literal text and JSX text of a TS/JS source, each with its line. */
export function scriptSegments(text: string, fileName = 'x.ts', firstLine = 1): Segment[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName))
  const out: Segment[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) && !isModuleSpecifier(node)) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push({ text: node.text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + firstLine })
    } else if (ts.isJsxText(node)) {
      // JSX text keeps its leading whitespace, so it starts at `pos`, not at getStart().
      out.push({ text: node.text, line: sf.getLineAndCharacterOfPosition(node.pos).line + firstLine })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

const SCRIPT_RE = /(<script\b[^>]*>)([\s\S]*?)<\/script>/gi
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi

/** A Svelte component or HTML page: its `<script>` blocks as scripts, then the rest as text. */
function componentSegments(text: string, fileName: string): Segment[] {
  const out: Segment[] = []
  for (const m of text.matchAll(SCRIPT_RE)) {
    const body = m[2] ?? ''
    const offset = (m.index ?? 0) + (m[1] ?? '').length
    out.push(...scriptSegments(body, fileName.endsWith('.svelte') ? 'x.ts' : 'x.js', lineAt(text, offset)))
  }
  const markup = blankHtmlComments(text.replace(SCRIPT_RE, blank)).replace(STYLE_RE, blankCssComments)
  out.push({ text: markup, line: 1 })
  return out
}

/** Every string value of a JSON document with its path; keys are not copy. */
function jsonSegments(text: string): Segment[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return [{ text, line: 1 }]
  }
  const out: Segment[] = []
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'string') {
      const at = text.indexOf(JSON.stringify(v))
      out.push({ text: v, line: at < 0 ? 1 : lineAt(text, at), where: path })
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`))
    } else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`)
    }
  }
  walk(data, '$')
  return out
}

/** The scannable text of a file, by its type ({@link kindOf}); `[]` for files the lint skips. */
export function segmentsOf(text: string, path: string): Segment[] {
  switch (kindOf(path)) {
    case 'script':
      return scriptSegments(text, path)
    case 'component':
      return componentSegments(text, path)
    case 'markup':
      return [{ text: blankHtmlComments(text), line: 1 }]
    case 'css':
      return [{ text: blankCssComments(text), line: 1 }]
    case 'json':
      return jsonSegments(text)
    default:
      return []
  }
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Matches an allowed text exactly, however its whitespace wraps. */
const ALLOWED_RES: readonly (readonly [AllowedText, RegExp])[] = ALLOWED_TEXT.map((a) => [
  a,
  new RegExp(a.text.trim().split(/\s+/).map(escapeRegExp).join('\\s+'), 'g'),
])

/**
 * Terms match between letters only, not at `\b`: digits and `_` delimit too, so id-like copy such
 * as "adhd_screen" or "ADHD2" is caught, while "IQR" and "diagram" are not. `\p{L}` also keeps
 * accented letters from delimiting.
 */
const TERM_RES: readonly (readonly [BannedTerm, RegExp])[] = BANNED_TERMS.map((t) => [t, new RegExp(`(?<!\\p{L})(?:${t.pattern})(?!\\p{L})`, 'giu')])

export interface Analysis {
  readonly hits: readonly Hit[]
  /** Names of the {@link ALLOWED_TEXT} entries the file spells out. */
  readonly allowed: readonly string[]
}

/** Banned words in one file, after masking the allowed texts. The file type comes from `path`. */
export function analyseText(text: string, path: string): Analysis {
  const hits: Hit[] = []
  const allowed = new Set<string>()
  for (const seg of segmentsOf(text, path)) {
    let masked = seg.text
    for (const [a, re] of ALLOWED_RES) {
      masked = masked.replace(re, (s) => {
        allowed.add(a.name)
        return blank(s)
      })
    }
    for (const [term, re] of TERM_RES) {
      for (const m of masked.matchAll(re)) {
        const hit: Hit = { term: term.id, match: m[0], line: seg.line + lineAt(masked, m.index) - 1 }
        hits.push(seg.where === undefined ? hit : { ...hit, where: seg.where })
      }
    }
  }
  hits.sort((a, b) => a.line - b.line || a.term.localeCompare(b.term))
  return { hits, allowed: [...allowed].sort() }
}

/** Banned words in one file (see {@link analyseText}). */
export function lintText(text: string, path: string): Hit[] {
  return [...analyseText(text, path).hits]
}

export interface SourceFile {
  /** Repo-relative posix path (the allowed texts' `home` is compared against it). */
  readonly path: string
  readonly text: string
}

/**
 * One line per problem: banned words, and (unless `checkHomes` is false) allowed texts spelled out
 * away from their home file.
 */
export function lintFiles(files: readonly SourceFile[], { checkHomes = true }: { readonly checkHomes?: boolean } = {}): string[] {
  const out: string[] = []
  const why = new Map(BANNED_TERMS.map((t) => [t.id, t.why]))
  for (const f of files) {
    const { hits, allowed } = analyseText(f.text, f.path)
    for (const h of hits) {
      const where = h.where === undefined ? '' : ` at ${h.where}`
      out.push(`${f.path}:${h.line}: "${h.match}"${where} is banned (${h.term}: ${why.get(h.term) ?? ''})`)
    }
    for (const name of checkHomes ? allowed : []) {
      const a = ALLOWED_TEXT.find((x) => x.name === name)
      if (a?.home !== undefined && a.home !== f.path) out.push(`${f.path}: spells out ${a.name}; import it from ${a.home} instead (A13: one allow-listed constant)`)
    }
  }
  return out
}

/** Directories scanned recursively, and single files, relative to the repo root. */
export const SCAN_DIRS: readonly string[] = ['web/src', 'web/public', 'schema']
export const SCAN_FILES: readonly string[] = ['README.md', 'web/README.md', 'web/index.html', 'web/notes.html', 'web/rt-selftest.html', 'web/render-visual.html', 'web/review.html']
/** Tests and their data are not copy (they must name banned words to test them). */
export const EXCLUDE: readonly RegExp[] = [/\.(test|spec)\.[cm]?[jt]sx?$/, /(^|\/)__fixtures__\//]

/** Every file the repo lint reads, as sorted repo-relative posix paths. */
export function collectFiles(root: string = REPO_ROOT): string[] {
  const out: string[] = []
  for (const dir of SCAN_DIRS) {
    const abs = join(root, dir)
    if (!existsSync(abs)) continue
    for (const f of readdirSync(abs, { recursive: true, encoding: 'utf8' })) {
      const path = `${dir}/${f.split(sep).join('/')}`
      if (kindOf(path) !== undefined && statSync(join(root, path)).isFile()) out.push(path)
    }
  }
  for (const f of SCAN_FILES) if (existsSync(join(root, f))) out.push(f)
  return out.filter((p) => !EXCLUDE.some((re) => re.test(p))).sort()
}

/** The whole-repo lint: `[]` when clean. */
export function lintRepo(root: string = REPO_ROOT): string[] {
  return lintFiles(collectFiles(root).map((path) => ({ path, text: readFileSync(join(root, path), 'utf8') })))
}

export interface MainIo {
  readonly out: (s: string) => void
  readonly err: (s: string) => void
  readonly cwd: string
}

const USAGE = `usage: npm run lint:language [-- <file>...]

With no files, lints the repo (the files collectFiles() lists) and also checks that only
web/src/copy.ts spells out the R-5.6.5 sentence. With files, lints just those for banned words.
The banned terms and reasons are in web/scripts/language-lint.ts (ROADMAP A13).`

/** `npm run lint:language`: prints each problem, returns the exit code (0 clean, 1 hits, 2 usage). */
export function main(argv: readonly string[], io: MainIo): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.out(USAGE)
    return 0
  }
  const unknown = argv.find((a) => a.startsWith('-'))
  if (unknown !== undefined) {
    io.err(`unknown option ${unknown}\n${USAGE}`)
    return 2
  }
  let problems: string[]
  let count: number
  if (argv.length === 0) {
    count = collectFiles().length
    problems = lintRepo()
  } else {
    const files: SourceFile[] = []
    for (const a of argv) {
      const abs = resolve(io.cwd, a)
      if (!existsSync(abs)) {
        io.err(`no such file: ${a}`)
        return 2
      }
      if (kindOf(abs) === undefined) {
        io.err(`not a file type the lint reads: ${a}`)
        return 2
      }
      files.push({ path: relative(REPO_ROOT, abs).split(sep).join('/'), text: readFileSync(abs, 'utf8') })
    }
    count = files.length
    // Explicit files get the word lint only: the one-home rule needs the whole tree.
    problems = lintFiles(files, { checkHomes: false })
  }
  if (problems.length > 0) {
    io.err(problems.join('\n'))
    io.err(`language lint: ${problems.length} problem(s) in ${count} file(s) (ROADMAP A13, DESIGN R-5.6.x)`)
    return 1
  }
  io.out(`language lint: ${count} file(s) clean`)
  return 0
}
