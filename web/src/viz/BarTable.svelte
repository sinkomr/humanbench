<script lang="ts">
  /**
   * Bar / lollipop view (DESIGN §9.5 c, §9.3 accessible fallback; ROADMAP M1.16): a real data
   * table (caption, column headers, row headers) with one row per spoke: the estimate, its 90%
   * interval, where the interval sits against 0 SD (text, so nothing is colour-only, §13), and a
   * lollipop drawn over −3 … +3 SD. It is always in the DOM, visually hidden while the blob is
   * shown, so it is what screen readers get by default.
   */
  import { formatTheta, THETA_MAX, THETA_MIN } from './geometry'
  import type { CountUnit } from './facets'
  import type { SpokeEstimate } from './profile'
  import {
    notMeasuredText,
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
  }

  let { rows, caption, skillHeader, groupHeader, hidden = false }: Props = $props()

  const W = 132
  const PAD = 6
  const x = (theta: number): number => {
    const t = Math.min(THETA_MAX, Math.max(THETA_MIN, theta))
    return PAD + ((t - THETA_MIN) / (THETA_MAX - THETA_MIN)) * (W - 2 * PAD)
  }
  const f = (v: number): string => v.toFixed(1)
  /** A line-break opportunity after "/" ("Calibration/Metacognition" is one long word otherwise). */
  const wrap = (s: string): string => s.replaceAll('/', '/\u200b')
</script>

<!-- A table ignores a 1 px box, so the wrapper is what hides it visually (blob view). -->
<div class="hb-bars-wrap" class:visually-hidden={hidden}>
<table class="hb-bars">
  <caption>{caption}</caption>
  <thead>
    <tr>
      <th scope="col">{skillHeader}</th>
      <th scope="col" class="group-col">{groupHeader}</th>
      <th scope="col">{TABLE_ESTIMATE}</th>
      <th scope="col">{TABLE_INTERVAL}</th>
      <th scope="col">{TABLE_RELATION}</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as row (row.id)}
      <tr class:muted={row.muted} class:unmeasured={!row.measured} data-row={row.id}>
        <th scope="row"
          >{wrap(row.name)}{#if row.glyph}<span class="glyph" aria-hidden="true">&nbsp;{row.glyph}</span><span class="visually-hidden">
              ({TIER_TEXT[row.tier]})</span
            >{/if}</th
        >
        <td class="group-col">{wrap(row.group)}</td>
        {#if row.measured && row.theta !== undefined && row.sd !== undefined && row.lo90 !== undefined && row.hi90 !== undefined && row.relation}
          <td class="num">{formatTheta(row.theta)} <span class="sd">(SD {row.sd.toFixed(2)})</span></td>
          <td class="num">
            <div class="interval">
              <span>{formatTheta(row.lo90)} to {formatTheta(row.hi90)}</span>
              <svg class="lollipop" viewBox="0 0 {W} 16" width={W} height="16" aria-hidden="true" focusable="false">
                <line class="track" x1={PAD} y1="8" x2={W - PAD} y2="8" />
                <line class="zero" x1={f(x(0))} y1="2" x2={f(x(0))} y2="14" />
                <line class="range" x1={f(x(row.lo90))} y1="8" x2={f(x(row.hi90))} y2="8" />
                <circle class="dot" cx={f(x(row.theta))} cy="8" r="4" />
              </svg>
            </div>
          </td>
          <td>{RELATION_TEXT[row.relation]}</td>
        {:else}
          <td colspan="3" class="stub">{notMeasuredText(row.reason, row.nItems, row.unit)}</td>
        {/if}
      </tr>
    {/each}
  </tbody>
</table>
</div>

<style>
  .hb-bars-wrap {
    width: 100%;
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
  th,
  td {
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--hb-grid);
    text-align: left;
    vertical-align: middle;
  }
  thead th {
    font-weight: 600;
    color: var(--hb-text-strong);
  }
  tbody th {
    font-weight: 500;
    color: var(--hb-text-strong);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .sd {
    white-space: nowrap;
  }
  .sd {
    color: var(--hb-text-muted);
  }
  /* Shrinks on narrow screens (no horizontal scrolling region, WCAG 1.4.10). */
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
  .muted .lollipop .range {
    stroke: var(--hb-muted);
  }
  .muted .lollipop .dot {
    fill: var(--hb-bg);
    stroke: var(--hb-muted);
    stroke-width: 2;
  }
  /* Narrow screens: the table must fit without scrolling sideways (WCAG 1.4.10 reflow), so it
     tightens, lets intervals wrap, and drops the group column (the order already groups rows).
     table-layout: fixed caps the table at its container's width regardless of font metrics: with
     the default auto layout a browser grows the table past 100% to fit each column's min-content
     (an unbroken run of glyphs), and a wider CI font (e.g. Linux's Liberation/DejaVu fallback vs
     macOS's system font) pushes that past the viewport even though every cell here can already
     wrap at a space; overflow-wrap/word-break is the same belt-and-suspenders for a single word
     wider than its now-fixed column. */
  @media (max-width: 40rem) {
    .hb-bars {
      table-layout: fixed;
      font-size: 0.8125rem;
    }
    th,
    td {
      padding: 0.3rem 0.2rem;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    th {
      hyphens: auto;
    }
    .sd {
      white-space: normal;
    }
    /* Only when shown: the visually hidden table (blob view) keeps every column for screen readers. */
    .hb-bars-wrap:not(.visually-hidden) .group-col {
      display: none;
    }
    /* Column shares for the 4 visible columns (skill, estimate, interval, relation); the skill
       name (with its parenthetical qualifier) is the longest text, so it gets the most room. */
    .hb-bars-wrap:not(.visually-hidden) th:first-child,
    .hb-bars-wrap:not(.visually-hidden) td:first-child {
      width: 32%;
    }
    .hb-bars-wrap:not(.visually-hidden) th:nth-child(3),
    .hb-bars-wrap:not(.visually-hidden) td.num:nth-child(3) {
      width: 20%;
    }
    .hb-bars-wrap:not(.visually-hidden) th:nth-child(4),
    .hb-bars-wrap:not(.visually-hidden) td.num:nth-child(4) {
      width: 26%;
    }
    .hb-bars-wrap:not(.visually-hidden) th:nth-child(5),
    .hb-bars-wrap:not(.visually-hidden) td:nth-child(5):not(.stub) {
      width: 22%;
    }
    .interval {
      min-width: 0;
    }
    .interval span {
      white-space: normal;
    }
    .lollipop {
      min-width: 2.5rem;
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
