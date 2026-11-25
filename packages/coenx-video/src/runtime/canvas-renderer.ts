import type { Scene, Vec3, VideoComposition, VisualNode } from "../model/types"
import { evaluateSceneAtFrame } from "../animation/timeline"
import { effectPadding, canvasFilterValue, canvasFilterUnsupportedWarning } from "../render/effects"
import { projectMesh3D } from "../render/geometry3d"
import { canvasPaint } from "./canvas-paint"
import { resolvePaint } from "../render/paint"
import { resolveNodeMask } from "../render/mask"
import { pathCommandsToSvgD, resolveClipPath, resolveNodePath } from "../render/path"

export interface CanvasAssetResolver {
  (assetId: string, configuredPath: string | undefined): string
}

export interface CanvasRendererOptions {
  canvas: HTMLCanvasElement
  composition: VideoComposition
  resolveAsset?: CanvasAssetResolver
}

/**
 * CSS filter chaining (ctx.filter) is feature-detected once: every modern
 * browser supports it; when it is missing the Canvas backend degrades to
 * rendering without effects and dispatches a `coenx:renderer-warning` event
 * (explicit partial capability, never a silent drop).
 */
const CSS_FILTER_SUPPORTED =
  typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype

/** Hard renderer-side cap for one padded effect surface, mirroring the validation budget. */
const MAX_EFFECT_SURFACE_SIDE = 4096

export class CanvasVideoRenderer {
  private context: CanvasRenderingContext2D
  private readonly images = new Map<string, HTMLImageElement>()
  private readonly failedImages = new Set<string>()
  /** Reused node-box offscreen surface for mask compositing; resized per masked node. */
  private readonly scratch: HTMLCanvasElement
  private readonly scratchContext: CanvasRenderingContext2D
  /** Second offscreen for the effect-filtered copy (content -> effects -> mask). */
  private readonly effectScratch: HTMLCanvasElement
  private readonly effectScratchContext: CanvasRenderingContext2D
  private warnedAboutFilters = false

  constructor(private readonly options: CanvasRendererOptions) {
    const context = options.canvas.getContext("2d", { alpha: false, desynchronized: true })
    if (!context) throw new Error("Canvas 2D is unavailable in this browser")
    this.context = context
    this.options.canvas.width = options.composition.stage.width
    this.options.canvas.height = options.composition.stage.height
    this.scratch = document.createElement("canvas")
    const scratchContext = this.scratch.getContext("2d", { willReadFrequently: false })
    if (!scratchContext) throw new Error("Canvas 2D is unavailable for mask compositing")
    this.scratchContext = scratchContext
    this.effectScratch = document.createElement("canvas")
    const effectScratchContext = this.effectScratch.getContext("2d", { willReadFrequently: false })
    if (!effectScratchContext) throw new Error("Canvas 2D is unavailable for effect compositing")
    this.effectScratchContext = effectScratchContext
  }

  draw(
    scene: Scene,
    frame: number,
    hidden: ReadonlySet<string>,
    physics3d?: Record<string, { position: Vec3; rotation: Vec3 }>,
  ) {
    const { context, options } = this
    const { width, height } = options.composition.stage
    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = scene.background ?? options.composition.stage.background ?? "#10131b"
    context.fillRect(0, 0, width, height)
    for (const node of evaluateSceneAtFrame(scene, frame, hidden)) {
      const pose = physics3d?.[node.id]
      const rendered =
        pose && node.kind === "mesh3d" ? { ...node, position: pose.position, rotation3d: pose.rotation } : node
      this.drawNode(rendered, scene)
    }
    context.restore()
  }

  private drawNode(node: VisualNode, scene: Scene) {
    const context = this.context
    const opacity = Math.max(0, Math.min(1, node.opacity ?? 1))
    if (opacity === 0) return
    // Meshes draw in stage space with their own transform/alpha handling and
    // can never carry clips, masks or effects (validation rejects all three).
    if (node.kind === "mesh3d") {
      this.drawMesh(node, scene)
      return
    }
    const mask = resolveNodeMask(node, scene)
    const effects = node.effects
    const hasEffects = !!effects?.length
    if (hasEffects && !CSS_FILTER_SUPPORTED && !this.warnedAboutFilters) {
      this.warnedAboutFilters = true
      this.options.canvas.dispatchEvent(
        new CustomEvent("coenx:renderer-warning", {
          detail: { message: canvasFilterUnsupportedWarning(effects, CSS_FILTER_SUPPORTED) },
        }),
      )
    }
    context.save()
    context.globalAlpha = opacity
    context.translate(node.x, node.y)
    context.rotate(((node.rotation ?? 0) * Math.PI) / 180)
    context.scale(node.scaleX ?? 1, node.scaleY ?? 1)
    const { width, height } = node
    const clip = resolveClipPath(node, scene)
    if (clip) context.clip(new Path2D(pathCommandsToSvgD(clip.commands, width, height)), clip.fillRule)
    if (mask || (hasEffects && CSS_FILTER_SUPPORTED)) {
      // Bounded isolated compositing: render the node body into a padded
      // node-box offscreen, apply the filter chain while blitting between
      // offscreens (content -> effects), multiply mask alpha with
      // destination-in, then blit under the main-context clip.
      const pad = hasEffects ? effectPadding(effects!) : 0
      const body = this.beginScratch(this.scratch, this.scratchContext, width, height, pad)
      const previous = this.context
      this.context = body.scratch
      try {
        this.drawNodeBody(node, scene)
      } finally {
        this.context = previous
      }
      let surface = body.surface
      let activeScratch = body.scratch
      if (hasEffects && CSS_FILTER_SUPPORTED) {
        const filtered = this.beginScratch(this.effectScratch, this.effectScratchContext, width, height, pad)
        // Both offscreens share the same padded dimensions: identity blit,
        // with the CSS filter chain applied to the drawing operation.
        filtered.scratch.setTransform(1, 0, 0, 1, 0, 0)
        filtered.scratch.globalAlpha = 1
        filtered.scratch.filter = canvasFilterValue(effects)
        filtered.scratch.drawImage(surface, 0, 0)
        filtered.scratch.filter = "none"
        surface = filtered.surface
        activeScratch = filtered.scratch
      }
      if (mask) {
        activeScratch.setTransform(1, 0, 0, 1, surface.width / 2, surface.height / 2)
        activeScratch.globalCompositeOperation = "destination-in"
        activeScratch.globalAlpha = 1
        for (const shape of mask.shapes) {
          activeScratch.fillStyle = canvasPaint(activeScratch, width, height, resolvePaint(shape.paint, scene), "transparent")
          activeScratch.fill(new Path2D(pathCommandsToSvgD(shape.commands, width, height)), shape.fillRule)
        }
        activeScratch.globalCompositeOperation = "source-over"
        activeScratch.setTransform(1, 0, 0, 1, 0, 0)
      }
      context.globalAlpha = opacity
      context.drawImage(surface, -surface.width / 2, -surface.height / 2, surface.width, surface.height)
      context.globalAlpha = 1
      context.restore()
      return
    }
    this.drawNodeBody(node, scene)
    context.restore()
  }

  private beginScratch(
    surface: HTMLCanvasElement,
    scratch: CanvasRenderingContext2D,
    width: number,
    height: number,
    pad: number,
  ) {
    const boundedWidth = Math.max(
      1,
      Math.min(Math.ceil(width) + pad * 2, MAX_EFFECT_SURFACE_SIDE),
    )
    const boundedHeight = Math.max(
      1,
      Math.min(Math.ceil(height) + pad * 2, MAX_EFFECT_SURFACE_SIDE),
    )
    if (surface.width !== boundedWidth || surface.height !== boundedHeight) {
      surface.width = boundedWidth
      surface.height = boundedHeight
    } else {
      scratch.setTransform(1, 0, 0, 1, 0, 0)
    }
    scratch.globalCompositeOperation = "source-over"
    scratch.globalAlpha = 1
    scratch.filter = "none"
    scratch.clearRect(0, 0, boundedWidth, boundedHeight)
    scratch.translate(boundedWidth / 2, boundedHeight / 2)
    return { surface, scratch }
  }

  private drawNodeBody(node: VisualNode, scene: Scene) {
    const context = this.context
    const { width, height } = node
    switch (node.kind) {
      case "rect":
        context.fillStyle = canvasPaint(context, width, height, resolvePaint(node.fill, scene), "transparent")
        context.strokeStyle = node.stroke ?? "transparent"
        context.lineWidth = node.strokeWidth ?? 1
        this.roundRect(-width / 2, -height / 2, width, height, node.radius ?? 0, node.fill !== "none", !!node.stroke)
        break
      case "ellipse":
        context.beginPath()
        context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2)
        context.fillStyle = canvasPaint(context, width, height, resolvePaint(node.fill, scene), "transparent")
        context.strokeStyle = node.stroke ?? "transparent"
        context.lineWidth = node.strokeWidth ?? 1
        if (node.fill && node.fill !== "none") context.fill()
        if (node.stroke) context.stroke()
        break
      case "path": {
        const resolved = resolveNodePath(node, scene)
        const path = new Path2D(pathCommandsToSvgD(resolved.commands, width, height))
        if (node.fill && node.fill !== "none") {
          context.fillStyle = canvasPaint(context, width, height, resolvePaint(node.fill, scene), "transparent")
          context.fill(path, resolved.fillRule)
        }
        if (node.stroke) {
          context.strokeStyle = node.stroke
          context.lineWidth = node.strokeWidth ?? 1
          context.lineCap = node.lineCap ?? "butt"
          context.lineJoin = node.lineJoin ?? "miter"
          context.stroke(path)
        }
        break
      }
      case "line":
        if (node.points.length > 1) {
          context.beginPath()
          context.moveTo(node.points[0][0] - width / 2, node.points[0][1] - height / 2)
          for (const point of node.points.slice(1)) context.lineTo(point[0] - width / 2, point[1] - height / 2)
          context.strokeStyle = node.stroke
          context.lineWidth = node.strokeWidth ?? 2
          context.lineCap = node.lineCap ?? "round"
          context.stroke()
        }
        break
      case "text":
        this.drawText(node.text, node, width, height)
        break
      case "image":
        this.drawImage(node)
        break
      case "button":
        context.fillStyle = node.disabled ? "#666666" : canvasPaint(context, width, height, resolvePaint(node.fill, scene), "#315fe8")
        this.roundRect(-width / 2, -height / 2, width, height, node.radius ?? 12, true, false)
        this.drawText(
          node.text,
          {
            fontSize: node.fontSize ?? 18,
            color: node.color ?? "#ffffff",
            fontFamily: node.fontFamily,
            fontWeight: node.fontWeight ?? 600,
            align: "center",
          },
          width,
          height,
        )
        break
      case "input":
      case "select":
        context.fillStyle = "#ffffff"
        context.strokeStyle = "#8b95a5"
        this.roundRect(-width / 2, -height / 2, width, height, 8, true, true)
        const placeholder = node.kind === "input" ? (node.placeholder ?? node.label ?? " ") : (node.placeholder ?? " ")
        this.drawText(
          placeholder,
          {
            fontSize: node.fontSize ?? 16,
            color: "#6b7280",
            fontFamily: node.fontFamily,
            fontWeight: node.fontWeight,
            align: "left",
          },
          width,
          height,
          12,
        )
        break
      case "mesh3d":
        // Unreachable here: meshes are handled in drawNode before transforms.
        break
    }
    context.restore()
  }

  private drawMesh(node: Extract<VisualNode, { kind: "mesh3d" }>, scene: Scene) {
    const context = this.context
    const faces = projectMesh3D(node, scene.camera3d, { width: node.width, height: node.height }, scene.lights3d ?? [])
    context.save()
    context.globalAlpha = Math.max(0, Math.min(1, node.opacity ?? 1))
    for (const face of faces) {
      context.beginPath()
      face.points.forEach(([x, y], index) => {
        const px = node.x + x
        const py = node.y + y
        if (index === 0) context.moveTo(px, py)
        else context.lineTo(px, py)
      })
      context.closePath()
      if (!node.material?.wireframe) {
        context.fillStyle = face.fill
        context.fill()
      }
      const stroke = face.stroke ?? node.stroke
      if (stroke) {
        context.strokeStyle = stroke
        context.lineWidth = node.stroke ? 0.8 : 0.55
        context.stroke()
      }
    }
    context.restore()
  }

  private drawText(
    text: string,
    style: {
      fontSize?: number
      color?: string
      fontFamily?: string
      fontWeight?: number | string
      align?: "left" | "center" | "right"
    },
    width: number,
    height: number,
    padding = 0,
  ) {
    const context = this.context
    const fontSize = style.fontSize ?? 32
    context.font = `${style.fontWeight ?? 500} ${fontSize}px ${style.fontFamily ?? "Geist"}`
    context.fillStyle = style.color ?? "#ffffff"
    context.textAlign = style.align ?? "center"
    context.textBaseline = "middle"
    const lines = text.split("\n")
    const lineHeight = fontSize * 1.2
    const start = -((lines.length - 1) * lineHeight) / 2
    const x = style.align === "left" ? -width / 2 + padding : style.align === "right" ? width / 2 - padding : 0
    lines.forEach((line, index) =>
      context.fillText(line, x, start + index * lineHeight, Math.max(1, width - padding * 2)),
    )
    void height
  }

  private roundRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: boolean,
    stroke: boolean,
  ) {
    const context = this.context
    const r = Math.min(radius, width / 2, height / 2)
    context.beginPath()
    context.roundRect(x, y, width, height, r)
    if (fill) context.fill()
    if (stroke) context.stroke()
  }

  private drawImage(node: Extract<VisualNode, { kind: "image" }>) {
    const configured = this.options.composition.assets?.[node.asset]
    const source = this.options.resolveAsset?.(node.asset, configured) ?? configured ?? node.asset
    if (this.failedImages.has(node.asset)) return
    let image = this.images.get(node.asset)
    if (!image) {
      image = new Image()
      image.decoding = "async"
      image.onload = () => this.options.canvas.dispatchEvent(new Event("coenx:asset-ready"))
      image.onerror = () => this.failedImages.add(node.asset)
      image.src = source
      this.images.set(node.asset, image)
    }
    if (!image.complete || image.naturalWidth === 0) return
    const width = node.width
    const height = node.height
    const fit = node.fit ?? "contain"
    const scale =
      fit === "fill"
        ? [width / image.naturalWidth, height / image.naturalHeight]
        : [
            (fit === "cover" ? Math.max : Math.min)(width / image.naturalWidth, height / image.naturalHeight),
            (fit === "cover" ? Math.max : Math.min)(width / image.naturalWidth, height / image.naturalHeight),
          ]
    const drawWidth = image.naturalWidth * scale[0]
    const drawHeight = image.naturalHeight * scale[1]
    this.context.save()
    this.context.beginPath()
    this.context.rect(-width / 2, -height / 2, width, height)
    this.context.clip()
    this.context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
    this.context.restore()
  }

  destroy() {
    this.images.clear()
    this.failedImages.clear()
  }
}
