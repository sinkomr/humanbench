/** Copy and download helpers of the notes page, in jsdom (the real clipboard and download are in e2e/notes.spec.ts). */

import { describe, expect, it, vi } from 'vitest'
import { REVOKE_AFTER_MS, copyText, downloadText, fileToken } from './browser'

describe('browser helpers', () => {
  it('copies with the async clipboard when it works', async () => {
    const writeText = vi.fn(async () => undefined)
    expect(await copyText('hello', { clipboard: { writeText }, document })).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to selecting a temporary box, and cleans it up, when the clipboard refuses', async () => {
    const execCommand = vi.fn(() => true)
    const doc = { createElement: document.createElement.bind(document), body: document.body, execCommand, activeElement: null } as unknown as Document
    const before = document.body.children.length
    expect(await copyText('text', { clipboard: { writeText: async () => Promise.reject(new Error('denied')) }, document: doc })).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.body.children.length).toBe(before)
    expect(await copyText('text', { document: { ...doc, execCommand: () => false } as unknown as Document })).toBe(false)
    expect(await copyText('text', { document: { ...doc, execCommand: () => { throw new Error('nope') } } as unknown as Document })).toBe(false)
  })

  it('downloads through a hidden link and revokes the object URL later', () => {
    const created: string[] = []
    const revoked: string[] = []
    const timers: (() => void)[] = []
    const clicked: { href: string; download: string }[] = []
    const link = { href: '', download: '', rel: '', style: { display: '' }, click() { clicked.push({ href: this.href, download: this.download }) }, remove() {} }
    const name = downloadText('body', 'file.txt', 'text/plain', {
      document: { createElement: () => link, body: { appendChild: () => link } } as unknown as Document,
      URL: { createObjectURL: () => (created.push('blob:x'), 'blob:x'), revokeObjectURL: (u: string) => void revoked.push(u) },
      setTimeout: (fn, ms) => (expect(ms).toBe(REVOKE_AFTER_MS), timers.push(fn)),
    })
    expect(name).toBe('file.txt')
    expect(clicked).toEqual([{ href: 'blob:x', download: 'file.txt' }])
    expect(revoked).toEqual([])
    timers[0]!()
    expect(revoked).toEqual(['blob:x'])
  })

  it('draws a short lower-case token for file names: a letter, then a digit, alternating', () => {
    const t = fileToken(4, {
      getRandomValues: <T extends ArrayBufferView | null>(a: T): T => {
        ;(a as unknown as Uint8Array).set([0, 1, 35, 36])
        return a
      },
    })
    expect(t).toBe('a1j6')
    expect(fileToken()).toMatch(/^[a-z][0-9][a-z][0-9]$/)
    expect(fileToken(8)).toMatch(/^(?:[a-z][0-9]){4}$/)
    expect(fileToken(5)).toMatch(/^(?:[a-z][0-9]){2}[a-z]$/)
  })
})
