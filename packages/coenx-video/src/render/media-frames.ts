import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Scene, VideoComposition, VisualNode } from "../model/types"
import { resolveImageMagickRuntime } from "./rasterizer"
import { runBuffer } from "./process"

const FFMPEG = process.env.COENX_VIDEO_FFMPEG ?? "ffmpeg"
const FFPROBE = process.env.COENX_VIDEO_FFPROBE ?? "ffprobe"

const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_GIF_FRAMES = 240
const MAX_VIDEO_SECONDS = 3600
const MAX_CACHED_FRAMES = 600
const MAX_IMAGE_EDGE = 4096

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/png": ".png",
  "image/apng": ".apng",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-matroska": ".mkv",
  "font/ttf": ".ttf",
  "font/otf": ".otf",
  "font/woff": ".woff",
  "font/woff2": ".woff2",
  "application/x-font-ttf": ".ttf",
  "application/x-font-otf": ".otf",
  "application/font-woff": ".woff",
  "application/font-woff2": ".woff2",
  "application/x-font-woff": ".woff2",
}

const EXTENSION_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
}

export interface MediaAssetInfo {
  identity: string
  /** Local file holding the (decoded-from-data-URI when needed) source bytes. */
  path: string
  extension: string
  mime: string
  kind: "image" | "gif" | "video"
  /** Animated GIF metadata. */
  frames?: number
  /** Seconds each GIF frame stays on screen (constant-delay assumption). */
  frameDelaySeconds?: number
  /** Decoded GIF frame directory (frame-0001.png...). */
  frameDirectory?: string
  /** Video metadata. */
  durationSeconds?: number
  width?: number
  height?: number
}

export interface MediaNodeBinding {
  info: MediaAssetInfo
  /** Scene-local seconds the media starts at inside the composition. */
  sourceStartSeconds: number
  playbackRate: number
  kind: "image" | "video"
  /** Animated GIFs get frame-by-frame overrides; static images never do. */
  animated: boolean
}

export interface MediaFrameOverrides {
  /** nodeId -> decoded PNG file path to composite for this frame. */
  paths: Record<string, string>
}

function extensionForMime(mime: string): string {
  const extension = MIME_TO_EXTENSION[mime.toLowerCase()]
  if (!extension) throw new Error(`Unsupported media MIME type: ${mime}`)
  return extension
}

async function insideRealroot(root: string, candidate: string): Promise<string | undefined> {
  try {
    const resolved = await realpath(candidate)
    const relative = path.relative(root, resolved)
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined
    return resolved
  } catch {
    return undefined
  }
}

/**
 * Resolves a media source reference. Allowed forms:
 * - `data:image/...;base64,...` and `data:video/...;base64,...` (embedded)
 * - `tmp:<path relative to os.tmpdir()>` (outside files in temp space)
 * - absolute paths that resolve inside the project root or os.tmpdir()
 * - relative paths inside the project root
 * Remote URLs are always rejected.
 */
export async function resolveMediaSource(
  asset: string,
  configured: string | undefined,
  projectRoot: string,
  tempRoot: string,
  sourceFiles: Map<string, string>,
): Promise<{ identity: string; path: string; extension: string; mime: string }> {
  const value = configured ?? asset

  const data = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(value)
  if (data) {
    const mime = data[1].toLowerCase()
    const extension = extensionForMime(mime)
    const bytes = Buffer.from(data[2].replaceAll(/\s/g, ""), "base64")
    if (!bytes.length || bytes.byteLength > MAX_SOURCE_BYTES) {
      throw new Error(`Media asset ${asset} exceeds the 64 MB source limit`)
    }
    const identity = createHash("sha256").update(mime).update(bytes).digest("hex")
    let sourcePath = sourceFiles.get(identity)
    if (!sourcePath) {
      sourcePath = path.join(tempRoot, `source-${identity}${extension}`)
      await writeFile(sourcePath, bytes)
      sourceFiles.set(identity, sourcePath)
    }
    return { identity, path: sourcePath, extension, mime }
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw new Error(`Remote media assets are not supported: ${asset}`)
  }

  const tmpRoot = await realpath(os.tmpdir())

  const tryResolve = async (root: string, candidate: string) => {
    const resolved = await insideRealroot(root, candidate)
    if (!resolved) return undefined
    const info = await stat(resolved).catch(() => undefined)
    if (!info?.isFile()) return undefined
    if (info.size <= 0 || info.size > MAX_SOURCE_BYTES) {
      throw new Error(`Media asset must be between 1 byte and 64 MB: ${asset}`)
    }
    return { resolved, info }
  }

  const finalize = async (root: string, found: NonNullable<Awaited<ReturnType<typeof tryResolve>>>) => {
    const { resolved, info } = found
    const extension = path.extname(resolved).toLowerCase()
    const mime = EXTENSION_MIME[extension] ?? (extension === ".svg" ? "image/svg+xml" : extension === ".gif" ? "image/gif" : "application/octet-stream")
    const identity = createHash("sha256").update(`${resolved}:${info.size}:${info.mtimeMs}`).digest("hex")
    let sourcePath = sourceFiles.get(identity)
    if (!sourcePath) {
      sourcePath = path.join(tempRoot, `source-${identity}${extension}`)
      await copyFile(resolved, sourcePath)
      sourceFiles.set(identity, sourcePath)
    }
    return { identity, path: sourcePath, extension, mime }
  }

  if (value.startsWith("tmp:")) {
    const rest = value.slice(4)
    if (!rest || rest === "/") throw new Error(`tmp: media asset ${asset} needs a path after the prefix`)
    // Both `tmp:relative/path` (under the temp dir) and `tmp:/absolute/path`
    // (must itself resolve inside the temp dir) are accepted.
    const candidate = path.isAbsolute(rest) ? path.resolve(rest) : path.resolve(tmpRoot, rest)
    const found = await tryResolve(tmpRoot, candidate)
    if (found) return finalize(tmpRoot, found)
    throw new Error(`tmp: media asset ${asset} does not exist under the temp directory`)
  }

  if (path.isAbsolute(value)) {
    const direct = await tryResolve(projectRoot, path.resolve(value))
    if (direct) return finalize(projectRoot, direct)
    const tempHit = await tryResolve(tmpRoot, path.resolve(value))
    if (tempHit) return finalize(tmpRoot, tempHit)
    throw new Error(`Absolute media asset ${asset} must resolve inside the project root or the temp directory`)
  }

  const found = await tryResolve(projectRoot, path.resolve(projectRoot, value))
  if (found) return finalize(projectRoot, found)
  throw new Error(
    `Media asset ${asset} could not be resolved to a local file inside the project root (or use tmp: / data: / an absolute temp-directory path)`,
  )
}

export class MediaFrameCache {
  private readonly bindings = new Map<string, MediaNodeBinding>()
  private readonly frameCache = new Map<string, string>()

  private constructor(
    private readonly tempRoot: string,
    private readonly frameDirectory: string,
  ) {}

  static async prepare(composition: VideoComposition, projectRoot: string, tempRoot: string, signal?: AbortSignal) {
    const cache = new MediaFrameCache(tempRoot, path.join(tempRoot, "media-frames"))
    await mkdir(cache.frameDirectory, { recursive: true })
    const sourceFiles = new Map<string, string>()
    for (const scene of composition.scenes) {
      for (const node of scene.nodes) {
        if (node.kind !== "video" && node.kind !== "image") continue
        if (signal?.aborted) throw new Error("Media preparation was cancelled")
        if (cache.bindings.has(node.id)) continue
        const source = await resolveMediaSource(node.asset, composition.assets?.[node.asset], projectRoot, tempRoot, sourceFiles)
        if (node.kind === "video") {
          cache.bindings.set(node.id, await cache.videoBinding(node, source))
          continue
        }
        const animated = source.extension === ".gif"
        cache.bindings.set(node.id, {
          info: await (animated ? cache.gifInfo(source) : Promise.resolve(imageInfo(source))),
          sourceStartSeconds: 0,
          playbackRate: 1,
          kind: "image",
          animated,
        })
      }
    }
    return cache
  }

  private async videoBinding(node: Extract<VisualNode, { kind: "video" }>, source: { identity: string; path: string; extension: string; mime: string }) {
    const probe = await runBuffer(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration:stream=width,height,avg_frame_rate", "-of", "json", source.path],
      { maxOutputBytes: 1024 * 1024 },
    )
    const parsed = JSON.parse(probe.stdout.toString("utf8")) as {
      format?: { duration?: string }
      streams?: Array<{ width?: number; height?: number }>
    }
    const duration = Number(parsed.format?.duration ?? 0)
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Video asset has no decodable duration: ${node.asset}`)
    if (duration > MAX_VIDEO_SECONDS) throw new Error(`Video asset exceeds the ${MAX_VIDEO_SECONDS}s limit: ${node.asset}`)
    const stream = parsed.streams?.find((item) => item.width && item.height)
    const sourceStart = Math.max(0, node.sourceStartSeconds ?? 0)
    const rate = Math.max(0.1, Math.min(4, node.playbackRate ?? 1))
    if (sourceStart >= duration) throw new Error(`Video node ${node.id} starts beyond the end of ${node.asset}`)
    return {
      info: {
        ...source,
        kind: "video" as const,
        durationSeconds: duration,
        width: stream?.width,
        height: stream?.height,
      },
      sourceStartSeconds: sourceStart,
      playbackRate: rate,
      kind: "video" as const,
      animated: true,
    } satisfies MediaNodeBinding
  }

  private async gifInfo(source: { identity: string; path: string; extension: string; mime: string }) {
    const runtime = await resolveImageMagickRuntime()
    const identify = await runBuffer(
      runtime.binary,
      ["-limit", "memory", "256MiB", "-format", "%T\n", source.path, "info:"],
      { maxOutputBytes: 256 * 1024, env: runtime.env },
    ).catch(async () => {
      // Fall back to a single-frame static image when identify is unavailable.
      return { stdout: Buffer.from("0\n"), stderr: "" }
    })
    // identify walks every frame of the sequence: one line per frame.
    const lines = identify.stdout.toString("utf8").trim().split(/\r?\n/).filter((line) => line.length > 0)
    const frames = Math.max(1, Math.min(MAX_GIF_FRAMES, lines.length))
    const delayCs = Math.max(2, Number.parseInt(lines[0] ?? "8", 10) || 8)
    const directory = path.join(this.tempRoot, `gif-${source.identity}`)
    await mkdir(directory, { recursive: true })
    await runBuffer(
      runtime.binary,
      [
        "-limit", "memory", "256MiB",
        "-limit", "map", "512MiB",
        "-limit", "disk", "512MiB",
        "-limit", "thread", "1",
        source.path,
        "-coalesce",
        "-resize", `${MAX_IMAGE_EDGE}x${MAX_IMAGE_EDGE}>`,
        "-depth", "8",
        path.join(directory, "frame-%04d.png"),
      ],
      { maxOutputBytes: 1024 * 1024, env: runtime.env },
    )
    return {
      ...source,
      kind: "gif" as const,
      frames,
      frameDelaySeconds: delayCs / 100,
      frameDirectory: directory,
    } satisfies MediaAssetInfo
  }

  binding(nodeId: string) {
    return this.bindings.get(nodeId)
  }

  /** Decodes one video frame at `seconds` and returns a cached PNG path. */
  async videoFrame(info: MediaAssetInfo, seconds: number, retry = true): Promise<string> {
    const duration = info.durationSeconds ?? Number.POSITIVE_INFINITY
    const clamped = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.05))
    const quantized = clamped.toFixed(2)
    const key = `${info.identity}@${quantized}`
    const cached = this.frameCache.get(key)
    if (cached) return cached
    if (this.frameCache.size >= MAX_CACHED_FRAMES) this.frameCache.clear()
    const output = path.join(this.frameDirectory, `frame-${key.replace(/[^a-z0-9]/gi, "_")}.png`)
    await runBuffer(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-y", "-ss", quantized, "-i", info.path, "-frames:v", "1", "-update", "1", output],
      { maxOutputBytes: 1024 * 1024 },
    )
    const written = await stat(output).catch(() => undefined)
    if (!written || written.size === 0) {
      if (retry) return this.videoFrame(info, Math.max(0, clamped - 0.15), false)
      throw new Error(`Video frame decode produced no output at ${quantized}s`)
    }
    this.frameCache.set(key, output)
    return output
  }

  /** Resolves the media overrides for every animated media node in the scene. */
  async sceneFrameOverrides(scene: Scene, localFrame: number, fps: number): Promise<MediaFrameOverrides> {
    const paths: Record<string, string> = {}
    for (const node of scene.nodes) {
      const binding = this.bindings.get(node.id)
      if (!binding?.animated) continue
      if (binding.kind === "video") {
        const seconds = binding.sourceStartSeconds + (localFrame / fps) * binding.playbackRate
        paths[node.id] = await this.videoFrame(binding.info, seconds)
        continue
      }
      const frames = binding.info.frames ?? 1
      const delay = binding.info.frameDelaySeconds ?? 0.08
      const secondsPerFrame = Math.max(1, Math.round(delay * fps))
      const index = Math.floor(localFrame / secondsPerFrame) % frames
      paths[node.id] = path.join(binding.info.frameDirectory!, `frame-${String(index).padStart(4, "0")}.png`)
    }
    return { paths }
  }

  /** Inline data URI for a media frame (browser/interactive consumption). */
  async frameDataUri(info: MediaAssetInfo, seconds: number): Promise<string> {
    const file = await this.videoFrame(info, seconds)
    const bytes = await readFile(file)
    return `data:image/png;base64,${bytes.toString("base64")}`
  }

  /** Standalone temp workspace used for container packing and tests. */
  static async workspace(prefix: string) {
    return mkdtemp(path.join(os.tmpdir(), prefix))
  }
}

function imageInfo(source: { identity: string; path: string; extension: string; mime: string }): MediaAssetInfo {
  return { ...source, kind: "image" }
}
