import { Duration, Effect } from "effect"

import {
  Login,
  PollDenied,
  PollError,
  PollExpired,
  PollPending,
  type PollResult,
  PollSlow,
  PollSuccess,
} from "./schema"

/**
 * In-flight device-authorization attempts, keyed by an opaque id handed to the client.
 *
 * `Account.poll` is deliberately a single-shot probe: the cadence, the `slow_down` backoff and
 * the expiry deadline all belong to whoever is driving the flow, and in DiveeOI that is a
 * browser tab. Registering the attempt here rather than returning the `Login` to the caller
 * keeps two things server-side that would otherwise leak across the wire:
 *
 *   - the `device_code`, which is a bearer credential for completing the login;
 *   - `Schema.Duration` fields (`expiry`, `interval`), which are not pleasant to round-trip
 *     through JSON. The wire shape below uses plain milliseconds instead.
 *
 * Attempts are process-local and expire on their own: an abandoned tab cannot leak anything,
 * because the codes are only useful for the lifetime the console already enforces.
 */

/** Longest an attempt is retained before it is treated as expired regardless of the console. */
const RETENTION = Duration.minutes(15)

/** Extra wait added after the console answers `slow_down`, per RFC 8628 section 3.5. */
const SLOW_DOWN_MARGIN = Duration.seconds(5)

export type Attempt = {
  readonly id: string
  readonly login: Login
  /** Epoch millis after which this attempt is dead, from the console's own `expires_in`. */
  readonly deadline: number
  /** Current poll cadence in millis. Grows by the RFC margin whenever the console says slow. */
  readonly interval: number
}

export type Outcome =
  | { readonly status: "pending" }
  | { readonly status: "slow" }
  | { readonly status: "expired" }
  | { readonly status: "denied" }
  | { readonly status: "success"; readonly email: string }
  | { readonly status: "error"; readonly message: string }

const attempts = new Map<string, Attempt>()

const prune = (now: number) => {
  for (const [id, attempt] of attempts) {
    // Retention is the hard cap; the console deadline is checked separately on every poll so a
    // client that ignores the expiry still gets a truthful answer.
    if (now > attempt.deadline + Duration.toMillis(RETENTION)) attempts.delete(id)
  }
}

/** Register a fresh attempt and return it. */
export const start = Effect.fnUntraced(function* (login: Login) {
  const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
  prune(now)

  const id = crypto.randomUUID()
  const attempt: Attempt = {
    id,
    login,
    deadline: now + Duration.toMillis(login.expiry),
    interval: Math.max(1, Duration.toMillis(login.interval)),
  }
  attempts.set(id, attempt)
  return attempt
})

/** Look up an attempt, dropping it if the console's own deadline has passed. */
export const get = Effect.fnUntraced(function* (id: string) {
  const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
  prune(now)
  const attempt = attempts.get(id)
  if (!attempt) return undefined
  if (now > attempt.deadline) {
    attempts.delete(id)
    return undefined
  }
  return attempt
})

/** Forget an attempt (the user closed the dialog, or the login finished). */
export const forget = (id: string) => {
  attempts.delete(id)
}

/** Clear everything. Test seam. */
export const reset = () => attempts.clear()

/** How long the client should wait before the next poll, given what the console just said. */
export const nextDelay = (attempt: Attempt, outcome: Outcome): number =>
  outcome.status === "slow" ? attempt.interval + Duration.toMillis(SLOW_DOWN_MARGIN) : attempt.interval

/** Fold a poll result plus the known attempt into the shape the client sees. */
export const interpret = (attempt: Attempt, result: PollResult): Outcome => {
  if (result instanceof PollSuccess) return { status: "success", email: result.email }
  if (result instanceof PollPending) return { status: "pending" }
  if (result instanceof PollSlow) return { status: "slow" }
  if (result instanceof PollExpired) return { status: "expired" }
  if (result instanceof PollDenied) return { status: "denied" }
  if (result instanceof PollError) {
    const cause = result.cause
    return { status: "error", message: cause instanceof Error ? cause.message : String(cause) }
  }
  // An unrecognised tagged result means the console answered with something we do not model.
  // Treat it as a failure rather than looping forever on a shape we cannot interpret.
  return { status: "error", message: "Unrecognized device authorization response" }
}

/** Terminal outcomes end the attempt; the others leave it pollable. */
export const isTerminal = (outcome: Outcome) =>
  outcome.status === "success" || outcome.status === "expired" || outcome.status === "denied"

export * as AccountDeviceLogin from "./device-login"
