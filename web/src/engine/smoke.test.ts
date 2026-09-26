import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

describe('toolchain smoke test', () => {
  it('runs vitest in the node environment', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof performance.now()).toBe('number')
  })

  it('runs fast-check property tests', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        expect(a + b).toBe(b + a)
      }),
    )
  })
})
