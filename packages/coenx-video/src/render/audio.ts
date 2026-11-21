import path from "node:path"
import { realpath } from "node:fs/promises"
import type { AudioClip, VideoComposition } from "../model/types"

export interface AudioInput {
  args: string[]
  filters: string[]
  outputLabel: string
}

export async function buildAudioGraph(composition: VideoComposition, projectRoot: string): Promise<AudioInput> {
  const tracks = composition.audio ?? []
  const args: string[] = []
  const filters: string[] = []
  const outputs: string[] = []
  const root = await realpath(projectRoot)
  const totalFrames = composition.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0)
  const totalDuration = totalFrames / composition.stage.fps

  for (let index = 0; index < tracks.length; index++) {
    const track: AudioClip = tracks[index]
    if (/^[a-z]+:\/\//i.test(track.source) || path.isAbsolute(track.source))
      throw new Error("Remote or absolute audio sources are not allowed; add the media to the project first")
    const source = path.resolve(root, track.source)
    if (!source.startsWith(root + path.sep)) throw new Error(`Audio track ${track.id} escapes the project root`)
    const verified = await realpath(source)
    if (!verified.startsWith(root + path.sep))
      throw new Error(`Audio track ${track.id} resolves outside the project root`)

    const startFrame = Math.floor(track.startFrame)
    const durationFrames = Math.min(track.durationFrames, totalFrames - startFrame)
    if (durationFrames <= 0) continue
    const start = Math.max(0, track.trimStartSeconds ?? 0)
    const duration = durationFrames / composition.stage.fps
    const delay = Math.round((startFrame / composition.stage.fps) * 1000)
    const volume = Math.max(0, Math.min(2, track.volume ?? 1))
    if (track.loop) args.push("-stream_loop", "-1")
    args.push("-i", verified)

    const parts = [
      `atrim=start=${start}:duration=${Math.min(duration, totalDuration)}`,
      "asetpts=PTS-STARTPTS",
      `volume=${volume}`,
      `adelay=${delay}:all=1`,
    ]
    if ((track.fadeInFrames ?? 0) > 0)
      parts.push(`afade=t=in:st=${delay / 1000}:d=${track.fadeInFrames! / composition.stage.fps}`)
    if ((track.fadeOutFrames ?? 0) > 0) {
      const fadeDuration = track.fadeOutFrames! / composition.stage.fps
      parts.push(`afade=t=out:st=${Math.max(0, delay / 1000 + duration - fadeDuration)}:d=${fadeDuration}`)
    }
    const inputIndex = outputs.length + 1
    const label = `a${outputs.length}`
    filters.push(`[${inputIndex}:a]${parts.join(",")}[${label}]`)
    outputs.push(`[${label}]`)
  }

  if (tracks.length === 0) return { args, filters, outputLabel: "" }
  filters.push(
    `${outputs.join("")}amix=inputs=${outputs.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`,
  )
  return { args, filters, outputLabel: "[aout]" }
}
