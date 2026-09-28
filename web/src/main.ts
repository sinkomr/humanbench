import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const target = document.getElementById('app')
if (!target) throw new Error('HumanBench: #app mount point missing')

// Dev-only routes (#/dev/<name>, e.g. the blob demo of M1.16) exist only when the build-time flag
// is on; a production build folds this branch away with its dynamic import (src/dev/flags.d.ts).
if (__HB_DEV_ROUTES__ && location.hash.startsWith('#/dev/')) {
  void import('./dev/routes').then(async ({ mountDevRoute }) => {
    if (!(await mountDevRoute(target, location.hash))) mount(App, { target })
  })
} else {
  mount(App, { target })
}
