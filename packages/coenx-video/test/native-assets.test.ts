import { afterAll, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { VideoComposition } from "../src/model/types"
import { prepareNativeImageAssets } from "../src/render/native-assets"
import { resolveImageMagickRuntime } from "../src/render/rasterizer"
import { runBuffer } from "../src/render/process"

const bundledImageMagick = path.resolve(import.meta.dir, "../vendor/imagemagick/linux-x64/bin/magick")
const canDecodeImages = existsSync(bundledImageMagick) || Bun.which("magick") !== null || Bun.which("convert") !== null
const directories: string[] = []

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "coenx-native-assets-"))
  directories.push(root)
  const projectRoot = path.join(root, "project")
  const tempRoot = path.join(root, "temp")
  await mkdir(projectRoot)
  await mkdir(tempRoot)
  return { root, projectRoot, tempRoot }
}

function imageComposition(asset: string): VideoComposition {
  return {
    version: 1,
    id: "native-asset-test",
    title: "Native asset test",
    stage: { width: 64, height: 64, fps: 24 },
    scenes: [
      {
        id: "scene",
        durationFrames: 1,
        nodes: [
          { id: "first", kind: "image", x: 16, y: 32, width: 24, height: 24, asset },
          { id: "second", kind: "image", x: 48, y: 32, width: 24, height: 24, asset },
        ],
      },
    ],
  }
}

describe("native image preparation", () => {
  it("rejects remote sources before invoking an image decoder", async () => {
    const { projectRoot, tempRoot } = await fixture()
    await expect(
      prepareNativeImageAssets(imageComposition("https://example.invalid/image.png"), projectRoot, tempRoot),
    ).rejects.toThrow("local project files")
  })

  it("rejects embedded SVG references to remote resources and executable content", async () => {
    const { projectRoot, tempRoot } = await fixture()
    const sources = [
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/pixel.png"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ]
    for (const [index, svg] of sources.entries()) {
      const composition = imageComposition("logo")
      composition.assets = {
        logo: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      }
      await expect(prepareNativeImageAssets(composition, projectRoot, tempRoot)).rejects.toThrow(
        index === 0 ? "external assets" : "unsupported active or external content",
      )
    }
  })

  it.skipIf(!canDecodeImages)("normalizes JPEG inputs into bounded PNG surfaces", async () => {
    const { projectRoot, tempRoot } = await fixture()
    const runtime = await resolveImageMagickRuntime()
    const jpeg = path.join(projectRoot, "photo.jpg")
    await runBuffer(runtime.binary, ["-size", "24x16", "xc:#e11d48", `JPEG:${jpeg}`], {
      env: runtime.env,
      maxOutputBytes: 1024 * 1024,
    })
    const unusualName = path.join(projectRoot, "photo[slide].jpg")
    await rename(jpeg, unusualName)

    const assets = await prepareNativeImageAssets(imageComposition("photo[slide].jpg"), projectRoot, tempRoot)
    const output = await readFile(assets.get("scene")!.first!)
    expect(output.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  })

  it("rejects ImageMagick-only executable formats", async () => {
    const { projectRoot, tempRoot } = await fixture()
    await writeFile(path.join(projectRoot, "payload.mvg"), "push graphic-context")
    await expect(prepareNativeImageAssets(imageComposition("payload.mvg"), projectRoot, tempRoot)).rejects.toThrow(
      "Unsupported native image file format",
    )
  })

  it("rejects traversal and symlink escapes from the project root", async () => {
    const { root, projectRoot, tempRoot } = await fixture()
    const outside = path.join(root, "outside.png")
    await writeFile(outside, "not an image")
    await symlink(outside, path.join(projectRoot, "escape.png"))

    await expect(prepareNativeImageAssets(imageComposition("../outside.png"), projectRoot, tempRoot)).rejects.toThrow(
      "escapes the project root",
    )
    await expect(prepareNativeImageAssets(imageComposition("escape.png"), projectRoot, tempRoot)).rejects.toThrow(
      "escapes the project root",
    )
  })

  it.skipIf(!canDecodeImages)("decodes embedded SVG once and shares its PNG across scene nodes", async () => {
    const { projectRoot, tempRoot } = await fixture()
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#2563eb"/></svg>'
    const composition = imageComposition("logo")
    composition.assets = {
      logo: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    }

    const assets = await prepareNativeImageAssets(composition, projectRoot, tempRoot)
    const sceneAssets = assets.get("scene")
    expect(sceneAssets?.first).toBeTruthy()
    expect(sceneAssets?.first).toBe(sceneAssets?.second)
    const png = await readFile(sceneAssets!.first!)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  })
})
