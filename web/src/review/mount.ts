/** Mounts the dev-only review page (ROADMAP M1.G7); imported only behind `import.meta.env.DEV` (`main.ts`). */

import { mount } from 'svelte'
import Review from './Review.svelte'

export function mountReview(target: HTMLElement): ReturnType<typeof mount> {
  target.textContent = ''
  return mount(Review, { target })
}
