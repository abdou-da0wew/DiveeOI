import { describe, expect, test } from "bun:test"
import { SessionV1 } from "@diveeoi/db/v1/session"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { canonicalJson, callHash, diagnoseLoop, LoopGuard, loopMessage, stripVolatile } from "@/session/loop-guard"

const sessionID = SessionID.make("ses_loop")

function assistant(parts: Array<{ tool: string; input: unknown; status?: string }>): SessionV1.WithParts {
  return {
    info: {
      id: MessageID.ascending(),
      role: "assistant",
      sessionID,
      mode: "build",
      agent: "build",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: "m",
      providerID: "p",
      time: { created: 0 },
    },
    parts: parts.map((p) => ({
      id: PartID.ascending(),
      sessionID,
      messageID: "msg",
      type: "tool",
      callID: "call",
      tool: p.tool,
      state: { status: p.status ?? "completed", input: p.input, output: "out" },
    })) as unknown as SessionV1.WithParts["parts"],
  } as unknown as SessionV1.WithParts
}

describe("loop-guard", () => {
  test("canonicalJson is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe(canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }))
  })

  test("volatile args do not change the hash", () => {
    expect(callHash("bash", { command: "ls", timeout: 1000 })).toBe(callHash("bash", { command: "ls", timeout: 90000 }))
    expect(stripVolatile("bash", { command: "ls", timeout: 1 })).toEqual({ command: "ls" })
    // non-volatile args still count
    expect(callHash("bash", { command: "ls" })).not.toBe(callHash("bash", { command: "pwd" }))
  })

  test("guard ignores non-repeating work", () => {
    const guard = new LoopGuard()
    for (const cmd of ["ls", "pwd", "echo a", "echo b", "cat f"]) {
      expect(guard.push("bash", { command: cmd })).toBeUndefined()
    }
  })

  test("guard trips on the third identical consecutive call", () => {
    const guard = new LoopGuard()
    expect(guard.push("read", { path: "/a" })).toBeUndefined()
    expect(guard.push("bash", { command: "ls" })).toBeUndefined()
    const diagnosis = guard.push("bash", { command: "ls" })
    expect(diagnosis).toBeUndefined()
    const tripped = guard.push("bash", { command: "ls" })
    expect(tripped?.tool).toBe("bash")
    expect(tripped?.consecutive).toBe(3)
  })

  test("diagnoseLoop finds a loop in persisted history (newest first)", () => {
    const messages = [
      assistant([{ tool: "bash", input: { command: "echo hi" } }]),
      assistant([{ tool: "read", input: { path: "/x" } }]),
      assistant([{ tool: "bash", input: { command: "echo hi" } }]),
      assistant([{ tool: "bash", input: { command: "echo hi" } }]),
      assistant([{ tool: "bash", input: { command: "echo hi" } }]),
    ]
    const diagnosis = diagnoseLoop(messages)
    expect(diagnosis?.tool).toBe("bash")
    expect(diagnosis?.consecutive).toBeGreaterThanOrEqual(3)
    expect(loopMessage(diagnosis!)).toContain("identical arguments")
  })

  test("diagnoseLoop stays quiet for interleaved repeats", () => {
    const messages = [
      assistant([{ tool: "read", input: { path: "/a" } }]),
      assistant([{ tool: "bash", input: { command: "ls" } }]),
      assistant([{ tool: "read", input: { path: "/a" } }]),
      assistant([{ tool: "bash", input: { command: "ls" } }]),
    ]
    expect(diagnoseLoop(messages)).toBeUndefined()
  })

  test("provider-executed tools are not blamed on the loop", () => {
    const message = assistant([{ tool: "webfetch", input: { url: "https://x" } }])
    const parts = message.parts as unknown as Array<Record<string, unknown>>
    for (const part of parts) part.metadata = { providerExecuted: true }
    expect(diagnoseLoop([message])).toBeUndefined()
  })

  test("pending tools are not counted", () => {
    const messages = [assistant([{ tool: "bash", input: { command: "ls" }, status: "pending" }])]
    expect(diagnoseLoop(messages)).toBeUndefined()
  })
})
