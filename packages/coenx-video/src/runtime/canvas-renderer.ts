import type { Scene, Vec3, VideoComposition, VisualNode } from "../model/types"
import { evaluateSceneAtFrame } from "../animation/timeline"
import { projectMesh3D } from "../render/geometry3d"
import { canvasPaint } from "../render/paint"
import { pathCommandsToSvgD, resolveClipPath, resolveNodePath } from "../render/path"

export interface CanvasAssetResolver {
  (assetId: string, configuredPath: string | undefined): string
}

export interface CanvasRendererOptions {
  canvas: HTMLCanvasElement
  composition: VideoComposition
  resolveAsset?: CanvasAssetResolver
}

export class CanvasVideoRenderer {
  private readonly context: CanvasRenderingContext2D
  private readonly images = new Map<string, HTMLImageElement>()
  private readonly failedImages = new Set<string>()

  constructor(private readonly options: CanvasRendererOptions) {
    const context = options.canvas.getContext("2d", { alpha: false, desynchronized: true })
    if (!context) throw new Error("Canvas 2D is unavailable in this browser")
    this.context = context
    this.options.canvas.width = options.composition.stage.width
    this.options.canvas.height = options.composition.stage.height
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
    context.save()
    context.globalAlpha = opacity
    context.translate(node.x, node.y)
    context.rotate(((node.rotation ?? 0) * Math.PI) / 180)
    context.scale(node.scaleX ?? 1, node.scaleY ?? 1)
    const { width, height } = node
    const clip = resolveClipPath(node, scene)
    if (clip) context.clip(new Path2D(pathCommandsToSvgD(clip.commands, width, height)), clip.fillRule)
    switch (node.kind) {
      case "rect":
        context.fillStyle = canvasPaint(context, width, height, node.fill, "transparent")
        context.strokeStyle = node.stroke ?? "transparent"
        context.lineWidth = node.strokeWidth ?? 1
        this.roundRect(-width / 2, -height / 2, width, height, node.radius ?? 0, node.fill !== "none", !!node.stroke)
        break
      case "ellipse":
        context.beginPath()
        context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2)
        context.fillStyle = canvasPaint(context, width, height, node.fill, "transparent")
        context.strokeStyle = node.stroke ?? "transparent"
        context.lineWidth = node.strokeWidth ?? 1
        if (node.fill && node.fill !== "none") context.fill()
        if (node.stroke) context.stroke()
        break
      case "path": {
        const resolved = resolveNodePath(node, scene)
        const path = new Path2D(pathCommandsToSvgD(resolved.commands, width, height))
        if (node.fill && node.fill !== "none") {
          context.fillStyle = canvasPaint(context, width, height, node.fill, "transparent")
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
        context.fillStyle = node.disabled ? "#666666" : canvasPaint(context, width, height, node.fill, "#315fe8")
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
        context.restore()
        this.drawMesh(node, scene)
        return
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
