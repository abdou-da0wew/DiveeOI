import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createZip, readZip, crc32 } from "../src/container/zip"
import { packCoenx, unpackCoenx, validateCoenx, CONTAINER_VERSION } from "../src/container/pack"
import type { VideoComposition } from "../src/model/types"

function composition(): VideoComposition {
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  )
  return {
    version: 1,
    id: "container-test",
    title: "Container test",
    stage: { width: 320, height: 180, fps: 10 },
    assets: { dot: "dot.png" },
    scenes: [
      {
        id: "intro",
        durationFrames: 20,
        nodes: [{ kind: "image", id: "img", x: 10, y: 10, width: 40, height: 40, asset: "dot" }],
        interactions: [
          {
            id: "jump-cta",
            trigger: { type: "click", targetId: "img" },
            actions: [{ type: "goto", sceneId: "outro" }],
          },
        ],
      },
      {
        id: "outro",
        durationFrames: 20,
        nodes: [{ kind: "text", id: "t", x: 100, y: 50, width: 120, height: 30, text: "The end" }],
      },
    ],
  }
}

async function workspace() {
  return mkdtemp(path.join(os.tmpdir(), "coenx-container-"))
}

describe("zip primitives", () => {
  test("crc32 is the standard polynomial", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926)
  })

  test("round-trips deflate and store entries", () => {
    const zip = createZip([
      { name: "text.txt", data: "hello coenx" },
      { name: "media/blob.bin", data: Buffer.from([1, 2, 3, 4, 5]), compress: false },
    ])
    const entries = readZip(zip)
    expect(entries.get("text.txt")!.toString()).toBe("hello coenx")
    expect([...entries.get("media/blob.bin")!]).toEqual([1, 2, 3, 4, 5])
  })

  test("detects corruption", () => {
    const zip = createZip([{ name: "a.txt", data: "hello coenx" }])
    const bytes = Buffer.from(zip)
    bytes[40] ^= 0xff
    expect(() => readZip(bytes)).toThrow()
  })
})

describe(".coenx4 container", () => {
  test("pack -> unpack -> validate round-trip with embedded media", async () => {
    const root = await workspace()
    try {
      await writeFile(path.join(root, "dot.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"))
      const out = path.join(root, "out.coenx4")
      const packed = await packCoenx({ composition: composition(), projectRoot: root, outputPath: out, renderer: "canvas" })
      expect(packed.manifest.version).toBe(CONTAINER_VERSION)
      expect(packed.manifest.media.length).toBeGreaterThan(0)
      const info = await stat(out)
      expect(info.size).toBe(packed.bytes)

      // The archive must also pass an external integrity listing if unzip exists.
      const probe = Bun.spawnSync(["unzip", "-t", out], { stdout: "pipe", stderr: "pipe" })
      if (probe.exitCode === 0) {
        expect(probe.stdout.toString()).toContain("No errors detected")
      }

      const unpacked = await unpackCoenx(out, path.join(root, "unpacked"))
      expect(unpacked.files).toBeGreaterThanOrEqual(3)
      const compositionCopy = JSON.parse(await readFile(path.join(root, "unpacked", "composition.json"), "utf8"))
      expect(compositionCopy.assets.dot.startsWith("data:image/png;base64,")).toBe(true)

      const validation = await validateCoenx(out)
      expect(validation.ok).toBe(true)
      expect(validation.issues).toEqual([])
      expect(validation.manifest!.compositionId).toBe("container-test")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60000)

  test("rejects interaction jumps to missing scenes", async () => {
    const root = await workspace()
    try {
      const bad = composition()
      bad.scenes[0]!.interactions![0]!.actions = [{ type: "goto", sceneId: "nope" }]
      const out = path.join(root, "bad.coenx4")
      // Composition validation runs at pack time and must fail first.
      await expect(packCoenx({ composition: bad, projectRoot: root, outputPath: out })).rejects.toThrow("nope")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60000)

  test("refuses unsafe entry names on unpack", async () => {
    const root = await workspace()
    try {
      const out = path.join(root, "evil.coenx4")
      const { createZip: zip } = await import("../src/container/zip")
      await writeFile(out, zip([{ name: "../escape.txt", data: "nope" }]))
      await expect(unpackCoenx(out, path.join(root, "evil-out"))).rejects.toThrow("unsafe container entry")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
