import { readFile } from "node:fs/promises"
import path from "node:path"
import type {
  Camera3D,
  ImageNode,
  Light3D,
  Mesh3DNode,
  Paint,
  Scene,
  Vec3,
  VideoComposition,
  VisualNode,
} from "../model/types"
import { applyComputedTexts, evaluateSceneAtFrame } from "../animation/timeline"
import { effectPadding, svgFilterDefinition, withGrainFrameSeeds } from "./effects"
import { projectMesh3D } from "./geometry3d"
import { resolveNodeMask, maskSvgDefinition } from "./mask"
import { resolvePaint, svgPaint } from "./paint"
import { pathCommandsToSvgD, resolveClipPath, resolveNodePath } from "./path"
import { renderFontFamilyName } from "../fonts/catalog"

export interface SvgFrameOptions {
  projectRoot: string
  hiddenNodes?: ReadonlySet<string>
  physics?: Record<string, { x: number; y: number }>
  physics3d?: Record<string, { position: Vec3; rotation: Vec3 }>
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function mimeType(file: string) {
  const extension = path.extname(file).toLowerCase()
  if (extension === ".png") return "image/png"
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".webp") return "image/webp"
  if (extension === ".gif") return "image/gif"
  if (extension === ".svg") return "image/svg+xml"
  return "application/octet-stream"
}

async function imageData(node: ImageNode, composition: VideoComposition, projectRoot: string) {
  const configured = composition.assets?.[node.asset] ?? node.asset
  if (configured.startsWith("data:image/")) return configured
  if (/^[a-z]+:\/\//i.test(configured) || path.isAbsolute(configured))
    throw new Error(`Remote or absolute media paths are not allowed: ${node.asset}`)
  const root = path.resolve(projectRoot)
  const resolved = path.resolve(root, configured)
  if (!resolved.startsWith(root + path.sep)) throw new Error(`Media asset escapes project root: ${node.asset}`)
  const bytes = await readFile(resolved)
  if (bytes.byteLength > 64 * 1024 * 1024) throw new Error(`Media asset exceeds 64 MB: ${node.asset}`)
  return `data:${mimeType(resolved)};base64,${bytes.toString("base64")}`
}

function nodeTransform(node: VisualNode, extraX = 0, extraY = 0) {
  const rotation = node.rotation ?? 0
  const sx = node.scaleX ?? 1
  const sy = node.scaleY ?? 1
  return `translate(${node.x + extraX} ${node.y + extraY}) rotate(${rotation}) scale(${sx} ${sy})`
}

function renderText(node: Extract<VisualNode, { kind: "text" }>) {
  const lines = node.text.split("\n")
  const height = node.lineHeight ?? (node.fontSize ?? 32) * 1.2
  const anchor = node.align === "left" ? "start" : node.align === "right" ? "end" : "middle"
  const firstY = -((lines.length - 1) * height) / 2
  const content = lines
    .map((line, index) => `<tspan x="0" y="${firstY + index * height}">${escapeXml(line)}</tspan>`)
    .join("")
  return `<text text-anchor="${anchor}" dominant-baseline="middle" fill="${node.color ?? "#ffffff"}" font-family="${escapeXml(renderFontFamilyName(node.fontFamily ?? "Geist", node.fontWeight ?? 500))}" font-size="${node.fontSize ?? 32}" font-weight="${node.fontWeight ?? 500}">${content}</text>`
}

function paintValue(
  paint: Paint | undefined,
  id: string,
  fallback: string,
  definitions: string[],
  width: number,
  height: number,
  scene?: Scene,
) {
  const result = svgPaint(resolvePaint(paint, scene), id, fallback, width, height)
  if (result.definition) definitions.push(result.definition)
  return result.value
}

async function renderNode(
  node: VisualNode,
  scene: Scene,
  composition: VideoComposition,
  camera: Camera3D | undefined,
  options: SvgFrameOptions,
  lights: Light3D[],
  transition: { x: number; y: number; opacity: number },
  definitions: string[],
  shared: { clipDefs: Map<string, string>; filterDefs: Map<string, string> },
) {
  const transform = nodeTransform(node, transition.x, transition.y)
  const opacity = Math.max(0, Math.min(1, (node.opacity ?? 1) * transition.opacity))
  if (opacity <= 0) return ""
  const { width, height } = node
  const clip = resolveClipPath(node, scene)
  // Clip definitions are deduplicated per (resource, node dimensions): the
  // scaled geometry only differs when either changes (WP1 follow-up).
  let clipId: string | undefined
  if (clip && node.clipPathId) {
    const key = `${node.clipPathId}|${width}x${height}`
    clipId = shared.clipDefs.get(key)
    if (!clipId) {
      clipId = `clip-${scene.id}-${node.clipPathId}`
      shared.clipDefs.set(key, clipId)
      definitions.push(
        `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><path d="${pathCommandsToSvgD(clip.commands, width, height)}" fill-rule="${clip.fillRule}" clip-rule="${clip.fillRule}"/></clipPath>`,
      )
    }
  }
  const mask = resolveNodeMask(node, scene)
  const maskId = mask ? `mask-${scene.id}-${node.id}` : undefined
  if (mask && maskId) {
    definitions.push(maskSvgDefinition(mask, maskId, width, height, definitions))
  }
  const effects = node.effects
  let filterId: string | undefined
  if (effects?.length) {
    const pad = effectPadding(effects)
    const key = `${JSON.stringify(effects)}|${width}x${height}`
    filterId = shared.filterDefs.get(key)
    if (!filterId) {
      filterId = `filter-${scene.id}-${node.id}`
      shared.filterDefs.set(key, filterId)
      definitions.push(svgFilterDefinition(effects, filterId, width, height, pad))
    }
  }
  // Vignette is a finishing overlay: a radial gradient rect painted over the
  // node content inside the same group (so clip/mask/opacity still apply).
  let vignetteOverlay = ""
  const vignette = effects?.find((effect) => effect.type === "vignette")
  if (vignette && vignette.type === "vignette") {
    const strength = Math.max(0, Math.min(1, vignette.strength ?? 0.5))
    const radius = Math.max(0, Math.min(1, vignette.radius ?? 0.7))
    const gradientId = `vignette-${scene.id}-${node.id}`
    definitions.push(
      `<radialGradient id="${gradientId}" cx="0.5" cy="0.5" r="0.75"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="${radius}" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="${strength}"/></radialGradient>`,
    )
    vignetteOverlay = `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" fill="url(#${gradientId})"/>`
  }
  let body = ""
  switch (node.kind) {
    case "rect": {
      const fill = paintValue(node.fill, `gradient-${composition.id}-${node.id}`, "none", definitions, width, height, scene)
      body = `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="${node.radius ?? 0}" fill="${fill}" stroke="${node.stroke ?? "none"}" stroke-width="${node.strokeWidth ?? 1}"/>`
      break
    }
    case "ellipse": {
      const fill = paintValue(node.fill, `gradient-${composition.id}-${node.id}`, "none", definitions, width, height, scene)
      body = `<ellipse cx="0" cy="0" rx="${width / 2}" ry="${height / 2}" fill="${fill}" stroke="${node.stroke ?? "none"}" stroke-width="${node.strokeWidth ?? 1}"/>`
      break
    }
    case "path": {
      const resolved = resolveNodePath(node, scene)
      const fill = paintValue(node.fill, `gradient-${composition.id}-${node.id}`, "none", definitions, width, height, scene)
      body = `<path d="${pathCommandsToSvgD(resolved.commands, width, height)}" fill="${fill}" fill-rule="${resolved.fillRule}" stroke="${node.stroke ?? "none"}" stroke-width="${node.strokeWidth ?? 1}" stroke-linecap="${node.lineCap ?? "butt"}" stroke-linejoin="${node.lineJoin ?? "miter"}"/>`
      break
    }
    case "line": {
      const points = node.points.map((point) => `${point[0] - width / 2},${point[1] - height / 2}`).join(" ")
      body = `<polyline points="${points}" fill="none" stroke="${node.stroke}" stroke-width="${node.strokeWidth ?? 2}" stroke-linecap="${node.lineCap ?? "round"}" stroke-linejoin="round"/>`
      break
    }
    case "text":
      body = renderText(node)
      break
    case "image": {
      const source = await imageData(node, composition, options.projectRoot)
      const preserve = node.fit === "fill" ? "none" : node.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"
      body = `<image href="${source}" x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" preserveAspectRatio="${preserve}"/>`
      break
    }
    case "button": {
      const fill = node.disabled
        ? "#666666"
        : paintValue(node.fill, `gradient-${composition.id}-${node.id}`, "#315fe8", definitions, width, height, scene)
      body = `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="${node.radius ?? 12}" fill="${fill}" stroke="${node.borderColor ?? "none"}"/>${renderText({ ...node, kind: "text", text: node.text, color: node.color ?? "#ffffff", fontSize: node.fontSize ?? 18, fontFamily: node.fontFamily ?? "Geist", fontWeight: node.fontWeight ?? 600 })}`
      break
    }
    case "input":
      body = `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="8" fill="#ffffff" stroke="#8b95a5"/><text x="${-width / 2 + 12}" text-anchor="start" dominant-baseline="middle" fill="#6b7280" font-family="${escapeXml(renderFontFamilyName(node.fontFamily ?? "Geist", node.fontWeight ?? 500))}" font-size="${node.fontSize ?? 16}" font-weight="${node.fontWeight ?? 500}">${escapeXml(node.placeholder ?? node.label ?? "")}</text>`
      break
    case "select":
      body = `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="8" fill="#ffffff" stroke="#8b95a5"/><text x="${-width / 2 + 12}" text-anchor="start" dominant-baseline="middle" fill="#6b7280" font-family="${escapeXml(renderFontFamilyName(node.fontFamily ?? "Geist", node.fontWeight ?? 500))}" font-size="${node.fontSize ?? 16}" font-weight="${node.fontWeight ?? 500}">${escapeXml(node.placeholder ?? "Choose an answer")}</text>`
      break
    case "mesh3d":
      body = renderMesh(node, camera, lights, transition)
      return body
  }
  return `<g transform="${transform}" opacity="${opacity}"${clipId ? ` clip-path="url(#${clipId})"` : ""}${maskId ? ` mask="url(#${maskId})"` : ""}${filterId ? ` filter="url(#${filterId})"` : ""}>${body}${vignetteOverlay}</g>`
}

function renderMesh(
  node: Mesh3DNode,
  camera: Camera3D | undefined,
  lights: Light3D[],
  transition: { x: number; y: number; opacity: number },
) {
  const faces = projectMesh3D(node, camera, { width: node.width, height: node.height }, lights)
  return faces
    .map((face) => {
      const points = face.points
        .map(([x, y]) => `${node.x + x - node.width / 2 + transition.x},${node.y + y - node.height / 2 + transition.y}`)
        .join(" ")
      const stroke = face.stroke ?? node.stroke ?? "none"
      return `<polygon points="${points}" fill="${node.material?.wireframe ? "none" : face.fill}" stroke="${stroke}" stroke-width="${node.stroke ? 0.8 : 0.55}" opacity="${(node.opacity ?? 1) * transition.opacity}"/>`
    })
    .join("")
}

export async function renderSceneSvg(
  composition: VideoComposition,
  scene: Scene,
  frame: number,
  options: SvgFrameOptions,
) {
  const transitionDuration = scene.transition?.durationFrames ?? 0
  const progress = transitionDuration > 0 ? Math.max(0, Math.min(1, frame / transitionDuration)) : 1
  const type = scene.transition?.type
  const amount = type === "fade" ? progress : 1
  const offset =
    type === "slide-left"
      ? (1 - progress) * composition.stage.width
      : type === "slide-right"
        ? -(1 - progress) * composition.stage.width
        : 0
  const transition = { x: offset, y: 0, opacity: amount }
  const nodes = applyComputedTexts(withGrainFrameSeeds(evaluateSceneAtFrame(scene, frame, options.hiddenNodes), frame))
  const paintDefinitions: string[] = []
  const shared = { clipDefs: new Map<string, string>(), filterDefs: new Map<string, string>() }
  const content = await Promise.all(
    nodes.map((node) => {
      const physics = options.physics?.[node.id]
      const physics3d = options.physics3d?.[node.id]
      const with2dPhysics = physics ? ({ ...node, x: physics.x, y: physics.y } as VisualNode) : node
      const renderedNode =
        physics3d && with2dPhysics.kind === "mesh3d"
          ? { ...with2dPhysics, position: physics3d.position, rotation3d: physics3d.rotation }
          : with2dPhysics
      return renderNode(
        renderedNode,
        scene,
        composition,
        scene.camera3d,
        options,
        scene.lights3d ?? [],
        transition,
        paintDefinitions,
        shared,
      )
    }),
  )

  const centerX = composition.stage.width / 2
  const centerY = composition.stage.height / 2
  const stageScale = type === "zoom" ? 0.82 + progress * 0.18 : 1
  const flipScale = type === "flip-3d" ? Math.max(0.025, Math.sin((progress * Math.PI) / 2)) : 1
  const transform =
    stageScale !== 1 || flipScale !== 1
      ? `translate(${centerX} ${centerY}) scale(${stageScale * flipScale} ${stageScale}) translate(${-centerX} ${-centerY})`
      : undefined
  const clipId = `scene-transition-${scene.id.replace(/[^A-Za-z0-9_-]/g, "")}`
  const clipDefinition =
    type === "wipe-left" || type === "wipe-right"
      ? `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="${type === "wipe-right" ? composition.stage.width * (1 - progress) : 0}" y="0" width="${composition.stage.width * progress}" height="${composition.stage.height}"/></clipPath>`
      : ""
  const definitions =
    paintDefinitions.length || clipDefinition ? `<defs>${paintDefinitions.join("")}${clipDefinition}</defs>` : ""
  let renderedContent = content.join("")
  if (transform) renderedContent = `<g transform="${transform}">${renderedContent}</g>`
  if (type === "wipe-left" || type === "wipe-right")
    renderedContent = `<g clip-path="url(#${clipId})">${renderedContent}</g>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${composition.stage.width}" height="${composition.stage.height}" viewBox="0 0 ${composition.stage.width} ${composition.stage.height}">`,
    `<rect width="100%" height="100%" fill="${scene.background ?? composition.stage.background ?? "#10131b"}"/>`,
    definitions,
    renderedContent,
    "</svg>",
  ].join("")
}
