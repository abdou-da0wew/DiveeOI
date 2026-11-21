import { access } from "node:fs/promises"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import type { Scene, Vec3, VideoComposition, VisualNode } from "../model/types"
import { projectMesh3D } from "./geometry3d"
import { evaluateSceneAtFrame } from "../animation/timeline"
import { resolveClipPath, resolveNodePath } from "./path"

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const NATIVE_ROOT = path.join(PACKAGE_ROOT, "native/coenx-video-native")

async function nativeBinary() {
  if (process.env.COENX_VIDEO_NATIVE) return process.env.COENX_VIDEO_NATIVE
  for (const profile of ["release", "debug"]) {
    const candidate = path.join(NATIVE_ROOT, "target", profile, "coenx-video-native")
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next build profile.
    }
  }
  throw new Error("Coenx native renderer is not built. Run bun run build:native in packages/coenx-video.")
}

export interface NativeFrameRequest {
  composition: VideoComposition
  scene: Scene
  frame: number
  outputPath: string
  physics3d?: Record<string, { position: Vec3; rotation: Vec3 }>
  imageAssets?: Record<string, string>
}

function supportedNodes(
  nodes: VisualNode[],
  scene: Scene,
  physics3d?: NativeFrameRequest["physics3d"],
  imageAssets?: NativeFrameRequest["imageAssets"],
): Array<VisualNode | Record<string, unknown>> {
  if (nodes.some((node) => node.kind === "select")) {
    throw new Error("Native renderer does not yet support select nodes")
  }

  const output: Array<VisualNode | Record<string, unknown>> = []
  for (const node of nodes) {
    const renderNode: Record<string, unknown> = { ...node }
    if (node.kind === "path") {
      const path = resolveNodePath(node, scene)
      renderNode.commands = path.commands
      renderNode.fillRule = path.fillRule
    }
    const clipPath = resolveClipPath(node, scene)
    if (clipPath) renderNode.clipPath = clipPath

    if (node.kind === "image") {
      const assetPath = imageAssets?.[node.id]
      if (!assetPath) throw new Error(`Native renderer could not resolve image asset: ${node.asset}`)
      output.push({ ...renderNode, assetPath })
      continue
    }
    if (node.kind !== "mesh3d") {
      output.push(renderNode)
      continue
    }
    const pose = physics3d?.[node.id]
    const mesh = pose ? { ...node, position: pose.position, rotation3d: pose.rotation } : node
    const faces = projectMesh3D(mesh, scene.camera3d, { width: node.width, height: node.height }, scene.lights3d ?? [])
    for (const [index, face] of faces.entries()) {
      output.push({
        id: `${node.id}-face-${index}`,
        kind: "polygon",
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        points: face.points,
        fill: node.material?.wireframe ? "none" : face.fill,
        stroke: face.stroke ?? node.stroke ?? "none",
        strokeWidth: node.stroke ? 0.8 : 0.55,
        opacity: node.opacity ?? 1,
      })
    }
  }
  return output
}

function applyFrameTransition(
  nodes: Array<VisualNode | Record<string, unknown>>,
  scene: Scene,
  frame: number,
  width: number,
  height: number,
) {
  const transition = scene.transition
  if (!transition) return { nodes, clipRect: undefined as number[] | undefined }
  const progress = Math.max(0, Math.min(1, frame / Math.max(1, transition.durationFrames)))
  let clipRect: number[] | undefined
  const scale = transition.type === "zoom" ? 0.82 + progress * 0.18 : 1
  const flipScale = transition.type === "flip-3d" ? Math.max(0.025, progress) : 1
  const shiftX =
    transition.type === "slide-left"
      ? (1 - progress) * width
      : transition.type === "slide-right"
        ? -(1 - progress) * width
        : 0
  if (transition.type === "wipe-left") clipRect = [0, 0, width * progress, height]
  if (transition.type === "wipe-right") clipRect = [width * (1 - progress), 0, width * progress, height]

  return {
    clipRect,
    nodes: nodes.map((node) => {
      const value = node as Record<string, unknown>
      const x = Number(value.x ?? 0)
      const y = Number(value.y ?? 0)
      const currentScaleX = Number(value.scaleX ?? 1)
      const currentScaleY = Number(value.scaleY ?? 1)
      const opacity = Number(value.opacity ?? 1)
      return {
        ...value,
        x: width / 2 + (x - width / 2) * scale + shiftX,
        y: height / 2 + (y - height / 2) * scale,
        scaleX: currentScaleX * scale * flipScale,
        scaleY: currentScaleY * scale,
        opacity: opacity * (transition.type === "fade" ? progress : 1),
      }
    }),
  }
}

export class NativeRendererSession {
  private readonly child: ChildProcess
  private readonly lines: ReturnType<typeof createInterface>
  private readonly iterator: AsyncIterator<string>
  private closed = false
  private requestCount = 0

  private constructor(child: ChildProcess) {
    this.child = child
    this.lines = createInterface({ input: child.stdout! })
    child.stderr?.on("data", () => undefined)
    this.iterator = this.lines[Symbol.asyncIterator]()
  }

  static async start(options: { fontConfigFile?: string; signal?: AbortSignal } = {}) {
    const binary = await nativeBinary()
    const env = options.fontConfigFile ? { ...process.env, FONTCONFIG_FILE: options.fontConfigFile } : process.env
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"], env })
    const session = new NativeRendererSession(child)
    options.signal?.addEventListener("abort", () => session.close(), { once: true })
    return session
  }

  async renderFrame(options: NativeFrameRequest) {
    if (this.closed || !this.child.stdin || !this.child.stdout) {
      throw new Error("Native renderer session is closed")
    }
    const nodes = supportedNodes(
      evaluateSceneAtFrame(options.scene, options.frame),
      options.scene,
      options.physics3d,
      options.imageAssets,
    )
    const transitioned = applyFrameTransition(
      nodes,
      options.scene,
      options.frame,
      options.composition.stage.width,
      options.composition.stage.height,
    )
    const payload = {
      op: "render_frame",
      width: options.composition.stage.width,
      height: options.composition.stage.height,
      background: options.scene.background ?? options.composition.stage.background ?? "#000000",
      output: path.resolve(options.outputPath),
      nodes: transitioned.nodes,
      ...(transitioned.clipRect ? { clipRect: transitioned.clipRect } : {}),
    }
    const line = JSON.stringify(payload) + "\n"
    if (!this.child.stdin.write(line)) {
      await new Promise<void>((resolve, reject) => {
        this.child.stdin!.once("drain", resolve)
        this.child.stdin!.once("error", reject)
      })
    }
    const result = await this.iterator.next()
    if (result.done) throw new Error("Native renderer exited before returning a frame result")
    const response = JSON.parse(result.value) as {
      error?: string
      output?: string
      nodeCount?: number
    }
    if (response.error) throw new Error("Coenx native renderer: " + response.error)
    if (response.output !== payload.output) {
      throw new Error("Native renderer returned an unexpected output path")
    }
    this.requestCount++
    return { outputPath: response.output, nodeCount: response.nodeCount ?? nodes.length }
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.lines.close()
    this.child.stdin?.end()
    if (this.child.exitCode === null) {
      await new Promise<void>((resolve) => {
        this.child.once("close", () => resolve())
        setTimeout(() => {
          this.child.kill("SIGTERM")
          resolve()
        }, 2000).unref()
      })
    }
  }
}

export async function renderNativeFrame(options: NativeFrameRequest & { signal?: AbortSignal }) {
  if (options.signal?.aborted) throw new Error("Native frame rendering was cancelled")
  const session = await NativeRendererSession.start({ signal: options.signal })
  try {
    return await session.renderFrame(options)
  } finally {
    await session.close()
  }
}
