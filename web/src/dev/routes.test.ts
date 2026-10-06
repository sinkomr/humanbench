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

  it('registers the blob demo, the reveal screens demo (AI.6b), the Fermi entry demo (M5.1), the emotion entry demo (M6.1) and the situational judgment, word links and unusual uses entry demos (M6.2-M6.4)', () => {
    expect(Object.keys(DEV_ROUTES)).toEqual(['blob', 'reveal-ai', 'fermi', 'emotion', 'sjt', 'rat', 'aut'])
    expect(parseDevHash('#/dev/reveal-ai?screen=share')?.name).toBe('reveal-ai')
    expect(parseDevHash('#/dev/fermi?seed=3')?.params.get('seed')).toBe('3')
    expect(parseDevHash('#/dev/emotion?seed=2')?.params.get('seed')).toBe('2')
    for (const name of ['sjt', 'rat', 'aut']) {
      expect(parseDevHash(`#/dev/${name}?seed=4`)?.name).toBe(name)
      expect(parseDevHash(`#/dev/${name}?seed=4`)?.params.get('seed')).toBe('4')
    }
  })
})
