import { type ComponentProps } from "solid-js"
import { DiveeMark } from "./divee-mark"
import { DiveeWordmark } from "./divee-wordmark"

/**
 * DiveeOI logo assets.
 *
 * `Mark` is the compact mark (frame + cursor) for small spaces, `Logo` is the
 * full lockup with the wordmark, and `Splash` is the large standalone mark for
 * hero areas. All of them take the current text colour, so they follow the
 * theme; the mark's accent comes from `--divee-accent`.
 */

export const Mark = (props: { class?: string; title?: string }) => {
  return <DiveeMark class={props.class} title={props.title} />
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return <DiveeMark ref={props.ref} class={props.class} />
}

export const Logo = (props: { class?: string; title?: string }) => {
  return (
    // The lockup scales with the font size of its container, so a caller can make it
    // bigger with a text size instead of fighting two fixed pixel sizes.
    <div class={`flex items-center gap-3 ${props.class ?? ""}`}>
      <DiveeMark class="h-[1.3em] w-[1.3em] shrink-0" />
      <DiveeWordmark class="h-[1em] w-auto" title={props.title} />
    </div>
  )
}
