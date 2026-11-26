import { describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { packCoenx } from "../src/container/pack"
import { readCoenxBrowser, readZipBrowser, MANIFEST_ENTRY } from "../src/container/browser"
import type { VideoComposition } from "../src/model/types"

function composition(): VideoComposition {
  return {
    version: 1,
    id: "browser-read-test",
    title: "Browser read test",
    stage: { width: 320, height: 180, fps: 10 },
    assets: { dot: "dot.png" },
    scenes: [
      {
        id: "main",
        durationFrames: 20,
        background: "#10131b",
        nodes: [
          { id: "dot", kind: "image", x: 160, y: 90, width: 32, height: 32, asset: "dot" },
          { id: "tap", kind: "button", x: 160, y: 150, width: 80, height: 22, text: "Tap" },
        ],
        interactions: [
          {
            id: "tap-dot",
            trigger: { type: "click", targetId: "tap" },
            actions: [{ type: "increment", key: "taps", amount: 1 }],
          },
        ],
      },
    ],
  }
}

describe("browser-side .coenx4 reader", () => {
  it("unpacks containers packed by the node-side packer (deflate + store)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "coenx-browser-"))
    try {
      await writeFile(path.join(root, "dot.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"))
      const output = path.join(root, "out.coenx4")
      await packCoenx({ composition: composition(), projectRoot: root, outputPath: output })
      const bytes = new Uint8Array(await readFile(output))

      const entries = await readZipBrowser(bytes)
      expect(entries.has("composition.json")).toBe(true)
      expect(entries.has(MANIFEST_ENTRY)).toBe(true)
      expect(entries.has("player.html")).toBe(true)
      expect([...entries.keys()].some((name) => name.startsWith("media/") && name.endsWith(".png"))).toBe(true)

      const container = await readCoenxBrowser(bytes)
      expect(container.composition.id).toBe("browser-read-test")
      expect(container.composition.scenes[0]?.interactions?.[0]?.trigger.type).toBe("click")
      expect(container.manifest.format).toBe("coenx")
      expect(container.manifest.title).toBe("Browser read test")
      expect(container.assets.size).toBeGreaterThanOrEqual(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects non-zip payloads with a clear error", async () => {
    await expect(readCoenxBrowser(new TextEncoder().encode("not a container"))).rejects.toThrow(/not a zip|end record/i)
  })
})
