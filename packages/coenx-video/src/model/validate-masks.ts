import type { MaskDefinition, Scene } from "./types"
import { colorAlpha } from "../render/paint"

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/
const FILL_RULES = new Set(["nonzero", "evenodd"])

export const MASK_BUDGETS = {
  /** Maximum mask resources per scene. */
  maxMasksPerScene: 32,
  /** Maximum shapes inside one mask; v1 masks are flat (no nesting). */
  maxShapesPerMask: 16,
  /** Maximum path commands contributed by one mask shape. */
  maxCommandsPerShape: 256,
  /** Maximum mask view-box dimension. */
  maxMaskDimension: 16_384,
  /** Maximum mask view-box pixel count (alpha surface budget). */
  maxMaskPixels: 4_194_304,
} as const

function add(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message)
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
}

function validateShapePaint(shapeId: string, paint: unknown, issues: string[]) {
  if (paint === undefined || paint === null || typeof paint === "object") {
    if (paint !== null && typeof paint === "object") {
      const value = paint as Record<string, unknown>
      const type = value.type
      if (type !== "linear" && type !== "radial") {
        add(issues, false, `mask shape ${shapeId} has an unsupported gradient type`)
        return
      }
      const stops = Array.isArray(value.stops) ? value.stops : []
      add(issues, stops.length >= 1 && stops.length <= 8, `mask shape ${shapeId} gradient needs 1–8 stops`)
      let previous = -1
      for (const rawStop of stops as Array<Record<string, unknown>>) {
        const stopOffset = rawStop.offset as number
        add(
          issues,
          finite(stopOffset) && stopOffset >= 0 && stopOffset <= 1 && stopOffset >= previous,
          `mask shape ${shapeId} gradient stops must be ordered between 0 and 1`,
        )
        if (finite(stopOffset)) previous = stopOffset
        const stopColor = rawStop.color
        add(issues, typeof stopColor === "string", `mask shape ${shapeId} gradient stop needs a color`)
        if (typeof stopColor === "string") add(issues, colorAlpha(stopColor) >= 0, `mask shape ${shapeId} gradient stop has an invalid color`)
        const stopOpacity = rawStop.opacity
        if (stopOpacity !== undefined)
          add(issues, finite(stopOpacity) && (stopOpacity as number) >= 0 && (stopOpacity as number) <= 1, `mask shape ${shapeId} gradient stop opacity must be between 0 and 1`)
      }
      const vector = (raw: unknown, length: number) => Array.isArray(raw) && raw.length === length && raw.every((item) => finite(item) && Math.abs(item as number) <= 2)
      add(
        issues,
        type === "linear" ? vector(value.from, 2) && vector(value.to, 2) : vector(value.center, 2),
        `mask shape ${shapeId} gradient coordinates must be finite and within -2 to 2`,
      )
      if (type === "radial") add(issues, finite(value.radius) && (value.radius as number) > 0 && (value.radius as number) <= 4, `mask shape ${shapeId} radial gradient radius must be greater than 0 and at most 4`)
    }
    return
  }
  if (typeof paint === "string") {
    add(issues, paint !== "none", `mask shape ${shapeId} must paint visible alpha; "none" masks everything away`)
    return
  }
  add(issues, false, `mask shape ${shapeId} has an invalid paint`)
}

function validateMaskShape(mask: MaskDefinition, shapeId: string, raw: unknown, issues: string[]) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    add(issues, false, `mask ${mask.id} contains an invalid shape`)
    return
  }
  const shape = raw as Record<string, unknown>
  const kind = shape.kind
  add(issues, kind === "path" || kind === "rect" || kind === "ellipse", `mask ${mask.id} shape ${shapeId} has an unsupported kind`)
  validateShapePaint(shapeId, shape.fill, issues)
  const shapeOpacity = shape.opacity
  if (shapeOpacity !== undefined)
    add(issues, finite(shapeOpacity) && (shapeOpacity as number) >= 0 && (shapeOpacity as number) <= 1, `mask shape ${shapeId} opacity must be between 0 and 1`)
  if (shape.fillRule !== undefined)
    add(issues, FILL_RULES.has(shape.fillRule as string), `mask shape ${shapeId} has an invalid fill rule`)
  if (kind === "rect" || kind === "ellipse") {
    const shapeWidth = shape.width as number
    const shapeHeight = shape.height as number
    add(issues, finite(shapeWidth) && shapeWidth > 0 && shapeWidth <= mask.width, `mask shape ${shapeId} needs a width inside the mask view box`)
    add(issues, finite(shapeHeight) && shapeHeight > 0 && shapeHeight <= mask.height, `mask shape ${shapeId} needs a height inside the mask view box`)
    const shapeX = shape.x as number
    const shapeY = shape.y as number
    if (finite(shapeX) && finite(shapeY)) {
      add(issues, shapeX >= -mask.width && shapeX <= mask.width, `mask shape ${shapeId} x must stay within the mask bounds`)
      add(issues, shapeY >= -mask.height && shapeY <= mask.height, `mask shape ${shapeId} y must stay within the mask bounds`)
    }
    if (kind === "rect" && shape.radius !== undefined)
      add(issues, finite(shape.radius) && (shape.radius as number) >= 0, `mask shape ${shapeId} has an invalid radius`)
  }
  if (kind === "path") {
    const hasCommands = shape.commands !== undefined
    const hasReference = shape.pathRef !== undefined
    add(issues, hasCommands !== hasReference, `mask shape ${shapeId} must define commands or pathRef, but not both`)
    if (hasCommands) {
      const commands = Array.isArray(shape.commands) ? shape.commands : []
      add(issues, commands.length <= MASK_BUDGETS.maxCommandsPerShape, `mask shape ${shapeId} exceeds the ${MASK_BUDGETS.maxCommandsPerShape} command budget`)
      if (commands[0] && (commands[0] as Record<string, unknown>).type !== "moveTo")
        add(issues, false, `mask shape ${shapeId} must begin with moveTo`)
    }
  }
}

export function validateSceneMasks(scene: Scene, issues: string[]) {
  const masks = scene.masks ?? []
  add(issues, masks.length <= MASK_BUDGETS.maxMasksPerScene, `scene ${scene.id} has more than ${MASK_BUDGETS.maxMasksPerScene} mask resources`)
  const maskIds = new Set<string>()
  for (const mask of masks) {
    add(issues, ID.test(mask.id), `scene ${scene.id} has an invalid mask id`)
    add(issues, !maskIds.has(mask.id), `scene ${scene.id} has duplicate mask ${mask.id}`)
    maskIds.add(mask.id)
    add(issues, finite(mask.width) && mask.width > 0 && mask.width <= MASK_BUDGETS.maxMaskDimension, `mask ${mask.id} has an invalid view-box width`)
    add(issues, finite(mask.height) && mask.height > 0 && mask.height <= MASK_BUDGETS.maxMaskDimension, `mask ${mask.id} has an invalid view-box height`)
    add(issues, mask.width * mask.height <= MASK_BUDGETS.maxMaskPixels, `mask ${mask.id} exceeds the ${MASK_BUDGETS.maxMaskPixels} pixel budget`)
    add(issues, Array.isArray(mask.shapes) && mask.shapes.length >= 1, `mask ${mask.id} needs at least one shape`)
    add(issues, (mask.shapes?.length ?? 0) <= MASK_BUDGETS.maxShapesPerMask, `mask ${mask.id} exceeds ${MASK_BUDGETS.maxShapesPerMask} shapes`)
    ;(mask.shapes ?? []).forEach((shape, index) => validateMaskShape(mask, `${mask.id}[${index}]`, shape, issues))
  }
  for (const node of scene.nodes) {
    if (node.maskId === undefined) continue
    add(issues, maskIds.has(node.maskId), `node ${node.id} references missing mask ${node.maskId}`)
    add(issues, node.kind !== "mesh3d", `3D mesh node ${node.id} cannot use an alpha mask`)
  }
}
