<!--
  A qdata bar or line chart (DESIGN §3 row 6, §13): the title as a visible heading, the unit, a
  legend of line styles when there are two series, then the chart as an inline SVG scaled by its
  viewBox: gridlines at every y_step with their values, a printed label on every bar and point, and
  the category labels. Nothing depends on colour alone: the two series differ by line style (solid,
  dashed) and point shape (round, square). The SVG is an image named by a visually hidden table of
  the same values (complete; the question's answer is never in it). Geometry comes from `chart.ts`.
-->
<script lang="ts">
  import type { ChartExhibit } from '../../tasks/qdata/spec'
  import { VIEW_H, VIEW_W, chartLayout, fmt, squarePath } from './chart'
  import { LEGEND_LABEL, chartTableCaption, legendText, unitLine } from './copy'

  let { exhibit }: { exhibit: ChartExhibit } = $props()

  const uid = $props.id()
  const layout = $derived(chartLayout(exhibit))
  const linePoints = (pts: readonly { x: number; y: number }[]): string => pts.map((p) => `${p.x},${p.y}`).join(' ')
</script>

<figure class="chart">
  <h3 class="title">{exhibit.title}</h3>
  <p class="unit">{unitLine(exhibit.unit)}</p>
  {#if exhibit.series.length > 1}
    <ul class="legend" aria-label={LEGEND_LABEL}>
      {#each exhibit.series as s, k (s.name)}
        <li>
          <svg class="sample" viewBox="0 0 32 14" aria-hidden="true" focusable="false">
            <line class="line s{k}" x1="2" y1="7" x2="30" y2="7" />
            {#if k === 0}<circle class="mark s0" cx="16" cy="7" r="4" />{:else}<path class="mark s1" d={squarePath(16, 7, 4)} />{/if}
          </svg>
          <span>{legendText(k, s.name)}</span>
        </li>
      {/each}
    </ul>
  {/if}
  <svg class="plot" viewBox="0 0 {VIEW_W} {VIEW_H}" role="img" aria-labelledby="{uid}-data" focusable="false">
    {#each layout.gridlines as g (g.y)}
      <line class="grid" class:zero={g.zero} x1={layout.plot.x0} x2={layout.plot.x1} y1={g.y} y2={g.y} />
      <text class="tick" font-size="10" x={layout.plot.x0 - 5} y={g.y + 4} text-anchor="end">{g.text}</text>
    {/each}
    {#each layout.bars as b, i (i)}
      <rect class="bar" x={b.x} y={b.y} width={b.w} height={b.h} />
      <text class="value" font-size="11" x={b.labelX} y={b.labelY} text-anchor="middle">{b.text}</text>
    {/each}
    {#each layout.lines as pts, k (k)}
      <polyline class="line s{k}" points={linePoints(pts)} />
      {#each pts as p, i (i)}
        {#if k === 0}<circle class="mark s0" cx={p.x} cy={p.y} r="4" />{:else}<path class="mark s1" d={squarePath(p.x, p.y, 4)} />{/if}
        <text class="value" font-size="11" x={p.x} y={p.labelY} text-anchor="middle">{p.text}</text>
      {/each}
    {/each}
    {#each layout.categories as c, i (i)}
      <text class="cat" font-size="11" x={c.x} y={layout.labelY} text-anchor="middle">{c.text}</text>
    {/each}
  </svg>
  <!-- A table is as wide as its content whatever its width, so the hiding box is a div around it. -->
  <div class="hb-sr-only">
  <table id="{uid}-data">
    <caption>{chartTableCaption(exhibit.title, exhibit.unit)}</caption>
    <thead>
      <tr>
        <th scope="col">{exhibit.x_label}</th>
        {#each exhibit.series as s (s.name)}<th scope="col">{s.name}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each exhibit.categories as c, i (c)}
        <tr>
          <th scope="row">{c}</th>
          {#each exhibit.series as s (s.name)}<td>{fmt(s.values[i] ?? 0)}</td>{/each}
        </tr>
      {/each}
    </tbody>
  </table>
  </div>
</figure>

<style>
  .chart {
    margin: 0 0 1rem;
    max-width: 36rem;
    min-width: 0;
  }

  .title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .unit {
    margin: 0.125rem 0 0.5rem;
    color: var(--r-muted);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0 0 0.5rem;
    padding: 0;
    list-style: none;
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .sample {
    flex: none;
    width: 2rem;
    height: 0.875rem;
  }

  .plot {
    display: block;
    width: 100%;
    height: auto;
  }

  .grid {
    stroke: var(--r-border);
    stroke-width: 0.5;
    opacity: 0.6;
  }

  .grid.zero {
    stroke: var(--r-fg);
    stroke-width: 1;
    opacity: 1;
  }

  text {
    fill: var(--r-fg);
    font-family: inherit;
  }

  .tick {
    fill: var(--r-muted);
  }

  .bar {
    fill: var(--r-accent);
  }

  .line {
    fill: none;
    stroke-width: 2;
  }

  .line.s0 {
    stroke: var(--r-accent);
  }

  .line.s1 {
    stroke: var(--r-note);
    stroke-dasharray: 5 3;
  }

  .mark.s0 {
    fill: var(--r-accent);
  }

  .mark.s1 {
    fill: var(--r-note);
  }
</style>
