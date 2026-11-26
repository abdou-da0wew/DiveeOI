import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MediaFrameCache, resolveMediaSource } from "../src/render/media-frames"
import { validateComposition } from "../src/model/validate"
import type { VideoComposition } from "../src/model/types"

async function tempWorkspace() {
  return mkdtemp(path.join(os.tmpdir(), "coenx-media-"))
}

function compositionWith(nodes: VideoComposition["scenes"][number]["nodes"], assets?: Record<string, string>): VideoComposition {
  return {
    version: 1,
    id: "media-test",
    title: "Media test",
    stage: { width: 320, height: 180, fps: 10 },
    scenes: [{ id: "s1", durationFrames: 30, nodes }],
    ...(assets ? { assets } : {}),
  }
}

describe("media source resolution", () => {
  test("accepts project-relative files", async () => {
    const root = await tempWorkspace()
    try {
      const file = path.join(root, "a.png")
      await writeFile(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const source = await resolveMediaSource("a.png", undefined, root, root, new Map())
      expect(source.extension).toBe(".png")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("accepts tmp: prefixed files under the temp directory", async () => {
    const root = await tempWorkspace()
    const workspace = await tempWorkspace()
    try {
      const file = path.join(workspace, "tmp-asset.png")
      await writeFile(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      // Absolute form: tmp:/path/under/tmpdir
      const source = await resolveMediaSource("ext", `tmp:${file}`, root, root, new Map())
      expect(source.extension).toBe(".png")
      // Relative form: tmp:relative-path (resolved under os.tmpdir())
      const relFile = path.join(os.tmpdir(), "coenx-media-rel.png")
      await writeFile(relFile, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const source2 = await resolveMediaSource("ext2", "tmp:coenx-media-rel.png", root, root, new Map())
      expect(source2.extension).toBe(".png")
      await rm(relFile, { force: true })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test("rejects traversal outside the project root and remote URLs", async () => {
    const root = await tempWorkspace()
    try {
      await expect(resolveMediaSource("bad", "../escape.png", root, root, new Map())).rejects.toThrow("could not be resolved")
      await expect(resolveMediaSource("bad", "https://host/x.png", root, root, new Map())).rejects.toThrow("Remote media")
      await symlink(path.join(root, "missing-target"), path.join(root, "dangling.png"))
      await expect(resolveMediaSource("bad", "dangling.png", root, root, new Map())).rejects.toThrow("could not be resolved")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe("animated GIF frames", () => {
  test("coalesces gif frames and overrides per local time", async () => {
    const root = await tempWorkspace()
    try {
      // Build a 3-frame gif with a clearly different middle frame.
      const { resolveImageMagickRuntime } = await import("../src/render/rasterizer")
      const { runBuffer } = await import("../src/render/process")
      const runtime = await resolveImageMagickRuntime()
      const magick = runtime.binary
      const frameDir = path.join(root, "gif-src")
      await mkdir(frameDir, { recursive: true })
      for (const [index, color] of ["#ff0000", "#00ff00", "#0000ff"].entries()) {
        await runBuffer(magick, ["-size", "16x16", `xc:${color}`, path.join(frameDir, `f${index}.png`)], { env: runtime.env })
      }
      const gifPath = path.join(root, "anim.gif")
      await runBuffer(magick, ["-delay", "10", path.join(frameDir, "f0.png"), path.join(frameDir, "f1.png"), path.join(frameDir, "f2.png"), "-loop", "0", gifPath], { env: runtime.env })
      const composition = compositionWith([{ kind: "image", id: "gifNode", x: 10, y: 10, width: 16, height: 16, asset: "anim" }], { anim: "anim.gif" })
      const cache = await MediaFrameCache.prepare(composition, root, root)
      const binding = cache.binding("gifNode")!
      expect(binding.animated).toBe(true)
      expect(binding.info.frames).toBe(3)
      const first = await cache.sceneFrameOverrides(composition.scenes[0], 0, 10)
      const later = await cache.sceneFrameOverrides(composition.scenes[0], 25, 10)
      expect(first.paths.gifNode).toContain("frame-0000.png")
      expect(later.paths.gifNode).not.toContain("frame-0000.png")
      const bytes = await readFile(first.paths.gifNode)
      expect(bytes.length).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)
})

describe("video nodes", () => {
  test("validates bounds and extracts a frame from a real mp4", async () => {
    const root = await tempWorkspace()
    try {
      const composition = compositionWith(
        [
          {
            kind: "video",
            id: "v",
            x: 0,
            y: 0,
            width: 160,
            height: 90,
            asset: "clip",
            sourceStartSeconds: 0.5,
            playbackRate: 1,
          },
        ],
        { clip: "clip.mp4" },
      )
      // Validation must accept a well-formed video node.
      expect(() => validateComposition(composition)).not.toThrow()
      const bad = compositionWith([{ kind: "video", id: "v", x: 0, y: 0, width: 10, height: 10, asset: "c", playbackRate: 9 }])
      expect(() => validateComposition(bad)).toThrow("playbackRate must be between 0.1 and 4")

      // Render a tiny 1s mp4 with ffmpeg and extract a frame at 0.5s.
      const ffmpeg = process.env.COENX_VIDEO_FFMPEG ?? "ffmpeg"
      const { runBuffer } = await import("../src/render/process")
      await runBuffer(ffmpeg, [
        "-y", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=steelblue:size=160x90:rate=10:duration=1",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        path.join(root, "clip.mp4"),
      ])
      const cache = await MediaFrameCache.prepare(composition, root, root)
      const overrides = await cache.sceneFrameOverrides(composition.scenes[0], 5, 10)
      const framePath = overrides.paths.v!
      expect(framePath).toContain("frame-")
      const bytes = await readFile(framePath)
      expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)
})
