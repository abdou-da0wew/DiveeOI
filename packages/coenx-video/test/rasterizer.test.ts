import { describe, expect, it } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveImageMagickBinary, resolveImageMagickRuntime } from "../src/render/rasterizer"

describe("ImageMagick runtime resolution", () => {
  it("prefers an explicitly configured executable", async () => {
    const result = await resolveImageMagickBinary({
      packageRoot: "/missing",
      environment: { COENX_VIDEO_MAGICK: "/opt/coenx/bin/magick" },
      platform: "linux",
      arch: "x64",
    })
    expect(result).toBe("/opt/coenx/bin/magick")
  })

  it("finds a packaged executable using the platform/architecture convention", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "coenx-magick-resolver-"))
    try {
      const binary = path.join(root, "vendor", "imagemagick", "linux-x64", "bin", "magick")
      const configure = path.join(root, "vendor", "imagemagick", "linux-x64", "etc", "ImageMagick-7")
      await mkdir(path.dirname(binary), { recursive: true })
      await writeFile(binary, "#!/bin/sh\nexit 0\n")
      await chmod(binary, 0o755)
      await mkdir(configure, { recursive: true })
      const result = await resolveImageMagickBinary({
        packageRoot: root,
        environment: {},
        platform: "linux",
        arch: "x64",
      })
      expect(result).toBe(binary)
      const runtime = await resolveImageMagickRuntime({
        packageRoot: root,
        environment: {},
        platform: "linux",
        arch: "x64",
      })
      expect(runtime.bundled).toBe(true)
      expect(runtime.env.MAGICK_HOME).toBe(path.dirname(path.dirname(binary)))
      expect(runtime.env.MAGICK_CONFIGURE_PATH).toBe(configure)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("falls back to the system executable when no bundled binary exists", async () => {
    const result = await resolveImageMagickBinary({
      packageRoot: "/missing",
      environment: {},
      platform: "linux",
      arch: "arm64",
    })
    expect(result).toBe("magick")
  })
})
