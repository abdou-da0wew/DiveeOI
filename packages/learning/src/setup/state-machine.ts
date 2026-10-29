// packages/learning/src/setup/state-machine.ts
//
// Setup state lives in `setup.json` in the data directory (NOT in a database),
// so it survives the loss of `books.db` (plan §5.4). The UI shows each step,
// retries only failed steps, offers a Repair button, and can export a
// diagnostics bundle.
//
// Steps (plan §5.1):
//   1. probe
//   2. preflight
//   3. download
//   4. verify
//   5. runtime-check
//   6. golden-self-test
//   7. benchmark
//   8. recommend-profile → mark Ready
//
// Each step is persisted, idempotent and individually retryable.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect, Schema } from "effect"

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export const StepStatus = Schema.Literals(["pending", "running", "complete", "failed", "skipped"])
export type StepStatus = Schema.Schema.Type<typeof StepStatus>

export const StepName = Schema.Literals([
  "probe",
  "preflight",
  "download",
  "verify",
  "runtime-check",
  "golden-self-test",
  "benchmark",
  "recommend-profile",
])
export type StepName = Schema.Schema.Type<typeof StepName>

export const StepState = Schema.Struct({
  name: StepName,
  status: StepStatus,
  startedAt: Schema.optional(Schema.String),
  finishedAt: Schema.optional(Schema.String),
  attempts: Schema.Number,
  lastError: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Unknown), // step-specific result JSON
})
export type StepState = Schema.Schema.Type<typeof StepState>

export const SetupState = Schema.Struct({
  schemaVersion: Schema.Number,
  status: Schema.Literals(["not-started", "in-progress", "ready", "needs-repair"]),
  steps: Schema.Array(StepState),
  recommendedProfile: Schema.optional(Schema.Literals(["low", "balanced", "high"])),
  updatedAt: Schema.String,
})
export type SetupState = Schema.Schema.Type<typeof SetupState>

// ---------------------------------------------------------------------------
// File-backed store
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1

const emptyState: SetupState = {
  schemaVersion: SCHEMA_VERSION,
  status: "not-started",
  steps: [
    { name: "probe", status: "pending", attempts: 0 },
    { name: "preflight", status: "pending", attempts: 0 },
    { name: "download", status: "pending", attempts: 0 },
    { name: "verify", status: "pending", attempts: 0 },
    { name: "runtime-check", status: "pending", attempts: 0 },
    { name: "golden-self-test", status: "pending", attempts: 0 },
    { name: "benchmark", status: "pending", attempts: 0 },
    { name: "recommend-profile", status: "pending", attempts: 0 },
  ],
  updatedAt: new Date().toISOString(),
}

export const statePath = (dataDir: string) => join(dataDir, "setup.json")

export const loadState = (dataDir: string): Effect.Effect<SetupState, never> =>
  Effect.sync(() => {
    const path = statePath(dataDir)
    if (!existsSync(path)) return structuredClone(emptyState)
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"))
      // Validate minimally; trust the schema on save.
      if (typeof raw === "object" && raw !== null && typeof raw.schemaVersion === "number") {
        return raw as SetupState
      }
      return structuredClone(emptyState)
    } catch {
      return structuredClone(emptyState)
    }
  })

export const saveState = (dataDir: string, state: SetupState): Effect.Effect<void, never> =>
  Effect.sync(() => {
    mkdirSync(dataDir, { recursive: true })
    const next = { ...state, updatedAt: new Date().toISOString() }
    writeFileSync(statePath(dataDir), JSON.stringify(next, null, 2) + "\n")
  })

// ---------------------------------------------------------------------------
// Step transitions
// ---------------------------------------------------------------------------

const stepByName = (state: SetupState, name: StepName): StepState | undefined =>
  state.steps.find((s) => s.name === name)

const markRunning = (state: SetupState, name: StepName): SetupState => ({
  ...state,
  status: "in-progress",
  steps: state.steps.map((s) =>
    s.name === name
      ? { ...s, status: "running", startedAt: new Date().toISOString(), attempts: s.attempts + 1 }
      : s,
  ),
})

const markComplete = (state: SetupState, name: StepName, result: unknown): SetupState => ({
  ...state,
  steps: state.steps.map((s) =>
    s.name === name
      ? { ...s, status: "complete", finishedAt: new Date().toISOString(), lastError: undefined, result }
      : s,
  ),
})

const markFailed = (state: SetupState, name: StepName, err: unknown): SetupState => ({
  ...state,
  steps: state.steps.map((s) =>
    s.name === name
      ? {
          ...s,
          status: "failed",
          finishedAt: new Date().toISOString(),
          lastError: err instanceof Error ? err.message : String(err).slice(0, 500),
        }
      : s,
  ),
})

const markPending = (state: SetupState, name: StepName): SetupState => ({
  ...state,
  status: "not-started",
  steps: state.steps.map((step) =>
    step.name === name
      ? { ...step, status: "pending", finishedAt: undefined, lastError: undefined }
      : step,
  ),
})

const markSkipped = (state: SetupState, name: StepName): SetupState => ({
  ...state,
  steps: state.steps.map((s) => (s.name === name ? { ...s, status: "skipped" } : s)),
})

const markReady = (state: SetupState, profile: "low" | "balanced" | "high"): SetupState => ({
  ...state,
  status: "ready",
  recommendedProfile: profile,
})

/**
 * Run a single step. The step function receives the current state and may
 * return a result. If the step fails, the state is updated with the error
 * and the failure propagates so the caller can decide whether to retry.
 *
 * The step is idempotent — re-running a complete step is a no-op unless
 * `force` is true.
 */
export const runStep = (
  dataDir: string,
  name: StepName,
  stepFn: (state: SetupState) => Effect.Effect<unknown, unknown>,
  options?: { force?: boolean; signal?: AbortSignal },
): Effect.Effect<SetupState, unknown> =>
  Effect.gen(function* () {
    let state = yield* loadState(dataDir)
    if (options?.signal?.aborted) return yield* Effect.fail(new Error("Setup cancelled"))
    const current = stepByName(state, name)
    if (!current) return yield* Effect.die(`Unknown setup step: ${name}`)
    if (current.status === "complete" && !options?.force) return state

    state = markRunning(state, name)
    yield* saveState(dataDir, state)

    type StepResult = { _tag: "Right"; right: unknown } | { _tag: "Left"; left: unknown }
    const result: StepResult = yield* stepFn(state).pipe(
      Effect.matchEffect({
        onFailure: (err) => Effect.succeed({ _tag: "Left" as const, left: err }),
        onSuccess: (value) => Effect.succeed({ _tag: "Right" as const, right: value }),
      }),
    )
    if (result._tag === "Right") {
      state = markComplete(state, name, result.right)
      // If this was the recommend-profile step, record the profile.
      if (name === "recommend-profile" && typeof result.right === "string") {
        state = { ...state, recommendedProfile: result.right as "low" | "balanced" | "high" }
      }
      // Mark Ready only when ALL steps are complete or skipped.
      if (state.steps.every((s) => s.status === "complete" || s.status === "skipped")) {
        state = { ...state, status: "ready" }
      }
    } else {
      state = options?.signal?.aborted
        ? markPending(state, name)
        : markFailed(state, name, result.left)
    }
    yield* saveState(dataDir, state)
    if (result._tag === "Left") {
      return yield* Effect.fail(result.left)
    }
    return state
  })

/**
 * Repair = clear all step statuses except `probe` and re-run from there.
 * Used by the Repair button in the UI.
 */
export const resetForRepair = (dataDir: string): Effect.Effect<SetupState, never> =>
  Effect.gen(function* () {
    const state = yield* loadState(dataDir)
    const repaired: SetupState = {
      ...state,
      status: "needs-repair",
      steps: state.steps.map((s) => ({ ...s, status: "pending", lastError: undefined })),
    }
    yield* saveState(dataDir, repaired)
    return repaired
  })

/** Restore an interrupted step to pending so setup can be resumed cleanly. */
export const cancelSetup = (dataDir: string): Effect.Effect<SetupState, never> =>
  Effect.gen(function* () {
    const state = yield* loadState(dataDir)
    const steps = state.steps.map((step) =>
      step.status === "running"
        ? { ...step, status: "pending" as const, finishedAt: undefined, lastError: undefined }
        : step,
    )
    const cancelled: SetupState = {
      ...state,
      status: steps.every((step) => step.status === "complete" || step.status === "skipped") ? "ready" : "not-started",
      steps,
    }
    yield* saveState(dataDir, cancelled)
    return cancelled
  })

/**
 * Quick boot check — verifies only file existence and size (not sha256,
 * which is `verifyOnBoot: sha256` if configured). Used at server boot.
 * Returns true if setup is healthy, false if Repair is needed.
 */
export const bootCheck = (dataDir: string): Effect.Effect<{ healthy: boolean; missing: string[] }, never> =>
  Effect.sync(() => {
    const state = existsSync(statePath(dataDir))
      ? (JSON.parse(readFileSync(statePath(dataDir), "utf8")) as SetupState)
      : structuredClone(emptyState)
    if (state.status !== "ready") return { healthy: false, missing: [] }
    // Actual file existence check happens in the SetupService against the
    // manifest; here we only verify the state file says "ready".
    return { healthy: true, missing: [] }
  })
