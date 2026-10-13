/**
 * Made-up passages with made-up questions (ROADMAP M3.11 phase 2), for the dev demo (`#/dev/text-passage`),
 * the tests and the session simulation. **Everything here is synthetic and says so**: invented places,
 * people and sources, text written as a placeholder, no real passage, no real question, and no answer key
 * at all (the page never holds one for a served question, R-11.1; CLAUDE.md: no finite-bank items and no
 * keys in this repository). The shapes are the ones the server sends for an `mc_passage` item: `{stem,
 * media: {renderer: 'passage_v1', passage, attribution?, title?}, options}`, and with each question its
 * place in the set (`set: {index, of}`).
 */

/** (A type alias, not an interface: it is passed where a plain record of media fields is taken.) */
export type DemoPassageMedia = {
  readonly renderer: 'passage_v1'
  readonly passage: readonly string[]
  readonly attribution?: string
  readonly title?: string
}

export interface DemoPassageQuestion {
  readonly stem: string
  readonly options: readonly string[]
}

export interface DemoPassage {
  readonly id: string
  readonly what: string
  readonly media: DemoPassageMedia
  readonly questions: readonly DemoPassageQuestion[]
}

const filler = (topic: string, n: number): string =>
  Array.from({ length: n }, (_, i) => `Placeholder sentence ${i + 1} about ${topic}: it was written to fill a line of a test page, it reports nothing, and it can be skimmed, scrolled past or ignored without loss.`).join(' ')

const question = (passage: number, q: number, options: number): DemoPassageQuestion => ({
  stem: `Made-up test question ${q} about made-up passage ${passage}: which placeholder below is listed at position ${q}? (This question has no right answer.)`,
  options: Array.from({ length: options }, (_, i) => `Placeholder ${passage}-${q}-${'ABCDEF'[i]} (made up)`),
})

export const DEMO_PASSAGES: readonly DemoPassage[] = Object.freeze([
  {
    id: 'demo:text_passage:plain',
    what: 'a passage of four paragraphs with a source line, and four questions of five options',
    media: {
      renderer: 'passage_v1',
      passage: [
        `Made-up test passage one, paragraph one. In the invented harbour town of Quibbleton, the council of glorps met every Tuesday to decide nothing in particular. ${filler('the council of Quibbleton', 2)}`,
        `Paragraph two. The made-up engineer Fenwick Zorblax proposed a bridge of imaginary stone. ${filler('the imaginary bridge', 2)}`,
        `Paragraph three. Nobody in this text exists, and none of it happened. ${filler('the people who do not exist', 2)}`,
        `Paragraph four. The passage ends here, having said nothing that could be looked up. ${filler('the end of the passage', 1)}`,
      ],
      attribution: 'Made-up source line: adapted from “The Chronicle of Nowhereshire” by A. Placeholder (an invented book), under a licence that does not exist. Changes were made.',
    },
    questions: [question(1, 1, 5), question(1, 2, 5), question(1, 3, 5), question(1, 4, 5)],
  },
  {
    id: 'demo:text_passage:long',
    what: 'a long passage with a title, a word with no place to break and characters that would be markup, and three questions of four options',
    media: {
      renderer: 'passage_v1',
      title: 'A made-up title: the <b>Snorkweavers</b> of Nowhereshire',
      passage: [
        `Made-up test passage two, paragraph one. The invented craft of snorkweaving has no history, which this placeholder now recounts at length. <i>Tags & ampersands here are text.</i> ${filler('snorkweaving', 4)}`,
        `Paragraph two holds a word with no place to break: Florbnaxitudinousnessificationalitywiseabilitynessfulnesshoodshipdomsupercalifragilisticexpialidocious. ${filler('very long words', 4)}`,
        `Paragraph three. <script>window.__hb_text_passage_injected = true</script> ${filler('things that are not markup', 4)}`,
        `Paragraph four. ${filler('the flimble, the gronk and the wumph', 5)}`,
        `Paragraph five. ${filler('the zatch', 5)}`,
        `Paragraph six, the last. ${filler('nothing at all', 4)}`,
      ],
      attribution: 'Made-up source line with an address that is text, not a link: https://example.invalid/a-very-long-path-with-no-place-to-break/placeholder-placeholder-placeholder <img src=x onerror="window.__hb_text_passage_injected = true">',
    },
    questions: [question(2, 1, 4), question(2, 2, 4), question(2, 3, 4)],
  },
  {
    id: 'demo:text_passage:short',
    what: 'a short passage without a source line, and three questions of five options',
    media: {
      renderer: 'passage_v1',
      passage: ['Made-up test passage three. It is two sentences long and says only that it is a placeholder. Nothing in it is true.'],
    },
    questions: [question(3, 1, 5), question(3, 2, 5), question(3, 3, 5)],
  },
])

/** The demo passage at `index` (wrapping around). */
export function demoPassage(index: number): DemoPassage {
  const n = DEMO_PASSAGES.length
  return DEMO_PASSAGES[((Math.trunc(index) % n) + n) % n]!
}

/** The payload of question `q` (0-based) of a demo passage, as `item_view` sends it. */
export function demoPassagePayload(p: DemoPassage, q: number): { readonly stem: string; readonly media: DemoPassageMedia; readonly options: readonly string[] } {
  const it = p.questions[q]!
  return { stem: it.stem, media: p.media, options: it.options }
}
