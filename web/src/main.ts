import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const target = document.getElementById('app')
if (!target) throw new Error('HumanBench: #app mount point missing')

// index.html paints a static copy of the welcome screen while this script loads (UX-100). It goes before
// anything mounts, so the page never has two headings or two main landmarks.
target.replaceChildren()
document.documentElement.classList.remove('hb-shell-js', 'hb-shell-deep')

// Dev-only routes (#/dev/<name>, e.g. the blob demo of M1.16) exist only when the build-time flag
// is on; a production build folds this branch away with its dynamic import (src/dev/flags.d.ts).
if (__HB_DEV_ROUTES__ && location.hash.startsWith('#/dev/')) {
  void import('./dev/routes').then(async ({ mountDevRoute }) => {
    if (!(await mountDevRoute(target, location.hash))) mount(App, { target })
  })
} else {
  mount(App, { target })
}
