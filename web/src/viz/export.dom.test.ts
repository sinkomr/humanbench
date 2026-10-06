/**
 * Saving a card as a file (ROADMAP M1.18; DESIGN §9.9): the same `<a download>` route as the save
 * file (`save/io.ts`), in jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { REVOKE_AFTER_MS, type DownloadEnv } from '../save/io'
import { downloadBlob, PNG_MIME } from './export'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('downloadBlob', () => {
  it('downloads through an <a download> that is removed afterwards, and revokes the URL later', () => {
    const clicks: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true)
      clicks.push(this)
    })
    const revoked: string[] = []
    const timers: [() => void, number][] = []
    const blobs: Blob[] = []
    const env: DownloadEnv = {
      document,
      URL: {
        createObjectURL: (b: Blob | MediaSource) => (blobs.push(b as Blob), `blob:card/${blobs.length}`),
        revokeObjectURL: (u: string) => void revoked.push(u),
      },
      setTimeout: (fn, ms) => timers.push([fn, ms]),
    }
    const png = new Blob(['x'], { type: PNG_MIME })
    downloadBlob(png, 'humanbench-card-light-2026-09-30.png', env)
    expect(clicks).toHaveLength(1)
    const a = clicks[0]!
    expect(a.download).toBe('humanbench-card-light-2026-09-30.png')
    expect(a.getAttribute('href')).toBe('blob:card/1')
    expect(a.isConnected).toBe(false)
    expect(blobs).toEqual([png])
    expect(revoked).toEqual([])
    expect(timers.map(([, ms]) => ms)).toEqual([REVOKE_AFTER_MS])
    timers[0]![0]()
    expect(revoked).toEqual(['blob:card/1'])
  })
})

