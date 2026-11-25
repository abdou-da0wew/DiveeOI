import type {
  ClipPathDefinition,
  GradientPaint,
  GradientStop,
  MaskDefinition,
  MaskShape,
  PaintResource,
  PathCommand,
  PathDefinition,
} from "../model/types"
import { childElements, elementText, type CmlElement } from "./markup"

/** Parses a bounded SVG-like path data string into model PathCommands. */
export function parsePathD(d: string, budget = 256): PathCommand[] {
  const commands: PathCommand[] = []
  const tokens = d.trim().split(/[\s,]+/).filter(Boolean)
  let index = 0
  const number = () => {
    const raw = tokens[index++]
    if (raw === undefined) throw new Error("path data ended unexpectedly")
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) throw new Error(`path data contains a non-finite number: ${raw}`)
    return parsed
  }
  const point = (): [number, number] => {
    const x = number()
    const y = number()
    return [x, y]
  }
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === undefined) break
    if (index >= budget) throw new Error(`path data exceeds ${budget} commands`)
    index++
    switch (token.toUpperCase()) {
      case "M":
        commands.push({ type: "moveTo", point: point() })
        break
      case "L":
        commands.push({ type: "lineTo", point: point() })
        break
      case "Q": {
        const control = point()
        const to = point()
        commands.push({ type: "quadraticTo", control, to })
        break
      }
      case "C": {
        const control1 = point()
        const control2 = point()
        const to = point()
        commands.push({ type: "cubicTo", control1, control2, to })
        break
      }
      case "Z":
        commands.push({ type: "close" })
        break
      default:
        throw new Error(`unsupported path command ${token} (allowed: M L Q C Z)`)
    }
  }
  return commands
}

function number(value: string | undefined, label: string, fallback?: number) {
  if (value === undefined) {
    if (fallback !== undefined) return fallback
    throw new Error(`${label} is required`)
  }
  const parsed = Number(value.replace(/px$/, ""))
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`)
  return parsed
}

function viewBox(value: string | undefined, label: string): { width: number; height: number } {
  const raw = value ?? "100x100"
  const parts = raw.split(/[x,]/).map((item) => Number(item))
  if (parts.length !== 2 || parts.some((item) => !Number.isFinite(item) || item <= 0))
    throw new Error(`${label} must be "WIDTHxHEIGHT" with positive numbers`)
  return { width: parts[0]!, height: parts[1]! }
}

function parsePoint(value: string | undefined, label: string, fallback: [number, number]): [number, number] {
  if (value === undefined) return fallback
  const parts = value.split(",").map((item) => Number(item))
  if (parts.length !== 2 || parts.some((item) => !Number.isFinite(item)))
    throw new Error(`${label} must be "x,y" with finite numbers`)
  return [parts[0]!, parts[1]!]
}

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/

/**
 * Compiles a scene <defs> block into reusable resources: <path>, <clip>,
 * <mask> (with shape children) and <gradient> paint resources. Node elements
 * reference them through clip="id", mask="id" and fill="url(#id)".
 */
export function compileSceneDefs(defs: CmlElement): {
  pathDefinitions: PathDefinition[]
  clipPaths: ClipPathDefinition[]
  masks: MaskDefinition[]
  paints: PaintResource[]
} {
  const pathDefinitions: PathDefinition[] = []
  const clipPaths: ClipPathDefinition[] = []
  const masks: MaskDefinition[] = []
  const paints: PaintResource[] = []
  const ids = new Set<string>()
  const requireId = (element: CmlElement) => {
    const id = element.attributes.id
    if (!id || !ID.test(id)) throw new Error(`<${element.tag}> defs element needs a valid id`)
    if (ids.has(id)) throw new Error(`duplicate defs id ${id}`)
    ids.add(id)
    return id
  }

  for (const element of childElements(defs)) {
    switch (element.tag) {
      case "path": {
        const id = requireId(element)
        const size = viewBox(element.attributes.viewBox, `<path ${id}> viewBox`)
        const commands = parsePathD(element.attributes.d ?? elementText(element))
        pathDefinitions.push({
          id,
          width: size.width,
          height: size.height,
          commands,
          ...(element.attributes["fill-rule"] ? { fillRule: element.attributes["fill-rule"] as "nonzero" | "evenodd" } : {}),
        })
        break
      }
      case "clip": {
        const id = requireId(element)
        if (!element.attributes.path) throw new Error(`<clip ${id}> requires a path attribute`)
        clipPaths.push({
          id,
          pathId: element.attributes.path,
          ...(element.attributes["fill-rule"] ? { fillRule: element.attributes["fill-rule"] as "nonzero" | "evenodd" } : {}),
        })
        break
      }
      case "mask": {
        const id = requireId(element)
        const size = viewBox(element.attributes.viewBox, `<mask ${id}> viewBox`)
        const shapes = childElements(element).map((shape): MaskShape => {
          const fill = shape.attributes.fill
          if (!fill || fill === "none") throw new Error(`<mask ${id}> shapes need a visible fill`)
          const base = {
            fill: withAlpha(fill, number(shape.attributes["fill-opacity"], "fill-opacity", 1)),
            ...(shape.attributes["fill-rule"] ? { fillRule: shape.attributes["fill-rule"] as "nonzero" | "evenodd" } : {}),
            ...(shape.attributes.opacity !== undefined ? { opacity: number(shape.attributes.opacity, "opacity") } : {}),
          }
          if (shape.tag === "rect") {
            return {
              kind: "rect",
              x: number(shape.attributes.x, "rect x", 0),
              y: number(shape.attributes.y, "rect y", 0),
              width: number(shape.attributes.width, "rect width"),
              height: number(shape.attributes.height, "rect height"),
              ...(shape.attributes.rx !== undefined ? { radius: number(shape.attributes.rx, "rect rx") } : {}),
              ...base,
            }
          }
          if (shape.tag === "ellipse") {
            const cx = number(shape.attributes.cx, "ellipse cx", size.width / 2)
            const cy = number(shape.attributes.cy, "ellipse cy", size.height / 2)
            const rx = number(shape.attributes.rx, "ellipse rx")
            const ry = number(shape.attributes.ry, "ellipse ry")
            return { kind: "ellipse", x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2, ...base }
          }
          if (shape.tag === "path") {
            return {
              kind: "path",
              commands: parsePathD(shape.attributes.d ?? elementText(shape)),
              ...base,
            }
          }
          throw new Error(`<mask ${id}> supports rect, ellipse and path shapes; got <${shape.tag}>`)
        })
        masks.push({ id, width: size.width, height: size.height, shapes })
        break
      }
      case "gradient": {
        const id = requireId(element)
        const type = element.attributes.type
        if (type !== "linear" && type !== "radial") throw new Error(`<gradient ${id}> type must be linear or radial`)
        const stops: GradientStop[] = childElements(element, "stop").map((stop) => {
          const color = stop.attributes.color ?? stop.attributes["stop-color"]
          if (!color) throw new Error(`<gradient ${id}> stops need a color`)
          return {
            offset: number(stop.attributes.offset, "stop offset"),
            color,
            ...(stop.attributes.opacity !== undefined ? { opacity: number(stop.attributes.opacity, "stop opacity") } : {}),
          }
        })
        const paint: GradientPaint =
          type === "linear"
            ? {
                type: "linear",
                from: parsePoint(element.attributes.from, "gradient from", [0, 0.5]),
                to: parsePoint(element.attributes.to, "gradient to", [1, 0.5]),
                stops,
                ...(element.attributes.spread ? { spread: element.attributes.spread as "pad" | "repeat" | "reflect" } : {}),
              }
            : {
                type: "radial",
                center: parsePoint(element.attributes.center, "gradient center", [0.5, 0.5]),
                radius: number(element.attributes.radius, "gradient radius", 0.5),
                stops,
                ...(element.attributes.spread ? { spread: element.attributes.spread as "pad" | "repeat" | "reflect" } : {}),
              }
        paints.push({ id, paint })
        break
      }
      case undefined:
        break
      default:
        throw new Error(`unsupported <defs> element <${element.tag}> (allowed: path, clip, mask, gradient)`)
    }
  }
  return { pathDefinitions, clipPaths, masks, paints }
}

function withAlpha(color: string, opacity: number) {
  if (opacity >= 1) return color
  const hex = color.replace("#", "")
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .split("")
          .map((item) => item + item)
          .join("")
      : hex
  if (expanded.length === 6 && /^[0-9a-f]+$/i.test(expanded)) {
    const alpha = Math.max(0, Math.min(255, Math.round(opacity * 255)))
      .toString(16)
      .padStart(2, "0")
    return `#${expanded}${alpha}`
  }
  return color
}

/** Computes a human-readable (line, column) location for a parsed CML element. */
export function elementLocation(source: string, element?: CmlElement) {
  if (!element || element.offset === undefined) return ""
  const upto = source.slice(0, element.offset)
  const line = upto.split("\n").length
  const column = element.offset - upto.lastIndexOf("\n")
  return ` (line ${line}, column ${column})`
}

export function paintFromAttribute(value: string | undefined): { paintRef: string } | undefined {
  if (!value?.startsWith("url(#") || !value.endsWith(")")) return undefined
  const id = value.slice(5, -1)
  if (!id) throw new Error("paint url references need an id: url(#id)")
  return { paintRef: id }
}
