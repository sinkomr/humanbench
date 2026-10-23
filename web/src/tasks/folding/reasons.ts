/**
 * Why each distractor of a paper-folding item is wrong (G3 `distractor_rationale`; `spec.ts`
 * `LureBase`, `LurePerturbation`), recomputed from the item alone: the base sheets are enumerated by
 * UNFOLDING the punches step by step (last fold first, reflecting the holes so far; a reflection
 * written here, not the generator's forward map), and each distractor is matched against them and
 * their perturbations. Shared by the verifier (which checks every distractor has a reason) and the
 * generator (which records the sorted reasons in the A11 structure, so the lure set is part of an
 * item's identity). Pure; no randomness.
 */

import { SHEET_MIRRORS, SHEET_SYMMETRIES, mapSlots, orbit, ptSlot, slotsKey, sortSlots, stabilizer, symmetryLine, type FoldPlan, type Line, type Pt, type SheetSymmetry, type Shape } from './geometry'
import { lureReason, type LureBase, type Slot } from './spec'

/** The mirror image of a point across a fold line, written out here (the verifier's own reflection). */
function mirrorAcross(p: Pt, line: Line): Pt {
  const [x, y] = p
  if (line.kind === 'v') return [2 * line.c - x, y]
  if (line.kind === 'h') return [x, 2 * line.c - y]
  if (line.kind === 'd') return [y + line.c, x - line.c] // the line x − y = c
  return [line.c - y, line.c - x] // the line x + y = c
}

const ptText = (p: Pt): string => `${p[0]},${p[1]}`

/** Unfold the punched points, last fold first, reflecting the holes so far across each line; `lineAt` may replace or skip (null) a fold. */
export function unfold(punches: readonly Pt[], lines: readonly Line[], lineAt: (k: number, line: Line) => Line | null = (_k, l) => l): Pt[] {
  const holes = new Map<string, Pt>()
  for (const p of punches) holes.set(ptText(p), p)
  for (let k = lines.length - 1; k >= 0; k--) {
    const line = lineAt(k, lines[k] as Line)
    if (line === null) continue
    for (const p of [...holes.values()]) {
      const q = mirrorAcross(p, line)
      holes.set(ptText(q), q)
    }
  }
  return [...holes.values()]
}

const inSheet = (p: Pt, n: number): boolean => p[0] > 0 && p[1] > 0 && p[0] < 2 * n && p[1] < 2 * n

export interface Base {
  readonly base: LureBase
  readonly holes: Slot[]
}

/** The verifier's own enumeration of the base sheets (`spec.ts` `LureBase`), the key first. */
export function basesOf(plan: FoldPlan, punches: readonly Pt[], key: readonly Slot[]): Base[] {
  const n = plan.grid
  const out: Base[] = [{ base: 'key', holes: [...key] }]
  const f = plan.lines.length
  for (let j = 0; j < f; j++) out.push({ base: 'missed_unfold', holes: sortSlots(unfold(punches, plan.lines, (k, l) => (k === j ? null : l)).map(ptSlot)) })
  for (let j = 0; j < f; j++) {
    const own = plan.lines[j] as Line
    const alts: Line[] = []
    const shapeLines = (['v', 'h', 'd', 'a'] as const).map((kind) => symmetryLine(plan.shapes[j] as Shape, kind))
    for (const l of [...shapeLines, ...plan.lines]) {
      if (l === null || (l.kind === own.kind && l.c === own.c) || alts.some((m) => m.kind === l.kind && m.c === l.c)) continue
      alts.push(l)
    }
    for (const alt of alts) {
      const got = unfold(punches, plan.lines, (k, l) => (k === j ? alt : l))
      if (got.length === key.length && got.every((p) => inSheet(p, n))) out.push({ base: 'wrong_line', holes: sortSlots(got.map(ptSlot)) })
    }
  }
  for (const m of SHEET_MIRRORS) out.push({ base: 'mirrored', holes: mapSlots(key, m, n) })
  for (const m of SHEET_MIRRORS) out.push({ base: 'extra_layer', holes: sortSlots([...key, ...mapSlots(key, m, n)]) })
  return out
}

/** The symmetry groups a perturbation of `holes` may respect (`spec.ts`): its stabilizer, its mirror subgroups, the trivial group. */
function groupsOf(holes: readonly Slot[], n: number): SheetSymmetry[][] {
  const full = stabilizer(holes, n)
  const identity = SHEET_SYMMETRIES[0] as SheetSymmetry
  const out: SheetSymmetry[][] = [full]
  for (const m of SHEET_MIRRORS) if (full.includes(m) && full.length > 2) out.push([identity, m])
  if (full.length > 1) out.push([identity])
  return out
}

const adjacent = (a: Slot, b: Slot): boolean => Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1

/**
 * The perturbation turning `base` into `d`, if it is one, else null: `extra_hole` when `d` adds one
 * orbit of a group of {@link groupsOf} to the base; `moved_hole` when it replaces one such orbit by the
 * orbit (same size, free) of a 4-neighbour of one of its slots.
 */
function perturbationOf(base: readonly Slot[], d: readonly Slot[], n: number): 'moved_hole' | 'extra_hole' | null {
  const inBase = new Set(base.map((s) => `${s.row}.${s.col}`))
  const inD = new Set(d.map((s) => `${s.row}.${s.col}`))
  const removed = base.filter((s) => !inD.has(`${s.row}.${s.col}`))
  const added = d.filter((s) => !inBase.has(`${s.row}.${s.col}`))
  if (added.length === 0) return null
  const addedText = slotsKey(added)
  const removedText = slotsKey(removed)
  for (const group of groupsOf(base, n)) {
    if (removed.length === 0) {
      if (slotsKey(orbit(added[0] as Slot, group, n)) === addedText) return 'extra_hole'
      continue
    }
    if (removed.length !== added.length) continue
    for (const r of removed) {
      if (slotsKey(orbit(r, group, n)) !== removedText) continue
      for (const m of added) if (adjacent(r, m) && slotsKey(orbit(m, group, n)) === addedText) return 'moved_hole'
    }
  }
  return null
}

/** Why distractor `d` is wrong (`spec.ts` `lureReason`), or null if no recorded reason fits. */
export function reasonOf(d: readonly Slot[], bases: readonly Base[], n: number): string | null {
  const text = slotsKey(d)
  const direct = bases.find((b) => b.base !== 'key' && slotsKey(b.holes) === text)
  if (direct) return lureReason(direct.base, null)
  for (const b of bases) {
    const p = perturbationOf(b.holes, d, n)
    if (p !== null) return lureReason(b.base, p)
  }
  return null
}


/** The reason of every option (`key` for option `keyIndex`, null where none fits), in display order. */
export function optionReasons(plan: FoldPlan, punches: readonly Slot[], sheets: readonly (readonly Slot[])[], keyIndex: number): (string | null)[] {
  const pts = punches.map((s): Pt => [2 * s.col - 1, 2 * s.row - 1])
  const unfolded = sortSlots(unfold(pts, plan.lines).map(ptSlot))
  const text = slotsKey(unfolded)
  const bases = basesOf(plan, pts, unfolded)
  return sheets.map((d, i) => (i === keyIndex ? 'key' : slotsKey(d) === text ? null : reasonOf(d, bases, plan.grid)))
}

/** The distractors' reasons, sorted (the `lures` of the A11 structure). */
export function lureSignature(plan: FoldPlan, punches: readonly Slot[], sheets: readonly (readonly Slot[])[], keyIndex: number): string[] {
  return optionReasons(plan, punches, sheets, keyIndex)
    .filter((_, i) => i !== keyIndex)
    .map((r) => r ?? 'none')
    .sort()
}
