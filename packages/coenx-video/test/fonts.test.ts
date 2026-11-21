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
