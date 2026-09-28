/**
 * Entry of the dev-only G7 review page and renderer gallery (ROADMAP M1.G7, M1.13; DESIGN §4.4),
 * loaded by `web/review.html`. Only the dev server serves it (`npm run review`): the production
 * build's only input is `index.html`, and this guard keeps the page out even if something imports
 * it, because `import.meta.env.DEV` is false there and the dynamic import is dropped
 * (`scripts/review-build.test.ts`).
 */

import '../app.css'

/** Shown instead of the page outside the dev server. */
export const REVIEW_DEV_ONLY = 'This review page runs only on the development server: in web/, run npm run review.'

const target = document.getElementById('app')
if (!target) throw new Error('HumanBench review: #app mount point missing')

if (import.meta.env.DEV) {
  void import('./mount').then((m) => m.mountReview(target))
} else {
  target.textContent = REVIEW_DEV_ONLY
}
