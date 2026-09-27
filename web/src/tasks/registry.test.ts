import { describe, expect, it } from 'vitest'
import { validateItemInstance } from './family'
import { FAMILY_NAME_RE, GENERATOR_VERSION_RE } from './ids'
import { FAMILIES, getFamily } from './registry'

const entries = Object.entries(FAMILIES)

describe('family registry (M1.F)', () => {
  it('is keyed by family name, with valid names and versions', () => {
    for (const [key, fam] of entries) {
      expect(fam.name).toBe(key)
      expect(key).toMatch(FAMILY_NAME_RE)
      expect(fam.generatorVersion).toMatch(GENERATOR_VERSION_RE)
      expect(getFamily(key)).toBe(fam)
    }
    expect(getFamily('toString')).toBeUndefined()
    expect(getFamily('example')).toBeUndefined() // the toy family is never registered
  })

  it('every registered family generates valid, verified instances (smoke; the full suite is per family)', () => {
    for (const [, fam] of entries) {
      for (let i = 0; i < 20; i++) {
        const item = fam.generate(`registry-smoke-${i}`)
        expect(validateItemInstance(item, fam)).toEqual([])
        expect(fam.verify(item).ok).toBe(true)
      }
    }
  })
})
