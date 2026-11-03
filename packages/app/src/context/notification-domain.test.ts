import { describe, expect, it } from "bun:test"
import {
  consumeFailedSession,
  markFailedSession,
  markSessionError,
  sessionErrorDescription,
} from "./notification-domain"

describe("session notification domain", () => {
  it("prefers the safe error message over a session title", () => {
    expect(
      sessionErrorDescription(
        { name: "UnknownError", data: { message: "Composer has no route\n    at prompt.ts:1:1" } },
        "New session",
        "An error occurred",
      ),
    ).toBe("Composer has no route")
  })

  it("uses the session title and fallback when the error has no message", () => {
    expect(
      sessionErrorDescription({ name: "MessageOutputLengthError", data: {} }, "Build task", "An error occurred"),
    ).toBe("Build task")
    expect(sessionErrorDescription(undefined, undefined, "An error occurred")).toBe("An error occurred")
  })

  it("deduplicates error events until the matching idle event arrives", () => {
    const failed = new Set<string>()

    expect(markFailedSession(failed, "/workspace/a", "session-1")).toBe(true)
    expect(markFailedSession(failed, "/workspace/a", "session-1")).toBe(false)
    expect(markFailedSession(failed, "/workspace/b", "session-1")).toBe(true)
    expect(consumeFailedSession(failed, "/workspace/a", "session-1")).toBe(true)
    expect(markFailedSession(failed, "/workspace/a", "session-1")).toBe(true)
  })

  it("deduplicates late error events without suppressing later turns", () => {
    const recent = new Map<string, number>()

    expect(markSessionError(recent, "/workspace/a", "session-1", 1_000)).toBe(true)
    expect(markSessionError(recent, "/workspace/a", "session-1", 1_100)).toBe(false)
    expect(markSessionError(recent, "/workspace/b", "session-1", 1_100)).toBe(true)
    expect(markSessionError(recent, "/workspace/a", "session-1", 6_000)).toBe(true)
    expect(markSessionError(recent, "/workspace/a", undefined, 6_100)).toBe(true)
  })

  it("does not consume a global idle event as a session failure", () => {
    const failed = new Set<string>()
    expect(consumeFailedSession(failed, "/workspace/a", undefined)).toBe(false)
    expect(markFailedSession(failed, "/workspace/a", undefined)).toBe(false)
    expect(failed.size).toBe(0)
  })
})
