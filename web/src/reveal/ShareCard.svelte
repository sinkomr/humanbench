<!--
  The share card (DESIGN §9.9, §10; ROADMAP M1.18; R-5.6.1, R-5.6.4): a 1200 × 630 picture of the
  profile that the person can hide any skill from, downloaded as a 2400 × 1260 PNG (2×) or as an SVG,
  or passed to the device's share sheet. Everything is made here, on this device: no request, no
  image server. The card itself (`viz/card.ts`) draws only skills that are ticked and measured, never
  an Emotion Reading estimate below the 0 SD ring, and holds no notes text, resource line or save
  data: this component has no way to hand it any.

  The PNG is prepared shortly after the card changes (debounced), so that the download and share
  buttons act inside the click, where iOS wants them. The SVG is always ready.
-->
<script lang="ts">
  import type { AxisCode } from '../engine/axes'
  import { wallClockMs } from '../save/clock'
  import { buildCard, cardAxes, cardSvg, CARD_H, CARD_W, EMO_CODE, MIN_CARD_SKILLS, PNG_SCALE, type CardPeak } from '../viz/card'
  import { canShareImage, cardFileName, downloadBlob, PNG_H, PNG_W, shareImage, svgBlob, svgDataUrl, svgToPng, type ImageShareOutcome, type Raster } from '../viz/export'
  import type { ThemeName } from '../viz/palette'
  import type { AxisEstimate } from '../viz/profile'
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
    shareCount,
    sharePngDone,
    shareTooFew,
  } from './copy'
  import './reveal.css'

  interface Props {
    /** All 17 estimates in spoke order (`axisEstimates`). */
    readonly estimates: readonly AxisEstimate[]
    /** The credible peaks of the whole measured profile, strongest first (`distinctivePeaks`). */
    readonly peaks: readonly CardPeak[]
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
    peaks,
    sessions,
    makePng = (svg, w, h) => svgToPng(svg, w, h),
    download = (blob, name) => downloadBlob(blob, name),
    shareFile = (blob, name) => shareImage(blob, name),
    canShare = canShareImage(),
    prepareMs = 250,
    today = () => new Date(wallClockMs()),
  }: Props = $props()

  const uid = $props.id()
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
  const card = $derived(shownCount >= MIN_CARD_SKILLS ? buildCard({ estimates, hidden, peaks, sessions, theme }) : null)
  const previewUrl = $derived(card === null ? '' : svgDataUrl(card.svg))

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

  <p class="hb-status" role="status" data-count>{card === null ? shareTooFew(shownCount, MIN_CARD_SKILLS) : shareCount(shownCount)}</p>

  {#if card !== null}
    <figure class="preview">
      <img src={previewUrl} alt={card.alt} width={CARD_W} height={CARD_H} data-preview />
    </figure>
  {/if}

  <div class="hb-actions">
    <button type="button" class="hb-btn hb-primary" disabled={png === null} onclick={savePng}>{SHARE_PNG}</button>
    <button type="button" class="hb-btn" disabled={card === null} onclick={saveSvg}>{SHARE_SVG}</button>
    {#if canShare}
      <button type="button" class="hb-btn" disabled={png === null} onclick={() => void sharePng()}>{SHARE_SHARE}</button>
    {/if}
  </div>
  {#if card !== null && png === null && !pngFailed}
    <p class="note" data-preparing>{SHARE_PREPARING}</p>
  {/if}
  {#if pngFailed}
    <p class="error" role="alert">{SHARE_PNG_FAILED}</p>
  {/if}
  <p class="hb-status" role="status" data-message>{message}</p>
  <p class="note">{SHARE_SIZES}</p>
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
</style>
