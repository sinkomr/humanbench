/**
 * Visualisation (DESIGN §9; ROADMAP M1.16): the jagged blob and the bar / lollipop view.
 * Pure modules are re-exported here; the Svelte views are imported directly:
 * `ProfileView.svelte` (blob + table + drill-down), `BlobChart.svelte`, `BarTable.svelte`.
 * The share card (M1.18) is `card.ts` (pure) and `export.ts` (browser); its UI is
 * `reveal/ShareCard.svelte`.
 * `synthetic.ts` (demo and test profiles) is deliberately not re-exported.
 */
export * from './blob'
export * from './card'
export * from './card-copy'
export * from './copy'
export * from './curve'
export * from './export'
export * from './facets'
export * from './geometry'
export * from './measure'
export * from './palette'
export * from './profile'
export * from './seriation'
