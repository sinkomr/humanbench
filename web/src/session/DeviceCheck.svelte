<!--
  The device check and the RT input mode (ROADMAP M1.15; DESIGN §8 `device`, §11.6, §13 "RT tasks offer
  a keyboard or touch mode; the mode is stored and normed separately"). It measures the screen
  refresh rate from animation frames (about a second) and the timer precision, lists the coarse
  facts a save keeps, and asks how the person will respond in the reaction tasks. Nothing is
  judged: the remarks only explain what will be less precise.
  The choice and "Continue" come first and the facts after them, so "Continue" stays where it is when the
  measurement arrives (UX-013). "Continue" is not `disabled` while it measures (a disabled button leaves
  the tab order): it is `aria-disabled` and does nothing until the facts are in. The "checking" line sits
  in a status line that is on the page, empty, before its text is put in, so it is announced; and it is
  taken out when done, so a translated copy of it goes too.
  The refresh-rate measurement may already be done (provisional default, UX-REVIEW D23): the flow starts it
  while the 18+ gate and the honour screen are shown and hands it over as `probe`. Done, its rate is used at
  once and the facts are there when the screen opens, with nothing to wait for; still under way, the screen
  waits for what is left of it; hidden, cancelled, too old or without a rate, it measures here as it always did.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { RtInputMode } from '../render/rt/keys'
  import type { DeviceInfo } from '../save/types'
  import Screen from './Screen.svelte'
  import { DEVICE_CONTINUE, DEVICE_FACTS, DEVICE_HEADING, DEVICE_INPUT_KEYBOARD, DEVICE_INPUT_LEGEND, DEVICE_INPUT_TOUCH, DEVICE_INTRO, DEVICE_MEASURING } from './copy'
  import { defaultRtInput, describeDevice, deviceRemarks, measureHz, probeHz, type RefreshProbe } from './device'
  import type { SessionEnv } from './env'

  interface Props {
    readonly env: SessionEnv
    readonly ondone: (info: DeviceInfo, input: RtInputMode) => void
    /** The refresh-rate measurement the flow started on the gate (D23), if there is one. */
    readonly probe?: RefreshProbe | null
  }

  let { env, ondone, probe = null }: Props = $props()

  const uid = $props.id()
  let info: DeviceInfo | null = $state(null)
  let measuring = $state(false)
  let input: RtInputMode = $state('keyboard')

  onMount(() => {
    const denv = env.device()
    input = defaultRtInput(denv)
    const deps = { env: denv, frames: env.realFrames, clock: env.realClock }
    let live = true
    const finish = (hz: number | null): void => {
      if (!live) return
      info = describeDevice(deps, hz, input)
      measuring = false
    }
    // Measured on the gate: the facts are in before the first paint of this screen.
    const early = probeHz(probe, env.realClock.now())
    if (typeof early === 'number') {
      finish(early)
      return () => {
        live = false
      }
    }
    // After the status line is in the page, so the text that goes into it is announced.
    void tick().then(() => {
      if (live && info === null) measuring = true
    })
    const measure = (): void => void measureHz({ frames: env.realFrames }).then(finish)
    if (probe !== null && early === undefined) {
      // Still measuring: what is left of it, and a measurement of our own when it comes to nothing.
      void probe.done.then((hz) => (hz === null ? (live ? measure() : undefined) : finish(hz)))
    } else {
      measure()
    }
    return () => {
      live = false
    }
  })

  const remarks = $derived(info === null ? [] : deviceRemarks(info))

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    if (info !== null) ondone({ ...info, input }, input)
  }
</script>

<Screen title={DEVICE_HEADING}>
  <p>{DEVICE_INTRO}</p>
  <p class="muted measuring" role="status">{#if measuring}<span>{DEVICE_MEASURING}</span>{/if}</p>
  <form onsubmit={submit}>
    <fieldset>
      <legend>{DEVICE_INPUT_LEGEND}</legend>
      <label class="radio"><input type="radio" name="{uid}-input" value="keyboard" bind:group={input} /> {DEVICE_INPUT_KEYBOARD}</label>
      <label class="radio"><input type="radio" name="{uid}-input" value="touch" bind:group={input} /> {DEVICE_INPUT_TOUCH}</label>
    </fieldset>
    <div class="hb-actions">
      <button type="submit" class="hb-btn hb-primary" aria-disabled={info === null ? 'true' : undefined}>{DEVICE_CONTINUE}</button>
    </div>
  </form>
  {#if info !== null}
    <dl class="facts" aria-label="What was measured">
      <dt>{DEVICE_FACTS.class}</dt>
      <dd class="cap">{info.class}</dd>
      <dt>{DEVICE_FACTS.system}</dt>
      <dd>{info.os_family}, {info.browser_family}</dd>
      <dt>{DEVICE_FACTS.screen}</dt>
      <dd>{info.viewport[0]} × {info.viewport[1]}</dd>
      <dt>{DEVICE_FACTS.refresh}</dt>
      <dd>{info.refresh_hz_est === null ? 'not measured' : `${info.refresh_hz_est} Hz (screen updates per second)`}</dd>
      <dt>{DEVICE_FACTS.timer}</dt>
      <dd>{info.timer_res_ms === null ? 'not measured' : `${info.timer_res_ms} ms (thousandths of a second)`}</dd>
    </dl>
    {#each remarks as remark (remark)}
      <p class="muted">{remark}</p>
    {/each}
  {/if}
</Screen>

<style>
  .cap {
    text-transform: capitalize;
  }

  /* The line keeps its height when it empties, so the form below does not move. */
  .measuring {
    min-height: 1.5rem;
  }
</style>
