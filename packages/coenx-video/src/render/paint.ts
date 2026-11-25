import type { GradientPaint, GradientStop, Paint } from "../model/types"

export function isGradientPaint(value: Paint | undefined): value is GradientPaint {
  return typeof value === "object" && value !== null && (value.type === "linear" || value.type === "radial")
}

export function canvasPaint(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  paint: Paint | undefined,
  fallback: string,
): string | CanvasGradient {
  if (!isGradientPaint(paint)) return paint ?? fallback
  const localX = (value: number) => (value - 0.5) * width
  const localY = (value: number) => (value - 0.5) * height
  const gradient =
    paint.type === "linear"
      ? context.createLinearGradient(
          localX(paint.from[0]),
          localY(paint.from[1]),
          localX(paint.to[0]),
          localY(paint.to[1]),
        )
      : context.createRadialGradient(
          localX(paint.center[0]),
          localY(paint.center[1]),
          0,
          localX(paint.center[0]),
          localY(paint.center[1]),
          paint.radius * Math.min(width, height),
        )
  for (const stop of paint.stops) {
    gradient.addColorStop(stop.offset, stop.opacity === undefined ? stop.color : withOpacity(stop.color, stop.opacity))
  }
  return gradient
}

export function cssPaint(paint: Paint | undefined, fallback: string) {
  if (!isGradientPaint(paint)) return paint ?? fallback
  const stops = paint.stops
    .map((stop) => {
      const color = stop.opacity === undefined ? stop.color : withOpacity(stop.color, stop.opacity)
      return `${color} ${percent(stop.offset)}`
    })
    .join(", ")
  if (paint.type === "radial") {
    return `radial-gradient(circle ${percent(paint.radius)} at ${percent(paint.center[0])} ${percent(paint.center[1])}, ${stops})`
  }
  const dx = paint.to[0] - paint.from[0]
  const dy = paint.to[1] - paint.from[1]
  const angle = (Math.atan2(dx, -dy) * 180) / Math.PI
  return `linear-gradient(${angle}deg, ${stops})`
}

export function svgPaint(paint: Paint | undefined, id: string, fallback: string, width = 1, height = 1) {
  if (!isGradientPaint(paint)) return { value: paint ?? fallback, definition: undefined }
  const stops = paint.stops.map(renderStop).join("")
  const localX = (value: number) => Number(((value - 0.5) * width).toFixed(4))
  const localY = (value: number) => Number(((value - 0.5) * height).toFixed(4))
  if (paint.type === "linear") {
    return {
      value: `url(#${id})`,
      definition: `<linearGradient id="${id}" x1="${localX(paint.from[0])}" y1="${localY(paint.from[1])}" x2="${localX(paint.to[0])}" y2="${localY(paint.to[1])}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`,
    }
  }
  return {
    value: `url(#${id})`,
    definition: `<radialGradient id="${id}" cx="${localX(paint.center[0])}" cy="${localY(paint.center[1])}" r="${Number((paint.radius * Math.min(width, height)).toFixed(4))}" gradientUnits="userSpaceOnUse">${stops}</radialGradient>`,
  }
}

function percent(value: number) {
  return `${Number((value * 100).toFixed(4))}%`
}

function renderStop(stop: GradientStop) {
  const hex = stop.color.slice(1)
  const rgb = hex.slice(0, 6)
  const embeddedAlpha = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
  const opacity = embeddedAlpha * (stop.opacity ?? 1)
  return `<stop offset="${percent(stop.offset)}" stop-color="#${rgb}" stop-opacity="${opacity}"/>`
}

function withOpacity(color: string, opacity: number) {
  const hex = color.replace("#", "")
  const parsed =
    hex.length === 3
      ? hex
          .split("")
          .map((value) => value + value)
          .join("")
      : hex
  if ((parsed.length !== 6 && parsed.length !== 8) || !/^[0-9a-f]+$/i.test(parsed)) return color
  const red = Number.parseInt(parsed.slice(0, 2), 16)
  const green = Number.parseInt(parsed.slice(2, 4), 16)
  const blue = Number.parseInt(parsed.slice(4, 6), 16)
  const embeddedAlpha = parsed.length === 8 ? Number.parseInt(parsed.slice(6, 8), 16) / 255 : 1
  return `rgba(${red}, ${green}, ${blue}, ${embeddedAlpha * Math.max(0, Math.min(1, opacity))})`
}

const NAMED_COLORS: Record<string, [number, number, number, number]> = {
  white: [255, 255, 255, 1],
  black: [0, 0, 0, 1],
  red: [255, 0, 0, 1],
  green: [0, 128, 0, 1],
  blue: [0, 0, 255, 1],
  transparent: [0, 0, 0, 0],
}

/** Extracts the alpha channel of any accepted color string; unknown colors count as opaque. */
export function colorAlpha(color: string): number {
  if (color === "none") return 0
  const named = NAMED_COLORS[color.trim().toLowerCase()]
  if (named) return named[3]
  const hex = color.trim().replace("#", "")
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .split("")
          .map((value) => value + value)
          .join("")
      : hex
  if ((expanded.length === 4 || expanded.length === 8) && /^[0-9a-f]+$/i.test(expanded)) {
    return Number.parseInt(expanded.slice(-2), 16) / 255
  }
  return 1
}

/**
 * Rewrites a gradient paint as white while preserving only its alpha channel.
 * SVG masks consume luminance by default; white-with-alpha yields the same
 * mask value in both luminance and alpha mask modes, so one serialized form is
 * correct everywhere without depending on `mask-type` support. Solid mask
 * shapes are emitted as white fills with fill-opacity by the callers.
 */
export function whiteAlphaPaint(paint: GradientPaint): GradientPaint {
  return {
    ...paint,
    stops: paint.stops.map((stop) => ({
      offset: stop.offset,
      color: "#ffffff",
      opacity: stop.opacity === undefined ? colorAlpha(stop.color) : stop.opacity * colorAlpha(stop.color),
    })),
  }
}
