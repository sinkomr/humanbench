/**
 * Visualisation (DESIGN §9; ROADMAP M1.16): the jagged blob and the bar / lollipop view.
 * Pure modules are re-exported here; the Svelte views are imported directly:
 * `ProfileView.svelte` (blob + table + drill-down), `BlobChart.svelte`, `BarTable.svelte`.
 * `synthetic.ts` (demo and test profiles) is deliberately not re-exported.
 */
export * from './blob'
export * from './copy'
export * from './curve'
export * from './facets'
export * from './geometry'
export * from './palette'
export * from './profile'
export * from './seriation'
