import { spawn } from "node:child_process"
import { mkdir, mkdtemp, realpath, rename, rm, writeFile, stat, access } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { locateScene } from "../animation/timeline"
import { RENDER_PROFILES, validateComposition } from "../model/validate"
import type { RenderOptions, RenderProfile, RenderResult, VideoComposition } from "../model/types"
import { simulatePhysics } from "../physics/simulate"
import { physics3DPoseAt, simulatePhysics3D, type Physics3DSimulation } from "../physics/simulate3d"
import type { PhysicsFrame } from "../physics/world"
import { renderSceneSvg } from "./scene-svg"
import { buildAudioGraph } from "./audio"
import { prepareRenderFonts } from "./fonts"
import { MediaFrameCache } from "./media-frames"
import { renderNativeVideo } from "./native-video"
import { resolveImageMagickRuntime } from "./rasterizer"
import { runBuffer, waitForExit, writeWithBackpressure } from "./process"

const FFMPEG = process.env.COENX_VIDEO_FFMPEG ?? "ffmpeg"
const FFPROBE = process.env.COENX_VIDEO_FFPROBE ?? "ffprobe"
let activeRenders = 0

function profileFrom(input?: Partial<RenderProfile>): RenderProfile {
  const base = RENDER_PROFILES[input?.name ?? "balanced"]
  return { ...base, ...input, name: input?.name ?? base.name }
}

function resolveOutput(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, candidate)
  if (!resolved.startsWith(resolvedRoot + path.sep))
    throw new Error("Video output path must stay inside the project root")
  if (path.extname(resolved).toLowerCase() !== ".mp4")
    throw new Error("Standard video output must use the .mp4 extension")
  return resolved
}

async function encodeFrameBatch(
  svgFiles: string[],
  width: number,
  height: number,
  limitBytes: number,
  threads: number,
  signal?: AbortSignal,
  fontConfigFile?: string,
) {
  const args = [
    "-limit",
    "memory",
    "256MiB",
    "-limit",
    "map",
    "512MiB",
    "-limit",
    "thread",
    String(threads),
    ...svgFiles,
    "-background",
    "black",
    "-alpha",
    "remove",
    "-alpha",
    "off",
    "-depth",
    "8",
    "RGB:-",
  ]
  const runtime = await resolveImageMagickRuntime()
  const env = fontConfigFile ? { ...runtime.env, FONTCONFIG_FILE: fontConfigFile } : runtime.env
  const { stdout } = await runBuffer(runtime.binary, args, { maxOutputBytes: limitBytes, signal, env })
  const expected = width * height * 3 * svgFiles.length
  if (stdout.byteLength !== expected)
    throw new Error(`Rasterizer returned ${stdout.byteLength} bytes; expected ${expected}`)
  return stdout
}

async function probeVideo(file: string, width: number, height: number, hasAudio: boolean) {
  const { stdout } = await runBuffer(
    FFPROBE,
    ["-v", "error", "-show_entries", "stream=codec_type,width,height,codec_name", "-of", "json", file],
    { maxOutputBytes: 1024 * 1024 },
  )
  const data = JSON.parse(stdout.toString("utf8")) as {
    streams?: Array<{ codec_type: string; width?: number; height?: number; codec_name?: string }>
  }
  const video = data.streams?.find((stream) => stream.codec_type === "video")
  const audio = data.streams?.find((stream) => stream.codec_type === "audio")
  if (!video || video.width !== width || video.height !== height)
    throw new Error("FFprobe could not verify the rendered MP4 video stream")
  if (hasAudio && !audio) throw new Error("FFprobe could not find the requested audio stream")
}

export function physicsForScene(scene: VideoComposition["scenes"][number]) {
  if (!scene.physics) return undefined
  return {
    ...scene.physics,
    bodies: scene.physics.bodies.map((body) => {
      if (body.position) return body
      const node = scene.nodes.find((item) => item.id === body.nodeId)
      return { ...body, position: [node?.x ?? 0, node?.y ?? 0] as const }
    }),
  }
}

function physics3dForScene(scene: VideoComposition["scenes"][number]) {
  if (!scene.physics3d) return undefined
  return {
    ...scene.physics3d,
    bodies: scene.physics3d.bodies.map((body) => {
      const node = scene.nodes.find((item) => item.id === body.nodeId)
      if (!node || node.kind !== "mesh3d") return body
      return {
        ...body,
        position: body.position ?? node.position ?? [0, 0, 0],
        rotation: body.rotation ?? node.rotation3d ?? [0, 0, 0],
      }
    }),
  }
}

export async function renderStandardVideo(
  composition: VideoComposition,
  options: RenderOptions,
): Promise<RenderResult> {
  if (options.renderer === "native") return renderNativeVideo(composition, options)
  if (activeRenders >= 1)
    throw new Error(
      "A video render is already active on this server; queue the next render instead of competing for RAM",
    )
  const profile = profileFrom(options.profile)
  const summary = validateComposition(composition, profile)
  if (options.signal?.aborted) throw new Error("Video render was cancelled")

  const fps = composition.stage.fps
  const width = composition.stage.width
  const height = composition.stage.height
  const totalFrames = summary.totalFrames
  const frameBytes = width * height * 3
  if (frameBytes > profile.maxRasterChunkBytes)
    throw new Error("One raster frame exceeds the configured memory budget for this render profile")
  const maxChunkFrames = Math.floor(profile.maxRasterChunkBytes / frameBytes)
  const chunkFrames = Math.max(1, Math.min(30, maxChunkFrames))

  const projectRoot = await realpath(path.resolve(options.projectRoot ?? process.cwd()))
  const outputPath = resolveOutput(projectRoot, options.outputPath)
  const outputDir = path.dirname(outputPath)
  await mkdir(outputDir, { recursive: true })
  const realOutputDir = await realpath(outputDir)
  if (realOutputDir !== projectRoot && !realOutputDir.startsWith(projectRoot + path.sep))
    throw new Error("Video output directory resolves outside the project root")
  try {
    await access(outputPath)
    throw new Error("Video output already exists; choose a new path instead of silently replacing it")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  const audio = await buildAudioGraph(composition, projectRoot)
  const partialPath = path.join(realOutputDir, path.basename(outputPath) + ".partial.mp4")
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-video-"))
  activeRenders++
  let media: MediaFrameCache | undefined
  try {
    media = await MediaFrameCache.prepare(composition, projectRoot, tempRoot)
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    activeRenders--
    throw error
  }
  let fontConfig: Awaited<ReturnType<typeof prepareRenderFonts>>
  try {
    fontConfig = await prepareRenderFonts(composition, tempRoot)
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    activeRenders--
    throw error
  }
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-video_size",
    width + "x" + height,
    "-framerate",
    String(fps),
    "-i",
    "pipe:0",
    ...audio.args,
  ]
  if (audio.filters.length) args.push("-filter_complex", audio.filters.join(";"))
  args.push(
    "-map",
    "0:v:0",
    ...(audio.outputLabel ? ["-map", audio.outputLabel] : ["-an"]),
    "-frames:v",
    String(totalFrames),
    "-r",
    String(fps),
    "-fps_mode",
    "cfr",
    "-c:v",
    "libx264",
    "-preset",
    options.preset ?? "fast",
    "-crf",
    String(options.quality ?? 21),
    "-pix_fmt",
    "yuv420p",
    "-threads",
    String(profile.ffmpegThreads),
    ...(audio.outputLabel ? ["-c:a", "aac", "-b:a", "192k"] : []),
    "-movflags",
    "+faststart",
    "-t",
    String(totalFrames / fps),
    partialPath,
  )
  const ffmpeg = spawn(FFMPEG, args, { stdio: ["pipe", "ignore", "pipe"] })
  const stderr: Buffer[] = []
  let stderrBytes = 0
  ffmpeg.stderr.on("data", (chunk: Buffer) => {
    if (stderrBytes >= 48 * 1024) return
    const accepted = chunk.subarray(0, 48 * 1024 - stderrBytes)
    stderr.push(accepted)
    stderrBytes += accepted.byteLength
  })
  const abort = () => ffmpeg.kill("SIGTERM")
  options.signal?.addEventListener("abort", abort, { once: true })
  const encoderExit = waitForExit(ffmpeg, stderr)

  try {
    const physicsByScene = new Map<string, PhysicsFrame[]>()
    for (const scene of composition.scenes) {
      const settings = physicsForScene(scene)
      if (!settings) continue
      const simulation = await simulatePhysics(settings, scene.durationFrames - 1, {
        dt: 1 / fps,
        signal: options.signal,
      })
      physicsByScene.set(scene.id, simulation)
    }
    let physics3dSceneId: string | undefined
    let physics3dSimulation: Physics3DSimulation | undefined
    const getPhysics3dSimulation = (scene: VideoComposition["scenes"][number]) => {
      if (scene.id === physics3dSceneId) return physics3dSimulation
      physics3dSceneId = scene.id
      const settings = physics3dForScene(scene)
      physics3dSimulation = settings
        ? simulatePhysics3D(settings, scene.durationFrames - 1, { dt: 1 / fps, signal: options.signal })
        : undefined
      return physics3dSimulation
    }

    let completed = 0
    for (let start = 0; start < totalFrames; start += chunkFrames) {
      if (options.signal?.aborted) throw new Error("Video render was cancelled")
      const end = Math.min(totalFrames, start + chunkFrames)
      const batchDir = path.join(tempRoot, "batch-" + start)
      await mkdir(batchDir, { recursive: true })
      const files: string[] = []
      for (let frame = start; frame < end; frame++) {
        const located = locateScene(composition, frame)
        const physicsFrame = physicsByScene.get(located.scene.id)?.[located.localFrame]
        const positions = physicsFrame
          ? Object.fromEntries(physicsFrame.bodies.map((body) => [body.nodeId, { x: body.x, y: body.y }]))
          : undefined
        const framePhysics3d = getPhysics3dSimulation(located.scene)
        const positions3d = framePhysics3d
          ? Object.fromEntries(
              [...framePhysics3d.bodyIndexes.keys()].flatMap((nodeId) => {
                const pose = physics3DPoseAt(framePhysics3d, nodeId, located.localFrame)
                return pose ? [[nodeId, pose]] : []
              }),
            )
          : undefined
        const svg = await renderSceneSvg(composition, located.scene, located.localFrame, {
          projectRoot,
          physics: positions,
          physics3d: positions3d,
          mediaFrames: media ? (await media.sceneFrameOverrides(located.scene, located.localFrame, composition.stage.fps)).paths : undefined,
        })
        const file = path.join(batchDir, "frame-" + String(frame).padStart(8, "0") + ".svg")
        await writeFile(file, svg)
        files.push(file)
      }
      const raster = await encodeFrameBatch(
        files,
        width,
        height,
        frameBytes * files.length + 1024,
        profile.ffmpegThreads,
        options.signal,
        fontConfig.fontConfigFile,
      )
      await writeWithBackpressure(ffmpeg, raster)
      completed += files.length
      options.onProgress?.({ frame: completed, totalFrames, percent: Math.round((completed / totalFrames) * 100) })
      await rm(batchDir, { recursive: true, force: true })
    }

    ffmpeg.stdin.end()
    await encoderExit
    if (options.signal?.aborted) throw new Error("Video render was cancelled")
    await probeVideo(partialPath, width, height, (composition.audio?.length ?? 0) > 0)
    await rename(partialPath, outputPath)
    const info = await stat(outputPath)
    return {
      outputPath,
      width,
      height,
      fps,
      frames: totalFrames,
      durationSeconds: totalFrames / fps,
      bytes: info.size,
    }
  } catch (error) {
    ffmpeg.kill("SIGTERM")
    await encoderExit.catch(() => undefined)
    await rm(partialPath, { force: true })
    throw error
  } finally {
    options.signal?.removeEventListener("abort", abort)
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    activeRenders--
  }
}

export * as StandardRenderer from "./standard"
