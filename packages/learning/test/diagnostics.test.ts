import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  configureDiagnosticsDataDir,
  diagnosticsSnapshot,
  flushDiagnostics,
  logDiagnostic,
  startDiagnosticOperation,
  withDiagnosticEffect,
  withDiagnosticPromise,
} from "../src/diagnostics"

const ENV_KEYS = [
  "DIVEEOI_TL_DEBUG",
  "DIVEEOI_TL_DEBUG_LEVEL",
  "DIVEEOI_TL_DEBUG_CONTENT",
  "DIVEEOI_TL_DEBUG_CONSOLE",
  "DIVEEOI_TL_DEBUG_FILE",
  "DIVEEOI_TL_DEBUG_HANG_MS",
  "DIVEEOI_TL_DEBUG_MAX_LOG_MB",
] as const

const previousEnv = new Map<string, string | undefined>()
let dataDir = ""

beforeEach(() => {
  previousEnv.clear()
  for (const key of ENV_KEYS) previousEnv.set(key, process.env[key])
  dataDir = mkdtempSync(join(tmpdir(), "diveeoi-tl-diagnostics-"))
  configureDiagnosticsDataDir(dataDir)
  process.env.DIVEEOI_TL_DEBUG = "all"
  process.env.DIVEEOI_TL_DEBUG_FILE = "debug.jsonl"
  delete process.env.DIVEEOI_TL_DEBUG_LEVEL
  delete process.env.DIVEEOI_TL_DEBUG_CONTENT
  delete process.env.DIVEEOI_TL_DEBUG_CONSOLE
  delete process.env.DIVEEOI_TL_DEBUG_HANG_MS
  delete process.env.DIVEEOI_TL_DEBUG_MAX_LOG_MB
})

afterEach(async () => {
  await flushDiagnostics()
  for (const key of ENV_KEYS) {
    const value = previousEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(dataDir, { recursive: true, force: true })
})

describe("Targeted Learning diagnostics", () => {
  test("are disabled by default and do not create a log", async () => {
    delete process.env.DIVEEOI_TL_DEBUG
    logDiagnostic("session", "must.not.write", { userText: "private question" }, "info")
    await flushDiagnostics()
    expect(existsSync(join(dataDir, "debug.jsonl"))).toBe(false)
    expect(diagnosticsSnapshot().enabled).toBe(false)
  })

  test("redact secrets and content by default, and create a private JSONL file", async () => {
    logDiagnostic(
      "session",
      "privacy.check",
      {
        userText: "a private student question",
        apiToken: "top-secret-token",
        authorization: "Bearer abc.def.ghi",
        errorMessage: "parser received private input:\nthis line must be hidden",
        privateError: new Error("first line\nthis stack message line must also be hidden"),
        ordinary: "visible diagnostic detail",
      },
      "info",
    )
    await flushDiagnostics()

    const file = join(dataDir, "debug.jsonl")
    const text = readFileSync(file, "utf8")
    const record = JSON.parse(text.trim())
    expect(text).not.toContain("a private student question")
    expect(text).not.toContain("top-secret-token")
    expect(text).not.toContain("abc.def.ghi")
    expect(text).not.toContain("this line must be hidden")
    expect(text).not.toContain("this stack message line must also be hidden")
    expect(text).toContain("visible diagnostic detail")
    expect(record.data.userText).toEqual({ redacted: true, length: 26 })
    expect(record.data.apiToken).toBe("[REDACTED]")
    expect(record.data.errorMessage.redacted).toBe(true)
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  test("logs bounded content only with the explicit content flag", async () => {
    process.env.DIVEEOI_TL_DEBUG_CONTENT = "1"
    logDiagnostic("retrieval", "question", { queryText: "show this only when opted in" }, "info")
    await flushDiagnostics()
    expect(readFileSync(join(dataDir, "debug.jsonl"), "utf8")).toContain("show this only when opted in")
    expect(diagnosticsSnapshot().contentLogging).toBe(true)
  })

  test("tracks progress, pause/resume, completion, errors, and stalled operations", async () => {
    process.env.DIVEEOI_TL_DEBUG_HANG_MS = "1000"
    const operation = startDiagnosticOperation("ingest", "test-job", { jobId: "job_test" })
    operation.progress("embed", { progress: 25 })
    operation.pause()
    await new Promise((resolve) => setTimeout(resolve, 1_250))
    const pausedOperation = diagnosticsSnapshot().activeOperations.find((item: any) => item.id === operation.id)
    expect(pausedOperation?.paused).toBe(true)
    expect(pausedOperation?.stalled).toBe(false)
    await flushDiagnostics()
    expect(readFileSync(join(dataDir, "debug.jsonl"), "utf8")).not.toContain("operation.stalled")
    operation.resume()

    await new Promise((resolve) => setTimeout(resolve, 1_750))
    expect(
      diagnosticsSnapshot().activeOperations.some((item: any) => item.id === operation.id && item.stalled),
    ).toBe(true)
    await flushDiagnostics()
    expect(readFileSync(join(dataDir, "debug.jsonl"), "utf8")).toContain("operation.stalled")
    operation.complete({ status: "complete" })

    const failed = startDiagnosticOperation("setup", "test-step", { step: "probe" })
    failed.fail(new Error("diagnostic fixture failure"))
    const snapshot = diagnosticsSnapshot()
    expect(snapshot.activeOperations.some((item: any) => item.id === operation.id || item.id === failed.id)).toBe(false)
    const diagnosticError = snapshot.recentErrors.find((item: any) => item.operationId === failed.id)
    expect(diagnosticError).toBeDefined()
    expect((diagnosticError?.error as any).message.redacted).toBe(true)
    await flushDiagnostics()
    const text = readFileSync(join(dataDir, "debug.jsonl"), "utf8")
    expect(text).toContain("operation.complete")
    expect(text).not.toContain("diagnostic fixture failure")
  })

  test("rotates the JSONL log at the configured size limit", async () => {
    process.env.DIVEEOI_TL_DEBUG_MAX_LOG_MB = "1"
    const detail = "x".repeat(8_000)
    for (let index = 0; index < 140; index++) {
      logDiagnostic("setup", "rotation.fixture", { index, detail }, "info")
    }
    await flushDiagnostics()
    const file = join(dataDir, "debug.jsonl")
    const backup = `${file}.1`
    expect(existsSync(backup)).toBe(true)
    expect(statSync(file).size).toBeLessThanOrEqual(1024 * 1024)
    expect(statSync(backup).size).toBeLessThanOrEqual(1024 * 1024)
  })

  test("wraps Effect and Promise operations and records interruption as cancellation", async () => {
    const effectResult = await Effect.runPromise(
      withDiagnosticEffect("service", "effect-success", {}, Effect.succeed({ status: "ready" })),
    )
    expect(effectResult).toEqual({ status: "ready" })

    const interruption = withDiagnosticEffect("setup", "effect-cancelled", {}, Effect.interrupt)
    await Effect.runPromise(Effect.exit(interruption))

    const promiseResult = await withDiagnosticPromise("service", "promise-success", {}, async () => "ready")
    expect(promiseResult).toBe("ready")
    await expect(
      withDiagnosticPromise("service", "promise-failure", {}, async () => {
        throw new Error("private promise error")
      }),
    ).rejects.toThrow("private promise error")

    await flushDiagnostics()
    const text = readFileSync(join(dataDir, "debug.jsonl"), "utf8")
    expect(text).toContain("operation.complete")
    expect(text).toContain("operation.cancelled")
    expect(text).toContain("operation.error")
    expect(text).not.toContain("private promise error")
  })

  test("supports component allowlists", async () => {
    process.env.DIVEEOI_TL_DEBUG = "setup,retrieval"
    logDiagnostic("session", "filtered", {}, "info")
    logDiagnostic("setup", "enabled", {}, "info")
    await flushDiagnostics()
    const text = readFileSync(join(dataDir, "debug.jsonl"), "utf8")
    expect(text).not.toContain("filtered")
    expect(text).toContain("enabled")
  })
})
