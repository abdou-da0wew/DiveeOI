import type { Component, JSX } from "solid-js"
import { splitProps } from "solid-js"

/**
 * The Divee wordmark.
 *
 * Divee is the built-in model router (DiveeComposer): one entry the user picks, which routes
 * to the best free model that is actually reachable. It gets its own mark so the routed models
 * are recognisable at a glance in every provider and model list.
 *
 * The letterforms follow the same construction as the app's other wordmark: a flat geometric
 * sans on a 73.85 wide / 110.77 advance grid, 36.86 stroke, cap height 18.43 to 110.57, with
 * a squared bowl on the D and a solid chevron for the V. The fill is a vertical gradient that
 * fades toward the baseline with a soft glow underneath, rather than a flat silhouette.
 *
 * The mark spells the product name (DiveeOI); the provider it labels is the shorter "Divee".
 */
export type DiveeWordmarkProps = JSX.SVGElementTags["svg"] & {
  /** Accessible label. Omit for a decorative mark. */
  readonly title?: string
}

const VIEWBOX = "0 0 738.466 129.001"

// D I V E E O I — all on the shared grid.
const PATH = [
  // D
  "M55.384 36.8571H18.461V92.1429H55.384V36.8571Z",
  "M73.846 110.571H0V18.4286H55.384V0H73.846V110.571Z",
  // I
  "M129.232 18.4297H166.154V110.573H129.232Z",
  // V
  "M221.54 18.4297H240.002L257.463 92.1429L274.924 18.4297H295.386L257.463 110.573Z",
  // E
  "M406.156 73.7154H350.772V92.144H406.156V110.573H332.31V18.4297H406.156V73.7154Z",
  "M350.772 55.2868H387.695V36.8583H350.772V55.2868Z",
  // E
  "M516.926 73.7154H461.542V92.144H516.926V110.573H443.08V18.4297H516.926V73.7154Z",
  "M461.542 55.2868H498.465V36.8583H461.542V55.2868Z",
  // O
  "M627.69 110.573H553.844V18.4297H627.69V110.573Z",
  "M609.229 36.8583H572.306V92.144H609.229V36.8583Z",
  // I
  "M683.082 18.4297H720.004V110.573H683.082Z",
].join("")

export const DiveeWordmark: Component<DiveeWordmarkProps> = (props) => {
  const [local, rest] = splitProps(props, ["title", "class", "classList"])
  return (
    <svg
      data-component="divee-wordmark"
      viewBox={VIEWBOX}
      fill="none"
      preserveAspectRatio="none"
      aria-label={local.title}
      role={local.title ? "img" : undefined}
      aria-hidden={local.title ? undefined : "true"}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      {...rest}
    >
      <defs>
        <linearGradient id="divee-wordmark-fill" x1="369" y1="0" x2="369" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="currentColor" stop-opacity="1" />
          <stop offset="0.55" stop-color="currentColor" stop-opacity="0.82" />
          <stop offset="1" stop-color="currentColor" stop-opacity="0.28" />
        </linearGradient>
        <filter id="divee-wordmark-glow" x="-6%" y="-24%" width="112%" height="150%" color-interpolation-filters="sRGB">
          <feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-color="currentColor" flood-opacity="0.28" />
        </filter>
      </defs>
      <path d={PATH} fill="url(#divee-wordmark-fill)" filter="url(#divee-wordmark-glow)" />
    </svg>
  )
}
