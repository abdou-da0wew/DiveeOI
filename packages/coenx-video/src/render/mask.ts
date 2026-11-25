import type { MaskDefinition, MaskShape, Paint, PathCommand, PathFillRule, Scene, VisualNode } from "../model/types"
import { isGradientPaint, svgPaint, whiteAlphaPaint } from "./paint"
import { pathCommandsToSvgD } from "./path"

export interface ResolvedMaskShape {
  commands: PathCommand[]
  fillRule: PathFillRule
  paint: Paint
  opacity: number
}

export interface ResolvedMask {
  id: string
  shapes: ResolvedMaskShape[]
}

/**
 * SVG serialization of one resolved mask shape: white fill, alpha preserved.
 * `definition` is a white gradient definition that must be added to `<defs>`;
 * `fillOpacity` carries solid-shape alpha. White-with-alpha renders identically
 * under luminance masks (SVG default) and alpha masks, so no `mask-type`
 * dependency is introduced.
 */
export function maskShapeSvgParts(
  shape: ResolvedMaskShape,
  paintId: string,
  width: number,
  height: number,
): { fill: string; definition?: string; fillOpacity?: number } {
  if (!isGradientPaint(shape.paint)) {
    return { fill: "#ffffff", fillOpacity: Math.max(0, Math.min(1, shape.opacity)) }
  }
  const white = whiteAlphaPaint(shape.paint)
  const scaled = {
    ...white,
    stops: white.stops.map((stop) => ({
      offset: stop.offset,
      color: stop.color,
      opacity: Math.max(0, Math.min(1, (stop.opacity ?? 1) * shape.opacity)),
    })),
  }
  const painted = svgPaint(scaled, paintId, "#ffffff", width, height)
  return { fill: painted.value, definition: painted.definition }
}

/** Serializes a full `<mask>` element (white-alpha content) for the static SVG backend. */
export function maskSvgDefinition(
  mask: ResolvedMask,
  maskId: string,
  width: number,
  height: number,
  definitions: string[],
): string {
  const content = mask.shapes
    .map((shape, index) => {
      const parts = maskShapeSvgParts(shape, `${maskId}-paint-${index}`, width, height)
      if (parts.definition) definitions.push(parts.definition)
      return `<path d="${pathCommandsToSvgD(shape.commands, width, height)}" fill="${parts.fill}"${parts.fillOpacity !== undefined ? ` fill-opacity="${parts.fillOpacity}"` : ""} fill-rule="${shape.fillRule}"/>`
    })
    .join("")
  return `<mask id="${maskId}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}">${content}</mask>`
}

function ellipseCommands(x: number, y: number, width: number, height: number): PathCommand[] {
  // Four-cubic Bézier approximation of a full ellipse, kappa = 0.5523.
  // Geometry is in top-left view-box space, like path definitions.
  const kappa = 0.5522847498
  const hw = width / 2
  const hh = height / 2
  const kx = hw * kappa
  const ky = hh * kappa
  const cx = x + hw
  const cy = y + hh
  return [
    { type: "moveTo", point: [cx, cy - hh] },
    { type: "cubicTo", control1: [cx + kx, cy - hh], control2: [cx + hw, cy - ky], to: [cx + hw, cy] },
    { type: "cubicTo", control1: [cx + hw, cy + ky], control2: [cx + kx, cy + hh], to: [cx, cy + hh] },
    { type: "cubicTo", control1: [cx - kx, cy + hh], control2: [cx - hw, cy + ky], to: [cx - hw, cy] },
    { type: "cubicTo", control1: [cx - hw, cy - ky], control2: [cx - kx, cy - hh], to: [cx, cy - hh] },
    { type: "close" },
  ]
}

function roundedRectCommands(x: number, y: number, width: number, height: number, radius: number): PathCommand[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  const left = x
  const top = y
  const right = x + width
  const bottom = y + height
  if (r <= 0) {
    return [
      { type: "moveTo", point: [left, top] },
      { type: "lineTo", point: [right, top] },
      { type: "lineTo", point: [right, bottom] },
      { type: "lineTo", point: [left, bottom] },
      { type: "close" },
    ]
  }
  return [
    { type: "moveTo", point: [left + r, top] },
    { type: "lineTo", point: [right - r, top] },
    { type: "cubicTo", control1: [right, top], control2: [right, top + r], to: [right, top + r] },
    { type: "lineTo", point: [right, bottom - r] },
    { type: "cubicTo", control1: [right, bottom], control2: [right - r, bottom], to: [right - r, bottom] },
    { type: "lineTo", point: [left + r, bottom] },
    { type: "cubicTo", control1: [left, bottom], control2: [left, bottom - r], to: [left, bottom - r] },
    { type: "lineTo", point: [left, top + r] },
    { type: "cubicTo", control1: [left, top], control2: [left + r, top], to: [left + r, top] },
    { type: "close" },
  ]
}

function scaleMaskPoint(point: readonly number[], scaleX: number, scaleY: number): [number, number] {
  return [point[0] * scaleX, point[1] * scaleY]
}

export function scaleMaskCommands(commands: PathCommand[], scaleX: number, scaleY: number): PathCommand[] {
  return commands.map((command) => {
    switch (command.type) {
      case "moveTo":
      case "lineTo":
        return { ...command, point: scaleMaskPoint(command.point, scaleX, scaleY) }
      case "quadraticTo":
        return {
          ...command,
          control: scaleMaskPoint(command.control, scaleX, scaleY),
          to: scaleMaskPoint(command.to, scaleX, scaleY),
        }
      case "cubicTo":
        return {
          ...command,
          control1: scaleMaskPoint(command.control1, scaleX, scaleY),
          control2: scaleMaskPoint(command.control2, scaleX, scaleY),
          to: scaleMaskPoint(command.to, scaleX, scaleY),
        }
      case "close":
        return command
    }
  })
}

/** Normalizes one mask shape into top-left mask view-box path commands. */
function shapeCommandsInMaskSpace(
  shape: MaskShape,
  mask: MaskDefinition,
  pathDefinitions: Scene["pathDefinitions"],
): PathCommand[] {
  if (shape.kind === "rect") {
    return roundedRectCommands(shape.x ?? 0, shape.y ?? 0, shape.width ?? 0, shape.height ?? 0, shape.radius ?? 0)
  }
  if (shape.kind === "ellipse") {
    return ellipseCommands(shape.x ?? 0, shape.y ?? 0, shape.width ?? 0, shape.height ?? 0)
  }
  if (shape.commands) return shape.commands
  if (!shape.pathRef) throw new Error("Mask path shape has neither commands nor a path reference")
  const definition = pathDefinitions?.find((item) => item.id === shape.pathRef)
  if (!definition) throw new Error(`Mask shape references missing path ${shape.pathRef}`)
  return scaleMaskCommands(definition.commands, mask.width / definition.width, mask.height / definition.height)
}

/**
 * Resolves a node's mask resource into node-local normalized shapes: geometry
 * is centered on the node (like clip paths) and scaled from the mask view box
 * to the node box; path references reuse the scene path resources.
 */
export function resolveNodeMask(node: VisualNode, scene: Scene): ResolvedMask | undefined {
  if (!node.maskId) return undefined
  const mask = scene.masks?.find((item) => item.id === node.maskId)
  if (!mask) throw new Error(`Node ${node.id} references missing mask ${node.maskId}`)
  const scaleX = node.width / mask.width
  const scaleY = node.height / mask.height
  const shapes = mask.shapes.map((shape) => ({
    commands: scaleMaskCommands(shapeCommandsInMaskSpace(shape, mask, scene.pathDefinitions), scaleX, scaleY),
    fillRule: shape.fillRule ?? "nonzero",
    paint: shape.fill,
    opacity: Math.max(0, Math.min(1, shape.opacity ?? 1)),
  }))
  return { id: mask.id, shapes }
}
