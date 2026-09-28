/**
 * Spoke order by seriation (DESIGN §9.4, §9.5 b; ROADMAP A7, A8, M1.16).
 *
 * §9.4: order the K spokes around the circle to maximise the sum of adjacent correlations in Σ,
 * a TSP on a cycle with distance 1 − r_ij, solved exactly, with every cluster contiguous. A7: the
 * clusters are the 8 labels of the §3 table. A8/§9.4: the order comes from the PINNED Σ
 * (`sigma_version`), so every user sees the same order (§9.5 b) until the version changes.
 *
 * {@link seriate} is an exact Held–Karp dynamic programme restricted to cluster-contiguous
 * cycles: a tour may only leave a cluster once all of its members are visited, and only for a
 * cluster it has not touched. Every contiguous cycle, read from the first member of one fixed
 * cluster's run, is such a tour, so trying each member of that cluster as the start covers all
 * of them. The reachable states are few (complete clusters × a partial current cluster), so K =
 * 17 takes well under a millisecond. {@link seriateBruteForce} enumerates every cycle for the
 * property test (K ≤ 10).
 */

import { AXES, AXIS_CODES, initialSigma, SIGMA_VERSION, type AxisCode } from '../engine/axes'

/** The adjacency score of a cyclic order: Σ W[o_i][o_{i+1}] over the K cycle edges. */
export function cycleScore(order: readonly number[], w: readonly (readonly number[])[]): number {
  let s = 0
  for (let i = 0; i < order.length; i++) s += w[order[i]!]![order[(i + 1) % order.length]!]!
  return s
}

/** Whether every group occupies one contiguous run of the cyclic order. */
export function isContiguous(order: readonly number[], groups: readonly (string | number)[]): boolean {
  const n = order.length
  const entries = new Map<string | number, number>()
  for (let i = 0; i < n; i++) {
    const g = groups[order[i]!]!
    if (g !== groups[order[(i - 1 + n) % n]!]) entries.set(g, (entries.get(g) ?? 0) + 1)
  }
  for (const v of entries.values()) if (v > 1) return false
  return true
}

function checkInputs(w: readonly (readonly number[])[], groups: readonly (string | number)[]): number {
  const k = w.length
  if (k < 1 || groups.length !== k || w.some((row) => row.length !== k)) {
    throw new RangeError('seriation needs a K×K matrix and K group labels')
  }
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      if (!Number.isFinite(w[i]![j]!) || Math.abs(w[i]![j]! - w[j]![i]!) > 1e-12) throw new RangeError('seriation needs a finite symmetric matrix')
    }
  }
  return k
}

/**
 * An order maximising {@link cycleScore} among the cycles where every group is contiguous
 * (exact). Deterministic: ties go to the first optimum found in index order. The result starts
 * at index 0 of the start cluster's run; use {@link canonicalCycle} for a fixed presentation.
 */
export function seriate(w: readonly (readonly number[])[], groups: readonly (string | number)[]): number[] {
  const k = checkInputs(w, groups)
  if (k <= 2) return Array.from({ length: k }, (_, i) => i)
  if (k > 30) throw new RangeError('seriate supports K ≤ 30')

  const labels = [...new Set(groups)]
  const gOf = groups.map((g) => labels.indexOf(g))
  const gMask = labels.map((_, gi) => gOf.reduce((m, g, i) => (g === gi ? m | (1 << i) : m), 0))
  // Start in the smallest group: each of its members is tried as the first node of its run.
  let startGroup = 0
  for (let gi = 1; gi < labels.length; gi++) if (popcount(gMask[gi]!) < popcount(gMask[startGroup]!)) startGroup = gi
  const full = (1 << k) - 1

  let best = -Infinity
  let bestOrder: number[] = []
  for (let s = 0; s < k; s++) {
    if (gOf[s] !== startGroup) continue
    // Layered DP over (mask, last): value = best path score from s, parent for the path.
    let layer = new Map<number, { v: Float64Array; p: Int32Array }>()
    const first = { v: new Float64Array(k).fill(-Infinity), p: new Int32Array(k).fill(-1) }
    first.v[s] = 0
    layer.set(1 << s, first)
    const layers: Map<number, { v: Float64Array; p: Int32Array }>[] = [layer]
    for (let size = 1; size < k; size++) {
      const next = new Map<number, { v: Float64Array; p: Int32Array }>()
      for (const [mask, st] of layer) {
        for (let last = 0; last < k; last++) {
          const v = st.v[last]!
          if (v === -Infinity) continue
          const g = gOf[last]!
          const groupDone = (mask & gMask[g]!) === gMask[g]!
          for (let j = 0; j < k; j++) {
            if (mask & (1 << j)) continue
            const gj = gOf[j]!
            if (gj === g ? groupDone : !groupDone || (mask & gMask[gj]!) !== 0) continue
            const nm = mask | (1 << j)
            let e = next.get(nm)
            if (e === undefined) {
              e = { v: new Float64Array(k).fill(-Infinity), p: new Int32Array(k).fill(-1) }
              next.set(nm, e)
            }
            const cand = v + w[last]![j]!
            if (cand > e.v[j]!) {
              e.v[j] = cand
              e.p[j] = last
            }
          }
        }
      }
      layer = next
      layers.push(layer)
    }
    const end = layer.get(full)
    if (end === undefined) continue
    for (let last = 0; last < k; last++) {
      const v = end.v[last]!
      if (v === -Infinity) continue
      const total = v + w[last]![s]!
      if (total > best + 1e-12) {
        best = total
        // Walk the parents back from (full, last).
        const order: number[] = []
        let mask = full
        let cur = last
        for (let size = k; size >= 1; size--) {
          order.push(cur)
          const prev = layers[size - 1]!.get(mask)!.p[cur]!
          mask &= ~(1 << cur)
          cur = prev
        }
        bestOrder = order.reverse()
      }
    }
  }
  return bestOrder
}

function popcount(x: number): number {
  let c = 0
  for (let v = x; v; v &= v - 1) c++
  return c
}

/**
 * Exhaustive reference for {@link seriate}: every cyclic order (index 0 first), keeping the
 * contiguous ones; returns the best score and one order achieving it. Only for small K (tests).
 */
export function seriateBruteForce(w: readonly (readonly number[])[], groups: readonly (string | number)[]): { score: number; order: number[] } {
  const k = checkInputs(w, groups)
  if (k > 11) throw new RangeError('brute force is for K ≤ 11')
  const rest = Array.from({ length: k - 1 }, (_, i) => i + 1)
  let best = -Infinity
  let bestOrder: number[] = []
  const perm: number[] = [0]
  const used = new Array<boolean>(k).fill(false)
  used[0] = true
  const rec = (): void => {
    if (perm.length === k) {
      if (!isContiguous(perm, groups)) return
      const s = cycleScore(perm, w)
      if (s > best) {
        best = s
        bestOrder = perm.slice()
      }
      return
    }
    for (const j of rest) {
      if (used[j]) continue
      used[j] = true
      perm.push(j)
      rec()
      perm.pop()
      used[j] = false
    }
  }
  rec()
  return { score: best, order: bestOrder }
}

/**
 * The fixed presentation of a cycle: rotated so index 0 comes first (at 12 o'clock), and turned
 * so the clockwise neighbour of index 0 has the smaller index of its two neighbours.
 */
export function canonicalCycle(order: readonly number[]): number[] {
  const n = order.length
  const at = order.indexOf(0)
  if (at < 0) throw new RangeError('order must contain index 0')
  const rot = Array.from({ length: n }, (_, i) => order[(at + i) % n]!)
  if (n > 2 && rot[1]! > rot[n - 1]!) return [rot[0]!, ...rot.slice(1).reverse()]
  return rot
}

const ORDER_CACHE = new Map<string, readonly AxisCode[]>()

/**
 * The spoke order of the 17 axes (§9.4): the contiguous seriation of the pinned Σ of
 * `sigmaVersion` over the A7 clusters, canonicalised (MAT at 12 o'clock). Throws for a version
 * this build does not pin. Cached; `seriation.test.ts` pins the result literally.
 */
export function spokeOrder(sigmaVersion: string = SIGMA_VERSION): readonly AxisCode[] {
  const hit = ORDER_CACHE.get(sigmaVersion)
  if (hit) return hit
  if (sigmaVersion !== SIGMA_VERSION) throw new RangeError(`no pinned Σ for sigma_version ${JSON.stringify(sigmaVersion)} (this build pins ${SIGMA_VERSION})`)
  const order = canonicalCycle(
    seriate(
      initialSigma(),
      AXES.map((a) => a.cluster),
    ),
  ).map((i) => AXIS_CODES[i]!)
  const frozen = Object.freeze(order)
  ORDER_CACHE.set(sigmaVersion, frozen)
  return frozen
}
