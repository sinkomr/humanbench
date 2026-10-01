<!--
  The per-cluster checklist (ROADMAP M1.15; DESIGN §10 "A per-cluster checklist is shown"): the
  clusters of this session in the order they are met (A7), each with a text status, so nothing
  depends on colour or a symbol. A cluster that spans two segments (Speed: reaction time first,
  processing and reading speed last) is "Partly done" in between. The Estimation cluster has no
  part of its own (the confidence slider after each answer measures it, A15), so it has a row that
  says so instead of being listed as missing. Clusters the session does not measure yet are listed
  once, at the end.
-->
<script lang="ts">
  import { axis as axisDef, CLUSTERS, type Cluster } from '../engine/axes'
  import type { SegmentView } from './run'
  import { CHECKLIST_EMBEDDED_STATUS, CHECKLIST_FOCUS_LATER_LABEL, CHECKLIST_LABEL, CHECKLIST_LATER_LABEL, CHECKLIST_STATUS } from './copy'
  import { skipTargetName } from './segments'

  interface Props {
    readonly segments: readonly SegmentView[]
    /** A focus session (M1.R) covers only the parts chosen: the rest are "not in this session", not "not in this version". */
    readonly focus?: boolean
  }

  let { segments, focus = false }: Props = $props()

  type Status = keyof typeof CHECKLIST_STATUS

  interface Row {
    readonly cluster: Cluster
    readonly status: Status | 'embedded'
    readonly names: string
  }

  /** Calibration is measured with every rated answer, in the Estimation cluster (A15, `run.ts`). */
  const EMBEDDED = axisDef('CAL')

  /** The status of a cluster from its segments' statuses (module comment). */
  function statusOf(segs: readonly SegmentView[]): Status {
    const s = segs.map((x) => x.status)
    if (s.includes('current')) return 'current'
    if (s.every((x) => x === 'skipped')) return 'skipped'
    if (s.every((x) => x === 'done' || x === 'skipped')) return 'done'
    if (s.every((x) => x === 'not_reached' || x === 'skipped')) return 'not_reached'
    if (s.every((x) => x === 'upcoming' || x === 'skipped')) return 'upcoming'
    return 'partial'
  }

  const rows = $derived.by((): Row[] => {
    const order: Cluster[] = []
    for (const s of segments) if (!order.includes(s.cluster)) order.push(s.cluster)
    const rows: Row[] = order.map((cluster) => {
      const segs = segments.filter((s) => s.cluster === cluster)
      return { cluster, status: statusOf(segs), names: segs.flatMap((s) => s.axes.map(skipTargetName)).join(', ') }
    })
    if (!order.includes(EMBEDDED.cluster)) rows.push({ cluster: EMBEDDED.cluster, status: 'embedded', names: skipTargetName(EMBEDDED.code) })
    return rows
  })

  const later = $derived(CLUSTERS.filter((c) => c !== EMBEDDED.cluster && !segments.some((s) => s.cluster === c)))
</script>

<nav class="checklist" aria-label={CHECKLIST_LABEL}>
  <ol>
    {#each rows as row (row.cluster)}
      <li data-status={row.status}>
        <span class="mark" aria-hidden="true">{row.status === 'done' ? '✓' : row.status === 'current' ? '●' : row.status === 'skipped' ? '–' : '○'}</span>
        <span class="name">{row.cluster}<span class="axes">{row.names}</span></span>
        <span class="status">{row.status === 'embedded' ? CHECKLIST_EMBEDDED_STATUS : CHECKLIST_STATUS[row.status]}</span>
      </li>
    {/each}
  </ol>
  {#if later.length > 0}
    <p class="later"><span class="later-label">{focus ? CHECKLIST_FOCUS_LATER_LABEL : CHECKLIST_LATER_LABEL}:</span> {later.join(', ')}</p>
  {/if}
</nav>

<style>
  .checklist {
    color: var(--r-fg);
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.5rem;
  }

  /* The status drops under the name when the row is too narrow for both (a phone, large text), instead of running off the page. */
  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    align-items: baseline;
  }

  .name {
    flex: 1 1 7rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  li[data-status='current'] .name {
    font-weight: 700;
  }

  .mark {
    flex: none;
    width: 1.25rem;
    text-align: center;
  }

  .axes {
    display: block;
    font-size: 0.875rem;
    font-weight: 400;
    color: var(--r-muted);
  }

  .status {
    flex: none;
    font-size: 0.9375rem;
    color: var(--r-muted);
    white-space: nowrap;
  }

  li[data-status='current'] .status {
    color: var(--r-fg);
    font-weight: 600;
  }

  .later {
    margin: 0.75rem 0 0;
    font-size: 0.875rem;
    color: var(--r-muted);
  }
</style>
