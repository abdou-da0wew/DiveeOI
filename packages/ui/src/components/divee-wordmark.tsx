import type { Component, JSX } from "solid-js"
import { splitProps } from "solid-js"

/**
 * The DiveeOI typography lockup.
 *
 * "Divee" in Bebas Neue (tight tracking) with "OI" in the same face at normal
 * tracking, in steel gray. Bebas Neue is an all-caps face, so the lockup reads
 * DIVEEOI. The face is loaded by the app shell; the stack falls back to Impact
 * so the lockup still has the right proportions without the webfont.
 *
 * Colours follow the brand sheet: the wordmark takes the surface colour and
 * the "OI" suffix takes steel gray (#8A8F98), overridable with
 * `--divee-wordmark-muted`.
 */
export type DiveeWordmarkProps = JSX.SVGElementTags["svg"] & {
  /** Accessible label. Omit for a decorative mark. */
  readonly title?: string
  /** Colour of the "OI" suffix. Defaults to `--divee-wordmark-muted`, then steel. */
  readonly muted?: string
}

export const DiveeWordmark: Component<DiveeWordmarkProps> = (props) => {
  const [local, rest] = splitProps(props, ["title", "muted", "class", "classList"])

  return (
    <svg
      data-component="divee-wordmark"
      viewBox="0 0 268 84"
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
      <text
        x="0"
        y="68"
        font-family="'Bebas Neue', Impact, 'Arial Narrow', sans-serif"
        font-weight="400"
        font-size="80"
        letter-spacing="-3.5"
        fill="currentColor"
      >
        Divee
        <tspan letter-spacing="0" fill={local.muted ?? "var(--divee-wordmark-muted, #8A8F98)"}>
          OI
        </tspan>
      </text>
    </svg>
  )
}
