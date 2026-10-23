<!--
  A qdata table (DESIGN §3 row 6, §13): a real HTML table with its title as the caption, column
  headers (`scope="col"`) and row headers (`scope="row"`), integers right-aligned. Header text
  wraps, so at most five narrow columns fit a 320 px screen without scrolling sideways.
-->
<script lang="ts">
  import type { TableExhibit } from '../../tasks/qdata/spec'
  import { fmt } from './chart'

  let { exhibit }: { exhibit: TableExhibit } = $props()
</script>

<table class="data">
  <caption>{exhibit.title}</caption>
  <thead>
    <tr>
      <th scope="col">{exhibit.row_header}</th>
      {#each exhibit.columns as c (c)}<th scope="col" class="num">{c}</th>{/each}
    </tr>
  </thead>
  <tbody>
    {#each exhibit.rows as r (r.label)}
      <tr>
        <th scope="row">{r.label}</th>
        {#each r.values as v, i (i)}<td class="num">{fmt(v)}</td>{/each}
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .data {
    width: 100%;
    max-width: 36rem;
    margin: 0 0 1rem;
    border-collapse: collapse;
    table-layout: auto;
  }

  caption {
    caption-side: top;
    text-align: left;
    font-weight: 600;
    font-size: 1.05rem;
    margin-bottom: 0.375rem;
    overflow-wrap: anywhere;
  }

  th,
  td {
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--r-border);
    vertical-align: bottom;
    overflow-wrap: anywhere;
    min-width: 0;
  }

  thead th {
    background: var(--r-surface);
    font-weight: 600;
  }

  tbody th {
    text-align: left;
    font-weight: 500;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
