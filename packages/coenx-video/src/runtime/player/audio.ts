import type { VideoComposition } from "../../model/types"

export type PlayerAssetResolver = (assetId: string, configuredPath: string | undefined) => string

export interface PlayerAudioRuntime {
  unlock(): void
  play(trackId: string, restart?: boolean): void
  sync(): void
  pauseAll(): void
  destroy(): void
}

export function createPlayerAudioRuntime(
  composition: VideoComposition,
  fps: number,
  resolveAsset: PlayerAssetResolver | undefined,
  getFrame: () => number,
): PlayerAudioRuntime {
  const elements = new Map<string, HTMLAudioElement>()
  let unlocked = false

  function getAudio(trackId: string) {
    const track = composition.audio?.find((item) => item.id === trackId)
    if (!track) return undefined
    let audio = elements.get(trackId)
    if (!audio) {
      audio = new Audio(resolveAsset?.(trackId, track.source) ?? track.source)
      audio.preload = "none"
      audio.volume = Math.max(0, Math.min(1, track.volume ?? 1))
      audio.loop = track.loop ?? false
      elements.set(trackId, audio)
    }
    return audio
  }

  function play(trackId: string, restart = true) {
    if (!unlocked) return
    const audio = getAudio(trackId)
    const track = composition.audio?.find((item) => item.id === trackId)
    if (!track || !audio) return
    if (restart) audio.currentTime = track.trimStartSeconds ?? 0
    audio.loop = track.loop ?? false
    audio.volume = Math.max(0, Math.min(1, track.volume ?? 1))
    void audio.play().catch(() => undefined)
  }

  function sync() {
    if (!unlocked) return
    const frame = getFrame()
    for (const track of composition.audio ?? []) {
      if (track.kind === "sfx") continue
      const end = track.startFrame + track.durationFrames
      if (frame < track.startFrame || frame >= end) {
        const audio = elements.get(track.id)
        if (audio && !audio.paused) audio.pause()
        continue
      }
      const audio = getAudio(track.id)
      if (!audio) continue
      const elapsed = Math.max(0, (frame - track.startFrame) / fps)
      const wantedTime = (track.trimStartSeconds ?? 0) + elapsed
      if (audio.paused) {
        audio.currentTime = wantedTime
        play(track.id, false)
      } else if (Math.abs(audio.currentTime - wantedTime) > 0.35) {
        audio.currentTime = wantedTime
      }
    }
  }

  return {
    unlock() {
      if (unlocked) return
      unlocked = true
      sync()
    },
    play,
    sync,
    pauseAll() {
      for (const audio of elements.values()) audio.pause()
    },
    destroy() {
      for (const audio of elements.values()) {
        audio.pause()
        audio.src = ""
      }
      elements.clear()
    },
  }
}
