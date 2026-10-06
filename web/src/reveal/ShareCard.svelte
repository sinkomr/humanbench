<!--
  The share card (DESIGN §9.9, §10; ROADMAP M1.18; R-5.6.1, R-5.6.4): a 1200 × 630 picture of the
  profile that the person can hide any skill from, downloaded as a 2400 × 1260 PNG (2×) or as an SVG,
  or passed to the device's share sheet. Everything is made here, on this device: no request, no
  image server. The card itself (`viz/card.ts`) draws only skills that are ticked and measured, never
  an Emotion Reading estimate below the 0 SD ring, and holds no notes text, resource line or save
  data: this component has no way to hand it any. The card's peaks are worked out here from the
  score over the skills on the card ONLY (a mean over a hidden skill or a withheld Emotion Reading
  would carry its level into the visible numbers), again after every tick.

  The PNG is prepared shortly after the card changes (debounced), so that the download and share
  buttons act inside the click, where iOS wants them. The SVG is always ready. While the PNG is
  being prepared its buttons are `aria-disabled` (still in the Tab order, clicks ignored, the
  "Preparing" note as their description) rather than `disabled`, which Tab would skip (UX-032).
  With fewer than the minimum of measured skills there is nothing to tick: the panel says what a
  card needs instead. A link opens the card at full size in a new tab (the preview is a thumbnail on
  a phone). The count line is mounted empty and filled a moment later, with its number in a
  `translate="no"` element: a page translator replaces text nodes, and a number written into a
  replaced node never shows.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { N_AXES, type AxisCode } from '../engine/axes'
  import { wallClockMs } from '../save/clock'
  import { buildCard, cardAxes, cardSvg, CARD_H, CARD_W, EMO_CODE, MIN_CARD_SKILLS, PNG_SCALE } from '../viz/card'
  import { canShareImage, cardFileName, downloadBlob, PNG_H, PNG_W, shareImage, svgBlob, svgDataUrl, svgToPng, type ImageShareOutcome, type Raster } from '../viz/export'
  import type { ThemeName } from '../viz/palette'
  import type { AxisEstimate, ProfileScore } from '../viz/profile'
  import {
    SHARE_COLOURS_LEGEND,
    SHARE_DARK,
    SHARE_HIDE_ALL,
    SHARE_INTRO,
    SHARE_LIGHT,
    SHARE_PNG,
    SHARE_PNG_FAILED,
    SHARE_PREPARING,
    SHARE_SHARE,
    SHARE_SHARE_CANCELLED,
    SHARE_SHARE_FAILED,
    SHARE_SHARED,
    SHARE_SHOW_ALL,
    SHARE_SIZES,
    SHARE_SKILLS_HELP,
    SHARE_SKILLS_LEGEND,
    SHARE_SVG,
    SHARE_SVG_DONE,
    SHARE_EMO_RULE,
    SHARE_FULLSIZE,
    shareCountParts,
    shareNeedsMore,
    sharePngDone,
    shareTooFewParts,
  } from './copy'
  import { distinctivePeaks } from './peaks'
  import './reveal.css'

  interface Props {
    /** All 17 estimates in spoke order (`axisEstimates`). */
    readonly estimates: readonly AxisEstimate[]
    /** The score the estimates came from: the peaks are worked out from it over the skills on the card. */
    readonly score: ProfileScore
    /** Sessions the profile rests on. */
    readonly sessions: number
    /** Injectable for tests: rasterise the card's SVG (default: a canvas). */
    readonly makePng?: (svg: string, width: number, height: number) => Promise<Raster>
    /** Injectable for tests: save a file (default: `<a download>`). */
    readonly download?: (blob: Blob, name: string) => void
    /** Injectable for tests: hand the PNG to the share sheet. */
    readonly shareFile?: (blob: Blob, name: string) => Promise<ImageShareOutcome>
    /** Whether to offer the share sheet (default: where the browser takes image files). */
    readonly canShare?: boolean
    /** Wait after a change before the PNG is made, in ms. */
    readonly prepareMs?: number
    /** Injectable for tests: the date in the file names. */
    readonly today?: () => Date
  }

  let {
    estimates,
    score,
    sessions,
    makePng = (svg, w, h) => svgToPng(svg, w, h),
    download = (blob, name) => downloadBlob(blob, name),
    shareFile = (blob, name) => shareImage(blob, name),
    canShare = canShareImage(),
    prepareMs = 250,
    today = () => new Date(wallClockMs()),
  }: Props = $props()

  const uid = $props.id()
  /** How long after mount the count line gets its text: the live region has to exist, empty, before its text arrives. */
  const COUNT_AFTER_MS = 100
  let counted = $state(false)
  onMount(() => {
    const timer = setTimeout(() => (counted = true), COUNT_AFTER_MS)
    return () => clearTimeout(timer)
  })
  let hidden = $state<AxisCode[]>([])
  let theme = $state<ThemeName>('light')
  let message = $state('')
  let png = $state<Raster | null>(null)
  let pngFailed = $state(false)

  const axes = $derived(cardAxes(estimates, hidden))
  const offered = $derived(axes.filter((a) => a.status === 'shown' || a.status === 'hidden'))
  // Emotion Reading, when it was measured (R-5.6.4: never on a card below the 0 SD ring).
  const emo = $derived(axes.find((a) => a.estimate.code === EMO_CODE && a.status !== 'unmeasured'))
  const shownCount = $derived(axes.filter((a) => a.status === 'shown').length)
  const shownCodes = $derived(axes.filter((a) => a.status === 'shown').map((a) => a.estimate.code))
  // Peaks against the mean of the skills on the card, so no hidden or withheld skill's level shows in them (A12, R-5.6.4).
  const peaks = $derived(shownCount >= MIN_CARD_SKILLS ? distinctivePeaks(score, shownCodes, { max: N_AXES }) : [])
  const card = $derived(shownCount >= MIN_CARD_SKILLS ? buildCard({ estimates, hidden, peaks, sessions, theme }) : null)
  const previewUrl = $derived(card === null ? '' : svgDataUrl(card.svg))
  // Fewer measured skills than a card needs: nothing to tick, so the panel says what would unlock one (UX-032).
  const needsMore = $derived(offered.length < MIN_CARD_SKILLS)
  const preparing = $derived(card !== null && png === null && !pngFailed)

  // The card at full size, in a new tab: the SVG, which is ready with the preview. Not every environment has object URLs.
  let fullUrl = $state('')
  $effect(() => {
    const c = card
    fullUrl = ''
    if (c === null || typeof URL.createObjectURL !== 'function') return
    let url = ''
    try {
      url = URL.createObjectURL(svgBlob(c.svg))
    } catch {
      return
    }
    fullUrl = url
    return () => URL.revokeObjectURL(url)
  })

  // The PNG for the card as it is now, made a moment after the last change.
  $effect(() => {
    const c = card
    png = null
    pngFailed = false
    if (c === null) return
    const svg = cardSvg(c, PNG_SCALE)
    let live = true
    const timer = setTimeout(() => {
      makePng(svg, PNG_W, PNG_H).then(
        (r) => {
          if (live) png = r
        },
        () => {
          if (live) pngFailed = true
        },
      )
    }, prepareMs)
    return () => {
      live = false
      clearTimeout(timer)
    }
  })

  function toggle(code: AxisCode, on: boolean): void {
    message = ''
    hidden = on ? hidden.filter((c) => c !== code) : [...hidden.filter((c) => c !== code), code]
  }

  function showAll(): void {
    message = ''
    hidden = []
  }

  function hideAll(): void {
    message = ''
    hidden = offered.map((a) => a.estimate.code)
  }

  function savePng(): void {
    if (png === null) return
    download(png.blob, cardFileName('png', today()))
    message = sharePngDone(png.width, png.height)
  }

  function saveSvg(): void {
    if (card === null) return
    download(svgBlob(card.svg), cardFileName('svg', today()))
    message = SHARE_SVG_DONE
  }

  // Straight into the share sheet: the first statement reaches it before any await.
  async function sharePng(): Promise<void> {
    if (png === null) return
    const outcome = await shareFile(png.blob, cardFileName('png', today()))
    message = outcome === 'shared' ? SHARE_SHARED : outcome === 'cancelled' ? SHARE_SHARE_CANCELLED : SHARE_SHARE_FAILED
  }
</script>

<div class="share" data-share-card>
  <p>{SHARE_INTRO}</p>

  {#if needsMore}
    <p class="needs-more" data-needs-more>{shareNeedsMore(MIN_CARD_SKILLS, offered.length)}</p>
    {#if emo !== undefined}
      <p class="note emo-rule" data-emo-rule data-withheld={emo.status === 'withheld' ? emo.estimate.code : undefined}><strong>{emo.estimate.name}:</strong> {SHARE_EMO_RULE}</p>
    {/if}
  {:else}
    <fieldset class="skills" aria-describedby="{uid}-help">
      <legend>{SHARE_SKILLS_LEGEND}</legend>
      <p class="note" id="{uid}-help">{SHARE_SKILLS_HELP}</p>
      <div class="hb-actions">
        <button type="button" class="hb-btn" onclick={showAll}>{SHARE_SHOW_ALL}</button>
        <button type="button" class="hb-btn" onclick={hideAll}>{SHARE_HIDE_ALL}</button>
      </div>
      <div class="grid">
        {#each offered as a (a.estimate.code)}
          <label>
            <input
              type="checkbox"
              checked={a.status === 'shown'}
              data-skill={a.estimate.code}
              onchange={(e) => toggle(a.estimate.code, e.currentTarget.checked)}
            />
            <span>{a.estimate.name}</span>
          </label>
        {/each}
      </div>
      {#if emo !== undefined}
        <!-- The rule is stated the same way whatever the estimate is, so the note itself says nothing about it. -->
        <p class="note emo-rule" data-emo-rule data-withheld={emo.status === 'withheld' ? emo.estimate.code : undefined}><strong>{emo.estimate.name}:</strong> {SHARE_EMO_RULE}</p>
      {/if}
    </fieldset>

    <fieldset class="colours">
      <legend>{SHARE_COLOURS_LEGEND}</legend>
      <label><input type="radio" name="{uid}-colours" value="light" checked={theme === 'light'} onchange={() => (theme = 'light')} /> <span>{SHARE_LIGHT}</span></label>
      <label><input type="radio" name="{uid}-colours" value="dark" checked={theme === 'dark'} onchange={() => (theme = 'dark')} /> <span>{SHARE_DARK}</span></label>
    </fieldset>

    <p class="hb-status" role="status" data-count>
      {#if counted}
        {#if card === null}
          {@const [before, n, after] = shareTooFewParts(shownCount, MIN_CARD_SKILLS)}
          {before}<span translate="no">{n}</span>{after}
        {:else}
          {@const [n, rest] = shareCountParts(shownCount)}
          <span translate="no">{n}</span>{rest}
        {/if}
      {/if}
    </p>

    {#if card !== null}
      <figure class="preview">
        <img src={previewUrl} alt={card.alt} width={CARD_W} height={CARD_H} data-preview />
      </figure>
      {#if fullUrl !== ''}
        <p class="note fullsize"><a href={fullUrl} target="_blank" rel="noopener" data-fullsize>{SHARE_FULLSIZE}</a></p>
      {/if}
    {/if}

    <div class="hb-actions">
      <button
        type="button"
        class="hb-btn hb-primary"
        disabled={card === null || pngFailed}
        aria-disabled={preparing ? 'true' : undefined}
        aria-describedby={preparing ? `${uid}-preparing` : undefined}
        onclick={savePng}>{SHARE_PNG}</button
      >
      <button type="button" class="hb-btn" disabled={card === null} onclick={saveSvg}>{SHARE_SVG}</button>
      {#if canShare}
        <button
          type="button"
          class="hb-btn"
          disabled={card === null || pngFailed}
          aria-disabled={preparing ? 'true' : undefined}
          aria-describedby={preparing ? `${uid}-preparing` : undefined}
          onclick={() => void sharePng()}>{SHARE_SHARE}</button
        >
      {/if}
    </div>
    {#if preparing}
      <p class="note" id="{uid}-preparing" data-preparing>{SHARE_PREPARING}</p>
    {/if}
    {#if pngFailed}
      <p class="error" role="alert">{SHARE_PNG_FAILED}</p>
    {/if}
    <p class="hb-status" role="status" data-message>{message}</p>
    <p class="note">{SHARE_SIZES}</p>
  {/if}
</div>

<style>
  .share > p:first-child {
    margin-top: 0;
  }
  fieldset {
    margin: 0.75rem 0;
    padding: 0.5rem 0.75rem 0.75rem;
    border: 1px solid var(--r-border);
    border-radius: 0.5rem;
    min-width: 0;
  }
  legend {
    padding: 0 0.25rem;
    font-weight: 600;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(15rem, 100%), 1fr));
    gap: 0 0.75rem;
    margin-top: 0.5rem;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
  }
  input[type='checkbox'],
  input[type='radio'] {
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
    margin: 0;
  }
  .colours {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1.5rem;
  }
  .emo-rule {
    margin: 0.5rem 0 0;
  }
  .preview {
    margin: 0.5rem 0;
  }
  .preview img {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1200 / 630;
    border: 1px solid var(--r-border);
    border-radius: 0.5rem;
  }
  .error {
    color: var(--r-note);
  }
  .hb-btn[aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .fullsize {
    margin: 0 0 0.5rem;
  }
  .fullsize a {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    color: var(--r-accent);
  }
</style>
