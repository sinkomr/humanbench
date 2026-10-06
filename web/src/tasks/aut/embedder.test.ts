import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockEmbedder, EmbedderLoadError, l2Normalise, MOCK_MODEL_ID, type Embedder } from './embedder'

const dot = (a: Float32Array, b: Float32Array): number => a.reduce((s, x, i) => s + x * (b[i] as number), 0)
const length = (a: Float32Array): number => Math.sqrt(dot(a, a))

async function one(e: Embedder, text: string): Promise<Float32Array> {
  const [v] = await e.embed([text])
  if (v === undefined) throw new Error('no vector')
  return v
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createMockEmbedder', () => {
  it('names itself "mock" and has 64 dimensions unless told otherwise', () => {
    const e = createMockEmbedder()
    expect(e.modelId).toBe('mock')
    expect(e.modelId).toBe(MOCK_MODEL_ID)
    expect(e.dim).toBe(64)
    expect(createMockEmbedder({ dim: 384 }).dim).toBe(384)
  })

  it('refuses a dim that is not a positive integer', () => {
    for (const dim of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => createMockEmbedder({ dim }), String(dim)).toThrow(RangeError)
  })

  it('is deterministic: the same text gives the same vector, in one embedder and across embedders and calls', async () => {
    const a = createMockEmbedder()
    const b = createMockEmbedder()
    const texts = ['a brick', 'use it as a doorstop', 'mix cement', 'ünïcode — ok', '12 monkeys']
    const first = await a.embed(texts)
    expect(await a.embed(texts)).toEqual(first)
    expect(await b.embed(texts)).toEqual(first)
    expect(await b.embed([...texts].reverse())).toEqual([...first].reverse())
  })

  it('returns one Float32Array of length dim per text, in the order given, and an empty list for no texts', async () => {
    for (const dim of [1, 2, 7, 64, 384]) {
      const e = createMockEmbedder({ dim })
      const texts = ['one', 'two words', 'three little words', '']
      const out = await e.embed(texts)
      expect(out).toHaveLength(texts.length)
      for (const v of out) {
        expect(v).toBeInstanceOf(Float32Array)
        expect(v).toHaveLength(dim)
      }
      // order: each vector is what that text alone gives
      for (let i = 0; i < texts.length; i++) expect(out[i], `${dim}:${texts[i]}`).toEqual(await one(e, texts[i] as string))
    }
    expect(await createMockEmbedder().embed([])).toEqual([])
  })

  it('returns unit-length vectors', async () => {
    for (const dim of [1, 2, 8, 64, 384]) {
      const e = createMockEmbedder({ dim })
      for (const t of ['brick', 'a brick', 'hold the door open with it', 'x', '', '   ', '!!!', '日本語のテキスト', 'a '.repeat(500)]) {
        expect(length(await one(e, t)), `${dim}:${t.slice(0, 20)}`).toBeCloseTo(1, 5)
      }
    }
  })

  it('puts texts that share words closer than unrelated texts', async () => {
    const e = createMockEmbedder()
    const base = 'a brick wall'
    const cases: [string, string, string][] = [
      [base, 'brick wall', 'ocean liner'],
      [base, 'a wall of clay', 'jazz piano trio'],
      ['prop open a door', 'prop open a gate', 'knit a woollen scarf'],
      ['grind it into red powder', 'grind it for pigment', 'translate the letter'],
      ['paperweight', 'a paperweight', 'volcano'],
    ]
    for (const [a, near, far] of cases) {
      const [va, vn, vf] = await e.embed([a, near, far])
      expect(dot(va as Float32Array, vn as Float32Array), `${a} ~ ${near}`).toBeGreaterThan(dot(va as Float32Array, vf as Float32Array))
    }
  })

  it('orders similarity by overlap over a fixed vocabulary (the hash is fixed, so this either always holds or never)', async () => {
    const e = createMockEmbedder()
    const vocab = ['brick', 'door', 'stop', 'weapon', 'paper', 'weight', 'garden', 'border', 'pigment', 'hammer', 'sponge', 'bookend', 'heater', 'planter', 'step', 'anchor']
    let checked = 0
    for (let i = 0; i + 8 <= vocab.length; i++) {
      const words = vocab.slice(i, i + 8)
      const q = words.slice(0, 4).join(' ')
      const overlapping = [...words.slice(0, 3), words[5] as string].join(' ') // three words shared
      const disjoint = words.slice(4).join(' ')
      const [vq, vo, vd] = await e.embed([q, overlapping, disjoint])
      expect(dot(vq as Float32Array, vo as Float32Array), `${q} | ${overlapping} | ${disjoint}`).toBeGreaterThan(dot(vq as Float32Array, vd as Float32Array))
      checked++
    }
    expect(checked).toBe(9)
  })

  it('ignores case, punctuation and spacing between words, and keeps near-spellings close', async () => {
    const e = createMockEmbedder()
    expect(await one(e, 'Brick!')).toEqual(await one(e, 'brick'))
    expect(await one(e, '  A   BRICK,  wall. ')).toEqual(await one(e, 'a brick wall'))
    expect(dot(await one(e, 'doorstop'), await one(e, 'doorstops'))).toBeGreaterThan(dot(await one(e, 'doorstop'), await one(e, 'telescope')))
  })

  it('gives every text without a word the same fixed unit vector', async () => {
    const e = createMockEmbedder({ dim: 16 })
    const empty = await one(e, '')
    expect(await one(e, '   ')).toEqual(empty)
    expect(await one(e, '!?…')).toEqual(empty)
    expect(await one(e, '\n\t')).toEqual(empty)
    expect(length(empty)).toBeCloseTo(1, 6)
    expect(new Set(empty).size).toBe(1)
    // and it is a different vector from any text that has words
    expect(await one(e, 'brick')).not.toEqual(empty)
    await expect(createMockEmbedder({ dim: 16 }).embed([''])).resolves.toEqual([empty])
  })

  it('hands out fresh arrays: changing one does not change what the next call returns', async () => {
    const e = createMockEmbedder()
    const [v] = await e.embed(['brick'])
    const copy = Float32Array.from(v as Float32Array)
    ;(v as Float32Array).fill(0)
    expect((await e.embed(['brick']))[0]).toEqual(copy)
  })

  it('never touches the network: fetch is not called', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network is off'))
    const e = createMockEmbedder()
    await e.embed(['a', 'b c', ''])
    await e.embed(Array.from({ length: 200 }, (_, i) => `text ${i}`))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('properties: any text gives a finite unit vector; embedding is deterministic and batch-order independent', async () => {
    const e = createMockEmbedder()
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string({ maxLength: 60 }), { minLength: 1, maxLength: 6 }), async (texts) => {
        const out = await e.embed(texts)
        expect(out).toHaveLength(texts.length)
        for (const v of out) {
          expect(v.every(Number.isFinite)).toBe(true)
          expect(Math.abs(length(v) - 1)).toBeLessThan(1e-5)
        }
        expect(await e.embed(texts)).toEqual(out)
        for (let i = 0; i < texts.length; i++) expect(await one(e, texts[i] as string)).toEqual(out[i])
      }),
      { numRuns: 100 },
    )
  })

  it('properties: a text is closest to itself, and cosine is symmetric', async () => {
    const e = createMockEmbedder({ dim: 128 })
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 40 }), fc.string({ minLength: 1, maxLength: 40 }), async (a, b) => {
        const [va, vb] = (await e.embed([a, b])) as [Float32Array, Float32Array]
        expect(dot(va, va)).toBeCloseTo(1, 5)
        expect(dot(va, vb)).toBeCloseTo(dot(vb, va), 6)
        expect(dot(va, vb)).toBeLessThanOrEqual(1 + 1e-5)
      }),
      { numRuns: 100 },
    )
  })
})

describe('l2Normalise', () => {
  it('scales to unit length and copies', () => {
    const src = new Float32Array([3, 4])
    const out = l2Normalise(src)
    expect(Array.from(out)).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.8, 6)])
    expect(Array.from(src)).toEqual([3, 4])
    expect(out).not.toBe(src)
    expect(l2Normalise([0, 0, 5])).toEqual(new Float32Array([0, 0, 1]))
  })

  it('keeps a direction for very small and very large components', () => {
    expect(length(l2Normalise([1e-200, 1e-200]))).toBeCloseTo(1, 6)
    expect(length(l2Normalise([1e200, -1e200, 1e200]))).toBeCloseTo(1, 6)
  })

  it('returns zeros for a vector with no direction', () => {
    expect(l2Normalise([0, 0, 0])).toEqual(new Float32Array(3))
    expect(l2Normalise([1, Number.NaN])).toEqual(new Float32Array(2))
    expect(l2Normalise([1, Number.POSITIVE_INFINITY])).toEqual(new Float32Array(2))
    expect(l2Normalise([])).toEqual(new Float32Array(0))
  })

  it('accepts a view into a bigger buffer', () => {
    const big = new Float32Array([9, 9, 3, 4, 9])
    expect(Array.from(l2Normalise(big.subarray(2, 4)))).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.8, 6)])
  })
})

describe('EmbedderLoadError', () => {
  it('is an Error with its own name and keeps the cause', () => {
    const cause = new TypeError('Failed to fetch')
    const e = new EmbedderLoadError('could not load', { cause })
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(EmbedderLoadError)
    expect(e.name).toBe('EmbedderLoadError')
    expect(e.message).toBe('could not load')
    expect(e.cause).toBe(cause)
    expect(new EmbedderLoadError('x').cause).toBeUndefined()
  })
})

describe('embedder.ts stays free of the model library', () => {
  it('has no import or re-export statement at all (so nothing, not even a type, can pull in transformers or onnxruntime)', () => {
    const text = readFileSync(fileURLToPath(new URL('./embedder.ts', import.meta.url)), 'utf8')
    // Code only: the header comment may talk about `import()`.
    const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).toContain('export function createMockEmbedder')
    expect(src).not.toMatch(/^\s*(?:import|export)\b[^\n]*\bfrom\b/m)
    expect(src).not.toMatch(/^\s*import\s*['"(]/m)
    expect(src).not.toMatch(/\bimport\s*\(/)
    expect(src).not.toMatch(/\brequire\s*\(/)
  })
})
