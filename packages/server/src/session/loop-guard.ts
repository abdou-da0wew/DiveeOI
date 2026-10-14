// packages/server/src/session/loop-guard.ts
// Repetition guard for the tool loop (draft-10 P3, loop-detection slice).
//
// Small/free models get stuck: they re-issue the same tool call with the same arguments
// forever, burning quota until the provider rate-limits or the context overflows. The
// runner cannot stop that on its own because every individual step looks healthy.
//
// The guard is deliberately conservative: it only trips on *identical* calls (same tool,
// same canonical arguments) repeated back to back, and it understands a small set of
// volatile argument names so that legitimately-varying calls (timestamps, jitter, temp
// paths, pagination cursors) are not mistaken for a loop.

import { createHash } from "node:crypto"
import type { SessionV1 } from "@diveeoi/db/v1/session"

/** Argument names that legitimately differ between semantically identical calls. */
export const VOLATILE_ARGS: Readonly<Record<string, readonly string[]>> = {
  bash: ["timeout"],
  webfetch: [],
  read: [],
  grep: [],
  glob: [],
  task: [],
  websearch: [],
}

const MAX_HISTORY = 32

export interface LoopDiagnosis {
  readonly tool: string
  readonly hash: string
  /** Consecutive identical calls ending at the newest entry. */
  readonly consecutive: number
  /** Total identical calls inside the retained history window. */
  readonly window: number
  readonly args: unknown
}

function volatileFor(tool: string): ReadonlySet<string> {
  return new Set(VOLATILE_ARGS[tool] ?? [])
}

/** Stable stringify: object keys sorted recursively so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

/** Drop volatile arguments so a jittered/retried call still hashes to the same value. */
export function stripVolatile(tool: string, args: unknown): unknown {
  const drop = volatileFor(tool)
  if (drop.size === 0 || args === null || typeof args !== "object" || Array.isArray(args)) return args
  return Object.fromEntries(Object.entries(args as Record<string, unknown>).filter(([key]) => !drop.has(key)))
}

export function callHash(tool: string, args: unknown): string {
  return createHash("sha256").update(`${tool}\u0000${canonicalJson(stripVolatile(tool, args))}`).digest("hex")
}

export class LoopGuard {
  private readonly entries: Array<{ tool: string; hash: string; args: unknown }> = []

  /** Record a call and report a loop when the same call repeats too often. */
  push(tool: string, args: unknown, options?: { consecutive?: number; window?: number }): LoopDiagnosis | undefined {
    const hash = callHash(tool, args)
    this.entries.push({ tool, hash, args })
    if (this.entries.length > MAX_HISTORY) this.entries.splice(0, this.entries.length - MAX_HISTORY)

    let consecutive = 0
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i]!.hash !== hash) break
      consecutive++
    }
    const window = this.entries.filter((entry) => entry.hash === hash).length
    const consecutiveLimit = options?.consecutive ?? 3
    const windowLimit = options?.window ?? 5
    if (consecutive < consecutiveLimit && window < windowLimit) return undefined
    return { tool, hash, consecutive, window, args }
  }

  reset() {
    this.entries.length = 0
  }
}

export function loopMessage(diagnosis: LoopDiagnosis): string {
  const shown = canonicalJson(diagnosis.args)
  return [
    `Watchdog: \`${diagnosis.tool}\` was called with identical arguments ${diagnosis.consecutive} times in a row (${diagnosis.window} times in the last ${MAX_HISTORY} calls).`,
    `Repeated call: ${shown.slice(0, 400)}`,
    "The same call cannot make progress. Do not retry it. Either diagnose why the result was not what you needed and take a different approach, or stop and report what is blocking you.",
  ].join("\n")
}

/**
 * Scan a session's tool calls (newest first) and report the first repetition.
 *
 * Stateless on purpose: it reads the persisted message history, so a loop is caught even
 * when the run was restarted, and it survives a resume. Provider-executed tools and
 * interrupted orphans are ignored — those are not calls the runner can blame on a loop.
 */
export function diagnoseLoop(
  messages: ReadonlyArray<SessionV1.WithParts>,
  options?: { consecutive?: number; window?: number; limit?: number },
): LoopDiagnosis | undefined {
  const guard = new LoopGuard()
  const limit = options?.limit ?? 60
  let seen = 0
  for (let i = messages.length - 1; i >= 0 && seen < limit; i--) {
    const message = messages[i]!
    if (message.info.role !== "assistant") continue
    for (let j = message.parts.length - 1; j >= 0 && seen < limit; j--) {
      const part = message.parts[j]!
      if (part.type !== "tool") continue
      if (part.metadata?.providerExecuted) continue
      if (part.state.status === "pending") continue
      seen++
      const diagnosis = guard.push(part.tool, part.state.input, options)
      if (diagnosis) return diagnosis
    }
  }
  return undefined
}

/**
 * How many steps may keep re-deciding to loop before the runner stops the run itself.
 * One step of guidance is always given first; only a second identical diagnosis is fatal.
 */
export const LOOP_FATAL_AFTER = 2
