import { spawn } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { locateScene } from "../animation/timeline"
import { RENDER_PROFILES, totalFrames, validateComposition } from "../model/validate"
import type { RenderOptions, RenderProfile, RenderResult, VideoComposition } from "../model/types"
import { physics3DPoseAt, simulatePhysics3D, type Physics3DSimulation } from "../physics/simulate3d"
import { buildAudioGraph } from "./audio"
import { prepareRenderFonts } from "./fonts"
import { NativeRendererSession } from "./native"
import { prepareNativeImageAssets } from "./native-assets"
import { MediaFrameCache } from "./media-frames"
import { runBuffer, waitForExit, writeWithBackpressure } from "./process"

const FFMPEG = process.env.COENX_VIDEO_FFMPEG ?? "ffmpeg"
const FFPROBE = process.env.COENX_VIDEO_FFPROBE ?? "ffprobe"
let active = false

function physics3dForScene(scene: VideoComposition["scenes"][number]) {
  if (!scene.physics3d) return undefined
  return {
    ...scene.physics3d,
    bodies: scene.physics3d.bodies.map((body) => {
      const node = scene.nodes.find((item) => item.id === body.nodeId)
      return node?.kind === "mesh3d"
        ? {
            ...body,
            position: body.position ?? node.position ?? [0, 0, 0],
            rotation: body.rotation ?? node.rotation3d ?? [0, 0, 0],
          }
        : body
    }),
  }
}

function profileFrom(input?: Partial<RenderProfile>): RenderProfile {
  const base = RENDER_PROFILES[input?.name ?? "balanced"]
  return { ...base, ...input, name: input?.name ?? base.name }
}

function outputInside(root: string, output: string) {
  const resolved = path.resolve(root, output)
  if (!resolved.startsWith(root + path.sep)) throw new Error("Video output must stay inside the project root")
  if (path.extname(resolved).toLowerCase() !== ".mp4") throw new Error("Video output must use .mp4")
  return resolved
}

async function verify(file: string, width: number, height: number, audio: boolean) {
  const { stdout } = await runBuffer(
    FFPROBE,
    ["-v", "error", "-show_entries", "stream=codec_type,width,height,codec_name", "-of", "json", file],
    { maxOutputBytes: 1024 * 1024 },
  )
  const streams =
    (
      JSON.parse(stdout.toString("utf8")) as {
        streams?: Array<{ codec_type: string; width?: number; height?: number }>
      }
    ).streams ?? []
  const video = streams.find((stream) => stream.codec_type === "video")
  if (!video || video.width !== width || video.height !== height) throw new Error("Native MP4 verification failed")
  if (audio && !streams.some((stream) => stream.codec_type === "audio")) {
    throw new Error("FFprobe did not find the requested audio stream")
  }
}

export async function renderNativeVideo(composition: VideoComposition, options: RenderOptions): Promise<RenderResult> {
  if (active) throw new Error("A native Coenx render is already active")
  const profile = profileFrom(options.profile)
  validateComposition(composition, profile)
  const { width, height, fps } = composition.stage
  const frames = totalFrames(composition)
  const projectRoot = await realpath(path.resolve(options.projectRoot ?? process.cwd()))
  const outputPath = outputInside(projectRoot, options.outputPath)
  const outputDir = await realpath(path.dirname(outputPath)).catch(async () => {
    await mkdir(path.dirname(outputPath), { recursive: true })
    return realpath(path.dirname(outputPath))
  })
  if (outputDir !== projectRoot && !outputDir.startsWith(projectRoot + path.sep)) {
    throw new Error("Video output directory resolves outside the project root")
  }
  try {
    await access(outputPath)
    throw new Error("Video output already exists; choose a new path")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const unsupported = composition.scenes.flatMap((scene) => scene.nodes.filter((node) => node.kind === "select"))
  if (unsupported.length) {
    throw new Error("Native video v1 cannot render: select nodes")
  }
  if (options.signal?.aborted) throw new Error("Native video render was cancelled")

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-native-video-"))
  const partialPath = outputPath + ".partial.mp4"
  let fontConfig: Awaited<ReturnType<typeof prepareRenderFonts>>
  let audio: Awaited<ReturnType<typeof buildAudioGraph>>
  let imageAssets: Awaited<ReturnType<typeof prepareNativeImageAssets>>
  let media: MediaFrameCache | undefined
  try {
    fontConfig = await prepareRenderFonts(composition, tempRoot)
    audio = await buildAudioGraph(composition, projectRoot)
    imageAssets = await prepareNativeImageAssets(composition, projectRoot, tempRoot, options.signal)
    media = await MediaFrameCache.prepare(composition, projectRoot, tempRoot, options.signal)
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true })
    throw error
  }
  active = true
  const framePath = path.join(tempRoot, "frame.png")
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
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
    String(frames),
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
    String(frames / fps),
    partialPath,
  )
  const ffmpeg = spawn(FFMPEG, args, { stdio: ["pipe", "ignore", "pipe"] })
  const stderr: Buffer[] = []
  let stderrSize = 0
  ffmpeg.stderr?.on("data", (chunk: Buffer) => {
    if (stderrSize >= 48 * 1024) return
    const part = chunk.subarray(0, 48 * 1024 - stderrSize)
    stderr.push(part)
    stderrSize += part.length
  })
  const abort = () => ffmpeg.kill("SIGKILL")
  options.signal?.addEventListener("abort", abort, { once: true })
  const encoderExit = waitForExit(ffmpeg, stderr)
  let native: NativeRendererSession | undefined
  try {
    native = await NativeRendererSession.start({
      fontConfigFile: fontConfig.fontConfigFile,
      signal: options.signal,
    })
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
    for (let frame = 0; frame < frames; frame++) {
      if (options.signal?.aborted) throw new Error("Native video render was cancelled")
      const located = locateScene(composition, frame)
      const physics = getPhysics3dSimulation(located.scene)
      const physics3d = physics
        ? Object.fromEntries(
            [...physics.bodyIndexes.keys()].flatMap((nodeId) => {
              const pose = physics3DPoseAt(physics, nodeId, located.localFrame)
              return pose ? [[nodeId, pose]] : []
            }),
          )
        : undefined
      const sceneImageAssets: Record<string, string> = { ...(imageAssets.get(located.scene.id) ?? {}) }
      if (media) Object.assign(sceneImageAssets, (await media.sceneFrameOverrides(located.scene, located.localFrame, fps)).paths)
      await native.renderFrame({
        composition,
        scene: located.scene,
        frame: located.localFrame,
        outputPath: framePath,
        physics3d,
        imageAssets: sceneImageAssets,
      })
      const png = await readFile(framePath)
      await writeWithBackpressure(ffmpeg, png)
      await rm(framePath, { force: true })
      completed++
      options.onProgress?.({
        frame: completed,
        totalFrames: frames,
        percent: Math.round((completed / frames) * 100),
      })
    }
    ffmpeg.stdin.end()
    await encoderExit
    if (options.signal?.aborted) throw new Error("Native video render was cancelled")
    await verify(partialPath, width, height, audio.outputLabel.length > 0)
    await rename(partialPath, outputPath)
    const info = await stat(outputPath)
    return {
      outputPath,
      width,
      height,
      fps,
      frames,
      durationSeconds: frames / fps,
      bytes: info.size,
    }
  } catch (error) {
    ffmpeg.kill("SIGKILL")
    await encoderExit.catch(() => undefined)
    await rm(partialPath, { force: true })
    throw error
  } finally {
    options.signal?.removeEventListener("abort", abort)
    await native?.close()
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    active = false
  }
}
