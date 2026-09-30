import { describe, expect, it } from 'vitest'
import { DEV_ROUTES, parseDevHash } from './routes'

describe('dev route hashes (M1.16)', () => {
  it('parses #/dev/<name>[?query] and nothing else', () => {
    const r = parseDevHash('#/dev/blob?profile=full')
    expect(r?.name).toBe('blob')
    expect(r?.params.get('profile')).toBe('full')
    expect(parseDevHash('#/dev/blob')?.params.toString()).toBe('')
    for (const h of ['', '#', '#/blob', '#/dev/', '#/dev/Blob', '#/devx/blob', '#/dev/blob/x']) expect(parseDevHash(h), h).toBeNull()
  })

  it('registers the blob demo and the reveal screens demo (AI.6b)', () => {
    expect(Object.keys(DEV_ROUTES)).toEqual(['blob', 'reveal-ai'])
    expect(parseDevHash('#/dev/reveal-ai?screen=share')?.name).toBe('reveal-ai')
  })
})
