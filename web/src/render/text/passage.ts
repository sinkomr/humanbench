/**
 * A served passage question, as the session shows it (ROADMAP M3.11 phase 2; DESIGN §3 row 4, §7.1,
 * §11.2, R-11.1): the passage, which stays on screen while its questions are answered (owner decision
 * 2026-10-12: "the test taker should have the text available to them while answering the question"), and
 * one text multiple-choice question about it. This is the shape of the reading bank's `mc_passage` items:
 * the server's `item_view` hands over `{stem, media: {renderer: 'passage_v1', passage, ...}, options}`.
 *
 * As in `spec.ts`, everything here is **text the server sent, treated as data**: checked for shape, kept
 * as strings, written into text nodes and never parsed as HTML or Markdown (a source line that holds an
 * address is shown as the characters it is, not as a link). The spec holds no key, no verdict and no
 * parameter, because the payload has none (R-11.1).
 *
 * What is accepted ({@link passageSpec}), and nothing else:
 * - `stem` and `options`: as for text multiple choice (`spec.ts`);
 * - `media.renderer`: `'passage_v1'`;
 * - `media.passage`: a string or a list of strings with something in it (paragraphs; a blank line inside
 *   a string starts a new one);
 * - `media.attribution`, optional: one string, the source line a licence requires to be shown with the
 *   text (the server adds the family's `source.attribution` when the payload has none);
 * - `media.title`, optional: one string, shown above the text.
 * A payload with any other `media` field has something this screen cannot show, and is not drawn: the
 * session offers the skip instead of half a passage.
 *
 * Two questions belong to the same passage when their {@link PassageSpec.passageKey} is equal: a key of
 * the passage's own text (the server names no family, R-11.1), so the screen keeps one passage in place
 * across its questions, scrolled where the person left it.
 */

import { paragraphs, textMcSpec, type TextMcSpec } from './spec'

/** The client-side name of the renderer of a passage question (`ServedItem.family`); not a family of the task registry. */
export const TEXT_PASSAGE_RENDERER = 'text_passage'

/** `media.renderer` of a passage item as the bank stores it. */
export const PASSAGE_MEDIA_RENDERER = 'passage_v1'

const MEDIA_FIELDS: readonly string[] = ['renderer', 'passage', 'attribution', 'title']

/** A passage as the screen shows it. */
export interface PassageText {
  /** A key of the passage's text: equal for the questions of one passage. */
  readonly passageKey: string
  readonly passage: readonly string[]
  /** The source line, or null. */
  readonly attribution: string | null
  /** A title above the text, or null. */
  readonly title: string | null
}

/** The spec of a passage question: the question as the text renderer takes it (no stimulus), and its passage. */
export interface PassageSpec extends TextMcSpec, PassageText {}

const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** A short key of a text (FNV-1a over its UTF-16 units, with the length): not a secret, only a name for "the same text". */
export function textKey(parts: readonly string[]): string {
  let h = 0x811c9dc5
  let n = 0
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x1e // a separator, so ['ab', 'c'] and ['a', 'bc'] differ
    h = Math.imul(h, 0x01000193)
    n += part.length
  }
  return `${parts.length}.${n}.${(h >>> 0).toString(16).padStart(8, '0')}`
}

function passageOf(raw: unknown): string[] | null {
  if (typeof raw === 'string') return paragraphs(raw)
  if (Array.isArray(raw) && raw.every((p) => typeof p === 'string')) return (raw as string[]).flatMap(paragraphs)
  return null
}

/** An optional line of text: absent or blank is null; anything but a string is not acceptable (`undefined`). */
function line(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return undefined
  return raw.trim() === '' ? null : raw.trim()
}

/** The spec of a payload that is a passage question (module comment), or null for anything else. */
export function passageSpec(payload: { readonly stem: string | null; readonly media: Readonly<Record<string, unknown>> | null; readonly options: readonly string[] | null }): PassageSpec | null {
  const { media } = payload
  if (media === null || media.renderer !== PASSAGE_MEDIA_RENDERER) return null
  if (Object.keys(media).some((k) => !MEDIA_FIELDS.includes(k))) return null
  const passage = passageOf(media.passage)
  if (passage === null || passage.length === 0 || !passage.every(hasText)) return null
  const attribution = line(media.attribution)
  const title = line(media.title)
  if (attribution === undefined || title === undefined) return null
  const question = textMcSpec({ stem: payload.stem, media: null, options: payload.options })
  if (question === null) return null
  return { ...question, passageKey: textKey(passage), passage, attribution, title }
}

/** The passage of a spec, without its question. */
export function passageTextOf(spec: PassageSpec): PassageText {
  return { passageKey: spec.passageKey, passage: spec.passage, attribution: spec.attribution, title: spec.title }
}

/** Whether `spec` (a served item's) is a passage question's. */
export function isPassageSpec(spec: object): spec is PassageSpec {
  const s = spec as Partial<PassageSpec>
  return typeof s.passageKey === 'string' && Array.isArray(s.passage) && typeof s.stem === 'string' && Array.isArray(s.options)
}
