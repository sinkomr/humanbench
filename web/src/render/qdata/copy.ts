/**
 * Copy of the qdata renderer (DESIGN §13 screen-reader labels; non-diagnostic plain language,
 * R-5.6.x). Every user-facing word of the renderer is here; the item's own words (title, labels,
 * stem, hint) come from its spec.
 */

/** Accessible name of the question region. */
export const QDATA_REGION_LABEL = 'Question with data'

/** Label of the entry box. */
export const QDATA_ENTRY_LABEL = 'Your answer'

/** The visible line under a chart's title that names the unit of its values. */
export const unitLine = (unit: string): string => `Unit: ${unit}`

/** Caption of a chart's text alternative, the visually hidden table of the same values. */
export const chartTableCaption = (title: string, unit: string): string => `${title}. The chart's values as a table (unit: ${unit}).`

/** Accessible name of the list that shows which line style is which series. */
export const LEGEND_LABEL = 'Line styles'

/** The words under each legend sample. */
export const legendText = (index: number, name: string): string => `${name}: ${index === 0 ? 'solid line, round points' : 'dashed line, square points'}`
