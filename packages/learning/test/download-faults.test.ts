// Fault injection for the downloader against a local HTTP server.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { downloadManifest, importFromLocalFolder, verifyManifestFiles } from "../src/download"
import type { Manifest } from "../src/manifest/types"

const payload = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251))
const sha = createHash("sha256").update(payload).digest("hex")
let server: ReturnType<typeof Bun.serve>
let mode: "normal" | "ignore-range" | "flaky" = "normal"
let hits = 0
let dir: string

const manifest = (overrides: Partial<{ sha256: string; size: number }> = {}): Manifest => ({
  repo: "t/r",
  revision: "abc123",
  endpoint: "",
  generatedAt: "now",
  generatorVersion: "test",
  files: [{ path: "a.bin", size: overrides.size ?? payload.length, sha256: overrides.sha256 ?? sha, required: true }],
})

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tl-dl-"))
  server = Bun.serve({
    port: 0,
    fetch(req) {
      hits++
      if (mode === "flaky" && hits % 2 === 1) return new Response("busy", { status: 503 })
      const range = req.headers.get("range")
      if (range && mode !== "ignore-range") {
        const start = parseInt(range.replace("bytes=", ""), 10)
        return new Response(payload.subarray(start), {
          status: 206,
          headers: { "content-length": String(payload.length - start) },
        })
      }
      return new Response(payload, { headers: { "content-length": String(payload.length) } })
    },
  })
})
afterAll(() => {
  server.stop(true)
  rmSync(dir, { recursive: true, force: true })
})

const run = (m: Manifest, destDir: string) =>
  Effect.runPromise(
    downloadManifest(m, { destDir, endpoint: `http://localhost:${server.port}`, retries: 4, stallTimeoutSec: 5 }),
  )

test("plain download verifies size and sha256", async () => {
  mode = "normal"
  const dest = join(dir, "ok")
  await run(manifest(), dest)
  expect(readFileSync(join(dest, "a.bin")).equals(payload)).toBe(true)
  const v = await Effect.runPromise(verifyManifestFiles(manifest(), dest, "int8", "hash"))
  expect(v.problems).toEqual([])
})

test("server ignores Range on resume → restart cleanly, no corrupted file", async () => {
  mode = "ignore-range"
  const dest = join(dir, "resume")
  mkdirSync(dest, { recursive: true })
  writeFileSync(join(dest, "a.bin.part"), payload.subarray(0, 50_000))
  await run(manifest(), dest)
  expect(readFileSync(join(dest, "a.bin")).equals(payload)).toBe(true)
})

test("503s are retried", async () => {
  mode = "flaky"
  hits = 0
  const dest = join(dir, "flaky")
  await run(manifest(), dest)
  expect(readFileSync(join(dest, "a.bin")).equals(payload)).toBe(true)
})

test("wrong sha256 never produces a final file", async () => {
  mode = "normal"
  const dest = join(dir, "bad")
  await expect(run(manifest({ sha256: "0".repeat(64) }), dest)).rejects.toBeTruthy()
  expect(existsSync(join(dest, "a.bin"))).toBe(false)
})

test("unpinned file (size 0, no hash) downloads and is accepted", async () => {
  mode = "normal"
  const dest = join(dir, "unpinned")
  await run(manifest({ sha256: "", size: 0 }), dest)
  expect(readFileSync(join(dest, "a.bin")).equals(payload)).toBe(true)
})

test("verify reports a missing file", async () => {
  const v = await Effect.runPromise(verifyManifestFiles(manifest(), join(dir, "nowhere"), "int8", "size"))
  expect(v.problems[0]).toContain("missing")
})

test("local import rejects manifest traversal and source symlinks outside the selected folder", async () => {
  const source = join(dir, "import-source")
  const destination = join(dir, "import-destination")
  mkdirSync(source, { recursive: true })
  writeFileSync(join(dir, "outside.bin"), payload)
  symlinkSync(join(dir, "outside.bin"), join(source, "a.bin"))

  await expect(Effect.runPromise(importFromLocalFolder(manifest(), source, destination))).rejects.toBeTruthy()
  const traversal: Manifest = {
    ...manifest(),
    files: [{ path: "../../outside.bin", size: payload.length, sha256: sha, required: true }],
  }
  await expect(Effect.runPromise(importFromLocalFolder(traversal, source, destination))).rejects.toBeTruthy()
})

test("local import rejects destination symlinks that escape the model directory", async () => {
  const source = join(dir, "safe-source")
  const destination = join(dir, "safe-destination")
  const outside = join(dir, "outside-destination")
  mkdirSync(source, { recursive: true })
  mkdirSync(destination, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(source, "a.bin"), payload)
  symlinkSync(outside, join(destination, "nested"))

  const nested: Manifest = {
    ...manifest(),
    files: [{ path: "nested/a.bin", size: payload.length, sha256: sha, required: true }],
  }
  await expect(Effect.runPromise(importFromLocalFolder(nested, source, destination))).rejects.toBeTruthy()
  expect(existsSync(join(outside, "a.bin"))).toBe(false)
})
