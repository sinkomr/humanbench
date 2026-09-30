<!--
  The device check and the RT input mode (ROADMAP M1.15; DESIGN §8 `device`, §11.6, §13 "RT tasks offer
  a keyboard or touch mode; the mode is stored and normed separately"). It measures the screen
  refresh rate from animation frames (about a second) and the timer precision, lists the coarse
  facts a save keeps, and asks how the person will respond in the reaction tasks. Nothing is
  judged: the remarks only explain what will be less precise.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import type { RtInputMode } from '../render/rt/keys'
  import type { DeviceInfo } from '../save/types'
  import Screen from './Screen.svelte'
  import { DEVICE_CONTINUE, DEVICE_FACTS, DEVICE_HEADING, DEVICE_INPUT_KEYBOARD, DEVICE_INPUT_LEGEND, DEVICE_INPUT_TOUCH, DEVICE_INTRO, DEVICE_MEASURING } from './copy'
  import { checkDevice, defaultRtInput, deviceRemarks } from './device'
  import type { SessionEnv } from './env'

  interface Props {
    readonly env: SessionEnv
    readonly ondone: (info: DeviceInfo, input: RtInputMode) => void
  }

  let { env, ondone }: Props = $props()

  const uid = $props.id()
  let info: DeviceInfo | null = $state(null)
  let input: RtInputMode = $state('keyboard')

  onMount(() => {
    const denv = env.device()
    input = defaultRtInput(denv)
    let live = true
    void checkDevice({ env: denv, frames: env.realFrames, clock: env.realClock }, input).then((r) => {
      if (live) info = r
    })
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
  <p class="muted" role="status">{info === null ? DEVICE_MEASURING : ''}</p>
  {#if info !== null}
    <dl class="facts" aria-label="What was measured">
      <dt>{DEVICE_FACTS.class}</dt>
      <dd class="cap">{info.class}</dd>
      <dt>{DEVICE_FACTS.system}</dt>
      <dd>{info.os_family}, {info.browser_family}</dd>
      <dt>{DEVICE_FACTS.screen}</dt>
      <dd>{info.viewport[0]} × {info.viewport[1]}</dd>
      <dt>{DEVICE_FACTS.refresh}</dt>
      <dd>{info.refresh_hz_est === null ? 'not measured' : `${info.refresh_hz_est} Hz`}</dd>
      <dt>{DEVICE_FACTS.timer}</dt>
      <dd>{info.timer_res_ms === null ? 'not measured' : `${info.timer_res_ms} ms`}</dd>
    </dl>
    {#each remarks as remark (remark)}
      <p class="muted">{remark}</p>
    {/each}
  {/if}
  <form onsubmit={submit}>
    <fieldset>
      <legend>{DEVICE_INPUT_LEGEND}</legend>
      <label class="radio"><input type="radio" name="{uid}-input" value="keyboard" bind:group={input} /> {DEVICE_INPUT_KEYBOARD}</label>
      <label class="radio"><input type="radio" name="{uid}-input" value="touch" bind:group={input} /> {DEVICE_INPUT_TOUCH}</label>
    </fieldset>
    <div class="hb-actions">
      <button type="submit" class="hb-btn hb-primary" disabled={info === null}>{DEVICE_CONTINUE}</button>
    </div>
  </form>
</Screen>

<style>
  .cap {
    text-transform: capitalize;
  }
</style>
