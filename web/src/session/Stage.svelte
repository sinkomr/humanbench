<!--
  Hosts the renderer of one item or block (ROADMAP M1.15, M1.13, A18): looked up by family name in
  the visual and entry maps, mounted afresh for every item with {#key} (the entry renderers report
  `onshown` once per mount and only accept an answer typed after it; `render/entry.ts`), and given
  the item's `spec` only, never the key. The renderers' frame timestamps are on the real
  `performance.now()` timeline; `scale` puts them on the session's (1 outside the `?fast=1` dev
  flag). Fixed blocks get the session's timing (scaled with the same factor) and the input mode
  of the device check.
-->
<script lang="ts">
  import type { RendererTiming } from '../render/common/props'
  import { entryRenderer } from '../render/entry'
  import type { RtInputMode, RtInputType } from '../render/rt/keys'
  import { VISUAL_RENDERERS } from '../render/visual'

  interface Props {
    readonly family: string
    /** Mount key: a new id mounts the renderer afresh. */
    readonly itemId: string
    readonly spec: object
    /** A fixed block (span, RT, coding, reading) rather than a power item. */
    readonly block?: boolean
    readonly scale: number
    readonly timing: RendererTiming
    readonly disabled?: boolean
    readonly inputMode?: RtInputMode
    readonly onrespond: (response: unknown) => void
    /** First frame that showed the item, on the session timeline. */
    readonly onshown?: (onsetMs: number) => void
    readonly onunavailable?: () => void
    readonly onpaste?: (itemId: string) => void
    readonly oninputtype?: (type: RtInputType) => void
  }

  let { family, itemId, spec, block = false, scale, timing, disabled = false, inputMode, onrespond, onshown, onunavailable, onpaste, oninputtype }: Props = $props()

  const Renderer = $derived((VISUAL_RENDERERS as Readonly<Record<string, import('svelte').Component<any> | undefined>>)[family] ?? entryRenderer(family))
</script>

{#key itemId}
  {#if Renderer === undefined}
    <p class="hb-render error" role="alert">This question type is not available in this version.</p>
  {:else if block}
    <Renderer {spec} {onrespond} {timing} {inputMode} {oninputtype} />
  {:else}
    <Renderer
      {spec}
      {onrespond}
      {disabled}
      {onunavailable}
      onshown={(ts: number) => onshown?.(ts * scale)}
      onpaste={() => onpaste?.(itemId)}
    />
  {/if}
{/key}
