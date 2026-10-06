<script lang="ts">
  /**
   * Bar / lollipop view (DESIGN §9.5 c, §9.3 accessible fallback; ROADMAP M1.16): a real data
   * table (caption, column headers, row headers) with one row per spoke: the estimate, its 90%
   * range, where the range sits against 0 SD (text, so nothing is colour-only, §13), and a
   * lollipop drawn over −3 … +3 SD. It is always in the DOM, visually hidden while the blob is
   * shown, so it is what screen readers get by default.
   *
   * An estimate beyond the scale gets an arrowhead at the end of its line instead of the dot, and
   * the words "(off scale)" in its cell (UX-037). On a phone each row is laid out as a card (name
   * and comparison; estimate and range; the lollipop on its own line) with display: grid, so the
   * table roles are set explicitly: a display override drops them in some browsers (UX-043).
   */
  import { formatTheta, offScaleOf, THETA_MAX, THETA_MIN } from './geometry'
  import type { CountUnit } from './facets'
  import type { SpokeEstimate } from './profile'
  import {
    notMeasuredText,
    OFF_SCALE_CELL,
    RELATION_TEXT,
    TABLE_ESTIMATE,
    TABLE_INTERVAL,
    TABLE_RELATION,
    TIER_TEXT,
  } from './copy'

  interface Props {
    rows: readonly (SpokeEstimate & { readonly nItems?: number; readonly unit?: CountUnit })[]
    caption: string
    skillHeader: string
    groupHeader: string
    /** Visually hidden but still read by screen readers (blob view). */
    hidden?: boolean
    /** Row id → id of the element that explains that skill (R-5.6.2: Emotion Reading's tooltip), set as the row header's `aria-describedby`. */
    describedBy?: Readonly<Record<string, string>>
  }

  let { rows, caption, skillHeader, groupHeader, hidden = false, describedBy }: Props = $props()

  // The table's own roles, stated so a display override (the phone layout) cannot drop them. Spread,
  // not literal attributes: they are the native roles, which the Svelte linter flags as redundant.
  const TABLE = { role: 'table' }
  const GROUP = { role: 'rowgroup' }
  const ROW = { role: 'row' }
  const COLUMNHEADER = { role: 'columnheader' }
  const ROWHEADER = { role: 'rowheader' }
  const CELL = { role: 'cell' }

  const W = 132
  const PAD = 6
  const x = (theta: number): number => {
    const t = Math.min(THETA_MAX, Math.max(THETA_MIN, theta))
    return PAD + ((t - THETA_MIN) / (THETA_MAX - THETA_MIN)) * (W - 2 * PAD)
  }
  const f = (v: number): string => v.toFixed(1)
  /** A line-break opportunity after "/" ("Calibration/Metacognition" is one long word otherwise). */
  const wrap = (s: string): string => s.replaceAll('/', '/\u200b')
  /** Arrowhead at a track end (tip on the end, pointing off the line): the estimate is beyond the scale. */
  const arrow = (end: 'low' | 'high'): string => {
    const tip = end === 'low' ? PAD : W - PAD
    const base = end === 'low' ? tip + 9 : tip - 9
    return `M${f(tip)},8L${f(base)},2.5L${f(base)},13.5Z`
  }
  /** "Overlaps 0 SD" with "0 SD" kept together on a line (a non-breaking space), so a narrow cell breaks before it. */
  const keepUnit = (s: string): string => s.replace(/ (\d+) SD$/, '\u00a0$1\u00a0SD')
  /** Whether the drawn part of a range has any length (a range wholly beyond the end is not drawn). */
  const drawn = (lo: number, hi: number): boolean => x(hi) - x(lo) >= 0.5
</script>

<!-- A table ignores a 1 px box, so the wrapper is what hides it visually (blob view). -->
<div class="hb-bars-wrap" class:visually-hidden={hidden}>
  <table class="hb-bars" {...TABLE}>
    <caption>{caption}</caption>
    <thead {...GROUP}>
      <tr {...ROW}>
        <th scope="col" {...COLUMNHEADER}>{skillHeader}</th>
        <th scope="col" class="group-col" {...COLUMNHEADER}>{groupHeader}</th>
        <th scope="col" {...COLUMNHEADER}>{TABLE_ESTIMATE}</th>
        <th scope="col" {...COLUMNHEADER}>{TABLE_INTERVAL}</th>
        <th scope="col" {...COLUMNHEADER}>{TABLE_RELATION}</th>
      </tr>
    </thead>
    <tbody {...GROUP}>
      {#each rows as row (row.id)}
        <tr class:muted={row.muted} class:unmeasured={!row.measured} data-row={row.id} {...ROW}>
          <th scope="row" class="name" aria-describedby={describedBy?.[row.id]} {...ROWHEADER}
            >{wrap(row.name)}{#if row.glyph}<span class="glyph" aria-hidden="true">&nbsp;{row.glyph}</span><span class="visually-hidden">
                ({TIER_TEXT[row.tier]})</span
              >{/if}</th
          >
          <td class="group-col" {...CELL}>{wrap(row.group)}</td>
          {#if row.measured && row.theta !== undefined && row.sd !== undefined && row.lo90 !== undefined && row.hi90 !== undefined && row.relation}
            {@const end = row.offScale ?? offScaleOf(row.theta)}
            <td class="num estimate" {...CELL}
              >{formatTheta(row.theta)}&nbsp;±&nbsp;{row.sd.toFixed(2)}{#if end !== 'none'}{' '}<span class="off">{OFF_SCALE_CELL}</span>{/if}</td
            >
            <td class="num interval-cell" {...CELL}>
              <div class="interval">
                <span class="range-text"><span class="range-nums">{formatTheta(row.lo90)} to {formatTheta(row.hi90)}</span></span>
                <svg class="lollipop" viewBox="0 0 {W} 16" width={W} height="16" aria-hidden="true" focusable="false">
                  <line class="track" x1={PAD} y1="8" x2={W - PAD} y2="8" />
                  <line class="zero" x1={f(x(0))} y1="2" x2={f(x(0))} y2="14" />
                  {#if drawn(row.lo90, row.hi90)}
                    <line class="range" x1={f(x(row.lo90))} y1="8" x2={f(x(row.hi90))} y2="8" />
                  {/if}
                  {#if end === 'none'}
                    <circle class="dot" cx={f(x(row.theta))} cy="8" r="4" />
                  {:else}
                    <path class="arrow" d={arrow(end)} data-off-scale={end} />
                  {/if}
                </svg>
              </div>
            </td>
            <td class="relation" {...CELL}>{keepUnit(RELATION_TEXT[row.relation])}</td>
          {:else}
            <td colspan="3" class="stub" {...CELL}>{notMeasuredText(row.reason, row.nItems, row.unit)}</td>
          {/if}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  /* The width the table has decides its layout (a container query, not a media query: a media query's
     rem is the browser's 16 px, so it would not follow the person's text size; a container's rem is the page's). */
  .hb-bars-wrap {
    width: 100%;
    container: bars / inline-size;
  }
  .hb-bars {
    width: 100%;
    max-width: 48rem;
    margin: 0 auto;
    border-collapse: collapse;
    font-size: 0.9375rem;
    color: var(--hb-text);
  }
  caption {
    text-align: left;
    padding: 0 0 0.5rem;
    color: var(--hb-text);
  }
  /* Whole words only (UX-043): a cell is as wide as its longest word, or the row wraps at spaces. */
  th,
  td {
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--hb-grid);
    text-align: left;
    vertical-align: middle;
    overflow-wrap: normal;
    word-break: normal;
    hyphens: manual;
  }
  thead th {
    font-weight: 600;
    color: var(--hb-text-strong);
  }
  tbody th {
    font-weight: 500;
    color: var(--hb-text-strong);
  }
  td.group-col {
    min-width: 12ch;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .estimate {
    white-space: nowrap;
  }
  .off {
    color: var(--hb-text-muted);
    font-style: italic;
  }
  .lollipop {
    width: 100%;
    min-width: 4.5rem;
    max-width: 8.25rem;
    height: auto;
  }
  .interval {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .interval span {
    white-space: nowrap;
  }
  .interval .lollipop {
    flex: 1 1 4.5rem;
  }
  .unmeasured th,
  .stub {
    color: var(--hb-text-muted);
  }
  .stub {
    font-style: italic;
  }
  .lollipop .track {
    stroke: var(--hb-grid);
    stroke-width: 2;
  }
  .lollipop .zero {
    stroke: var(--hb-stub);
    stroke-dasharray: 2 2;
  }
  .lollipop .range {
    stroke: var(--hb-blob);
    stroke-width: 3;
    stroke-linecap: round;
  }
  .lollipop .dot {
    fill: var(--hb-blob);
  }
  .lollipop .arrow {
    fill: var(--hb-blob);
  }
  .muted .lollipop .range {
    stroke: var(--hb-muted);
  }
  .muted .lollipop .dot {
    fill: var(--hb-bg);
    stroke: var(--hb-muted);
    stroke-width: 2;
  }
  .muted .lollipop .arrow {
    fill: var(--hb-bg);
    stroke: var(--hb-muted);
    stroke-width: 1.5;
    stroke-linejoin: round;
  }
  /* A narrow table (a phone, or large text: WCAG 1.4.4, 1.4.10 reflow, UX-043): no sideways scrolling and no word cut in two. Each row of
     the shown table is a small card of up to two columns that fall back to one when the text is
     large: the name and its comparison with 0 SD, then the estimate and its range, then the lollipop
     on a line of its own at a readable width. The column headers stay for assistive technology
     (clipped, not removed), the cluster column is dropped (the order already groups the rows), and the
     table keeps its roles (set in the markup). `order` is visual only: the DOM, and so the reading
     order, stays name, estimate, range, comparison. Only when shown: the visually hidden table (blob
     view) keeps every column for screen readers. */
  @container bars (max-width: 40rem) {
    .hb-bars {
      font-size: 0.875rem;
    }
    .hb-bars-wrap:not(.visually-hidden) .hb-bars,
    .hb-bars-wrap:not(.visually-hidden) tbody {
      display: block;
    }
    .hb-bars-wrap:not(.visually-hidden) caption {
      display: block;
    }
    .hb-bars-wrap:not(.visually-hidden) thead {
      display: block;
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .hb-bars-wrap:not(.visually-hidden) tbody tr {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
      gap: 0.2rem 0.75rem;
      align-items: baseline;
      padding: 0.6rem 0;
      border-bottom: 1px solid var(--hb-grid);
    }
    .hb-bars-wrap:not(.visually-hidden) tbody th,
    .hb-bars-wrap:not(.visually-hidden) tbody td {
      display: block;
      padding: 0;
      border: 0;
    }
    .hb-bars-wrap:not(.visually-hidden) .group-col {
      display: none;
    }
    .hb-bars-wrap:not(.visually-hidden) tbody th.name {
      order: 0;
    }
    .hb-bars-wrap:not(.visually-hidden) td.relation {
      order: 1;
    }
    .hb-bars-wrap:not(.visually-hidden) td.estimate {
      order: 2;
      white-space: normal;
    }
    /* The range cell and its box give way, so the range text and the lollipop are grid items of the row. */
    .hb-bars-wrap:not(.visually-hidden) td.interval-cell,
    .hb-bars-wrap:not(.visually-hidden) .interval {
      display: contents;
    }
    .hb-bars-wrap:not(.visually-hidden) .range-text {
      order: 3;
      white-space: normal;
    }
    /* The two numbers stay together; the line breaks before them, not inside "−0.13 to +1.24". */
    .hb-bars-wrap:not(.visually-hidden) .range-nums {
      white-space: nowrap;
    }
    .hb-bars-wrap:not(.visually-hidden) .range-text::before {
      content: '90% range ';
      color: var(--hb-text-muted);
    }
    .hb-bars-wrap:not(.visually-hidden) .lollipop {
      order: 4;
      grid-column: 1 / -1;
      width: 100%;
      min-width: 0;
      max-width: 15rem;
      margin-top: 0.15rem;
    }
    .hb-bars-wrap:not(.visually-hidden) td.stub {
      order: 1;
      grid-column: 1 / -1;
    }
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
</style>
