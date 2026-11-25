import path from "node:path"
import { isBundledFontFamily } from "../fonts/catalog"
import type { Paint, VisualNode } from "./types"

function add(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message)
}

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/
const SAFE_ASSET = /^(?![a-z]+:\/\/)(?!\/)(?![A-Za-z]:\\)[^\0]+$/i

function validatePaint(paint: Paint | undefined, nodeId: string, issues: string[]) {
  if (paint === undefined || typeof paint === "string") return
  if (typeof paint === "object" && paint !== null && "paintRef" in paint) {
    add(issues, typeof (paint as { paintRef: unknown }).paintRef === "string", `node ${nodeId} has an invalid paint reference`)
    return
  }
  if (typeof paint !== "object" || paint === null || Array.isArray(paint)) {
    add(issues, false, `node ${nodeId} has an invalid gradient paint`)
    return
  }
  const value = paint as unknown as Record<string, unknown>
  const type = value.type
  if (type !== "linear" && type !== "radial") {
    add(issues, false, `node ${nodeId} has an unsupported gradient type`)
    return
  }
  const spread = value.spread
  if (spread !== undefined)
    add(issues, spread === "pad" || spread === "repeat" || spread === "reflect", `node ${nodeId} gradient spread must be pad, repeat or reflect`)
  const transform = value.transform
  if (transform !== undefined && typeof transform === "object" && transform !== null) {
    const t = transform as Record<string, unknown>
    if (t.rotate !== undefined)
      add(issues, typeof t.rotate === "number" && Number.isFinite(t.rotate) && Math.abs(t.rotate) <= 360, `node ${nodeId} gradient rotate must be finite within ±360 degrees`)
    if (t.translate !== undefined)
      add(issues, Array.isArray(t.translate) && t.translate.length === 2 && t.translate.every((item) => typeof item === "number" && Number.isFinite(item) && Math.abs(item as number) <= 2), `node ${nodeId} gradient translate must be finite within -2 to 2`)
    if (t.scale !== undefined)
      add(issues, Array.isArray(t.scale) && t.scale.length === 2 && t.scale.every((item) => typeof item === "number" && Number.isFinite(item) && Math.abs(item as number) <= 4 && (item as number) !== 0), `node ${nodeId} gradient scale must be finite, non-zero, within ±4`)
  }
  const rawStops = value.stops
  const stops = Array.isArray(rawStops) ? rawStops : []
  add(issues, stops.length >= 2 && stops.length <= 8, `node ${nodeId} gradients need 2–8 color stops`)
  let previous = -1
  for (const rawStop of stops) {
    if (typeof rawStop !== "object" || rawStop === null || Array.isArray(rawStop)) {
      add(issues, false, `node ${nodeId} has an invalid gradient stop`)
      continue
    }
    const stop = rawStop as Record<string, unknown>
    const offset = stop.offset
    add(
      issues,
      typeof offset === "number" && Number.isFinite(offset) && offset >= 0 && offset <= 1 && offset >= previous,
      `node ${nodeId} gradient stops must be ordered between 0 and 1`,
    )
    if (typeof offset === "number" && Number.isFinite(offset)) previous = offset
    add(
      issues,
      typeof stop.color === "string" && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(stop.color),
      `node ${nodeId} gradient stop has an invalid color`,
    )
    if (stop.opacity !== undefined) {
      add(
        issues,
        typeof stop.opacity === "number" && Number.isFinite(stop.opacity) && stop.opacity >= 0 && stop.opacity <= 1,
        `node ${nodeId} gradient stop opacity must be between 0 and 1`,
      )
    }
  }
  const validVector = (vector: unknown, length: number) =>
    Array.isArray(vector) &&
    vector.length === length &&
    vector.every((item) => typeof item === "number" && Number.isFinite(item) && item >= -2 && item <= 2)
  const coordinatesValid =
    type === "linear" ? validVector(value.from, 2) && validVector(value.to, 2) : validVector(value.center, 2)
  add(issues, coordinatesValid, `node ${nodeId} gradient coordinates must be finite and within -2 to 2`)
  if (type === "radial") {
    const radius = value.radius
    add(
      issues,
      typeof radius === "number" && Number.isFinite(radius) && radius > 0 && radius <= 4,
      `node ${nodeId} radial gradient radius must be greater than 0 and at most 4`,
    )
  }
}

export function validateNode(node: VisualNode, issues: string[], sceneId: string, assets: Record<string, string>) {
  add(issues, ID.test(node.id), `scene ${sceneId} has invalid node id ${node.id}`)
  for (const [name, value] of Object.entries({
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation ?? 0,
    scaleX: node.scaleX ?? 1,
    scaleY: node.scaleY ?? 1,
    opacity: node.opacity ?? 1,
  }))
    add(issues, Number.isFinite(value), `node ${node.id} has invalid ${name}`)
  add(issues, node.width >= 0 && node.height >= 0, `node ${node.id} has negative dimensions`)
  if (node.fontFamily) {
    add(issues, isBundledFontFamily(node.fontFamily), "node " + node.id + " uses a font outside the bundled catalogue")
  }
  if (node.fontSize !== undefined) {
    add(
      issues,
      Number.isFinite(node.fontSize) && node.fontSize > 0 && node.fontSize <= 512,
      "node " + node.id + " has an invalid font size",
    )
  }
  add(issues, (node.opacity ?? 1) >= 0 && (node.opacity ?? 1) <= 1, `node ${node.id} opacity must be between 0 and 1`)
  if (node.kind === "rect" || node.kind === "ellipse" || node.kind === "button" || node.kind === "path") {
    validatePaint(node.fill, node.id, issues)
  }
  add(issues, (node.animations?.length ?? 0) <= 16, `node ${node.id} has too many animation tracks`)
  for (const track of node.animations ?? []) {
    add(
      issues,
      track.keyframes.length > 0 && track.keyframes.length <= 128,
      `node ${node.id} animation needs 1–128 keyframes`,
    )
    let previous = -1
    for (const keyframe of track.keyframes) {
      add(issues, Number.isFinite(keyframe.frame) && keyframe.frame >= 0, `node ${node.id} has an invalid keyframe`)
      add(issues, keyframe.frame > previous, `node ${node.id} keyframes must be strictly increasing`)
      previous = keyframe.frame
    }
  }
  if (node.kind === "text") add(issues, node.text.length <= 12_000, `text node ${node.id} is too long`)
  if (node.kind === "image") {
    const assetPath = assets[node.asset] ?? node.asset
    add(
      issues,
      SAFE_ASSET.test(assetPath) && !path.normalize(assetPath).startsWith(".."),
      `image node ${node.id} has an unsafe asset path`,
    )
  }
  if (node.kind === "mesh3d") {
    const validVector = (value: readonly number[]) => value.length === 3 && value.every(Number.isFinite)
    add(issues, node.vertices.length <= 20_000, `mesh ${node.id} has too many vertices`)
    add(issues, node.vertices.length >= 3, `mesh ${node.id} needs at least three vertices`)
    add(issues, node.triangles.length <= 20_000, `mesh ${node.id} has too many triangles`)
    for (const vertex of node.vertices) add(issues, validVector(vertex), `mesh ${node.id} has an invalid vertex`)
    for (const vector of [node.position, node.rotation3d, node.scale3d, node.lightDirection])
      if (vector) add(issues, validVector(vector), `mesh ${node.id} has an invalid 3D transform or light vector`)
    for (const face of node.triangles)
      for (const index of face)
        add(
          issues,
          Number.isInteger(index) && index >= 0 && index < node.vertices.length,
          `mesh ${node.id} has an invalid triangle index`,
        )
    const targets = node.morphTargets ?? []
    add(issues, targets.length <= 16, `mesh ${node.id} has more than 16 morph targets`)
    const targetNames = new Set<string>()
    for (const target of targets) {
      add(issues, /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(target.name), `mesh ${node.id} has an invalid morph target name`)
      add(issues, !targetNames.has(target.name), `mesh ${node.id} has duplicate morph target ${target.name}`)
      targetNames.add(target.name)
      add(
        issues,
        target.vertices.length === node.vertices.length,
        `morph target ${target.name} vertex count does not match mesh ${node.id}`,
      )
      for (const vertex of target.vertices)
        add(issues, validVector(vertex), `morph target ${target.name} has an invalid vertex`)
    }
    for (const [name, weight] of Object.entries(node.morphWeights ?? {})) {
      add(issues, targetNames.has(name), `mesh ${node.id} references unknown morph target ${name}`)
      add(
        issues,
        Number.isFinite(weight) && weight >= -1 && weight <= 1,
        `mesh ${node.id} morph weight ${name} must be between -1 and 1`,
      )
    }
    const material = node.material
    if (material) {
      for (const [name, value] of Object.entries({
        ambient: material.ambient ?? 0.22,
        diffuse: material.diffuse ?? 0.85,
        specular: material.specular ?? 0.22,
        shininess: material.shininess ?? 28,
        metalness: material.metalness ?? 0,
        roughness: material.roughness ?? 0.62,
      })) {
        const max = name === "shininess" ? 256 : name === "metalness" || name === "roughness" ? 1 : 8
        add(
          issues,
          Number.isFinite(value) && value >= 0 && value <= max,
          `mesh ${node.id} has invalid material ${name}`,
        )
      }
    }
    for (const track of node.animations ?? []) {
      if (track.property.startsWith("morph:")) {
        const name = track.property.slice("morph:".length)
        add(issues, targetNames.has(name), `mesh ${node.id} animation references unknown morph target ${name}`)
        add(
          issues,
          track.keyframes.every((keyframe) => typeof keyframe.value === "number"),
          `mesh ${node.id} morph animation values must be numbers`,
        )
      }
      if (track.property.endsWith("3d"))
        add(
          issues,
          track.keyframes.every((keyframe) => typeof keyframe.value === "number"),
          `mesh ${node.id} 3D animation values must be numbers`,
        )
    }
  }
  if (node.kind === "select")
    add(issues, node.options.length > 0 && node.options.length <= 64, `select ${node.id} needs 1–64 options`)
}
