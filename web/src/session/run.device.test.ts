/**
 * The online session hands the server its estimates of the timed skills (DESIGN §7.4 "Cross-skill aim", amended
 * 2026-10-17; `public.device_estimates`): after each timed block, that skill's axis, mean and sd (never a trial), before
 * the next served part asks for an item; a failure is let go. The static version sends nothing.
 */

import { describe, expect, it } from 'vitest'
import { BackendError } from '../backend/errors'
import type { CatAnswer, CatNext, CatSource } from '../backend/session'
import type { AxisCode } from '../engine/axes'
import { deviceEstimate, type DeviceEstimate } from '../engine/xskill'
import { initialSigma } from '../engine/axes'
import { Bot } from './bot'

class DeviceCat implements CatSource {
  readonly sessionId = 's_SERVERSESSION01'
  readonly order: string[] = []
  readonly sent: DeviceEstimate[][] = []
  fail = false
  next(_axes: readonly AxisCode[]): Promise<CatNext> {
    this.order.push('next')
    return Promise.resolve({ kind: 'done', reason: 'axes_done' })
  }
  answer(_a: CatAnswer): Promise<void> {
    this.order.push('answer')
    return Promise.resolve()
  }
  deviceEstimates(estimates: readonly DeviceEstimate[]): Promise<void> {
    this.order.push(`device:${estimates.map((e) => e.axis).join(',')}`)
    this.sent.push(estimates.map((e) => ({ ...e })))
    return this.fail ? Promise.reject(new BackendError('network', 'network_error')) : Promise.resolve()
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/** Steps the bot until the run asks the server for an item (or `max` steps). */
async function untilNext(bot: Bot, cat: DeviceCat, max = 40): Promise<void> {
  for (let i = 0; i < max && !cat.order.includes('next'); i++) {
    bot.step()
    await settle()
  }
}

describe('device estimates in a served session', () => {
  it('sends the reaction-time estimate (axis, mean, sd only) after each RT block, before the first served item is asked for', async () => {
    const cat = new DeviceCat()
    const bot = new Bot({ sessionId: 's_DEVICEESTIMATE1', cat }, { seed: 'device-1' })
    await untilNext(bot, cat)
    const rt = cat.order.filter((o) => o.startsWith('device:'))
    expect(rt.length).toBeGreaterThanOrEqual(1)
    expect(rt.every((o) => o === 'device:RT')).toBe(true)
    expect(cat.order.indexOf('next')).toBeGreaterThan(cat.order.lastIndexOf('device:RT'))
    for (const list of cat.sent) for (const e of list) expect(Object.keys(e).sort()).toEqual(['axis', 'mean', 'sd'])
    // the last one is the estimate of every RT block so far
    const want = deviceEstimate('RT', bot.run.result().observations, { sigma: initialSigma() })
    expect(cat.sent.at(-1)![0]).toEqual(want)
  })

  it('a failed call is let go: the session goes on and asks for its items', async () => {
    const cat = new DeviceCat()
    cat.fail = true
    const bot = new Bot({ sessionId: 's_DEVICEESTIMATE2', cat }, { seed: 'device-2' })
    await untilNext(bot, cat)
    expect(cat.order).toContain('device:RT')
    expect(cat.order).toContain('next')
  })

  it('the static version sends nothing and a source without the method is not asked', async () => {
    const bot = new Bot({ sessionId: 's_DEVICEESTIMATE3' }, { seed: 'device-3' })
    for (let i = 0; i < 6; i++) bot.step()
    const plain: CatSource = { sessionId: 's_SERVERSESSION01', next: () => Promise.resolve({ kind: 'done', reason: 'axes_done' }), answer: () => Promise.resolve() }
    const b2 = new Bot({ sessionId: 's_DEVICEESTIMATE4', cat: plain }, { seed: 'device-4' })
    for (let i = 0; i < 6; i++) {
      b2.step()
      await settle()
    }
    expect(b2.view().phase).not.toBe('finished')
  })
})
