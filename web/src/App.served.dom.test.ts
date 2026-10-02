/**
 * The app shell with a server (ROADMAP M2.7; DESIGN §13; ROADMAP AI.26): the privacy notice describes
 * what is sent and says the notes settings stay on the device, the footer links the notice and the page
 * about data on the server, `#/data` shows that page, and the static fallback has none of it.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App.svelte'
import { SERVER_PRIVACY_SECTIONS } from './backend/copy'
import { FakeTransport, fakeBackend } from './backend/testing'
import { fakeDisplay } from './render/common/testing'
import { fakeEnv } from './session/dom-support'
import { PRIVACY_SECTIONS } from './session/copy'

let app: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
  location.hash = ''
})

function mountApp(server: boolean): void {
  const env = fakeEnv(fakeDisplay(), { backend: server ? fakeBackend(new FakeTransport()) : null }).env
  app = mount(App, { target: document.body, props: { env } })
  flushSync()
}
const go = (hash: string): void => {
  location.hash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  flushSync()
}

describe('the privacy notice with a server', () => {
  it('is the online notice: what is sent, that notes settings stay on the device, how to delete, and the placeholders the user must fill', () => {
    location.hash = '#/privacy'
    mountApp(true)
    const text = document.querySelector('.flow + main')?.textContent ?? ''
    for (const s of SERVER_PRIVACY_SECTIONS) expect(text).toContain(s.heading)
    expect(text).toContain('Your notes settings stay on your device')
    expect(text).toContain('They are never sent to the server, they are left out of the server backup')
    expect(text).toContain('Controller: TODO(user)')
    expect(text).toContain('retention period (draft: 24 months)')
    expect(text).not.toContain('Nothing is sent to a server.')
    expect(text).not.toContain('In this version everything stays in your browser')
    expect(document.querySelector('.flow + main a[href="#/data"]')).not.toBeNull()
  })

  it('the static notice is unchanged without a server', () => {
    location.hash = '#/privacy'
    mountApp(false)
    const text = document.querySelector('.flow + main')?.textContent ?? ''
    for (const s of PRIVACY_SECTIONS) expect(text).toContain(s.heading)
    expect(text).not.toContain('notes settings')
    expect(document.querySelector('.flow + main a[href="#/data"]')).toBeNull()
  })
})

describe('the footer and the data page', () => {
  it('with a server the footer links the notice and the data page; without one it has only the disclaimer', () => {
    mountApp(true)
    expect([...document.querySelectorAll('footer a')].map((a) => a.getAttribute('href'))).toEqual(['#/privacy', '#/data'])
    unmount(app!)
    document.body.innerHTML = ''
    mountApp(false)
    expect(document.querySelectorAll('footer a')).toHaveLength(0)
    expect(document.querySelectorAll('footer p')).toHaveLength(1)
  })

  it('#/data shows the page for the data on the server, keeps the flow mounted behind it, and goes back', () => {
    mountApp(true)
    go('#/data')
    expect(document.querySelector('.flow + main h1')?.textContent).toBe('Your data on the server')
    expect(document.querySelector('.flow')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelectorAll('.flow + main form')).toHaveLength(2)
    go('')
    expect(document.querySelector('.flow')?.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('.flow + main')).toBeNull()
  })

  it('#/data in the static fallback only says that nothing is kept on a server', () => {
    mountApp(false)
    go('#/data')
    const page = document.querySelector('.flow + main')!
    expect(page.textContent).toContain('keeps nothing on a server')
    expect(page.querySelector('form')).toBeNull()
  })
})
