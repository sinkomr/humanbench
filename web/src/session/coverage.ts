/**
 * How much of each power axis a person's earlier sessions already covered (ROADMAP M1.15 review;
 * DESIGN §7.4 L584, "a floor of ≥ 3 scored items per axis in session 1").
 *
 * The floor is about an axis being covered, not about the ordinal of the session: counting sessions
 * would let a session that was abandoned before it reached Quant (or one autosaved at Begin with no
 * answer) lift the floor of the next one, so the person's first look at Quant could get 0–2 items.
 * The session flow therefore counts the CAT items a save holds per axis and hands the counts to the
 * selector (`SelectorState.priorCounts`): an axis with 3 or more is free of the floor, any other is
 * not, whatever the session number.
 */

import type { AxisCode } from '../engine/axes'
import type { SaveFileV1 } from '../save/types'
import { parseItemId } from '../tasks/ids'
import { getFamily } from '../tasks/registry'

/**
 * The CAT items per axis in `save`'s sessions: the answers and time-outs of power items, by the axis
 * of the family named in the item id (so an id from another generator version still counts).
 * Fixed blocks and pretest responses do not count; an axis without an item is absent.
 */
export function priorItemCounts(save: SaveFileV1 | null): Partial<Record<AxisCode, number>> {
  const out: Partial<Record<AxisCode, number>> = {}
  if (save === null) return out
  for (const session of save.sessions) {
    for (const [itemId, pretest] of session.responses) {
      if (pretest === 1) continue
      const ids = parseItemId(itemId)
      const family = ids === null ? undefined : getFamily(ids.family)
      if (family === undefined || family.kind !== 'item') continue
      out[family.axis] = (out[family.axis] ?? 0) + 1
    }
  }
  return out
}
