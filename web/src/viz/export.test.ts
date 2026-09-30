/**
 * Getting the card out (ROADMAP M1.18; DESIGN §9.9): the PNG is drawn 1:1 onto a 2400 × 1260 canvas
 * from the card's own SVG, the SVG is a file of the same text, downloads go through `<a download>`
 * like the save file (`export.dom.test.ts`), and the share sheet gets a PNG file. jsdom has no 2-D
 * canvas, so the browser objects are fakes here; the real rasterisation is checked in the browsers (`e2e/share-card.spec.ts`).
 */

import { describe, expect, it, vi } from 'vitest'
import { buildCard, cardSvg, CARD_H, CARD_W, PNG_SCALE } from './card'
import { canShareImage, cardFileName, PNG_H, PNG_MIME, PNG_W, shareImage, svgBlob, svgDataUrl, svgToPng, SVG_MIME, type RasterEnv } from './export'
import { axisEstimates } from './profile'
import { syntheticProfile } from './synthetic'

const card = buildCard({ estimates: axisEstimates(syntheticProfile('m1')!.input), sessions: 1 })

describe('sizes and names', () => {
  it('the PNG is the card at 2×: 2400 × 1260', () => {
    expect([PNG_W, PNG_H]).toEqual([CARD_W * PNG_SCALE, CARD_H * PNG_SCALE])
    expect([PNG_W, PNG_H]).toEqual([2400, 1260])
  })

  it('names files humanbench-card-<date>.<ext>, with no id in them', () => {
    const d = new Date(2026, 8, 30, 23, 59)
    expect(cardFileName('png', d)).toBe('humanbench-card-2026-09-30.png')
    expect(cardFileName('svg', d)).toBe('humanbench-card-2026-09-30.svg')
    expect(cardFileName('png', new Date(2027, 0, 5, 0, 0))).toBe('humanbench-card-2027-01-05.png')
  })

  it('dates the file with the person\'s own day, not the UTC one, in any time zone', () => {
    try {
      // 2026-10-01 03:00 UTC is still 30 September in California and already 1 October in Auckland.
      const instant = new Date(Date.UTC(2026, 9, 1, 3, 0))
      vi.stubEnv('TZ', 'America/Los_Angeles')
      expect(cardFileName('png', instant)).toBe('humanbench-card-2026-09-30.png')
      vi.stubEnv('TZ', 'Pacific/Auckland')
      expect(cardFileName('png', instant)).toBe('humanbench-card-2026-10-01.png')
      vi.stubEnv('TZ', 'UTC')
      expect(cardFileName('svg', instant)).toBe('humanbench-card-2026-10-01.svg')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('makes a data URL that decodes to exactly the SVG (#, %, &, quotes and non-ASCII survive)', () => {
    const tricky = '<svg xmlns="http://www.w3.org/2000/svg"><text>#1 100% Matrix & "Series" −3 SD ○ ◇ x</text></svg>'
    const url = svgDataUrl(tricky)
    expect(url.startsWith(`data:${SVG_MIME};charset=utf-8,`)).toBe(true)
    expect(url).not.toMatch(/[#"<> ]/)
    expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toBe(tricky)
    expect(decodeURIComponent(svgDataUrl(card.svg).split(',')[1]!)).toBe(card.svg)
  })

  it('the SVG file body is the card text, typed as SVG', async () => {
    const blob = svgBlob(card.svg)
    expect(blob.type).toBe(`${SVG_MIME};charset=utf-8`)
    expect(await blob.text()).toBe(card.svg)
  })
})

/** Fake browser objects: an image that "loads" (or fails) once its source is set, and a canvas that records. */
function fakeRaster(opts: { imageFails?: boolean; noContext?: boolean; noBlob?: boolean } = {}) {
  const log = { src: '', drawn: [] as unknown[][], imageSize: [0, 0], canvasSize: [0, 0], type: '' }
  const image = {
    onload: null as null | (() => void),
    onerror: null as null | (() => void),
    width: 0,
    height: 0,
    set src(v: string) {
      log.src = v
      log.imageSize = [this.width, this.height]
      queueMicrotask(() => (opts.imageFails ? this.onerror?.() : this.onload?.()))
    },
    get src() {
      return log.src
    },
  }
  const ctx = { drawImage: (...a: unknown[]) => void log.drawn.push(a) }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (opts.noContext ? null : ctx),
    toBlob(cb: BlobCallback, type?: string) {
      log.canvasSize = [this.width, this.height]
      log.type = type ?? ''
      cb(opts.noBlob ? null : new Blob(['\u0089PNG'], { type }))
    },
  }
  const env = { image: () => image, canvas: () => canvas } as unknown as RasterEnv
  return { env, log, image }
}

describe('svgToPng', () => {
  it('draws the card\'s SVG 1:1 onto a 2400 × 1260 canvas and encodes a PNG of that size', async () => {
    const { env, log, image } = fakeRaster()
    const svg = cardSvg(card, PNG_SCALE)
    const r = await svgToPng(svg, PNG_W, PNG_H, env)
    expect([r.width, r.height]).toEqual([2400, 1260])
    expect(r.blob.type).toBe(PNG_MIME)
    // The image knows its size before it loads (WebKit rasterises an SVG at its intrinsic size).
    expect(log.imageSize).toEqual([2400, 1260])
    expect(decodeURIComponent(log.src.slice(log.src.indexOf(',') + 1))).toBe(svg)
    expect(log.src.startsWith('data:image/svg+xml')).toBe(true)
    expect(log.canvasSize).toEqual([2400, 1260])
    expect(log.type).toBe(PNG_MIME)
    expect(log.drawn).toEqual([[image, 0, 0, 2400, 1260]])
    // The source document is itself 2400 × 1260 (vector-sharp), with the 1200 × 630 viewBox.
    expect(svg).toContain('width="2400" height="1260" viewBox="0 0 1200 630"')
  })

  it('rejects, in words, when the image cannot be decoded, there is no 2-D context, or no PNG comes out', async () => {
    await expect(svgToPng(card.svg, PNG_W, PNG_H, fakeRaster({ imageFails: true }).env)).rejects.toThrow(/decoded/)
    await expect(svgToPng(card.svg, PNG_W, PNG_H, fakeRaster({ noContext: true }).env)).rejects.toThrow(/2-D canvas/)
    await expect(svgToPng(card.svg, PNG_W, PNG_H, fakeRaster({ noBlob: true }).env)).rejects.toThrow(/encode/)
  })
})

describe('the share sheet', () => {
  it('is offered only where the browser takes image files', () => {
    expect(canShareImage(undefined)).toBe(false)
    expect(canShareImage({})).toBe(false)
    expect(canShareImage({ share: async () => {} })).toBe(false)
    expect(canShareImage({ share: async () => {}, canShare: () => false })).toBe(false)
    expect(canShareImage({ share: async () => {}, canShare: () => true })).toBe(true)
    expect(
      canShareImage({
        share: async () => {},
        canShare: () => {
          throw new TypeError('no')
        },
      }),
    ).toBe(false)
    const seen: ShareData[] = []
    canShareImage({ share: async () => {}, canShare: (d) => (seen.push(d as ShareData), true) })
    expect(seen[0]!.files![0]!.type).toBe(PNG_MIME)
  })

  it('hands the PNG over as a file, reaching the sheet before any await', async () => {
    const calls: ShareData[] = []
    let reached = false
    const nav = {
      share: (d: ShareData) => {
        reached = true
        calls.push(d)
        return Promise.resolve()
      },
    }
    const png = new Blob(['x'], { type: PNG_MIME })
    const p = shareImage(png, 'humanbench-card-2026-09-30.png', nav)
    expect(reached).toBe(true) // synchronously: the click's user activation still holds
    expect(await p).toBe('shared')
    const file = calls[0]!.files![0]!
    expect([file.name, file.type]).toEqual(['humanbench-card-2026-09-30.png', PNG_MIME])
  })

  it('tells a dismissed sheet from a failure', async () => {
    const png = new Blob(['x'])
    const abort = { share: () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) }
    const broken = { share: () => Promise.reject(new TypeError('nope')) }
    expect(await shareImage(png, 'a.png', abort)).toBe('cancelled')
    expect(await shareImage(png, 'a.png', broken)).toBe('failed')
    expect(await shareImage(png, 'a.png', {})).toBe('failed')
    expect(await shareImage(png, 'a.png', undefined)).toBe('failed')
  })
})
