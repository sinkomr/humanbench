import { describe, expect, it } from 'vitest'
import { installUnloadGuard, unloadHandler, type UnloadTarget } from './guard'

function fakeTarget(): UnloadTarget & { handlers: Set<(e: BeforeUnloadEvent) => void> } {
  const handlers = new Set<(e: BeforeUnloadEvent) => void>()
  return {
    handlers,
    addEventListener: (_t, l) => void handlers.add(l),
    removeEventListener: (_t, l) => void handlers.delete(l),
  }
}

describe('beforeunload guard (§10)', () => {
  it('asks the browser to confirm: prevents the event and sets the legacy return value', () => {
    let prevented = 0
    const e = { preventDefault: () => void prevented++, returnValue: undefined as unknown } as unknown as BeforeUnloadEvent
    unloadHandler(e)
    expect(prevented).toBe(1)
    expect(e.returnValue).toBe('')
  })

  it('is on until removed, and removing twice is harmless', () => {
    const t = fakeTarget()
    const off = installUnloadGuard(t)
    expect(t.handlers.size).toBe(1)
    off()
    off()
    expect(t.handlers.size).toBe(0)
  })

  it('two guards are independent', () => {
    const t = fakeTarget()
    const a = installUnloadGuard(t)
    a()
    const b = installUnloadGuard(t)
    a() // the old remover must not remove the new guard
    expect(t.handlers.size).toBe(1)
    b()
    expect(t.handlers.size).toBe(0)
  })
})
