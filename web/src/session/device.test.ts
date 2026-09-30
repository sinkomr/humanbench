import { describe, expect, it } from 'vitest'
import { fakeDisplay } from '../render/common/testing'
import { assertValidSession } from '../save/validate'
import { TEST_DEVICE } from './bot'
import { browserFamily, checkDevice, defaultRtInput, deviceClass, deviceRemarks, osFamily, timerResolutionMs, type DeviceEnv } from './device'

const UA = {
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  bot: 'curl/8.0',
}

const env = (over: Partial<DeviceEnv> = {}): DeviceEnv => ({ userAgent: UA.macChrome, maxTouchPoints: 0, coarsePointer: false, viewport: [1280, 800], ...over })

describe('coarse device families (DESIGN §8: families only, never versions)', () => {
  it('names the operating-system family', () => {
    expect(osFamily(UA.macSafari)).toBe('macOS')
    expect(osFamily(UA.winEdge)).toBe('Windows')
    expect(osFamily(UA.iphone)).toBe('iOS')
    expect(osFamily(UA.android)).toBe('Android')
    expect(osFamily(UA.linux)).toBe('Linux')
    expect(osFamily(UA.chromeOs)).toBe('ChromeOS')
    expect(osFamily(UA.bot)).toBe('Other')
    // iPadOS asks for the desktop site: a Mac user agent with a touch screen is an iPad.
    expect(osFamily(UA.ipadDesktop, 5)).toBe('iOS')
  })

  it('names the browser family, Edge and iOS Chrome included', () => {
    expect(browserFamily(UA.macSafari)).toBe('Safari')
    expect(browserFamily(UA.macChrome)).toBe('Chrome')
    expect(browserFamily(UA.winEdge)).toBe('Edge')
    expect(browserFamily(UA.winFirefox)).toBe('Firefox')
    expect(browserFamily(UA.iphoneChrome)).toBe('Chrome')
    expect(browserFamily(UA.iphone)).toBe('Safari')
    expect(browserFamily(UA.bot)).toBe('Other')
  })

  it('every family name is one the save schema accepts (letters, no digits or dots)', () => {
    const re = /^[A-Za-z][A-Za-z _-]{0,31}$/
    for (const ua of Object.values(UA)) {
      expect(osFamily(ua)).toMatch(re)
      expect(browserFamily(ua)).toMatch(re)
    }
  })

  it('classes the device from the pointer and the short side of the window', () => {
    expect(deviceClass(env())).toBe('desktop')
    expect(deviceClass(env({ userAgent: UA.iphone, maxTouchPoints: 5, coarsePointer: true, viewport: [390, 844] }))).toBe('phone')
    expect(deviceClass(env({ userAgent: UA.ipadDesktop, maxTouchPoints: 5, coarsePointer: true, viewport: [820, 1180] }))).toBe('tablet')
    expect(deviceClass(env({ viewport: [0, 0] }))).toBe('other')
    // A small desktop window is still a desktop.
    expect(deviceClass(env({ viewport: [400, 500] }))).toBe('desktop')
  })

  it('starts the reaction tasks on touch for a coarse pointer, else on the keyboard (DESIGN §13)', () => {
    expect(defaultRtInput(env())).toBe('keyboard')
    expect(defaultRtInput(env({ coarsePointer: true }))).toBe('touch')
  })
})

describe('the timer resolution (§11.6 item 4)', () => {
  it('is the smallest positive step of the clock', () => {
    let t = 0
    let calls = 0
    const clock = {
      now: () => {
        calls++
        if (calls % 4 === 0) t += 0.1
        return t
      },
    }
    expect(timerResolutionMs(clock)).toBeCloseTo(0.1, 6)
  })

  it('gives null for a clock that never moves, without hanging', () => {
    expect(timerResolutionMs({ now: () => 5 }, 3, 1000)).toBeNull()
  })
})

describe('checkDevice', () => {
  it('measures the refresh rate from animation frames and returns a save-valid device', async () => {
    const display = fakeDisplay(1000 / 120)
    const p = checkDevice({ env: env(), frames: display.frames, clock: display.clock }, 'keyboard')
    display.advance(1000)
    const info = await p
    expect(info).toMatchObject({ class: 'desktop', input: 'keyboard', os_family: 'macOS', browser_family: 'Chrome', refresh_hz_est: 120, viewport: [1280, 800] })
    // The session record that carries it validates against schema v1.
    const session = { session_id: 's_DEVICECHECK001', started_utc: '2026-09-29T12:00:00Z', duration_s: 0, device: info, flags: {}, responses: [] }
    expect(() => assertValidSession(session)).not.toThrow()
  })

  it('leaves the refresh rate null when no frames come (a hidden tab), after the time limit', async () => {
    const frames = { request: () => 1, cancel: () => undefined }
    let fire: (() => void) | null = null
    const p = checkDevice(
      {
        env: env({ userAgent: UA.iphone, maxTouchPoints: 5, coarsePointer: true, viewport: [390, 844] }),
        frames,
        clock: { now: () => 0 },
        setTimeout: (fn) => {
          fire = fn
          return 1
        },
        clearTimeout: () => undefined,
      },
      'touch',
    )
    fire!()
    const info = await p
    expect(info.refresh_hz_est).toBeNull()
    expect(info.input).toBe('touch')
    expect(info.class).toBe('phone')
    expect(info.timer_res_ms).toBeNull()
  })

  it('remarks say what will be less precise, never anything about the person', () => {
    expect(deviceRemarks(TEST_DEVICE)).toEqual([])
    expect(deviceRemarks({ ...TEST_DEVICE, refresh_hz_est: 30 })[0]).toMatch(/less precise/)
    expect(deviceRemarks({ ...TEST_DEVICE, refresh_hz_est: null })[0]).toMatch(/could not be measured/)
    expect(deviceRemarks({ ...TEST_DEVICE, viewport: [280, 500] })[0]).toMatch(/narrow/)
  })
})
