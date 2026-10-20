import type { Component, JSX } from "solid-js"
import { splitProps } from "solid-js"

/**
 * The DiveeOI mark — "Mark 02: Frame + Cursor".
 *
 * An open frame shaped like a "D" (the outline) with a solid inner "D" sitting
 * inside it (the cursor). The outline takes the surface colour; the inner
 * shape takes the accent. It reads at 16px, which is why it works as the app
 * icon, the favicon and the provider mark.
 *
 * Palette (from the brand sheet):
 *   charcoal  #121212   canvas
 *   off-white #EDEDEA   mark / primary text
 *   steel     #8A8F98   the "OI" of the wordmark
 *   orange    #FF5B1F   accent (tweakable)
 */
export type DiveeMarkProps = JSX.SVGElementTags["svg"] & {
  /**
   * `color`  - outline in the current text colour, inner shape in the accent.
   * `mono`   - one colour (the current text colour). This is the colourless
   *            variant used for the provider icon and for print-on-dark.
   * `inverted` - outline in off-white, inner shape in off-white; for dark
   *            backgrounds where the accent would be lost.
   */
  readonly variant?: "color" | "mono" | "inverted"
  /** Accent colour. Defaults to the `--divee-accent` variable, then #FF5B1F. */
  readonly accent?: string
  /** Accessible label. Omit for a decorative mark. */
  readonly title?: string
}

const FRAME = "M12 23V12H32A20 20 0 0 1 32 52H12V41"
const CURSOR = "M23 23H32A9 9 0 0 1 32 41H23Z"

export const DiveeMark: Component<DiveeMarkProps> = (props) => {
  const [local, rest] = splitProps(props, ["variant", "accent", "title", "class", "classList"])
  const variant = () => local.variant ?? "color"
  const accent = () => local.accent ?? "var(--divee-accent, #FF5B1F)"

  return (
    <svg
      data-component="divee-mark"
      data-variant={variant()}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={local.title}
      role={local.title ? "img" : undefined}
      aria-hidden={local.title ? undefined : "true"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      {...rest}
    >
      <path
        data-slot="divee-mark-frame"
        d={FRAME}
        stroke={variant() === "inverted" ? "#EDEDEA" : "currentColor"}
        stroke-width="8"
        stroke-linecap="butt"
      />
      <path
        data-slot="divee-mark-cursor"
        d={CURSOR}
        fill={variant() === "mono" ? "currentColor" : variant() === "inverted" ? "#EDEDEA" : accent()}
      />
    </svg>
  )
}
