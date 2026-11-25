import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { renderNativeVideo } from "../src/render/native-video"
import type { VideoComposition } from "../src/model/types"

setDefaultTimeout(30_000)

const nativeBinary = path.resolve(import.meta.dir, "../native/coenx-video-native/target/release/coenx-video-native")
const bundledImageMagick = path.resolve(import.meta.dir, "../vendor/imagemagick/linux-x64/bin/magick")
const canRender = existsSync(nativeBinary) && Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null
const canDecodeImages = existsSync(bundledImageMagick) || Bun.which("magick") !== null || Bun.which("convert") !== null
const tempDirectories: string[] = []

afterAll(async () => {
  await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("Rust/Cairo native MP4 renderer", () => {
  it.skipIf(!canRender)("renders animated vector/text scenes to a verified H.264 MP4", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-native-test-"))
    tempDirectories.push(projectRoot)
    const composition: VideoComposition = {
      version: 1,
      id: "native-render-test",
      title: "Native renderer test",
      stage: { width: 160, height: 90, fps: 6, background: "#0b1220" },
      scenes: [
        {
          id: "intro",
          durationFrames: 6,
          nodes: [
            { id: "panel", kind: "rect", x: 80, y: 45, width: 140, height: 78, radius: 8, fill: "#17243a" },
            {
              id: "orb",
              kind: "ellipse",
              x: 24,
              y: 45,
              width: 18,
              height: 18,
              fill: "#6c9cff",
              animations: [
                {
                  property: "x",
                  keyframes: [
                    { frame: 0, value: 24 },
                    { frame: 5, value: 136 },
                  ],
                },
              ],
            },
            {
              id: "title",
              kind: "text",
              x: 80,
              y: 42,
              width: 120,
              height: 24,
              text: "Coenx",
              fontFamily: "Geist",
              fontSize: 16,
              color: "#ffffff",
            },
          ],
        },
      ],
    }
    const result = await renderNativeVideo(composition, {
      outputPath: "native.mp4",
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
    expect(result.durationSeconds).toBe(1)
    expect(result.bytes).toBeGreaterThan(100)
    const header = await readFile(result.outputPath)
    expect(header.subarray(4, 8).toString("ascii")).toBe("ftyp")
  })

  it.skipIf(!canRender)("renders linear and radial gradient paints into native MP4 frames", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-native-gradient-test-"))
    tempDirectories.push(projectRoot)
    const composition: VideoComposition = {
      version: 1,
      id: "native-gradient-render-test",
      title: "Native gradient renderer test",
      stage: { width: 160, height: 90, fps: 6, background: "#080d18" },
      scenes: [
        {
          id: "gradient-scene",
          durationFrames: 6,
          nodes: [
            {
              id: "linear-panel",
              kind: "rect",
              x: 44,
              y: 45,
              width: 76,
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
              x: 120,
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
    const result = await renderNativeVideo(composition, {
      outputPath: "native-gradients.mp4",
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
    const header = await readFile(result.outputPath)
    expect(header.subarray(4, 8).toString("ascii")).toBe("ftyp")
  })

  it.skipIf(!canRender)("renders closed quadratic and cubic vector paths into native MP4", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-native-path-test-"))
    tempDirectories.push(projectRoot)
    const composition: VideoComposition = {
      version: 1,
      id: "native-path-render-test",
      title: "Native path renderer test",
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
              fill: {
                type: "linear",
                from: [0, 0.5],
                to: [1, 0.5],
                stops: [
                  { offset: 0, color: "#f97316" },
                  { offset: 1, color: "#7c3aed" },
                ],
              },
              stroke: "#ffffff",
              strokeWidth: 2,
              lineCap: "round",
              lineJoin: "round",
            },
          ],
        },
      ],
    }
    const result = await renderNativeVideo(composition, {
      outputPath: "native-path.mp4",
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
    const header = await readFile(result.outputPath)
    expect(header.subarray(4, 8).toString("ascii")).toBe("ftyp")
  })

  it.skipIf(!canRender)("renders reusable paths and node clip paths through the native frame adapter", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-native-clip-test-"))
    tempDirectories.push(projectRoot)
    const shape = [
      { type: "moveTo" as const, point: [0, 18] as const },
      { type: "lineTo" as const, point: [48, 0] as const },
      { type: "lineTo" as const, point: [48, 36] as const },
      { type: "close" as const },
    ]
    const composition: VideoComposition = {
      version: 1,
      id: "native-clip-render-test",
      title: "Native reusable clip path test",
      stage: { width: 160, height: 90, fps: 6, background: "#080d18" },
      scenes: [
        {
          id: "clip-scene",
          durationFrames: 6,
          pathDefinitions: [{ id: "triangle", width: 48, height: 36, commands: shape }],
          clipPaths: [{ id: "triangle-clip", pathId: "triangle", fillRule: "evenodd" }],
          nodes: [
            {
              id: "clipped-panel",
              kind: "rect",
              x: 80,
              y: 45,
              width: 120,
              height: 72,
              fill: "#16a34a",
              clipPathId: "triangle-clip",
            },
            {
              id: "shared-path",
              kind: "path",
              x: 80,
              y: 45,
              width: 120,
              height: 72,
              pathRef: "triangle",
              fill: "#2563eb",
            },
          ],
        },
      ],
    }
    const result = await renderNativeVideo(composition, {
      outputPath: "native-reusable-clips.mp4",
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
    const header = await readFile(result.outputPath)
    expect(header.subarray(4, 8).toString("ascii")).toBe("ftyp")
  })

  it.skipIf(!canRender || !canDecodeImages)(
    "decodes SVG assets once and composites them in native MP4 frames",
    async () => {
      const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-native-image-test-"))
      tempDirectories.push(projectRoot)
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#ef4444"/></svg>'
      const composition: VideoComposition = {
        version: 1,
        id: "native-image-render-test",
        title: "Native image renderer test",
        stage: { width: 160, height: 90, fps: 6, background: "#080d18" },
        assets: { logo: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` },
        scenes: [
          {
            id: "image-scene",
            durationFrames: 6,
            nodes: [
              {
                id: "logo",
                kind: "image",
                x: 80,
                y: 45,
                width: 48,
                height: 48,
                asset: "logo",
                fit: "contain",
                animations: [
                  {
                    property: "rotation",
                    keyframes: [
                      { frame: 0, value: 0 },
                      { frame: 5, value: 30 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }
      const result = await renderNativeVideo(composition, {
        outputPath: "native-image.mp4",
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
    },
  )

  it.skipIf(!canRender)("renders lit, morph-animated 3D meshes with native physics and transitions", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-native-3d-test-"))
    tempDirectories.push(projectRoot)
    const composition: VideoComposition = {
      version: 1,
      id: "native-3d-render-test",
      title: "Native 3D renderer test",
      stage: { width: 160, height: 90, fps: 6, background: "#080d18" },
      scenes: [
        {
          id: "mesh-scene",
          durationFrames: 6,
          transition: { type: "wipe-left", durationFrames: 6 },
          camera3d: { position: [0, 0, 6], target: [0, 0, 0], fov: 55 },
          lights3d: [
            { type: "ambient", intensity: 0.35 },
            { type: "directional", direction: [-0.4, 0.7, 0.6], intensity: 1.2 },
            { type: "point", position: [1, 2, 3], intensity: 0.6, distance: 8 },
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
                collider: "aabb",
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
              material: { shading: "smooth", ambient: 0.2, diffuse: 0.9, specular: 0.25, shininess: 32 },
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
    const result = await renderNativeVideo(composition, {
      outputPath: "native-3d.mp4",
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
  })

  it("rejects native-only unsupported visual nodes instead of dropping them", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-native-reject-"))
    tempDirectories.push(projectRoot)
    const composition: VideoComposition = {
      version: 1,
      id: "unsupported-native",
      title: "Unsupported node",
      stage: { width: 160, height: 90, fps: 6 },
      scenes: [
        {
          id: "scene",
          durationFrames: 1,
          nodes: [
            {
              id: "choice",
              kind: "select",
              x: 80,
              y: 45,
              width: 100,
              height: 32,
              bind: "answer",
              options: [{ value: "correct", label: "Correct" }],
            },
          ],
        },
      ],
    }
    await expect(renderNativeVideo(composition, { outputPath: "unsupported.mp4", projectRoot })).rejects.toThrow(
      "select nodes",
    )
  })

  it.skipIf(!canRender)("renders bounded effect chains into native MP4 frames", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-native-effect-test-"))
    tempDirectories.push(projectRoot)
    const composition: VideoComposition = {
      version: 1,
      id: "native-effect-render-test",
      title: "Native effect renderer test",
      stage: { width: 160, height: 90, fps: 6, background: "#080d18" },
      scenes: [
        {
          id: "effect-scene",
          durationFrames: 6,
          nodes: [
            {
              id: "glow-panel",
              kind: "rect",
              x: 80,
              y: 45,
              width: 110,
              height: 60,
              radius: 8,
              fill: "#1d4ed8",
              effects: [
                { type: "blur", radius: 2 },
                { type: "drop-shadow", dx: 4, dy: 6, radius: 3, color: "#000000" },
                { type: "color-adjust", brightness: 1.15, saturate: 1.1 },
              ],
            },
          ],
        },
      ],
    }
    const result = await renderNativeVideo(composition, {
      outputPath: "effects.mp4",
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
    const header = await readFile(result.outputPath)
    expect(header.subarray(4, 8).toString("ascii")).toBe("ftyp")
  })
})

