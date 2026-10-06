import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createMockEmbedder, type Embedder } from './embedder'
import { AUT_PARAMS_V0 } from './params'
import { scoreResponses } from './run'
import { scoreAut } from './scoring'
import { templateText } from './text'

/** A mock embedder that records what it was asked to embed. */
function spied(): { embedder: Embedder; calls: (readonly string[])[] } {
  const inner = createMockEmbedder()
  const calls: (readonly string[])[] = []
  return {
    calls,
    embedder: {
      modelId: inner.modelId,
      dim: inner.dim,
      embed: (texts) => {
        calls.push([...texts])
        return inner.embed(texts)
      },
    },
  }
}

const IDEAS = ['prop open a door', 'use it as a doorstop', 'crush it into red pigment', 'bookend for paperbacks']

describe('scoreResponses (M6.4)', () => {
  it('embeds the object, its template and the ideas in one call, in that order', async () => {
    const { embedder, calls } = spied()
    await scoreResponses(embedder, 'brick', IDEAS)
    expect(calls).toEqual([['brick', 'a use for a brick', ...IDEAS]])
    expect(calls[0]?.[1]).toBe(templateText('brick'))
  })

  it('gives the score scoreAut gives for the same vectors', async () => {
    const e = createMockEmbedder()
    const score = await scoreResponses(e, 'brick', IDEAS)
    const [objectVec, templateVec, ...vecs] = await e.embed(['brick', templateText('brick'), ...IDEAS])
    const direct = scoreAut({ object: 'brick', objectVec: objectVec as Float32Array, templateVec: templateVec as Float32Array, responses: IDEAS.map((text, i) => ({ text, vec: vecs[i] as Float32Array })) })
    expect(score).toEqual(direct)
    expect(score.version).toBe(AUT_PARAMS_V0.version)
    expect(score.perResponse.map((r) => r.text)).toEqual(IDEAS)
  })

  it('uses the parameters it is given', async () => {
    const e = createMockEmbedder()
    const loose = await scoreResponses(e, 'brick', IDEAS, { ...AUT_PARAMS_V0, version: 'test', plausibilityFloor: -1, duplicateCosine: 1 })
    expect(loose.version).toBe('test')
    expect(loose.fluency).toBe(IDEAS.length)
  })

  it('scores no ideas as an empty round, not an error', async () => {
    const { embedder, calls } = spied()
    const score = await scoreResponses(embedder, 'paperclip', [])
    expect(calls).toEqual([['paperclip', 'a use for a paperclip']])
    expect(score.fluency).toBe(0)
    expect(score.originality).toBeNull()
    expect(score.flags).toContain('no_scored_responses')
  })

  it('counts a repeat once, and leaves out an idea that looks like contact details (redacted in the score)', async () => {
    const e = createMockEmbedder()
    const score = await scoreResponses(e, 'brick', ['doorstop', 'doorstop', 'write to jo@example.com about it'])
    expect(score.perResponse.map((r) => r.status)).toEqual(['scored', 'duplicate', 'personal_info'])
    expect(score.fluency).toBe(1)
    expect(JSON.stringify(score)).not.toContain('jo@example.com')
    expect(score.flags).toContain('personal_info')
  })

  it('gives an originality for a norm-bearing object a z, and none for another', async () => {
    const e = createMockEmbedder()
    expect((await scoreResponses(e, 'brick', IDEAS)).originalityZ).not.toBeNull()
    const other = await scoreResponses(e, 'spoon', IDEAS)
    expect(other.originalityZ).toBeNull()
    expect(other.flags).toContain('no_prompt_norm')
  })

  it('rejects an empty object, an embedder that fails and one that returns the wrong number of vectors', async () => {
    const e = createMockEmbedder()
    await expect(scoreResponses(e, '  ', IDEAS)).rejects.toBeInstanceOf(RangeError)
    const failing: Embedder = { modelId: 'x', dim: 4, embed: () => Promise.reject(new Error('boom')) }
    await expect(scoreResponses(failing, 'brick', IDEAS)).rejects.toThrow('boom')
    const short: Embedder = { modelId: 'x', dim: 4, embed: () => Promise.resolve([new Float32Array(4)]) }
    await expect(scoreResponses(short, 'brick', IDEAS)).rejects.toThrow(/returned 1 vectors for 6 texts/)
  })

  it('makes no network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await scoreResponses(createMockEmbedder(), 'brick', IDEAS)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('gives one entry per idea and counts within range for any ideas (property)', async () => {
    const e = createMockEmbedder()
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string({ maxLength: 30 }), { maxLength: 12 }), async (ideas) => {
        const score = await scoreResponses(e, 'brick', ideas)
        expect(score.perResponse).toHaveLength(ideas.length)
        expect(score.fluency).toBe(score.perResponse.filter((r) => r.status === 'scored').length)
        expect(score.flexibility).toBeLessThanOrEqual(score.fluency)
        if (score.originality !== null) {
          expect(score.originality).toBeGreaterThanOrEqual(0)
          expect(score.originality).toBeLessThanOrEqual(2)
        }
      }),
      { numRuns: 80 },
    )
  })
})
