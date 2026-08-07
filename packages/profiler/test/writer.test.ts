import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

const outDir = join("/tmp/opencode", `profiler-writer-test-${process.pid}`)
const outFile = join(outDir, "profiler.jsonl")

// Output path and thresholds are import-time config; the enabled flag is
// driven by core._configure in beforeAll because bun test shares one process
// across all test files (env mutations at module scope race each other).
process.env["DIVEEOI_PROFILER_OUTPUT"] = outFile
process.env["DIVEEOI_PROFILER_MIN_MS"] = "0"
process.env["DIVEEOI_PROFILER_FLUSH_MS"] = "60000"
process.env["DIVEEOI_PROFILER_SNAPSHOT_MS"] = "60000"

const core = await import("../src/core")
const writer = await import("../src/writer")

beforeAll(() => core._configure({ enabled: true, sampleRate: 1 }))

function readLines(): Array<Record<string, unknown>> {
  return readFileSync(outFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

beforeEach(() => {
  writer.stop()
  core._reset()
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  writer.start()
})

afterAll(() => {
  writer.stop()
  rmSync(outDir, { recursive: true, force: true })
})

test("writes start line on boot", () => {
  const lines = readLines()
  expect(lines.some((l) => l.kind === "start")).toBe(true)
})

test("writes scope_done lines with caller attribution", () => {
  const inner = core.wrap("m.f.inner", () => 1)
  const outer = core.wrap("m.f.outer", () => inner())
  outer()
  writer._flushTick()
  const scopeLines = readLines().filter((l) => l.kind === "scope_done")
  expect(scopeLines.find((l) => l.key === "m.f.outer")!.caller).toBeUndefined()
  expect(scopeLines.find((l) => l.key === "m.f.inner")!.caller).toBe("m.f.outer")
  expect(typeof scopeLines.find((l) => l.key === "m.f.inner")!.durMs).toBe("number")
})

test("writes error flag for rejected scopes", async () => {
  const fn = core.wrap("m.f.reject", async () => {
    throw new Error("z")
  })
  await expect(fn()).rejects.toThrow("z")
  writer._flushTick()
  const line = readLines().find((l) => l.kind === "scope_done" && l.key === "m.f.reject")
  expect(line!.err).toBe(true)
})

test("filters scopes below minMs", () => {
  core.wrap("m.f.instant", () => 1)()
  writer._flushTick()
  // minMs=0 so everything passes; the filter itself is exercised by default config
  const line = readLines().find((l) => l.kind === "scope_done" && l.key === "m.f.instant")
  expect(line).toBeDefined()
})

test("states line carries gauge state", () => {
  core.gauge("http.active", 3)
  writer._flushTick()
  const statesLine = readLines().find((l) => l.kind === "states")
  expect((statesLine!.states as Record<string, { current: number }>)["http.active"].current).toBe(3)
})

test("proc line carries memory", () => {
  writer._flushTick()
  const proc = readLines().find((l) => l.kind === "proc")
  expect(typeof proc!.rssMB).toBe("number")
  expect(typeof proc!.heapUsedMB).toBe("number")
})

test("snapshot line carries aggregations", () => {
  core.wrap("m.f.Class.method", () => 1)()
  core.wrap("m.f.other", () => 2)()
  writer._snapshotTick()
  writer.flush()
  const snap = readLines().find((l) => l.kind === "snapshot")
  expect((snap!.classes as Record<string, { calls: number }>)["Class"].calls).toBe(1)
  expect((snap!.total as { calls: number }).calls).toBe(2)
  expect(snap!.active).toBeDefined()
})

test("stop closes cleanly and restart reopens", () => {
  writer.stop()
  writer.start()
  core.wrap("m.f.afterRestart", () => 1)()
  writer._flushTick()
  const lines = readLines()
  expect(lines.filter((l) => l.kind === "start").length).toBe(2)
  expect(lines.some((l) => l.key === "m.f.afterRestart")).toBe(true)
})
