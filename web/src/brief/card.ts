/**
 * The control-word card (proposal §3.2): a small image the person can screenshot to remember the
 * words the notes define. Built as an SVG string from the brief's own keywords, so it shows only
 * what the notes actually say. Plain black on white so a screenshot reads well in either theme.
 */

import type { Keywords } from './types'

const MEANING: Readonly<Record<string, string>> = {
  'teach me': 'A hint first, then you try.',
  'just do it': 'The result and one quick check.',
  'challenge me': 'A harder case, and you justify your answer.',
  deeper: 'Assume more and skip routine steps.',
  'more steps': 'Show every step and add an example.',
}
const ORDER = ['teach me', 'just do it', 'challenge me', 'deeper', 'more steps']

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The words the card lists, in a fixed order, for the keywords a brief defines. */
export function cardWords(keywords: Keywords): { word: string; meaning: string }[] {
  return ORDER.filter((w) => w in keywords || (w === 'teach me' && Object.keys(keywords).length > 0)).map((word) => ({ word, meaning: MEANING[word] ?? '' }))
}

/** SVG text of the card; `null` when the notes define no control words. */
export function controlWordCardSvg(keywords: Keywords): string | null {
  const words = cardWords(keywords)
  if (words.length === 0) return null
  const width = 520
  const rowH = 52
  const height = 88 + words.length * rowH
  const rows = words
    .map((w, i) => {
      const y = 96 + i * rowH
      return `<text x="24" y="${y}" font-size="22" font-weight="700" fill="#111116">${esc(w.word)}</text><text x="24" y="${y + 22}" font-size="16" fill="#3a3844">${esc(w.meaning)}</text>`
    })
    .join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="hb-card-title hb-card-desc" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">`,
    '<title id="hb-card-title">Words you can say to your assistant</title>',
    `<desc id="hb-card-desc">${esc(words.map((w) => `${w.word}: ${w.meaning}`).join(' '))}</desc>`,
    `<rect width="${width}" height="${height}" rx="14" fill="#ffffff" stroke="#c9c7cf"/>`,
    '<text x="24" y="44" font-size="20" font-weight="700" fill="#111116">Words you can say to your assistant</text>',
    rows,
    '</svg>',
  ].join('')
}
