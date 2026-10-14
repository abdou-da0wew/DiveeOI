import { describe, expect, test } from "bun:test"
import { step, terminalStage, describeError } from "./console-device-login-flow"

describe("console device login flow", () => {
  test("success finishes and reports the account email", () => {
    expect(step({ status: "success", email: "dev@example.com", nextPollMs: 0 })).toEqual({
      action: "done",
      email: "dev@example.com",
    })
    // The email is optional on the wire; a missing one must not break the handoff.
    expect(step({ status: "success", nextPollMs: 0 })).toEqual({ action: "done", email: "" })
  })

  test("pending and slow keep polling on the cadence the server chose", () => {
    expect(step({ status: "pending", nextPollMs: 5000 })).toEqual({ action: "poll", delayMs: 5000 })
    // The server widens the interval after `slow_down`; the client must honour it verbatim
    // rather than using its own idea of the delay.
    expect(step({ status: "slow", nextPollMs: 10000 })).toEqual({ action: "poll", delayMs: 10000 })
  })

  test("a missing or nonsensical cadence falls back instead of busy-looping", () => {
    expect(step({ status: "pending", nextPollMs: 0 })).toEqual({ action: "poll", delayMs: 5000 })
    expect(step({ status: "pending", nextPollMs: -1 })).toEqual({ action: "poll", delayMs: 5000 })
  })

  test("denied and expired stop polling", () => {
    expect(step({ status: "denied", nextPollMs: 0 })).toEqual({ action: "stop" })
    expect(step({ status: "expired", nextPollMs: 0 })).toEqual({ action: "stop" })
  })

  test("an error warns but keeps trying: the user is approving in another tab", () => {
    const result = step({ status: "error", message: "console unreachable", nextPollMs: 5000 })
    expect(result).toEqual({ action: "warn", message: "console unreachable", delayMs: 5000 })
    // Not terminal, even though the console said error.
    expect(terminalStage({ status: "error", nextPollMs: 0 })).toBeUndefined()
  })

  test("an error with no message still produces a usable warning", () => {
    expect(step({ status: "error", nextPollMs: 0 })).toEqual({ action: "warn", message: "", delayMs: 5000 })
  })

  test("terminalStage maps only the two stopping statuses", () => {
    expect(terminalStage({ status: "denied", nextPollMs: 0 })).toBe("denied")
    expect(terminalStage({ status: "expired", nextPollMs: 0 })).toBe("expired")
    expect(terminalStage({ status: "success", nextPollMs: 0 })).toBeUndefined()
    expect(terminalStage({ status: "pending", nextPollMs: 0 })).toBeUndefined()
    expect(terminalStage({ status: "slow", nextPollMs: 0 })).toBeUndefined()
  })

  test("describeError unwraps the shapes the SDK actually throws", () => {
    expect(describeError({ data: { message: "Could not reach the console" } }, "fb")).toBe(
      "Could not reach the console",
    )
    expect(describeError({ error: { data: { message: "nested" } } }, "fb")).toBe("nested")
    expect(describeError(new Error("plain"), "fb")).toBe("plain")
    expect(describeError("string", "fb")).toBe("string")
    // Anything unrecognised falls back rather than rendering "undefined" to the user.
    expect(describeError(undefined, "fb")).toBe("fb")
    expect(describeError({}, "fb")).toBe("fb")
  })
})
