import type { RenderProfile, Scene, TimelineEvent, VideoComposition } from "./types"
import { validateSceneEffects } from "./validate-effects"
import { validateActionsExport, validateSceneInteractions } from "./validate-interactions"
import { validateSceneMasks } from "./validate-masks"
import { isPermittedAssetReference, validateNode } from "./validate-nodes"
import { validateScenePaints } from "./validate-paints"
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

function add(issues: string[], condition: boolean, message: string) {
  if (!condition) issues.push(message)
}

function validateScene(
  scene: Scene,
  scenes: Set<string>,
  audio: Set<string>,
  assets: Record<string, string>,
  issues: string[],
  allowedFontFamilies: ReadonlySet<string> = new Set(),
) {
  add(issues, ID.test(scene.id), `invalid scene id ${scene.id}`)
  add(
    issues,
    Number.isInteger(scene.durationFrames) && scene.durationFrames > 0,
    `scene ${scene.id} duration must be a positive frame count`,
  )
  add(issues, scene.nodes.length <= 5_000, `scene ${scene.id} has too many nodes`)
  validateScenePaths(scene, issues)
  validateSceneMasks(scene, issues)
  validateScenePaints(scene, issues)
  validateSceneEffects(scene, issues)
  const ids = new Set<string>()
  for (const node of scene.nodes) {
    add(issues, !ids.has(node.id), `scene ${scene.id} has duplicate node id ${node.id}`)
    ids.add(node.id)
    validateNode(node, issues, scene.id, assets, allowedFontFamilies)
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
    validateSceneInteractions(interaction, ids, scenes, audio, issues, scene)
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

function validateEventActions(
  event: TimelineEvent,
  ids: Set<string>,
  scenes: Set<string>,
  audio: Set<string>,
  issues: string[],
) {
  validateActionsExport(event.actions, ids, scenes, audio, issues)
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
      ID.test(name) && isPermittedAssetReference(asset),
      `asset ${name} has an unsafe path (allowed: project-relative, tmp:, data: URIs, absolute temp-directory paths)`,
    )
  const fontIds = new Set<string>()
  for (const font of composition.fonts ?? []) {
    add(issues, ID.test(font.family), `custom font family ${font.family} must be a plain identifier`)
    add(issues, !fontIds.has(font.family), `custom font family ${font.family} is declared twice`)
    fontIds.add(font.family)
    add(issues, isPermittedAssetReference(font.src), `custom font ${font.family} has an unsafe src`)
    if (font.weight !== undefined)
      add(issues, font.weight === "normal" || font.weight === "bold" || (Number.isInteger(font.weight) && (font.weight as number) >= 100 && (font.weight as number) <= 900), `custom font ${font.family} weight must be normal, bold or 100..900`)
    if (font.style !== undefined) add(issues, font.style === "normal" || font.style === "italic", `custom font ${font.family} style must be normal or italic`)
  }
  const allowedFontFamilies = new Set((composition.fonts ?? []).map((font) => font.family))
  composition.scenes.forEach((scene) => validateScene(scene, sceneIds, audioIds, composition.assets ?? {}, issues, allowedFontFamilies))
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
    validateEventActions(event, new Set(composition.scenes.flatMap((scene) => scene.nodes.map((node) => node.id))), sceneIds, audioIds, issues)
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
