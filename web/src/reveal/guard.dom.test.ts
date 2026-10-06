import { afterEach, describe, expect, it } from 'vitest'
import { installUnloadGuard } from './guard'

let off: (() => void) | undefined
afterEach(() => off?.())

describe('beforeunload guard on the real window (§10)', () => {
  it('a cancelled beforeunload is what the browser turns into its prompt; removing the guard stops it', () => {
    off = installUnloadGuard()
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    off()
    const e2 = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e2)
    expect(e2.defaultPrevented).toBe(false)
  })

  it('with two guards on the real window, lifting the first leaves the page guarded until the second is lifted', () => {
    const run = installUnloadGuard()
    const results = installUnloadGuard()
    const prevented = (): boolean => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(prevented()).toBe(true)
    run()
    expect(prevented()).toBe(true)
    results()
    expect(prevented()).toBe(false)
  })
})
