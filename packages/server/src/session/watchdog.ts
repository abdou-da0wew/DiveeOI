// packages/server/src/session/watchdog.ts
// Watchdog supervisor fiber (draft-10 P3, no-progress + heartbeat slice).
//
// The repetition guard (loop-guard.ts) catches a stuck model that re-issues
// the same tool call. It cannot detect:
//
//   - a run that has produced no persisted part AND no LLM event for a long
//     time (the LLM is silent, the user is wondering if it died)
//   - a task session that lost its heartbeat (a task fiber wedged without
//     touching the session — the run-state shows busy forever)
//
// This module adds those two signals. One supervisor fiber per active run,
// forked by the runner, scoped to the run, wakes on heartbeatIntervalMs
// (adaptive: 60s/45s/30s by tier — HDD tool spawns are slow on constrained
// boxes). On trip:
//   - interrupt the run fiber
//   - write a session.watchdog event with the diagnosis
//   - restart the run from the last anchor checkpoint with an injected
//     system-reminder part: 'Watchdog: stalled Ms / heartbeat lost. Diagnose,
//     change approach, or call checkpoint.'
//
// Cap 3 auto-restarts per session without progress; then pause + degraded
// event. The heartbeat is also written by the runner on every persisted part
// (P4 task liveness uses the same column).
//
// The watchdog is a pure function the runner calls into — no service/layer
// needed. It holds its own mutable state (lastEventAt, lastPersistedPartAt,
// restartCount) and exposes touch() to update them.

import { Effect, Ref } from "effect"
import { useAdaptiveTargets } from "@diveeoi/db/adaptive"
import type { SessionID } from "./schema"

/**
 * Diagnosis emitted when the watchdog trips. Surfaced to the model as a
 * system-reminder so it can change approach; surfaced to the user as a
 * session.error event.
 */
export interface WatchdogDiagnosis {
  readonly sessionID: SessionID
  readonly kind: "no-progress" | "heartbeat-lost"
  /** Milliseconds since the last observed progress (event or part). */
  readonly stalledMs: number
  /** Auto-restart count for this session (0-based; cap at 3). */
  readonly restartCount: number
}

/**
 * Per-run watchdog state. The runner holds one of these per active run and
 * calls `touch` on every persisted part and LLM event.
 */
export class WatchdogState {
  private lastEventAt: number = Date.now()
  private lastPersistedPartAt: number = Date.now()
  private restartCount: number = 0
  /** Set when the supervisor fiber is interrupted so a late touch is a no-op. */
  private interrupted: boolean = false

  /** The runner calls this when any LLM event arrives (text/reasoning/tool). */
  touchEvent(): void {
    if (this.interrupted) return
    this.lastEventAt = Date.now()
  }

  /** The runner calls this when any part is persisted. */
  touchPart(): void {
    if (this.interrupted) return
    this.lastPersistedPartAt = Date.now()
  }

  /** Mark this watchdog as interrupted so late touches are no-ops. */
  markInterrupted(): void {
    this.interrupted = true
  }

  /** True when no progress has been observed for `stallMs`. */
  isStalled(stallMs: number): boolean {
    const since = Date.now() - Math.max(this.lastEventAt, this.lastPersistedPartAt)
    return since >= stallMs
  }

  /** Milliseconds since the last progress observation. */
  stalledFor(): number {
    return Date.now() - Math.max(this.lastEventAt, this.lastPersistedPartAt)
  }

  /** Increment the auto-restart count; returns the new count. */
  bumpRestartCount(): number {
    this.restartCount += 1
    return this.restartCount
  }

  /** Current auto-restart count. */
  getRestartCount(): number {
    return this.restartCount
  }

  /** Reset the progress timers (used after a successful restart). */
  reset(): void {
    this.lastEventAt = Date.now()
    this.lastPersistedPartAt = Date.now()
    this.interrupted = false
  }
}

/**
 * Build the diagnosis message that gets injected as a system-reminder after
 * the runner restarts the run from its last anchor checkpoint.
 */
export function diagnosisMessage(diag: WatchdogDiagnosis): string {
  const symptom =
    diag.kind === "no-progress"
      ? `no new tool calls or LLM events for ${Math.round(diag.stalledMs / 1000)}s`
      : "heartbeat lost (task session unresponsive)"
  return [
    `<system-reminder>Watchdog tripped: ${symptom}.`,
    `Auto-restart ${diag.restartCount} of 3 for this session.`,
    `Diagnose what you were doing, change approach, or call checkpoint to save state and pause.`,
    `If this trips again without progress, the session will be paused.</system-reminder>`,
  ].join("\n")
}

/**
 * Get the adaptive stall threshold (watchdogStallMs: 300s/240s/180s by tier)
 * and heartbeat interval (heartbeatIntervalMs: 60s/45s/30s by tier).
 *
 * The Effect requires AdaptiveResourceService — the runner provides it via
 * the existing AdaptiveResource layer (same seam as the LLM stream buffer
 * and PTY ticket cache).
 */
export function adaptiveThresholds<R = never>(): Effect.Effect<
  { stallMs: number; heartbeatMs: number },
  never,
  R
> {
  return useAdaptiveTargets((t) =>
    Effect.succeed({ stallMs: t.watchdogStallMs, heartbeatMs: t.heartbeatIntervalMs }),
  ) as Effect.Effect<{ stallMs: number; heartbeatMs: number }, never, R>
}

/**
 * Maximum auto-restarts before the watchdog pauses the session as degraded.
 * Per the plan: "Cap 3 auto-restarts per session without progress; then
 * pause + degraded event."
 */
export const MAX_AUTO_RESTARTS = 3

export * as Watchdog from "./watchdog"
