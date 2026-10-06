/**
 * Flexibility clusters for the Alternative Uses Task ("Unusual uses", experimental; ROADMAP M6.4,
 * DESIGN §5.4: "Flexibility = number of embedding clusters"). Pure: embedding vectors in, cluster ids
 * out; no embedder, no Svelte, no DOM, no randomness.
 *
 * **Method.** Agglomerative clustering with average linkage on cosine similarity. Every vector starts
 * in a cluster of its own. At each step the two clusters with the highest average linkage (the mean
 * cosine over every pair with one vector in each) are joined, provided that average is at least the
 * threshold; when no pair reaches it, clustering stops. Average linkage (not single linkage) keeps a
 * chain of loosely related ideas (wall, house, chimney, barbecue, fire, heat, ...) from collapsing into
 * one cluster.
 *
 * **Tie-breaking.** A cluster is named by its smallest member index. Among pairs with exactly equal
 * average linkage, the pair whose (smaller name, larger name) is lexicographically smallest is joined
 * first. Linkages are computed from sums of the pairwise cosines (a join adds two sums; nothing is
 * re-averaged), so for a given input order the result is fully determined.
 *
 * **Ids.** Cluster ids are numbered 0, 1, 2, ... by first appearance: the cluster of vector 0 is 0, the
 * next vector in a new cluster gets 1, and so on.
 *
 * Vectors with no direction (zero, or with a non-finite component) have cosine 0 with everything (see
 * `cosine` in ./vec), so they join others only when the threshold is 0 or below. The cost is O(n³) in
 * the number of vectors, which is fine for the dozens of responses a 90-second prompt yields.
 */

import { cosine, type Vec } from './vec'

/**
 * Cluster ids for `vecs` (average-linkage agglomerative clustering on cosine; join while the best
 * average linkage is ≥ `threshold`). Ids are numbered by first appearance, so `ids[0] === 0` when
 * there is any vector, and the number of clusters is `max(ids) + 1`.
 *
 * Throws a RangeError when `threshold` is not a finite number or the vectors differ in length.
 */
export function clusterIds(vecs: readonly Vec[], threshold: number): number[] {
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    throw new RangeError(`clusterIds(): threshold must be a finite number, got ${String(threshold)}`)
  }
  const n = vecs.length
  if (n === 0) return []

  // sum[a][b]: sum of the pairwise cosines between the members of the clusters named a and b.
  const sum: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = cosine(vecs[i] as Vec, vecs[j] as Vec)
      ;(sum[i] as number[])[j] = c
      ;(sum[j] as number[])[i] = c
    }
  }
  const size = new Array<number>(n).fill(1)
  const alive = new Array<boolean>(n).fill(true)
  /** owner[i]: the name (smallest member index) of the cluster vector i is in. */
  const owner = Array.from({ length: n }, (_, i) => i)

  for (;;) {
    let bestA = -1
    let bestB = -1
    let best = -Infinity
    for (let a = 0; a < n; a++) {
      if (!alive[a]) continue
      const row = sum[a] as number[]
      for (let b = a + 1; b < n; b++) {
        if (!alive[b]) continue
        const link = (row[b] as number) / ((size[a] as number) * (size[b] as number))
        // strict '>' keeps the first (lexicographically smallest) pair on an exact tie
        if (link > best) {
          best = link
          bestA = a
          bestB = b
        }
      }
    }
    if (bestA < 0 || !(best >= threshold)) break

    // join bestB into bestA (bestA < bestB, so the joined cluster keeps the smaller name)
    const rowA = sum[bestA] as number[]
    const rowB = sum[bestB] as number[]
    for (let c = 0; c < n; c++) {
      if (!alive[c] || c === bestA || c === bestB) continue
      const s = (rowA[c] as number) + (rowB[c] as number)
      rowA[c] = s
      ;(sum[c] as number[])[bestA] = s
    }
    size[bestA] = (size[bestA] as number) + (size[bestB] as number)
    alive[bestB] = false
    for (let i = 0; i < n; i++) if (owner[i] === bestB) owner[i] = bestA
  }

  // renumber by first appearance
  const idOf = new Map<number, number>()
  return owner.map((o) => {
    let id = idOf.get(o)
    if (id === undefined) {
      id = idOf.size
      idOf.set(o, id)
    }
    return id
  })
}

/** The number of distinct clusters in ids from {@link clusterIds}. */
export function clusterCount(ids: readonly number[]): number {
  return new Set(ids).size
}
