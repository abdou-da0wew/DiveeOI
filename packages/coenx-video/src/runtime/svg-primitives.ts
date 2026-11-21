import type { Paint, VisualNode } from "../model/types"
import { renderFontFamilyName } from "../fonts/catalog"
import { isGradientPaint } from "../render/paint"

export const SVG_NS = "http://www.w3.org/2000/svg"

export function element<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number | undefined>,
) {
  const node = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) node.setAttribute(key, String(value))
  }
  return node
}

export function textElement(node: Extract<VisualNode, { kind: "text" | "button" }>, value: string) {
  const textNode = element("text", {
    "text-anchor":
      "align" in node && node.align === "left" ? "start" : "align" in node && node.align === "right" ? "end" : "middle",
    "dominant-baseline": "middle",
    fill: node.color ?? "#ffffff",
    "font-family": renderFontFamilyName(node.fontFamily ?? "Geist", node.fontWeight ?? 500),
    "font-size": node.fontSize ?? (node.kind === "button" ? 18 : 32),
    "font-weight": node.fontWeight ?? 500,
  })
  const lines = value.split("\n")
  const lineHeight = (node.fontSize ?? 32) * 1.2
  const firstY = -((lines.length - 1) * lineHeight) / 2
  for (const [index, line] of lines.entries()) {
    const span = element("tspan", { x: 0, y: firstY + index * lineHeight })
    span.textContent = line
    textNode.append(span)
  }
  return textNode
}

export function paintValue(
  paint: Paint | undefined,
  id: string,
  fallback: string,
  definitions: SVGDefsElement,
  width: number,
  height: number,
) {
  if (!isGradientPaint(paint)) return paint ?? fallback
  const localX = (value: number) => Number(((value - 0.5) * width).toFixed(4))
  const localY = (value: number) => Number(((value - 0.5) * height).toFixed(4))
  const gradient =
    paint.type === "linear"
      ? element("linearGradient", {
          id,
          x1: localX(paint.from[0]),
          y1: localY(paint.from[1]),
          x2: localX(paint.to[0]),
          y2: localY(paint.to[1]),
          gradientUnits: "userSpaceOnUse",
        })
      : element("radialGradient", {
          id,
          cx: localX(paint.center[0]),
          cy: localY(paint.center[1]),
          r: Number((paint.radius * Math.min(width, height)).toFixed(4)),
          gradientUnits: "userSpaceOnUse",
        })
  for (const stop of paint.stops) {
    gradient.append(
      element("stop", {
        offset: `${stop.offset * 100}%`,
        "stop-color": stop.color,
        "stop-opacity": stop.opacity,
      }),
    )
  }
  definitions.append(gradient)
  return `url(#${id})`
}
