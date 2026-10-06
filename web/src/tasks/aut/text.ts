/**
 * Text handling for the Alternative Uses Task ("Unusual uses", experimental; ROADMAP M6.4, DESIGN
 * §5.4): cleaning a typed response, counting its words, the "a use for X" plausibility template,
 * and the personal-information check behind the §8 warning ("don't type personal info"; AUT
 * responses are the only free text a save file holds).
 *
 * Pure string functions: no embedder, no Svelte, no DOM.
 *
 * **The personal-information check** ({@link personalInfo}) leans toward flagging: a response it
 * flags is not scored and its text is redacted ({@link redactPersonalInfo}), so a false positive
 * costs one idea, while a missed phone number or email would be kept in the person's save file.
 * It looks for:
 * - `email`: `name@domain` (with or without a dot after the domain), and spelled-out forms such as
 *   "name at mail dot com" or "name (at) mail (dot) com";
 * - `phone`: 7 or more digits, optionally led by `+` or `(` and separated by spaces, `.`, `-`, `/`,
 *   `(` or `)` (up to three separators between two digits);
 * - `url`: a scheme (`https://`, `mailto:`, `tel:` …), `www.`, a bare domain ending in a common
 *   top-level domain (`example.com`, `shop.co.uk`), or "site dot com";
 * - `handle`: `@name` not inside an email, and Reddit-style `u/name`;
 * - `long_number`: 5 or more digits in a row that are not part of a phone number (account, card,
 *   ID or house numbers, US ZIP codes);
 * - `street_address`: a house number followed, within three more words, by a street word (street,
 *   st, road, rd, avenue, ave, lane, ln, drive, dr, close, court, way, boulevard, blvd and others in
 *   {@link STREET_WORDS}); the words in between may not be little words such as "in", "to" or "a"
 *   (so "stack 3 in a row" and "use 2 to drive nails" are not addresses), except "the" right before
 *   the street word ("1 The Close"). Also `PO Box 12`, and a number next to a word ending in a
 *   continental street suffix ("Hauptstraße 5");
 * - `postcode`: UK (`SW1A 1AA`, `M1 1AE`), Canadian (`K1A 0B1`), US ZIP+4 (`12345-6789`) and a
 *   5-digit ZIP after a US state code or "zip" (`CA 90210`; a bare 5-digit number is a
 *   `long_number`).
 *
 * Detection order matters only for overlap: an email's domain is not also reported as a url, nor a
 * url's `@path` as a handle, nor a phone number's digits as a long number.
 */

/** Longest cleaned response, in code points. */
export const MAX_RESPONSE_CHARS = 120

/** What replaces each piece of personal information in {@link redactPersonalInfo}. */
export const REDACTED = '[removed]'

/** The kinds of personal information the check reports, in the order it reports them. */
export const PERSONAL_INFO_KINDS = ['email', 'phone', 'url', 'handle', 'long_number', 'street_address', 'postcode'] as const
export type PersonalInfoKind = (typeof PERSONAL_INFO_KINDS)[number]

/* ---------------------------------------------------------------- cleaning */

function cleanOnce(s: string): string {
  let t = s
    .replace(/[\t\n\v\f\r\u0085]/g, ' ') // line breaks and tabs become spaces, not nothing
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '') // other control, format (zero-width, bidi) and lone surrogate code units
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
  const cps = Array.from(t)
  if (cps.length > MAX_RESPONSE_CHARS) t = cps.slice(0, MAX_RESPONSE_CHARS).join('').trimEnd()
  return t
}

/**
 * A typed response as it is scored and saved: Unicode NFC; tabs and line breaks turned into spaces;
 * control, format (zero-width, bidi) and lone surrogate characters removed; runs of whitespace
 * collapsed to one space; trimmed; capped at {@link MAX_RESPONSE_CHARS} code points (never splitting
 * a surrogate pair). Idempotent: cleaning a cleaned response changes nothing.
 */
export function cleanResponse(raw: string): string {
  if (typeof raw !== 'string') return ''
  // A cut at the cap can leave a string that one more pass would change (an NFC edge case); repeat
  // to the fixed point so the function is idempotent. Two passes suffice in practice.
  let prev = raw
  for (let i = 0; i < 8; i++) {
    const next = cleanOnce(prev)
    if (next === prev) return next
    prev = next
  }
  return prev
}

/** Whitespace-separated tokens that contain at least one letter or digit ("..." and "-" are not words). */
export function wordCount(s: string): number {
  if (typeof s !== 'string') return 0
  let n = 0
  for (const tok of s.split(/\s+/u)) if (/[\p{L}\p{N}]/u.test(tok)) n++
  return n
}

/* ---------------------------------------------------------------- template */

/** "a" or "an" before `word`, by its first sound (a spelling heuristic with the common exceptions). */
export function indefiniteArticle(word: string): 'a' | 'an' {
  const w = word.trim().toLowerCase()
  if (/^(?:hour|honest|honou?r|heir)/u.test(w)) return 'an'
  // Vowel letters that sound like "y" or "w": unicorn, uniform, union, USB, user, ukulele, euro, ewe, one.
  if (/^(?:uni[^nmdg]|unanim|us[ab]|use|usu|ute|uti|uku|ura|ure|uri|uro|eu|ewe|one(?!r)|once)/u.test(w)) return 'a'
  return /^[aeiou]/u.test(w) ? 'an' : 'a'
}

/**
 * The plausibility template for an object, "a use for a brick" (DESIGN §5.4: a response's
 * similarity to it must exceed a floor). An object that already starts with an article is used as
 * it is ("the moon" gives "a use for the moon"). Throws a RangeError for an empty object.
 */
export function templateText(object: string): string {
  const o = object.normalize('NFC').replace(/\s+/gu, ' ').trim()
  if (o === '') throw new RangeError('templateText(): the object is empty')
  if (/^(?:a|an|the)\s/iu.test(o)) return `a use for ${o}`
  return `a use for ${indefiniteArticle(o)} ${o}`
}

/* ---------------------------------------------------------------- personal information */

interface Span {
  readonly kind: PersonalInfoKind
  readonly start: number
  readonly end: number
}

/** Common top-level domains for bare domains and spelled-out addresses (longest first within a prefix). */
const TLDS =
  'com|net|org|edu|gov|mil|info|biz|name|io|co|uk|us|ca|au|nz|ie|de|fr|es|it|nl|be|ch|at|se|no|dk|fi|pl|pt|ru|jp|cn|in|br|mx|za|eu|me|tv|ly|fm|cc|app|dev|ai|gg|xyz|site|online|shop|store|blog|page|link|live|tech|club|top|email'

const L = '\\p{L}\\p{N}' // letters and digits, for character classes
const D = '\\p{Nd}' // any decimal digit (fullwidth and other scripts too)

const AT = `(?:\\s*[([{]\\s*at\\s*[)\\]}]\\s*|\\s+at\\s+)`
const DOT = `(?:\\s*[([{]\\s*dot\\s*[)\\]}]\\s*|\\s+dot\\s+|\\.)`

const RE = {
  email: new RegExp(`[${L}._%+'-]+@[${L}][${L}-]*(?:\\.[${L}-]+)*`, 'gu'),
  emailSpelled: new RegExp(`[${L}._%+-]+${AT}[${L}-]+(?:${DOT}[${L}-]+)*${DOT}(?:${TLDS})(?![${L}])`, 'giu'),
  urlScheme: new RegExp(`(?:[a-z][a-z0-9+.-]*:\\/\\/|(?:mailto|tel|sms|callto|skype|whatsapp):)\\S+`, 'giu'),
  urlWww: new RegExp(`www\\d?\\.\\S+`, 'giu'),
  urlBare: new RegExp(`(^|[^${L}@._-])((?:[${L}-]+\\.)+(?:${TLDS})(?![${L}-])(?:[/?#:]\\S*)?)`, 'giu'),
  urlSpelled: new RegExp(`(^|[^${L}])([${L}-]+(?:\\s*[([{]\\s*dot\\s*[)\\]}]\\s*|\\s+dot\\s+)(?:${TLDS}))(?![${L}])`, 'giu'),
  handleAt: new RegExp(`(^|[^${L}_.+@-])(@[${L}_](?:[${L}_.]*[${L}_])?)`, 'gu'),
  handleReddit: new RegExp(`(^|[^${L}_/])(u\\/[${L}_-]{3,})`, 'giu'),
  phone: new RegExp(`\\+?\\(?${D}(?:[\\s().\\-/]{0,3}${D}){6,}`, 'gu'),
  longNumber: new RegExp(`${D}{5,}`, 'gu'),
  poBox: new RegExp(`(^|[^${L}])(p\\.?\\s*o\\.?\\s*box\\s*#?\\s*${D}+)`, 'giu'),
  postUk: new RegExp(`(^|[^${L}])([a-z]{1,2}${D}[a-z${D}]?\\s*${D}[a-z]{2})(?![${L}])`, 'giu'),
  postCa: new RegExp(`(^|[^${L}])([abceghj-nprstvxy]${D}[abceghj-nprstv-z][\\s-]?${D}[abceghj-nprstv-z]${D})(?![${L}])`, 'giu'),
  postZip4: new RegExp(`(^|[^${L}])(${D}{5}\\s*-\\s*${D}{4})(?![${L}])`, 'gu'),
  postZipState: new RegExp(
    `(^|[^${L}])((?:zip(?:\\s*code)?:?|al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\\.?,?\\s*${D}{5})(?![${L}])`,
    'giu',
  ),
}

/** Street words that follow a house number (the spec list and common others). */
export const STREET_WORDS: ReadonlySet<string> = new Set([
  'street', 'st', 'road', 'rd', 'avenue', 'ave', 'av', 'lane', 'ln', 'drive', 'dr', 'close', 'court', 'ct', 'way',
  'boulevard', 'blvd', 'place', 'pl', 'terrace', 'crescent', 'cres', 'square', 'sq', 'highway', 'hwy', 'parkway',
  'pkwy', 'circle', 'cir', 'mews', 'grove', 'gardens', 'plaza', 'trail', 'rue', 'via', 'calle', 'avenida',
])

/** Little words that end the search for a street word after a number ("3 in a row" is no address). */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'to', 'in', 'on', 'of', 'as', 'at', 'by', 'for', 'from', 'with', 'into', 'onto', 'and', 'or', 'it',
  'its', 'them', 'they', 'is', 'are', 'be', 'up', 'down', 'out', 'over', 'under', 'off', 'than', 'then', 'that', 'this',
  'if', 'so', 'but', 'you', 'your', 'my', 'me', 'i', 'we', 'he', 'she',
])

/** A house number: 1–6 digits and an optional letter (221b), maybe after '#'. */
const HOUSE_NUMBER = new RegExp(`^#?${D}{1,6}[a-z]?$`, 'iu')
/** A token ending in a continental street suffix (Hauptstraße, Kerkstraat, Storgatan). */
const STREET_SUFFIX = /(?:straße|strasse|str|straat|gasse|weg|gatan|vägen|vej|veien|ulica)$/iu

function core(tok: string): string {
  return tok.replace(/^[("'[{]+/u, '').replace(/[)"'\]},.;:!?]+$/u, '').toLowerCase()
}

function streetSpans(text: string): Span[] {
  const toks = [...text.matchAll(/\S+/gu)].map((m) => ({ s: m.index, e: m.index + m[0].length, c: core(m[0]) }))
  const out: Span[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t === undefined || !HOUSE_NUMBER.test(t.c)) continue
    // number, then up to three name words, then a street word
    for (let j = i + 1; j <= i + 4 && j < toks.length; j++) {
      const u = toks[j] as (typeof toks)[number]
      if (STREET_WORDS.has(u.c)) {
        out.push({ kind: 'street_address', start: t.s, end: u.e })
        break
      }
      const nextIsStreet = STREET_WORDS.has(toks[j + 1]?.c ?? '')
      if (STOP_WORDS.has(u.c) && !(u.c === 'the' && nextIsStreet)) break
      if (HOUSE_NUMBER.test(u.c)) break
    }
    // "Hauptstraße 5": a continental street name, then the number
    const prev = toks[i - 1]
    if (prev !== undefined && prev.c.length > 3 && STREET_SUFFIX.test(prev.c)) out.push({ kind: 'street_address', start: prev.s, end: t.e })
  }
  return out
}

function spansOf(kind: PersonalInfoKind, re: RegExp, text: string, prefixed: boolean): Span[] {
  const out: Span[] = []
  for (const m of text.matchAll(re)) {
    const pre = prefixed ? (m[1] ?? '').length : 0
    const body = prefixed ? (m[2] ?? '') : m[0]
    if (body.length > 0) out.push({ kind, start: m.index + pre, end: m.index + pre + body.length })
  }
  return out
}

/** `text` with every span replaced, unit for unit, by NUL (a character no detector matches or joins across). */
function mask(text: string, spans: readonly Span[]): string {
  if (spans.length === 0) return text
  const chars = text.split('')
  for (const sp of spans) for (let i = sp.start; i < sp.end; i++) chars[i] = '\u0000'
  return chars.join('')
}

/** Every piece of personal information in `text`, as spans (may overlap across kinds). */
function findSpans(text: string): Span[] {
  const email = [...spansOf('email', RE.email, text, false), ...spansOf('email', RE.emailSpelled, text, false)]
  const t1 = mask(text, email)
  const url = [
    ...spansOf('url', RE.urlScheme, t1, false),
    ...spansOf('url', RE.urlWww, t1, false),
    ...spansOf('url', RE.urlBare, t1, true),
    ...spansOf('url', RE.urlSpelled, t1, true),
  ]
  const t2 = mask(t1, url)
  const phone = spansOf('phone', RE.phone, t2, false)
  const t3 = mask(t2, phone)
  const handle = [...spansOf('handle', RE.handleAt, t2, true), ...spansOf('handle', RE.handleReddit, t2, true)]
  const longNumber = spansOf('long_number', RE.longNumber, t3, false)
  const street = [...streetSpans(t2), ...spansOf('street_address', RE.poBox, t2, true)]
  const postcode = [
    ...spansOf('postcode', RE.postUk, t2, true),
    ...spansOf('postcode', RE.postCa, t2, true),
    ...spansOf('postcode', RE.postZip4, t2, true),
    ...spansOf('postcode', RE.postZipState, t2, true),
  ]
  return [...email, ...url, ...phone, ...handle, ...longNumber, ...street, ...postcode]
}

/**
 * The kinds of personal information found in `text`, each at most once, in
 * {@link PERSONAL_INFO_KINDS} order; empty when none is found. Leans toward flagging (see the module
 * comment).
 */
export function personalInfo(text: string): PersonalInfoKind[] {
  if (typeof text !== 'string' || text === '') return []
  const found = new Set(findSpans(text).map((s) => s.kind))
  return PERSONAL_INFO_KINDS.filter((k) => found.has(k))
}

/**
 * `text` with each piece of personal information replaced by {@link REDACTED} (overlapping or
 * touching pieces become one). Unchanged when {@link personalInfo} finds nothing.
 */
export function redactPersonalInfo(text: string): string {
  if (typeof text !== 'string' || text === '') return ''
  const spans = findSpans(text)
    .map((s) => [s.start, s.end] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (spans.length === 0) return text
  let out = ''
  let at = 0
  let cur: [number, number] | null = null
  for (const [s, e] of spans) {
    if (cur !== null && s <= cur[1]) {
      cur[1] = Math.max(cur[1], e)
      continue
    }
    if (cur !== null) {
      out += text.slice(at, cur[0]) + REDACTED
      at = cur[1]
    }
    cur = [s, e]
  }
  if (cur !== null) out += text.slice(at, cur[0]) + REDACTED + text.slice(cur[1])
  return out
}
