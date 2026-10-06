<!--
  The per-cluster checklist (ROADMAP M1.15; DESIGN §10 "A per-cluster checklist is shown"): the
  clusters of this session in the order they are met (A7), each with a text status, so nothing
  depends on colour or a symbol. A cluster that spans two segments (Speed: reaction time first,
  processing and reading speed last) is "Partly done" in between. The Estimation cluster has no
  part of its own (the confidence slider after each answer measures it, A15), so it has a row that
  says so instead of being listed as missing. Clusters the session does not measure yet are listed
  once, at the end. Only the cluster of the part that comes next in run order says "Up next" (the
  heading of an interstitial says it too); every other cluster still to come says "Later" (UX-007a).
  A row reads aloud as "Speed: Reaction Time, Processing & Reading Speed. Now." (hidden separators).
  The list is a named region, not a navigation landmark: it has nothing to follow (UX-007b).
  The rows lay out by the width of the list itself (a container query, so the 16 rem sidebar, a phone and text at
  200% each get the one that fits) and no word is ever broken inside (VER-01): wide, mark | name | status on one
  row; middle, the status under the name; narrow, the name over the full width and the mark beside its status.
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

  /**
   * The cluster that says "Up next": the first one still to come in run order after the part on screen (the
   * first of all when none is current). A cluster that is already under way ("Now", "Partly done") is not
   * "up next" however many of its parts are left.
   */
  const nextCluster = $derived.by((): Cluster | null => {
    const at = segments.findIndex((s) => s.status === 'current')
    const next = segments.slice(at + 1).find((s) => s.status === 'upcoming' && statusOf(segments.filter((x) => x.cluster === s.cluster)) === 'upcoming')
    return next === undefined ? null : next.cluster
  })

  const rows = $derived.by((): Row[] => {
    const order: Cluster[] = []
    for (const s of segments) if (!order.includes(s.cluster)) order.push(s.cluster)
    const rows: Row[] = order.map((cluster) => {
      const segs = segments.filter((s) => s.cluster === cluster)
      const status = statusOf(segs)
      return { cluster, status: status === 'upcoming' && cluster !== nextCluster ? 'later' : status, names: segs.flatMap((s) => s.axes.map(skipTargetName)).join(', ') }
    })
    if (!order.includes(EMBEDDED.cluster)) rows.push({ cluster: EMBEDDED.cluster, status: 'embedded', names: skipTargetName(EMBEDDED.code) })
    return rows
  })

  const later = $derived(CLUSTERS.filter((c) => c !== EMBEDDED.cluster && !segments.some((s) => s.cluster === c)))
</script>

<!-- A line may break after a slash ("Calibration/<wbr>Metacognition"), so a long name does not split mid-word on a narrow screen. -->
{#snippet breakable(text: string)}
  {#each text.split('/') as part, i (i)}{#if i > 0}/<wbr />{/if}{part}{/each}
{/snippet}

<section class="checklist" aria-label={CHECKLIST_LABEL}>
  <ol>
    {#each rows as row (row.cluster)}
      <li data-status={row.status}>
        <span class="mark" aria-hidden="true">{row.status === 'done' ? '✓' : row.status === 'current' ? '●' : row.status === 'skipped' ? '–' : '○'}</span>
        <span class="name">{@render breakable(row.cluster)}<span class="hb-sr-only">{': '}</span><span class="axes">{@render breakable(row.names)}</span><span class="hb-sr-only">{'. '}</span></span>
        <span class="status">{row.status === 'embedded' ? CHECKLIST_EMBEDDED_STATUS : CHECKLIST_STATUS[row.status]}</span>
      </li>
    {/each}
  </ol>
  {#if later.length > 0}
    <p class="later"><span class="later-label">{focus ? CHECKLIST_FOCUS_LATER_LABEL : CHECKLIST_LATER_LABEL}:</span> {later.join(', ')}</p>
  {/if}
</section>

<style>
  .checklist {
    color: var(--r-fg);
    /* The layout of a row follows the width of the list, not the window: the sidebar is 15 rem wide at any text size. */
    container: checklist / inline-size;
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.5rem;
  }

  /*
   * Narrow, and where container queries are not known: the name has the full width of the list (the longest word, "Metacognition",
   * is about 7 rem in bold, so it must never share its row), and the mark sits on the line below, beside the status.
   */
  li {
    display: grid;
    grid-template-columns: 1.25rem minmax(0, 1fr);
    grid-template-areas:
      'name name'
      'mark status';
    gap: 0.125rem 0.5rem;
    align-items: baseline;
  }

  .mark {
    grid-area: mark;
    text-align: center;
  }

  .name {
    grid-area: name;
    min-width: 0;
    /* A word is not hyphenated or split to fit: it moves to the next line (or, only if it is wider than the list itself, breaks). */
    hyphens: none;
    overflow-wrap: break-word;
  }

  .status {
    grid-area: status;
    font-size: 0.9375rem;
    color: var(--r-muted);
    min-width: 0;
  }

  /* Middle: mark and name side by side, the status under the name (the 16 rem sidebar is here: 15 rem of list). */
  @container checklist (min-width: 12rem) {
    li {
      grid-template-areas:
        'mark name'
        '. status';
    }
  }

  /* Wide: one row, the status wraps inside its own column on the right. */
  @container checklist (min-width: 20rem) {
    li {
      grid-template-columns: 1.25rem minmax(0, 1fr) auto;
      grid-template-areas: 'mark name status';
      gap: 0.25rem 0.5rem;
    }

    .status {
      max-width: 7rem;
      text-align: right;
    }
  }

  li[data-status='current'] .name {
    font-weight: 700;
  }

  .axes {
    display: block;
    font-size: 0.875rem;
    font-weight: 400;
    color: var(--r-muted);
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
