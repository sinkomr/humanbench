/**
 * Entry of the dev-only visual renderer gallery (ROADMAP M1.13): `web/render-visual.html` on the
 * Vite dev server. The production build never includes it (only `index.html` is an input, and the
 * bundle test checks the output); this guard also stops it if it were ever built.
 */

import { mount } from 'svelte'
import '../../app.css'
import VisualGallery from './VisualGallery.svelte'

if (!import.meta.env.DEV) throw new Error('The renderer gallery runs only on the dev server.')

const target = document.getElementById('app')
if (!target) throw new Error('renderer gallery: #app mount point missing')

mount(VisualGallery, { target })
