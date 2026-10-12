/**
 * Made-up text multiple-choice payloads (ROADMAP M3.11 phase 1), for the dev demo (`#/dev/text-mc`) and
 * the tests. **Everything here is synthetic and says so**: invented places and words, no real question,
 * and no answer key at all (the page never holds one for a served question, R-11.1; CLAUDE.md: no
 * finite-bank items and no keys in this repository). The shapes are the ones the server's `item_view`
 * sends for an `mc_text` item: `{stem, options}` and, for the one optional field this renderer reads,
 * `media.stimulus`.
 */

import type { TextAxis } from '../../engine/plan-table'

export interface DemoTextPayload {
  readonly stem: string
  readonly media?: { readonly stimulus: string | readonly string[] }
  readonly options: readonly string[]
}

export interface DemoTextItem {
  readonly item_id: string
  /** The skill a test serves it under; the payload itself never says. */
  readonly axis: TextAxis
  readonly what: string
  readonly payload: DemoTextPayload
}

export const DEMO_TEXT_ITEMS: readonly DemoTextItem[] = Object.freeze([
  {
    item_id: 'demo:text_mc:short',
    axis: 'KST',
    what: 'a short question with four options',
    payload: {
      stem: 'Made-up test question: on the invented planet Zorblax, which of these invented moons is named first in this list?',
      options: ['Moon Alpha (made up)', 'Moon Beta (made up)', 'Moon Gamma (made up)', 'Moon Delta (made up)'],
    },
  },
  {
    item_id: 'demo:text_mc:argument',
    axis: 'LR',
    what: 'an argument to read in the stem, then the question, with five options',
    payload: {
      stem:
        'Made-up test argument: every glorp in the invented town of Quibbleton wears a hat on Tuesdays. Fenwick is a glorp who lives in Quibbleton. Today is a Tuesday in Quibbleton.\n\nThis text is a placeholder and has no right answer. Which made-up statement is listed third below?',
      options: ['Fenwick is wearing a hat (placeholder)', 'Fenwick is not a glorp (placeholder)', 'Today is not a Tuesday (placeholder)', 'No glorp owns a hat (placeholder)', 'Quibbleton has no glorps (placeholder)'],
    },
  },
  {
    item_id: 'demo:text_mc:stimulus',
    axis: 'KHU',
    what: 'a text to read first, six options, and characters that would be markup if the page treated text as HTML',
    payload: {
      stem: 'Made-up test question about the text above: which <b>placeholder</b> is listed last? (Tags & ampersands here are text.)',
      media: {
        stimulus: [
          'Made-up test text, paragraph one: the invented chronicle of Nowhereshire lists six placeholder rulers <i>in no real order</i>.',
          'Paragraph two: none of this happened, and nothing in it can be looked up. <script>window.__hb_text_mc_injected = true</script>',
        ],
      },
      options: ['Placeholder ruler I', 'Placeholder ruler II', 'Placeholder ruler III', 'Placeholder ruler IV', 'Placeholder ruler V', 'Placeholder ruler VI <img src=x onerror="window.__hb_text_mc_injected = true">'],
    },
  },
  {
    item_id: 'demo:text_mc:long',
    axis: 'VOC',
    what: 'long options and a word with no place to break',
    payload: {
      stem: 'Made-up test question: which invented word below is the longest? Supercalifragilisticexpialidociousantidisestablishmentarianismpneumonoultramicroscopic is not one of them.',
      options: [
        'Florbnaxitudinousnessificationalitywiseabilitynessfulnesshoodshipdom (an invented word with no spaces at all)',
        'A much longer made-up option that runs to several lines on a phone because it is a whole sentence of placeholder words, one after another, with nothing to say and no meaning to find.',
        'Zib',
        'Quorple (made up)',
      ],
    },
  },
  {
    item_id: 'demo:text_mc:arts',
    axis: 'KAP',
    what: 'a short question with four options',
    payload: {
      stem: 'Made-up test question: in the invented craft of snorkweaving, which placeholder tool is listed second?',
      options: ['The placeholder flimble', 'The placeholder gronk', 'The placeholder wumph', 'The placeholder zatch'],
    },
  },
])

/** The demo item at `index` (wrapping around). */
export function demoTextItem(index: number): DemoTextItem {
  const n = DEMO_TEXT_ITEMS.length
  return DEMO_TEXT_ITEMS[((Math.trunc(index) % n) + n) % n]!
}
