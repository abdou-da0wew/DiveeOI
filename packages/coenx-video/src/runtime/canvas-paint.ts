import type { GradientPaint, Paint } from "../model/types"
import { isGradientPaint } from "../render/paint"

/** Browser-only paint resolution for the Canvas backend (kept out of the DOM-free paint module). */
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
    gradient.addColorStop(stop.offset, stop.opacity === undefined ? withAlpha(stop.color, 1) : withAlpha(stop.color, stop.opacity))
  }
  return gradient
}


function withAlpha(color: string, opacity: number) {
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
