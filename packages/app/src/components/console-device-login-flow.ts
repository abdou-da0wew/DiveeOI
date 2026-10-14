/**
 * Decision logic for the Console device sign-in, kept separate from the view so the parts that
 * are easy to get wrong - what is terminal, how long to wait, when to give up - can be tested
 * without rendering anything.
 */

export type Stage = "start" | "starting" | "waiting" | "denied" | "expired" | "error"

export type PollStatus = "pending" | "slow" | "expired" | "denied" | "error" | "success"

export type PollResult = {
  status: PollStatus
  email?: string
  message?: string
  nextPollMs: number
}

export type Step =
  | { readonly action: "poll"; readonly delayMs: number }
  | { readonly action: "done"; readonly email: string }
  | { readonly action: "stop" }
  | { readonly action: "warn"; readonly message: string; readonly delayMs: number }

/** Used when the server cannot supply a cadence, so a client never busy-loops on its own. */
const FALLBACK_DELAY_MS = 5000

/**
 * Decide what to do after one poll.
 *
 * `pending` and `slow` both mean keep waiting, and the server owns the cadence because it is
 * the side that knows about the RFC 8628 `slow_down` penalty. A terminal status stops. An
 * `error` is deliberately *not* terminal: the console being briefly unreachable should not
 * abandon a sign-in the user is completing in another tab, so it warns and tries again.
 */
export const step = (result: PollResult): Step => {
  switch (result.status) {
    case "success":
      return { action: "done", email: result.email ?? "" }
    case "denied":
      return { action: "stop" }
    case "expired":
      return { action: "stop" }
    case "error":
      return {
        action: "warn",
        message: result.message ?? "",
        delayMs: result.nextPollMs > 0 ? result.nextPollMs : FALLBACK_DELAY_MS,
      }
    default:
      return { action: "poll", delayMs: result.nextPollMs > 0 ? result.nextPollMs : FALLBACK_DELAY_MS }
  }
}

/** Stage the view should move to once polling has stopped for good. */
export const terminalStage = (result: PollResult): Extract<Stage, "denied" | "expired"> | undefined => {
  if (result.status === "denied") return "denied"
  if (result.status === "expired") return "expired"
  return undefined
}

/** Pull a human-readable message out of whatever the SDK rejected with. */
export function describeError(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "data" in error) {
    const message = (error as { data?: { message?: unknown } }).data?.message
    if (typeof message === "string" && message) return message
  }
  if (error && typeof error === "object" && "error" in error) {
    const nested = describeError((error as { error?: unknown }).error, "")
    if (nested) return nested
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}

export * as ConsoleDeviceLoginFlow from "./console-device-login-flow"
