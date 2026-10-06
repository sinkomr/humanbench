/**
 * Shared test vectors of the quant numeric-entry grammar (`numeric.ts`; DESIGN §4.2, §7.8;
 * ROADMAP A1, A17; UX-079). Hand-written, not computed: `numeric.test.ts` checks this repo's parser
 * against them, and the bank's `tests/gen/test_quant.py` checks its twin `hb.gen.quant.entry`
 * against the copy in `golden/ts_dumps/quant_entry.json` (written from here; the copy check is in
 * `scripts/ts-dumps-sync.test.ts`). Refresh the copy from `web/` with
 *
 *   npx tsx -e "import('./src/tasks/quant/entry-vectors.ts').then((m) => process.stdout.write(m.serializeEntryVectors()))" > ../../humanbench-bank/golden/ts_dumps/quant_entry.json
 *
 * Each case: `raw` (what was typed or saved; a few non-strings too), `value` (the scoring parser,
 * `parseEntry`: canonical rational text or null), `before` (the value the grammar gave before the
 * decimal comma was added, UX-079: saved answers were scored with it, so wherever it is not null
 * `value` must equal it) and `new_entry` (the entry box's check, `checkNewEntry`). Not imported by
 * the app.
 */

import { canonicalJson } from '../ids'
import type { NewEntryCheck } from './numeric'

export interface EntryVector {
  readonly raw: string | number | null
  readonly value: string | null
  readonly before: string | null
  readonly new_entry: NewEntryCheck
}

const v = (raw: string | number | null, value: string | null, before: string | null, newEntry: NewEntryCheck): EntryVector => ({ raw, value, before, new_entry: newEntry })

/** Readable then and now, with the same value: integers, decimals, fractions, mixed numbers, signs, "$" and "%". */
const UNCHANGED: readonly EntryVector[] = [
  ['42', '42'],
  ['-7', '-7'],
  ['−7', '-7'],
  ['+3', '3'],
  ['  12  ', '12'],
  [' 12\t', '12'],
  ['12.5', '25/2'],
  ['.5', '1/2'],
  ['3.', '3'],
  ['0.75', '3/4'],
  ['007', '7'],
  ['3/8', '3/8'],
  ['6/4', '3/2'],
  ['-3 / 8', '-3/8'],
  ['2 1/3', '7/3'],
  ['-2 1/3', '-7/3'],
  ['$28.90', '289/10'],
  ['-$5', '-5'],
  ['15%', '15'],
  ['0', '0'],
  ['-0', '0'],
  ['1'.repeat(32), '1'.repeat(32)],
].map(([raw, value]) => v(raw as string, value as string, value as string, 'ok'))

/** The decimal comma: one comma, then one or two digits. Unreadable before, so no saved answer has one. */
const DECIMAL_COMMA: readonly EntryVector[] = [
  ['3,5', '7/2'],
  ['0,25', '1/4'],
  ['-1,5', '-3/2'],
  ['−1,5', '-3/2'],
  ['+0,5', '1/2'],
  ['0,5', '1/2'],
  ['1,23', '123/100'],
  ['12,50', '25/2'],
  ['0,05', '1/20'],
  ['35,0', '35'],
  ['1234,5', '2469/2'],
  ['007,5', '15/2'],
  [' 3,5 ', '7/2'],
  ['$3,50', '7/2'],
  ['-$3,5', '-7/2'],
  ['12,5%', '25/2'],
].map(([raw, value]) => v(raw as string, value as string, null, 'ok'))

/** Thousands commas: read as before (saved answers keep their score), refused as new entries. */
const THOUSANDS: readonly EntryVector[] = [
  ['1,500', '1500'],
  ['1,533', '1533'],
  ['12,345.5', '24691/2'],
  ['1,500.', '1500'],
  ['999,999.99', '99999999/100'],
  ['1,000,000', '1000000'],
  ['-1,500', '-1500'],
  ['-$1,500', '-1500'],
  ['$1,234.50', '2469/2'],
  ['1,500%', '1500'],
  ['0,500', '500'],
  ['3,141', '3141'],
  [' 2,048 ', '2048'],
].map(([raw, value]) => v(raw as string, value as string, value as string, 'thousands'))

/** Unreadable then and now. */
const UNREADABLE: readonly EntryVector[] = [
  '',
  ' ',
  'abc',
  '1/0',
  '12,3456',
  '1,2345',
  '3,14159',
  '1000,500',
  '1,5,0',
  '1,50,0',
  '1.500,5',
  '3,5.0',
  ',5',
  '3,',
  '3, 5',
  '1, 500',
  '1,5/2',
  '2 1,5',
  '1e3',
  '--3',
  '+-3',
  '3-',
  '1/2/3',
  '1.2.3',
  '½',
  '3 /',
  '2 1/0',
  '$-5',
  '1 2',
  '٣',
  '1 2/3',
  '1'.repeat(33),
].map((raw) => v(raw, null, null, 'unreadable'))

/** Not text at all (a saved response of the wrong JSON type). */
const NOT_TEXT: readonly EntryVector[] = [v(42, null, null, 'unreadable'), v(null, null, null, 'unreadable')]

export const ENTRY_VECTORS: readonly EntryVector[] = Object.freeze([...UNCHANGED, ...DECIMAL_COMMA, ...THOUSANDS, ...UNREADABLE, ...NOT_TEXT])

/** File name of the bank copy in `golden/ts_dumps/`. */
export const ENTRY_VECTORS_FILE = 'quant_entry.json'

/** The bank copy: a header, then one canonical-JSON case per line (stable diffs). */
export function serializeEntryVectors(vectors: readonly EntryVector[] = ENTRY_VECTORS): string {
  const head = `{"fixture":"quant.entry","count":${vectors.length},"cases":[`
  return `${head}\n${vectors.map((c) => canonicalJson(c)).join(',\n')}\n]}\n`
}
