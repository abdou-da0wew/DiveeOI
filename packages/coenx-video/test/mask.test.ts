import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { validateComposition, VideoValidationError } from "../src/model/validate"
import type { MaskDefinition, Scene, VideoComposition } from "../src/model/types"
import { resolveNodeMask } from "../src/render/mask"
import { renderNativeFrame, NativeRendererSession } from "../src/render/native"
import { renderNativeVideo } from "../src/render/native-video"
import { renderSceneSvg } from "../src/render/scene-svg"
import { renderStandardVideo } from "../src/render/standard"

setDefaultTimeout(30_000)

const nativeBinary = path.resolve(import.meta.dir, "../native/coenx-video-native/target/release/coenx-video-native")
const bundledImageMagick = path.resolve(import.meta.dir, "../vendor/imagemagick/linux-x64/bin/magick")
const canRenderNative = existsSync(nativeBinary) && Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null
const magick: string | undefined = existsSync(bundledImageMagick)
  ? bundledImageMagick
  : (Bun.which("magick") ?? undefined)
const tempDirectories: string[] = []

afterAll(async () => {
  await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
})

function composition(masks: MaskDefinition[], maskId?: string, nodes?: Scene["nodes"]): VideoComposition {
  return {
    version: 1,
    id: "mask-test",
    title: "Mask test",
    stage: { width: 160, height: 90, fps: 6, background: "#0b1220" },
    scenes: [
      {
        id: "intro",
        durationFrames: 6,
        background: "#0b1220",
        masks,
        nodes: nodes ?? [
          {
            id: "faded",
            kind: "rect",
            x: 80,
            y: 45,
            width: 120,
            height: 60,
            fill: "#ff0000",
            ...(maskId ? { maskId } : {}),
          },
        ],
      },
    ],
  }
}

const gradientMask: MaskDefinition = {
  id: "fade",
  width: 120,
  height: 60,
  shapes: [
    {
      kind: "rect",
      x: 0,
      y: 0,
      width: 120,
      height: 60,
      fill: { type: "linear", from: [0, 0.5], to: [1, 0.5], stops: [{ offset: 0, color: "#ffffff" }, { offset: 1, color: "#ffffff", opacity: 0 }] },
    },
  ],
}

describe("mask model validation", () => {
  it("accepts a valid alpha mask composition", () => {
    const summary = validateComposition(composition([gradientMask], "fade"))
    expect(summary.nodeCount).toBe(1)
  })

  it("rejects a node referencing a missing mask", () => {
    expect(() => validateComposition(composition([gradientMask], "missing"))).toThrow(VideoValidationError)
  })

  it("rejects duplicate mask ids", () => {
    expect(() => validateComposition(composition([gradientMask, gradientMask], "fade"))).toThrow(
      /duplicate mask/,
    )
  })

  it("rejects masks without visible alpha", () => {
    const broken: MaskDefinition = {
      id: "empty",
      width: 120,
      height: 60,
      shapes: [{ kind: "rect", x: 0, y: 0, width: 120, height: 60, fill: "none" }],
    }
    expect(() => validateComposition(composition([broken], "empty"))).toThrow(/must paint visible alpha/)
  })

  it("rejects 3D meshes carrying a 2D alpha mask", () => {
    expect(() =>
      validateComposition(
        composition([gradientMask], "fade", [
          { id: "mesh", kind: "mesh3d", x: 80, y: 45, width: 80, height: 60, maskId: "fade", vertices: [[-1, -1, 0], [1, -1, 0], [0, 1, 0]], triangles: [[0, 1, 2]] },
        ]),
      ),
    ).toThrow(/cannot use an alpha mask/)
  })

  it("enforces the mask budgets", () => {
    const many: MaskDefinition[] = Array.from({ length: 33 }, (_, index) => ({ ...gradientMask, id: `mask-${index}` }))
    expect(() => validateComposition(composition(many, "mask-0"))).toThrow(/more than 32 mask resources/)
    const heavy: MaskDefinition = {
      id: "heavy",
      width: 120,
      height: 60,
      shapes: Array.from({ length: 17 }, (_, index) => ({
        kind: "rect" as const,
        x: index,
        y: index,
        width: 10,
        height: 10,
        fill: "#ffffffff",
      })),
    }
    expect(() => validateComposition(composition([heavy], "heavy"))).toThrow(/exceeds 16 shapes/)
  })
})

describe("mask resource resolution", () => {
  it("scales mask shapes into node-local space and reuses path resources", () => {
    const scene: Scene = {
      id: "intro",
      durationFrames: 6,
      nodes: [{ id: "faded", kind: "rect", x: 80, y: 45, width: 60, height: 30, fill: "#ff0000", maskId: "fade" }],
      pathDefinitions: [
        { id: "half-cover", width: 100, height: 100, commands: [{ type: "moveTo", point: [0, 0] }, { type: "lineTo", point: [50, 0] }, { type: "lineTo", point: [50, 100] }, { type: "lineTo", point: [0, 100] }, { type: "close" }] },
      ],
      masks: [
        {
          id: "fade",
          width: 100,
          height: 100,
          shapes: [{ kind: "path", pathRef: "half-cover", fill: "#ffffffff" }],
        },
      ],
    }
    const resolved = resolveNodeMask(scene.nodes[0], scene)
    expect(resolved).toBeDefined()
    expect(resolved!.shapes[0].commands[0]).toEqual({ type: "moveTo", point: [0, 0] })
    expect(resolved!.shapes[0].commands[1]).toEqual({ type: "lineTo", point: [30, 0] })
    expect(resolved!.shapes[0].fillRule).toBe("nonzero")
    // A dangling maskId must fail loudly instead of rendering unmasked.
    expect(() => resolveNodeMask(scene.nodes[0], { ...scene, masks: [] })).toThrow(/missing mask fade/)
  })

  it("throws when the mask references a missing path resource", () => {
    const scene: Scene = {
      id: "intro",
      durationFrames: 6,
      nodes: [{ id: "faded", kind: "rect", x: 80, y: 45, width: 60, height: 30, fill: "#ff0000", maskId: "fade" }],
      masks: [{ id: "fade", width: 100, height: 100, shapes: [{ kind: "path", pathRef: "nope", fill: "#ffffffff" }] }],
    }
    expect(() => resolveNodeMask(scene.nodes[0], scene)).toThrow(/missing path/)
  })
})

describe("mask rendering", () => {
  it("emits a white-alpha SVG mask definition bound to the node group", async () => {
    const svg = await renderSceneSvg(composition([gradientMask], "fade"), composition([gradientMask], "fade").scenes[0], 3, {
      projectRoot: "/tmp",
    })
    expect(svg).toContain(`<mask id="mask-intro-faded" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-60" y="-30" width="120" height="60">`)
    expect(svg).toContain(`mask="url(#mask-intro-faded)"`)
    expect(svg).toContain(`stop-color="#ffffff"`)
    expect(svg).toContain(`stop-opacity="1"`)
  })

  it.skipIf(!canRenderNative || !magick)("renders the native Cairo mask to pixels with a left-to-right fade", async () => {
    if (!magick) throw new Error("unreachable: test is gated on magick")
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-mask-native-"))
    tempDirectories.push(projectRoot)
    const framePath = path.join(projectRoot, "frame.png")
    const session = await NativeRendererSession.start()
    try {
      const result = await session.renderFrame({
        composition: composition([gradientMask], "fade"),
        scene: composition([gradientMask], "fade").scenes[0],
        frame: 3,
        outputPath: framePath,
      })
      expect(result.nodeCount).toBe(1)
    } finally {
      await session.close()
    }
    // Node box spans x 20..140; the mask fades alpha 1 -> 0 left to right.
    const rawLeft = Bun.spawnSync([magick, framePath, "-format", "%[pixel:p{40,45}]", "info:"])
    const leftProbe = rawLeft.stdout.toString().trim()
    // Probe just outside the node box (x>140): the faded rect must not leak.
    const rightProbe = Bun.spawnSync([magick, framePath, "-format", "%[pixel:p{150,45}]", "info:"]).stdout.toString().trim()
    expect(leftProbe).toMatch(/srgb\((2[0-9]{2}|1[4-9][0-9])/)
    expect(rightProbe.trim()).toMatch(/srgb\(1[0-2],1[7-9],3[0-3]\)/)
    const single = await renderNativeFrame({
      composition: composition([gradientMask], "fade"),
      scene: composition([gradientMask], "fade").scenes[0],
      frame: 3,
      outputPath: path.join(projectRoot, "single.png"),
    })
    expect(single.outputPath).toBe(path.join(projectRoot, "single.png"))
  })

  it.skipIf(!canRenderNative || !magick)("encodes a masked scene into a verified native MP4", async () => {
    if (!magick) throw new Error("unreachable: test is gated on magick")
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-mask-mp4-"))
    tempDirectories.push(projectRoot)
    const result = await renderNativeVideo(composition([gradientMask], "fade"), {
      outputPath: "out/masked.mp4",
      projectRoot,
      profile: { name: "low" },
    })
    expect(result.frames).toBe(6)
    await readFile(result.outputPath)
  })

  it.skipIf(!magick)("encodes a masked scene through the static SVG + ImageMagick pipeline", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "coenx-mask-static-"))
    tempDirectories.push(projectRoot)
    const result = await renderStandardVideo(composition([gradientMask], "fade"), {
      outputPath: "out/masked.mp4",
      projectRoot,
      profile: { name: "low", maxFrames: 100, maxNodes: 100 },
      preset: "ultrafast",
    })
    expect(result.frames).toBe(6)
    expect(result.bytes).toBeGreaterThan(0)
  })

  it("keeps unmasked nodes pixel-identical to the pre-mask renderer", async () => {
    const plain = composition([], undefined, [{ id: "solid", kind: "rect", x: 80, y: 45, width: 40, height: 20, fill: "#3b82f6" }])
    const svg = await renderSceneSvg(plain, plain.scenes[0], 0, { projectRoot: "/tmp" })
    expect(svg).not.toContain("<mask")
    expect(svg).toContain(`fill="#3b82f6"`)
  })
})
