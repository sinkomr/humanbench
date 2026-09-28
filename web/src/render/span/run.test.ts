/**
 * What the span renderers take from a spec (ROADMAP M1.9, M1.13): the targets they derive are the
 * family key, their state machine steps match the family's `runBlock` (the scorer's), and arrow
 * navigation reaches every block of the fixed Corsi board.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CORSI_BOARD, corsi, runBlock, spanBwd, spanFwd } from '../../tasks/span'
import { directionOfKey, nearestInDirection, spanNext, spanTargets, type Direction } from './run'

describe('span run helpers', () => {
  it('spanTargets(spec) is the key of every generated block (forward, backward, Corsi)', () => {
    for (const family of [spanFwd, spanBwd, corsi]) {
      for (let i = 0; i < 300; i++) {
        const item = family.generate(`run-${family.name}-${i}`)
        expect(spanTargets(item.spec)).toEqual(item.key.sequences)
      }
    }
  })

  it('spanNext steps exactly like the family scorer (property over pass/fail patterns)', () => {
    fc.assert(
      fc.property(fc.constantFrom(spanFwd, spanBwd, corsi), fc.nat(1000), fc.array(fc.boolean(), { maxLength: 18 }), (family, seed, pattern) => {
        const item = family.generate(`run-next-${seed}`)
        const responses: number[][] = []
        for (const pass of pattern) {
          const status = spanNext(item.spec, responses)
          expect(status).toEqual(runBlock(item, responses))
          if (status.finished) return
          const target = item.key.sequences[status.trial] ?? []
          responses.push(pass ? [...target] : [...target].reverse().concat(target[0] ?? 1))
        }
        expect(spanNext(item.spec, responses)).toEqual(runBlock(item, responses))
      }),
      { numRuns: 200 },
    )
  })

  it('arrow keys reach every Corsi block from every other block', () => {
    const blocks = CORSI_BOARD.blocks
    const dirs: Direction[] = ['left', 'right', 'up', 'down']
    for (let from = 0; from < blocks.length; from++) {
      const seen = new Set([from])
      const queue = [from]
      while (queue.length > 0) {
        const b = queue.shift() as number
        for (const d of dirs) {
          const n = nearestInDirection(blocks, b, d)
          if (!seen.has(n)) {
            seen.add(n)
            queue.push(n)
          }
        }
      }
      expect(seen.size, `from block ${from}`).toBe(blocks.length)
    }
  })

  it('an arrow move goes the right way, or stays when nothing lies that way', () => {
    const blocks = CORSI_BOARD.blocks
    for (let from = 0; from < blocks.length; from++) {
      const [x, y] = blocks[from] as readonly [number, number]
      const r = nearestInDirection(blocks, from, 'right')
      if (r !== from) expect((blocks[r] as readonly [number, number])[0]).toBeGreaterThan(x)
      else expect(blocks.every(([bx]) => bx <= x)).toBe(true)
      const u = nearestInDirection(blocks, from, 'up')
      if (u !== from) expect((blocks[u] as readonly [number, number])[1]).toBeLessThan(y)
      else expect(blocks.every(([, by]) => by >= y)).toBe(true)
    }
    expect(nearestInDirection(blocks, 99, 'left')).toBe(99)
    expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].map(directionOfKey)).toEqual(['left', 'right', 'up', 'down', null])
  })
})
