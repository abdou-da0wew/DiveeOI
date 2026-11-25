import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runBuffer } from "./render/process"
import { renderSceneSvg } from "./render/scene-svg"
import { resolveImageMagickRuntime } from "./render/rasterizer"
import { locateScene } from "./animation/timeline"
import { validateComposition } from "./model/validate"
import type { VideoComposition } from "./model/types"

export interface PreviewFrame {
  frame: number
  width: number
  height: number
  bytes: Uint8Array
  mime: "image/png"
}

export interface PreviewOptions {
  /** Global frame indices to render, deduplicated and clamped to the composition. */
  frames: number[]
  /** Longest edge of the returned PNGs; 128–1280. */
  maxDimension?: number
  /** Local project root for image assets; omit when the project carries no file assets. */
  projectRoot?: string
  signal?: AbortSignal
}

export interface PreviewResult {
  backend: "static-svg"
  frames: PreviewFrame[]
  totalBytes: number
}

export const PREVIEW_BUDGETS = {
  maxFrames: 8,
  minDimension: 128,
  maxDimension: 1280,
  maxBytesPerFrame: 8 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
} as const

/**
 * Renders a bounded set of preview frames through the static SVG backend and
 * rasterizes them with the packaged ImageMagick runtime. Server-safe: no
 * FFmpeg, no native binary, hard caps on frame count, dimensions and bytes.
 * Image assets must be resolvable inside `projectRoot` (or inline data URLs);
 * a project referencing missing files fails with an actionable error.
 */
export async function renderPreviewFrames(
  composition: VideoComposition,
  options: PreviewOptions,
): Promise<PreviewResult> {
  const maxDimension = options.maxDimension ?? 640
  if (!Number.isFinite(maxDimension) || maxDimension < PREVIEW_BUDGETS.minDimension || maxDimension > PREVIEW_BUDGETS.maxDimension) {
    throw new Error(`Preview maxDimension must be between ${PREVIEW_BUDGETS.minDimension} and ${PREVIEW_BUDGETS.maxDimension}`)
  }
  const frames = [...new Set(options.frames.map((frame) => Math.floor(frame)))].slice(0, PREVIEW_BUDGETS.maxFrames)
  if (!frames.length) throw new Error("Preview requires at least one frame index")
  validateComposition(composition)

  const stage = composition.stage
  const scale = Math.min(1, maxDimension / Math.max(stage.width, stage.height))
  const width = Math.max(2, Math.round(stage.width * scale))
  const height = Math.max(2, Math.round(stage.height * scale))

  const runtime = await resolveImageMagickRuntime()
  const out: PreviewFrame[] = []
  let totalBytes = 0
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-preview-"))
  try {
    for (const frame of frames) {
      if (options.signal?.aborted) throw new Error("Preview was cancelled")
      const located = locateScene(composition, frame)
      const svg = await renderSceneSvg(composition, located.scene, located.localFrame, {
        projectRoot: options.projectRoot ?? process.cwd(),
      })
      const svgFile = path.join(tempRoot, `frame-${frame}.svg`)
      await writeFile(svgFile, scaledSvg(svg, width, height), "utf8")
      const args = [
        "-limit",
        "memory",
        "256MiB",
        "-limit",
        "map",
        "512MiB",
        svgFile,
        "-resize",
        `${width}x${height}!`,
        "-background",
        "black",
        "-alpha",
        "remove",
        "-alpha",
        "off",
        "png:-",
      ]
      const { stdout } = await runBuffer(runtime.binary, args, {
        maxOutputBytes: PREVIEW_BUDGETS.maxBytesPerFrame,
        signal: options.signal,
        env: runtime.env,
      })
      totalBytes += stdout.byteLength
      if (totalBytes > PREVIEW_BUDGETS.maxTotalBytes) {
        throw new Error("Preview exceeds the total byte budget; request fewer or smaller frames")
      }
      out.push({ frame, width, height, bytes: new Uint8Array(stdout), mime: "image/png" })
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
  }
  return { backend: "static-svg", frames: out, totalBytes }
}

function scaledSvg(svg: string, width: number, height: number) {
  return svg.replace(/^<svg ([^>]*?)width="\d+" height="\d+"/, `<svg $1width="${width}" height="${height}"`)
}
