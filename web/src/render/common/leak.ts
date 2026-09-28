/**
 * Test-only DOM scans for key leaks (ROADMAP M1.13 acceptance: "no key or correctness hint in the
 * DOM or data attributes"; A18 option order). Imported only by `*.test.ts` files.
 *
 * - {@link normalizeIds}: Svelte's `$props.id()` values differ per mount; they are replaced by a
 *   fixed token so two renders can be compared byte for byte.
 * - {@link tokensOf}: the letter/digit runs of a text (the serialized DOM, or a spec value).
 * - {@link attributeProblems}: no `data-*` attribute at all, and no attribute name or value that
 *   names an answer (correct, answer, solution, right/wrong, key index/value, expected).
 * - {@link optionSignature}: an option element's markup with its own position erased, so the
 *   options of one question can be checked to be identical apart from their text and position.
 */

/** The DOM of `root` with every id generated for the renderer replaced by `ID`. */
export function normalizeIds(root: Element): string {
  let html = root.innerHTML
  const prefixes = new Set<string>()
  for (const el of root.querySelectorAll('[id]')) {
    const m = /^([a-z]+\d+)-/.exec(el.id)
    if (m?.[1]) prefixes.add(m[1])
  }
  for (const p of prefixes) html = html.replace(new RegExp(`\\b${p}(?=-)`, 'g'), 'ID')
  return html
}

/** Letter and digit runs of a text (Unicode letters and digits), in order. */
export function tokensOf(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? []
}

/** Every string and number leaf of a JSON value, as text. */
export function leafTexts(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap(leafTexts)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(leafTexts)
  return []
}

/** True iff `form` occurs in `text` bounded by non-alphanumerics (and not inside a longer number such as 4.5 for 4). */
export function containsWhole(text: string, form: string): boolean {
  const esc = form.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}.])${esc}(?![\\p{L}\\p{N}]|\\.\\p{N})`, 'u').test(text)
}

const ANSWER_WORD = /(?:^|[^a-z])(?:is[-_]?)?(?:correct|incorrect|answer|solution|right|wrong|expected)(?:$|[^a-z])|key[-_]?(?:index|value|table|pos)/i

/** Attribute problems of every element under `root` (see the module comment). */
export function attributeProblems(root: Element): string[] {
  const out: string[] = []
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of el.attributes) {
      if (a.name.startsWith('data-')) out.push(`<${el.tagName.toLowerCase()}> has ${a.name}="${a.value}"`)
      const camel = a.value.replace(/([a-z])([A-Z])/g, '$1-$2')
      if (ANSWER_WORD.test(a.name) || ANSWER_WORD.test(camel)) out.push(`<${el.tagName.toLowerCase()}> ${a.name}="${a.value}" names an answer`)
    }
  }
  return out
}

/**
 * An option element's outer markup with its position erased: `value="<i>"` and the index in
 * generated names/ids become `#`, and its text is dropped, so options that differ only by text and
 * position get equal signatures.
 */
export function optionSignature(el: Element, index: number): string {
  const clone = el.cloneNode(true) as Element
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    for (const a of [...node.attributes]) {
      if (a.name === 'value' && a.value === String(index)) node.setAttribute(a.name, '#')
    }
  }
  const walker = clone.ownerDocument.createTreeWalker(clone, 4 /* NodeFilter.SHOW_TEXT */)
  const texts: Text[] = []
  while (walker.nextNode()) texts.push(walker.currentNode as Text)
  for (const t of texts) t.data = ''
  return clone.outerHTML
}
