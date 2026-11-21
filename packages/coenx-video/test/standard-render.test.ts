import { afterAll, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { renderStandardVideo } from "../src/render/standard"
import type { VideoComposition } from "../src/model/types"

const bundledMagick = path.resolve(import.meta.dir, "../vendor/imagemagick/linux-x64/bin/magick")
const available =
  (Bun.which("magick") !== null || existsSync(bundledMagick)) &&
  Bun.which("ffmpeg") !== null &&
  Bun.which("ffprobe") !== null
const directories: string[] = []

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("SVG/ImageMagick standard 3D export", () => {
  it.skipIf(!available)("renders shared linear and radial gradient paints through SVG and FFmpeg", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-standard-gradient-"))
    directories.push(projectRoot)
    const composition: VideoComposition = {
      version: 1,
      id: "standard-gradient-render-test",
      title: "Standard gradient renderer test",
      stage: { width: 160, height: 90, fps: 6, background: "#080d18" },
      scenes: [
        {
          id: "gradient-scene",
          durationFrames: 6,
          nodes: [
            {
              id: "linear-panel",
              kind: "rect",
              x: 42,
              y: 45,
              width: 72,
              height: 68,
              radius: 8,
              fill: {
                type: "linear",
                from: [0, 0.5],
                to: [1, 0.5],
                stops: [
                  { offset: 0, color: "#ef4444" },
                  { offset: 1, color: "#2563eb", opacity: 0.8 },
                ],
              },
            },
            {
              id: "radial-orb",
              kind: "ellipse",
              x: 118,
              y: 45,
              width: 64,
              height: 64,
              fill: {
                type: "radial",
                center: [0.5, 0.5],
                radius: 0.55,
                stops: [
                  { offset: 0, color: "#ffffff" },
                  { offset: 1, color: "#10b981" },
                ],
              },
            },
          ],
        },
      ],
    }
    const result = await renderStandardVideo(composition, {
      outputPath: "standard-gradients.mp4",
      projectRoot,
      profile: {
        name: "low",
        maxWidth: 320,
        maxHeight: 180,
        maxFps: 24,
        maxFrames: 100,
        maxNodes: 20,
        maxRasterChunkBytes: 2_000_000,
        maxConcurrentRenders: 1,
        ffmpegThreads: 1,
      },
    })
    expect(result.frames).toBe(6)
    expect(result.bytes).toBeGreaterThan(100)
    expect(existsSync(result.outputPath)).toBe(true)
  })

  it.skipIf(!available)("renders quadratic and cubic vector paths through SVG/ImageMagick", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-standard-path-"))
    directories.push(projectRoot)
    const composition: VideoComposition = {
      version: 1,
      id: "standard-path-render-test",
      title: "Standard path renderer test",
      stage: { width: 160, height: 90, fps: 6, background: "#080d18" },
      scenes: [
        {
          id: "path-scene",
          durationFrames: 6,
          nodes: [
            {
              id: "curved-path",
              kind: "path",
              x: 80,
              y: 45,
              width: 104,
              height: 54,
              commands: [
                { type: "moveTo", point: [0, 27] },
                { type: "quadraticTo", control: [52, -6], to: [104, 27] },
                { type: "cubicTo", control1: [104, 54], control2: [0, 54], to: [0, 27] },
                { type: "close" },
              ],
              fill: "#2563eb",
              stroke: "#ffffff",
              strokeWidth: 2,
            },
          ],
        },
      ],
    }
    const result = await renderStandardVideo(composition, {
      outputPath: "standard-path.mp4",
      projectRoot,
      profile: {
        name: "low",
        maxWidth: 320,
        maxHeight: 180,
        maxFps: 24,
        maxFrames: 100,
        maxNodes: 20,
        maxRasterChunkBytes: 2_000_000,
        maxConcurrentRenders: 1,
        ffmpegThreads: 1,
      },
    })
    expect(result.frames).toBe(6)
    expect(result.bytes).toBeGreaterThan(100)
    expect(existsSync(result.outputPath)).toBe(true)
  })

  it.skipIf(!available)("renders reusable clip paths through SVG/ImageMagick and FFmpeg", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-standard-clip-"))
    directories.push(projectRoot)
    const commands = [
      { type: "moveTo" as const, point: [0, 0] as const },
      { type: "lineTo" as const, point: [48, 0] as const },
      { type: "lineTo" as const, point: [48, 36] as const },
      { type: "lineTo" as const, point: [0, 36] as const },
      { type: "close" as const },
      { type: "moveTo" as const, point: [12, 8] as const },
      { type: "lineTo" as const, point: [36, 8] as const },
      { type: "lineTo" as const, point: [36, 28] as const },
      { type: "lineTo" as const, point: [12, 28] as const },
      { type: "close" as const },
    ]
    const composition: VideoComposition = {
      version: 1,
      id: "standard-clip-render-test",
      title: "Standard clip path test",
      stage: { width: 160, height: 90, fps: 6, background: "#080d18" },
      scenes: [
        {
          id: "clip-scene",
          durationFrames: 6,
          pathDefinitions: [{ id: "donut", width: 48, height: 36, commands }],
          clipPaths: [{ id: "donut-clip", pathId: "donut", fillRule: "evenodd" }],
          nodes: [
            {
              id: "clipped-panel",
              kind: "rect",
              x: 80,
              y: 45,
              width: 120,
              height: 72,
              fill: "#16a34a",
              clipPathId: "donut-clip",
            },
          ],
        },
      ],
    }
    const result = await renderStandardVideo(composition, {
      outputPath: "standard-reusable-clip.mp4",
      projectRoot,
      profile: {
        name: "low",
        maxWidth: 320,
        maxHeight: 180,
        maxFps: 24,
        maxFrames: 100,
        maxNodes: 20,
        maxRasterChunkBytes: 2_000_000,
        maxConcurrentRenders: 1,
        ffmpegThreads: 1,
      },
    })
    expect(result.frames).toBe(6)
    expect(result.bytes).toBeGreaterThan(100)
    expect(existsSync(result.outputPath)).toBe(true)
  })

  it.skipIf(!available)("renders shaded, morphing and physics-driven 3D meshes to MP4", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-standard-3d-"))
    directories.push(projectRoot)
    const composition: VideoComposition = {
      version: 1,
      id: "standard-3d-render-test",
      title: "Standard 3D renderer test",
      stage: { width: 160, height: 90, fps: 6, background: "#080d18" },
      scenes: [
        {
          id: "mesh-scene",
          durationFrames: 6,
          transition: { type: "zoom", durationFrames: 6 },
          camera3d: { position: [0, 0, 6], target: [0, 0, 0], fov: 55 },
          lights3d: [
            { type: "ambient", intensity: 0.35 },
            { type: "directional", direction: [-0.4, 0.7, 0.6], intensity: 1.2 },
          ],
          physics3d: {
            gravity: [0, -0.4, 0],
            bodies: [
              {
                nodeId: "mesh",
                velocity: [0, 0, 0],
                angularVelocity: [0, 0.2, 0],
                mass: 1,
                size: [1, 1, 1],
                restitution: 0.2,
              },
            ],
          },
          nodes: [
            {
              id: "mesh",
              kind: "mesh3d",
              x: 80,
              y: 45,
              width: 70,
              height: 70,
              vertices: [
                [-1, -1, 0],
                [1, -1, 0],
                [0, 1, 0],
              ],
              triangles: [[0, 1, 2]],
              color: "#6b9ee8",
              material: { shading: "smooth", roughness: 0.4, metalness: 0.15 },
              morphTargets: [
                {
                  name: "stretch",
                  vertices: [
                    [-1, -1, 0],
                    [1, -1, 0],
                    [0.8, 1.4, 0.2],
                  ],
                },
              ],
              animations: [
                {
                  property: "morph:stretch",
                  keyframes: [
                    { frame: 0, value: 0 },
                    { frame: 5, value: 1 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const result = await renderStandardVideo(composition, {
      outputPath: "standard-3d.mp4",
      projectRoot,
      profile: {
        name: "low",
        maxWidth: 320,
        maxHeight: 180,
        maxFps: 24,
        maxFrames: 100,
        maxNodes: 20,
        maxRasterChunkBytes: 2_000_000,
        maxConcurrentRenders: 1,
        ffmpegThreads: 1,
      },
    })
    expect(result.frames).toBe(6)
    expect(result.bytes).toBeGreaterThan(100)
    expect(existsSync(result.outputPath)).toBe(true)
  })
})
