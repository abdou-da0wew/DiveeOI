import path from "node:path"
import { isBundledFontFamily } from "../fonts/catalog"
import type { Expression, InteractionAction, Paint, RenderProfile, Scene, VideoComposition, VisualNode } from "./types"
import { validateScenePaths } from "./validate-paths"

export const RENDER_PROFILES: Record<RenderProfile["name"], RenderProfile> = {
  low: {
    name: "low",
    maxWidth: 1280,
    maxHeight: 720,
    maxFps: 24,
    maxFrames: 18_000,
    maxNodes: 2_000,
    maxRasterChunkBytes: 48 * 1024 * 1024,
    maxConcurrentRenders: 1,
    ffmpegThreads: 2,
  },
  balanced: {
    name: "balanced",
    maxWidth: 1920,
    maxHeight: 1080,
    maxFps: 30,
    maxFrames: 18_000,
    maxNodes: 3_000,
    maxRasterChunkBytes: 64 * 1024 * 1024,
    maxConcurrentRenders: 1,
    ffmpegThreads: 2,
  },
  quality: {
    name: "quality",
    maxWidth: 3840,
    maxHeight: 2160,
    maxFps: 60,
    maxFrames: 36_000,
    maxNodes: 5_000,
    maxRasterChunkBytes: 96 * 1024 * 1024,
    maxConcurrentRenders: 1,
    ffmpegThreads: 4,
  },
}

export class VideoValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid coenx-video composition:\n- ${issues.join("\n- ")}`)
    this.name = "VideoValidationError"
  }
}

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/
const SAFE_ASSET = /^(?![a-z]+:\/\/)(?!\/)(?![A-Za-z]:\\)[^\0]+$/i

function add(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message)
}

function validateExpression(expression: Expression, issues: string[], depth = 0) {
  if (depth > 16) {
    issues.push("interaction expression exceeds 16 levels")
    return
  }
  if (expression.op === "literal" || expression.op === "state" || expression.op === "event") return
  if (expression.op === "not") {
    validateExpression(expression.value, issues, depth + 1)
    return
  }
  if (expression.op === "and" || expression.op === "or") {
    add(issues, expression.items.length > 0 && expression.items.length <= 24, "logical expressions need 1–24 operands")
    expression.items.forEach((item) => validateExpression(item, issues, depth + 1))
    return
  }
  if (expression.op === "contains") {
    validateExpression(expression.value, issues, depth + 1)
    validateExpression(expression.search, issues, depth + 1)
    return
  }
  if ("left" in expression && "right" in expression) {
    validateExpression(expression.left, issues, depth + 1)
    validateExpression(expression.right, issues, depth + 1)
  }
}

function validateActions(
  actions: InteractionAction[],
  ids: Set<string>,
  scenes: Set<string>,
  audio: Set<string>,
  issues: string[],
) {
  add(issues, actions.length <= 24, "an interaction can contain at most 24 actions")
  for (const action of actions) {
    if (action.type === "goto")
      add(issues, scenes.has(action.sceneId), `interaction references missing scene ${action.sceneId}`)
    if (action.type === "show" || action.type === "hide")
      add(issues, ids.has(action.targetId), `interaction references missing node ${action.targetId}`)
    if (action.type === "playAudio")
      add(issues, audio.has(action.trackId), `interaction references missing audio track ${action.trackId}`)
  }
}

function validatePaint(paint: Paint | undefined, nodeId: string, issues: string[]) {
  if (paint === undefined || typeof paint === "string") return
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

function validateNode(node: VisualNode, issues: string[], sceneId: string, assets: Record<string, string>) {
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

function validateScene(
  scene: Scene,
  scenes: Set<string>,
  audio: Set<string>,
  assets: Record<string, string>,
  issues: string[],
) {
  add(issues, ID.test(scene.id), `invalid scene id ${scene.id}`)
  add(
    issues,
    Number.isInteger(scene.durationFrames) && scene.durationFrames > 0,
    `scene ${scene.id} duration must be a positive frame count`,
  )
  add(issues, scene.nodes.length <= 5_000, `scene ${scene.id} has too many nodes`)
  validateScenePaths(scene, issues)
  const ids = new Set<string>()
  for (const node of scene.nodes) {
    add(issues, !ids.has(node.id), `scene ${scene.id} has duplicate node id ${node.id}`)
    ids.add(node.id)
    validateNode(node, issues, scene.id, assets)
  }
  for (const interaction of scene.interactions ?? []) {
    add(issues, ID.test(interaction.id), `scene ${scene.id} has invalid interaction id ${interaction.id}`)
    const target = "targetId" in interaction.trigger ? interaction.trigger.targetId : undefined
    if (target) add(issues, ids.has(target), `interaction ${interaction.id} references missing node ${target}`)
    if (interaction.trigger.type === "timer")
      add(
        issues,
        interaction.trigger.frame >= 0 && interaction.trigger.frame <= scene.durationFrames,
        `timer ${interaction.id} is outside its scene`,
      )
    if (interaction.when) validateExpression(interaction.when, issues)
    validateActions(interaction.actions, ids, scenes, audio, issues)
  }
  if (scene.physics) {
    add(issues, scene.physics.bodies.length <= 500, `scene ${scene.id} has too many physics bodies`)
    for (const body of scene.physics.bodies)
      add(issues, ids.has(body.nodeId), `physics body references missing node ${body.nodeId}`)
  }
  if (scene.lights3d) {
    add(issues, scene.lights3d.length <= 16, `scene ${scene.id} has more than 16 3D lights`)
    for (const light of scene.lights3d) {
      add(
        issues,
        Number.isFinite(light.intensity ?? 1) && (light.intensity ?? 1) >= 0 && (light.intensity ?? 1) <= 8,
        `scene ${scene.id} has an invalid 3D light intensity`,
      )
      if (light.direction)
        add(
          issues,
          light.direction.length === 3 && light.direction.every(Number.isFinite),
          `scene ${scene.id} has an invalid light direction`,
        )
      if (light.position)
        add(
          issues,
          light.position.length === 3 && light.position.every(Number.isFinite),
          `scene ${scene.id} has an invalid light position`,
        )
    }
  }
  if (scene.physics3d) {
    add(issues, scene.physics3d.bodies.length <= 64, `scene ${scene.id} has more than 64 3D physics bodies`)
    const physics3dIds = new Set<string>()
    add(
      issues,
      scene.physics3d.bodies.every((body) => {
        if (physics3dIds.has(body.nodeId)) return false
        physics3dIds.add(body.nodeId)
        return true
      }),
      `scene ${scene.id} has duplicate 3D physics bodies for a mesh`,
    )
    add(
      issues,
      Number.isInteger(scene.physics3d.substeps ?? 2) &&
        (scene.physics3d.substeps ?? 2) >= 1 &&
        (scene.physics3d.substeps ?? 2) <= 8,
      `scene ${scene.id} has invalid 3D physics substeps`,
    )
    const meshIds = new Set(scene.nodes.filter((node) => node.kind === "mesh3d").map((node) => node.id))
    for (const body of scene.physics3d.bodies) {
      add(issues, meshIds.has(body.nodeId), `3D physics body ${body.nodeId} must reference a mesh3d node`)
      add(
        issues,
        Number.isFinite(body.mass) && (body.mass > 0 || body.isStatic === true),
        `3D physics body ${body.nodeId} needs a positive mass or isStatic`,
      )
      add(
        issues,
        body.velocity.length === 3 && body.velocity.every(Number.isFinite),
        `3D physics body ${body.nodeId} has invalid velocity`,
      )
      add(
        issues,
        body.size.length === 3 && body.size.every((value) => Number.isFinite(value) && value > 0),
        `3D physics body ${body.nodeId} has invalid size`,
      )
      for (const vector of [body.position, body.rotation, body.angularVelocity])
        if (vector)
          add(
            issues,
            vector.length === 3 && vector.every(Number.isFinite),
            `3D physics body ${body.nodeId} has an invalid vector`,
          )
      add(
        issues,
        (body.restitution ?? 0.35) >= 0 && (body.restitution ?? 0.35) <= 1,
        `3D physics body ${body.nodeId} restitution must be between 0 and 1`,
      )
      add(
        issues,
        (body.friction ?? 0.18) >= 0 && (body.friction ?? 0.18) <= 1,
        `3D physics body ${body.nodeId} friction must be between 0 and 1`,
      )
    }
    if (scene.physics3d.gravity)
      add(
        issues,
        scene.physics3d.gravity.length === 3 && scene.physics3d.gravity.every(Number.isFinite),
        `scene ${scene.id} has invalid 3D gravity`,
      )
    if (scene.physics3d.bounds) {
      const { min, max } = scene.physics3d.bounds
      add(
        issues,
        min.length === 3 &&
          max.length === 3 &&
          min.every(Number.isFinite) &&
          max.every(Number.isFinite) &&
          min.every((value, index) => value < max[index]),
        `scene ${scene.id} has invalid 3D physics bounds`,
      )
    }
  }
  if (scene.transition)
    add(
      issues,
      Number.isInteger(scene.transition.durationFrames) &&
        scene.transition.durationFrames > 0 &&
        scene.transition.durationFrames <= scene.durationFrames,
      `scene ${scene.id} has an invalid transition duration`,
    )
}

export function totalFrames(composition: VideoComposition) {
  return composition.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0)
}

export function validateComposition(composition: VideoComposition, profile: RenderProfile = RENDER_PROFILES.balanced) {
  const issues: string[] = []
  add(issues, composition.version === 1, "unsupported composition version")
  add(
    issues,
    ID.test(composition.id),
    "composition id must start with a letter and contain only letters, numbers, _ or -",
  )
  add(issues, composition.title.length > 0 && composition.title.length <= 180, "title must contain 1–180 characters")
  const { width, height, fps } = composition.stage
  add(
    issues,
    Number.isInteger(width) && width >= 64 && width <= profile.maxWidth,
    `stage width must be 64–${profile.maxWidth}`,
  )
  add(
    issues,
    Number.isInteger(height) && height >= 64 && height <= profile.maxHeight,
    `stage height must be 64–${profile.maxHeight}`,
  )
  add(issues, Number.isFinite(fps) && fps > 0 && fps <= profile.maxFps, `frame rate must be 1–${profile.maxFps}`)
  add(issues, composition.scenes.length > 0 && composition.scenes.length <= 120, "composition needs 1–120 scenes")
  const sceneIds = new Set(composition.scenes.map((scene) => scene.id))
  const audioIds = new Set((composition.audio ?? []).map((track) => track.id))
  const nodeCount = composition.scenes.reduce((sum, scene) => sum + scene.nodes.length, 0)
  add(issues, nodeCount <= profile.maxNodes, `composition exceeds the ${profile.maxNodes} node limit`)
  add(
    issues,
    totalFrames(composition) <= profile.maxFrames,
    `composition exceeds the ${profile.maxFrames} frame limit for profile ${profile.name}`,
  )
  add(issues, audioIds.size === (composition.audio ?? []).length, "audio track ids must be unique")
  for (const [name, asset] of Object.entries(composition.assets ?? {}))
    add(
      issues,
      ID.test(name) && SAFE_ASSET.test(asset) && !path.normalize(asset).startsWith(".."),
      `asset ${name} has an unsafe path`,
    )
  composition.scenes.forEach((scene) => validateScene(scene, sceneIds, audioIds, composition.assets ?? {}, issues))
  for (const track of composition.audio ?? []) {
    add(issues, track.durationFrames > 0 && track.startFrame >= 0, `audio track ${track.id} has invalid timing`)
    add(
      issues,
      (track.volume ?? 1) >= 0 && (track.volume ?? 1) <= 2,
      `audio track ${track.id} volume must be between 0 and 2`,
    )
  }
  const eventIds = new Set<string>()
  for (const event of composition.timeline ?? []) {
    add(issues, !eventIds.has(event.id), `duplicate timeline event ${event.id}`)
    eventIds.add(event.id)
    add(
      issues,
      event.frame >= 0 && event.frame < totalFrames(composition),
      `timeline event ${event.id} is outside the composition`,
    )
    validateActions(
      event.actions,
      new Set(composition.scenes.flatMap((scene) => scene.nodes.map((node) => node.id))),
      sceneIds,
      audioIds,
      issues,
    )
  }
  if (composition.provenance?.mode === "education") {
    add(issues, !!composition.provenance.learningObjective, "educational videos need a learning objective")
    add(
      issues,
      (composition.provenance.citations?.length ?? 0) > 0,
      "educational videos need at least one retrieved source citation",
    )
  }
  if (issues.length) throw new VideoValidationError(issues)
  return { totalFrames: totalFrames(composition), nodeCount }
}
