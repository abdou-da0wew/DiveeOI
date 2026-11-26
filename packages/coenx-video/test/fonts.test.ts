import { describe, expect, it } from "bun:test"
import {
  FONT_CATALOG,
  FONT_FACE_CSS,
  FONT_LIBRARY_RESOURCE_FILES,
  findFontFamily,
  isBundledFontFamily,
  recommendFontFamily,
} from "../src/fonts"

describe("bundled typography library", () => {
  const manifest = JSON.parse(FONT_LIBRARY_RESOURCE_FILES["manifest.json"]) as {
    families: Array<{ family: string; files: string[]; scripts: string[]; license: string }>
  }

  it("contains all curated font families and their license notices", () => {
    expect(FONT_CATALOG).toHaveLength(16)
    expect(manifest.families).toHaveLength(16)
    expect(manifest.families.every((family) => Boolean(FONT_LIBRARY_RESOURCE_FILES[family.license]))).toBe(true)
  })

  it("embeds every WOFF2 family file as a valid local resource", () => {
    const files = manifest.families.flatMap((family) => family.files)
    expect(files).toHaveLength(28)
    for (const file of files) {
      const encoded = FONT_LIBRARY_RESOURCE_FILES["fonts/" + file + ".b64"]
      expect(typeof encoded).toBe("string")
      expect(Buffer.from(encoded, "base64").subarray(0, 4).toString()).toBe("wOF2")
    }
    expect(FONT_FACE_CSS.match(/@font-face/g)).toHaveLength(28)
    expect(FONT_FACE_CSS.includes("Inter")).toBe(false)
  })

  it("offers script-aware Arabic and Latin font recommendations", () => {
    expect(findFontFamily("Cairo")?.scripts).toContain("arabic")
    expect(isBundledFontFamily("Space Grotesk")).toBe(true)
    expect(isBundledFontFamily("Inter")).toBe(false)
    const arabic = recommendFontFamily(["arabic", "body"], "arabic")
    expect(arabic.some((family) => family.family === "Cairo")).toBe(true)
    expect(arabic.some((family) => family.family === "Amiri")).toBe(true)
  })
})

describe("custom font loading", () => {
  it("materializes a data:font TTF into the render fonts directory", async () => {
    const { prepareRenderFonts } = await import("../src/render/fonts")
    const manifest = JSON.parse(FONT_LIBRARY_RESOURCE_FILES["manifest.json"]) as {
      families: Array<{ family: string; files: string[] }>
    }
    const woff2 = manifest.families[0]!.files[0]!
    const encoded = FONT_LIBRARY_RESOURCE_FILES["fonts/" + woff2 + ".b64"]!
    // Convert the bundled WOFF2 to TTF via fontTools (same converter the
    // render path uses), then re-embed as a data:font/ttf URI.
    const script = `import sys\nfrom fontTools.ttLib import TTFont\nfont = TTFont(sys.argv[1])\nfont.flavor = None\nfont.save(sys.argv[2])`
    const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises")
    const os = await import("node:os")
    const path = await import("node:path")
    const { spawnSync } = await import("node:child_process")
    const work = await mkdtemp(path.join(os.tmpdir(), "coenx-font-test-"))
    try {
      const source = path.join(work, "in.woff2")
      const target = path.join(work, "out.ttf")
      await writeFile(source, Buffer.from(encoded, "base64"))
      const result = spawnSync("python3", ["-c", script, source, target], { stdio: "ignore" })
      if (result.status !== 0) throw new Error("fontTools conversion failed")
      const ttf = await readFile(target)
      const internalFamily = manifest.families[0]!.family
      const composition = {
        version: 1 as const,
        id: "font-test",
        title: "Font test",
        stage: { width: 320, height: 180, fps: 10 },
        scenes: [
          {
            id: "s1",
            durationFrames: 10,
            nodes: [{ kind: "text" as const, id: "t", x: 10, y: 10, width: 100, height: 30, text: "Hi", fontFamily: internalFamily }],
          },
        ],
        fonts: [{ family: internalFamily, src: `data:font/ttf;base64,${ttf.toString("base64")}` }],
      }
      const prepared = await prepareRenderFonts(composition, work)
      expect(prepared.fontFaces).toHaveLength(1)
      expect(prepared.fontFaces[0]!.family).toBe(internalFamily)
      const written = await readFile(path.join(work, "fonts", prepared.fontFaces[0]!.file))
      expect(written.length).toBe(ttf.length)
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }, 30000)

  it("rejects undeclared custom families in validation", async () => {
    const { validateComposition } = await import("../src/model/validate")
    const composition = {
      version: 1 as const,
      id: "font-test-2",
      title: "Font test 2",
      stage: { width: 320, height: 180, fps: 10 },
      scenes: [
        {
          id: "s1",
          durationFrames: 10,
          nodes: [{ kind: "text" as const, id: "t", x: 10, y: 10, width: 100, height: 30, text: "Hi", fontFamily: "Some Custom Font" }],
        },
      ],
    }
    expect(() => validateComposition(composition)).toThrow("outside the bundled catalogue")
  })
})
