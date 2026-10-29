// packages/learning/test/setup-state-machine.test.ts
//
// Unit tests for the setup state machine (plan §5.4). Uses a temp dir
// to verify setup.json persistence, step transitions, idempotency, and
// the Repair flow.

import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Setup from "../src/setup/state-machine"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "tl-setup-"))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe("setup state machine", () => {
  test("fresh state is not-started with 8 pending steps", async () => {
    const state = await Effect.runPromise(Setup.loadState(tempDir))
    expect(state.status).toBe("not-started")
    expect(state.steps.length).toBe(8)
    expect(state.steps.every((s) => s.status === "pending")).toBe(true)
  })

  test("running a step marks it complete and persists", async () => {
    const state = await Effect.runPromise(
      Setup.runStep(tempDir, "probe", () => Effect.succeed({ platform: "linux" })),
    )
    expect(state.steps.find((s) => s.name === "probe")?.status).toBe("complete")

    const reloaded = await Effect.runPromise(Setup.loadState(tempDir))
    expect(reloaded.steps.find((s) => s.name === "probe")?.status).toBe("complete")
  })

  test("re-running a complete step is a no-op", async () => {
    await Effect.runPromise(Setup.runStep(tempDir, "probe", () => Effect.succeed(1)))
    const calls: number[] = []
    const state = await Effect.runPromise(
      Setup.runStep(tempDir, "probe", () => {
        calls.push(1)
        return Effect.succeed(2)
      }),
    )
    expect(calls.length).toBe(0)
    expect(state.steps.find((s) => s.name === "probe")?.result).toBe(1)
  })

  test("force flag re-runs a complete step", async () => {
    await Effect.runPromise(Setup.runStep(tempDir, "probe", () => Effect.succeed(1)))
    const state = await Effect.runPromise(
      Setup.runStep(tempDir, "probe", () => Effect.succeed(2), { force: true }),
    )
    expect(state.steps.find((s) => s.name === "probe")?.result).toBe(2)
  })

  test("failed step records the error", async () => {
    try {
      await Effect.runPromise(
        Setup.runStep(tempDir, "probe", () => Effect.fail(new Error("boom"))),
      )
    } catch {
      // expected
    }
    const state = await Effect.runPromise(Setup.loadState(tempDir))
    const probe = state.steps.find((s) => s.name === "probe")!
    expect(probe.status).toBe("failed")
    expect(probe.lastError).toContain("boom")
    expect(probe.attempts).toBe(1)
  })

  test("an abort-triggered step error stays pending instead of racing into failed", async () => {
    const controller = new AbortController()
    try {
      await Effect.runPromise(
        Setup.runStep(
          tempDir,
          "download",
          () =>
            Effect.gen(function* () {
              controller.abort()
              return yield* Effect.fail(new Error("download aborted"))
            }),
          { signal: controller.signal },
        ),
      )
    } catch {
      // The operation still fails, but cancellation must not persist as a setup failure.
    }
    const state = await Effect.runPromise(Setup.loadState(tempDir))
    const download = state.steps.find((s) => s.name === "download")!
    expect(state.status).toBe("not-started")
    expect(download.status).toBe("pending")
    expect(download.lastError).toBeUndefined()
  })

  test("resetForRepair clears all step statuses", async () => {
    await Effect.runPromise(Setup.runStep(tempDir, "probe", () => Effect.succeed(1)))
    const state = await Effect.runPromise(Setup.resetForRepair(tempDir))
    expect(state.status).toBe("needs-repair")
    expect(state.steps.every((s) => s.status === "pending")).toBe(true)
  })

  test("completing all steps marks status as ready", async () => {
    const steps: Setup.StepName[] = [
      "probe",
      "preflight",
      "download",
      "verify",
      "runtime-check",
      "golden-self-test",
      "benchmark",
      "recommend-profile",
    ]
    for (const step of steps) {
      await Effect.runPromise(Setup.runStep(tempDir, step, () => Effect.succeed("ok")))
    }
    const state = await Effect.runPromise(Setup.loadState(tempDir))
    expect(state.status).toBe("ready")
  })

  test("recommend-profile step records the recommended profile", async () => {
    await Effect.runPromise(
      Setup.runStep(tempDir, "recommend-profile", () => Effect.succeed("balanced")),
    )
    const state = await Effect.runPromise(Setup.loadState(tempDir))
    expect(state.recommendedProfile).toBe("balanced")
    expect(state.status).not.toBe("ready") // other steps still pending
  })

  test("bootCheck on a not-started setup returns healthy=false", async () => {
    const result = await Effect.runPromise(Setup.bootCheck(tempDir))
    expect(result.healthy).toBe(false)
  })

  test("bootCheck on a ready setup returns healthy=true", async () => {
    const steps: Setup.StepName[] = [
      "probe",
      "preflight",
      "download",
      "verify",
      "runtime-check",
      "golden-self-test",
      "benchmark",
      "recommend-profile",
    ]
    for (const step of steps) {
      await Effect.runPromise(Setup.runStep(tempDir, step, () => Effect.succeed("ok")))
    }
    const result = await Effect.runPromise(Setup.bootCheck(tempDir))
    expect(result.healthy).toBe(true)
  })
})
