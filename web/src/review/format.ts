/**
 * JSON for the review page (ROADMAP M1.G7): indented, but an array of numbers, booleans or short
 * strings stays on one line, so a span sequence or an RT position list reads as one row.
 */

const isFlat = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'number' || typeof x === 'boolean' || x === null || (typeof x === 'string' && x.length <= 16))

export function reviewJson(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent)
  const inner = ' '.repeat(indent + 2)
  if (isFlat(value)) return JSON.stringify(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[\n${value.map((v) => inner + reviewJson(v, indent + 2)).join(',\n')}\n${pad}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${reviewJson(v, indent + 2)}`).join(',\n')}\n${pad}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}
