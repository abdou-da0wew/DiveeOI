import type { Paint } from "../model/types"
import { isGradientPaint, spreadKind, transformGradientPoint, transformGradientRadius } from "../render/paint"

/** Browser-only paint resolution for the Canvas backend (kept out of the DOM-free paint module). */
export function canvasPaint(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  paint: Paint | undefined,
  fallback: string,
): string | CanvasGradient {
  if (!isGradientPaint(paint)) return (typeof paint === "string" ? paint : fallback) ?? fallback
  const localX = (value: number) => (value - 0.5) * width
  const localY = (value: number) => (value - 0.5) * height
  const gradient =
    paint.type === "linear"
      ? context.createLinearGradient(
          localX(transformGradientPoint(paint.from, paint.transform)[0]),
          localY(transformGradientPoint(paint.from, paint.transform)[1]),
          localX(transformGradientPoint(paint.to, paint.transform)[0]),
          localY(transformGradientPoint(paint.to, paint.transform)[1]),
        )
      : context.createRadialGradient(
          localX(transformGradientPoint(paint.center, paint.transform)[0]),
          localY(transformGradientPoint(paint.center, paint.transform)[1]),
          0,
          localX(transformGradientPoint(paint.center, paint.transform)[0]),
          localY(transformGradientPoint(paint.center, paint.transform)[1]),
          transformGradientRadius(paint.radius * Math.min(width, height), paint.transform),
        )
  for (const stop of paint.stops) {
    gradient.addColorStop(stop.offset, stop.opacity === undefined ? withAlpha(stop.color, 1) : withAlpha(stop.color, stop.opacity))
  }
  return gradient
}

/**
 * Canvas gradients only implement pad semantics. When a composition uses
 * repeat/reflect the Canvas backend documents this as an explicit partial
 * capability (see capabilities.ts) and callers warn instead of silently
 * approximating; SVG and native Cairo implement all three modes exactly.
 */
export function canvasSpreadWarning(paint: Paint | undefined): string | undefined {
  if (!isGradientPaint(paint)) return undefined
  return spreadKind(paint.spread) === "pad"
    ? undefined
    : `Canvas backend only supports pad spread; gradient uses ${paint.spread} and will render with pad semantics`
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
