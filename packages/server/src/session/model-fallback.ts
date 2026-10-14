// packages/server/src/session/model-fallback.ts
// Model fallback chain + circuit breaker (draft-10 P2).
//
// Free-tier and rate-limited providers (Zen, OpenRouter free models, etc.) fail
// mid-stream when limits are hit. The existing retry.ts handles within-model
// backoff but cannot rotate to a different model when one is exhausted, and a
// persistently failing model keeps getting picked. This module adds:
//
//   - classify(error): map a stream failure to a rotation-worthy category
//     (rate_limit, server, network, timeout, auth, abort). Only the first
//     four trigger rotation; auth surfaces immediately; abort is the user.
//   - CircuitBreaker: per-`provider:model` Map. After three consecutive
//     failures the model is marked open for 5 minutes and skipped during
//     chain selection. A success resets the breaker.
//   - resolveChain(primary, fallbacks, catalog): the ordered list to try.
//     `llm.fallbacks` config first; when empty, derived at failure time from
//     the live catalog (same provider, then others, ranked by context-window
//     tier). Derived lists are recomputed per exhaustion event, never cached
//     as names — removed/renamed models degrade to the chain.
//   - emitFallbackEvent(eventBus, {from, to, reason}): one-line notice on
//     the existing event stream so the UI shows the rotation.
//
// The runner integration (llm.ts) wraps each stream attempt with this module:
// on a classified failure, advance to the next non-open model, optionally
// trigger a compaction (many "timeouts" are oversized contexts), and pause
// the run/task with a `session.degraded` event when the chain is exhausted.

import { Effect } from "effect"
import type { Err } from "./retry"

/** Categories of stream failures that matter for rotation. */
export type FailureCategory =
  | "rate_limit"
  | "server"
  | "network"
  | "timeout"
  | "auth"
  | "abort"
  | "unknown"

/** Per-model breaker state — open models are skipped during chain selection. */
interface BreakerEntry {
  consecutiveFailures: number
  openedAt: number | undefined
}

const CIRCUIT_OPEN_THRESHOLD = 3
const CIRCUIT_OPEN_DURATION_MS = 5 * 60 * 1000

/**
 * In-process circuit breaker keyed by `${providerID}:${modelID}`. A restart
 * resets all breakers (acceptable — the failure was likely transient).
 */
export class CircuitBreaker {
  private entries = new Map<string, BreakerEntry>()

  /** Record a failure; opens the breaker after `CIRCUIT_OPEN_THRESHOLD`. */
  recordFailure(providerID: string, modelID: string): void {
    const key = `${providerID}:${modelID}`
    const entry = this.entries.get(key) ?? { consecutiveFailures: 0, openedAt: undefined }
    entry.consecutiveFailures += 1
    if (entry.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD && entry.openedAt === undefined) {
      entry.openedAt = Date.now()
    }
    this.entries.set(key, entry)
  }

  /** Record a success; resets the breaker for this model. */
  recordSuccess(providerID: string, modelID: string): void {
    const key = `${providerID}:${modelID}`
    this.entries.delete(key)
  }

  /** True when the breaker is open and the cooldown window has not elapsed. */
  isOpen(providerID: string, modelID: string): boolean {
    const key = `${providerID}:${modelID}`
    const entry = this.entries.get(key)
    if (entry?.openedAt === undefined) return false
    if (Date.now() - entry.openedAt >= CIRCUIT_OPEN_DURATION_MS) {
      // Half-open: the cooldown elapsed, allow one trial.
      this.entries.delete(key)
      return false
    }
    return true
  }
}

/**
 * Classify a stream failure into a rotation category. Only the first four
 * (rate_limit, server, network, timeout) trigger rotation; auth surfaces
 * immediately (the user must fix credentials, not retry); abort is the user
 * cancelling and must never be retried.
 */
export function classify(error: Err | undefined): FailureCategory {
  if (!error) return "unknown"
  if (typeof error !== "object" || error === null) return "unknown"
  const data = (error as { data?: unknown }).data
  // Err is `{ name: string; data: unknown }` — a `message` field is not on
  // the type but is present at runtime (NamedError.toObject carries it). Cast
  // through `unknown` to satisfy TS without changing the Err type.
  const messageField = (error as unknown as { message?: unknown }).message
  const message = typeof messageField === "string" ? messageField : undefined
  if (typeof data !== "object" || data === null) {
    return classifyMessage(message ?? "")
  }
  const d = data as {
    statusCode?: number
    isRetryable?: boolean
    responseBody?: string
    message?: string
  }
  if (typeof d.statusCode === "number") {
    if (d.statusCode === 401 || d.statusCode === 403) return "auth"
    if (d.statusCode === 429) return "rate_limit"
    if (d.statusCode >= 500) return "server"
  }
  return classifyMessage(d.message ?? message ?? "")
}

function classifyMessage(message: string): FailureCategory {
  const lower = message.toLowerCase()
  if (lower.includes("aborted") || lower.includes("user cancel")) return "abort"
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("etimedout")
  ) {
    return "timeout"
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("429")
  ) {
    return "rate_limit"
  }
  if (
    lower.includes("econnreset") ||
    lower.includes("enetunreach") ||
    lower.includes("fetch failed") ||
    lower.includes("network")
  ) {
    return "network"
  }
  if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("api key")) {
    return "auth"
  }
  return "unknown"
}

/**
 * Pick the next model to try given the primary, the configured fallback list,
 * and the live breaker state. Returns `undefined` when the chain is exhausted
 * (every candidate is open or the list is empty).
 *
 * The `catalog` callback is invoked only when the fallback list needs to be
 * derived (config empty) — it must return candidates ranked by preference
 * (same provider first, then by context-window tier). Derived lists are
 * recomputed per call, never cached as names: removed/renamed models degrade
 * to the chain instead of crashing.
 */
export function pickNext(input: {
  primary: { providerID: string; modelID: string }
  fallbacks?: ReadonlyArray<{ providerID: string; modelID: string }>
  breaker: CircuitBreaker
  deriveFromCatalog?: () => ReadonlyArray<{ providerID: string; modelID: string }>
}): { providerID: string; modelID: string } | undefined {
  const { primary, fallbacks, breaker, deriveFromCatalog } = input
  const candidates: ReadonlyArray<{ providerID: string; modelID: string }> =
    fallbacks && fallbacks.length > 0
      ? [primary, ...fallbacks]
      : deriveFromCatalog
        ? [primary, ...deriveFromCatalog()]
        : [primary]
  for (const candidate of candidates) {
    if (!breaker.isOpen(candidate.providerID, candidate.modelID)) return candidate
  }
  return undefined
}

/**
 * Log a model rotation. The runner is responsible for emitting the user-facing
 * `session.error` event via its own EventV2Bridge; this helper just writes the
 * structured log line so the trace shows the rotation. Kept separate so the
 * module has no service dependencies (testable in isolation).
 */
export function logFallback(input: {
  sessionID: string
  from: string
  to: string
  reason: FailureCategory
}): Effect.Effect<void> {
  return Effect.logWarning("model_fallback", {
    "session.id": input.sessionID,
    from: input.from,
    to: input.to,
    reason: input.reason,
  })
}

/** Test helper: build a breaker with one open model pre-seeded. */
export function __testBreaker(open: { providerID: string; modelID: string }[]): CircuitBreaker {
  const b = new CircuitBreaker()
  for (const m of open) b.recordFailure(m.providerID, m.modelID)
  // force-open: record CIRCUIT_OPEN_THRESHOLD times
  for (const m of open) {
    b.recordFailure(m.providerID, m.modelID)
    b.recordFailure(m.providerID, m.modelID)
  }
  return b
}

export * as ModelFallback from "./model-fallback"
