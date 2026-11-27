// Unit tests for the shared token estimator and the boundary-aware memory cut.
// These back the pre-compaction window trigger (prompt.ts), the compaction tail
// budget (compaction.ts) and the <memory-context> rendering (memory.ts).
import { describe, expect, test } from "bun:test"
import { estimateHistoryTokens, estimateMessageTokens, MEDIA_TOKEN_ESTIMATES } from "@/session/estimate"
import { truncateAtBoundary } from "@/session/memory"
import type { SessionV1 } from "@diveeoi/db/v1/session"

const msg = (parts: SessionV1.WithParts["parts"]): SessionV1.WithParts =>
  ({ info: { role: "user", id: "m" }, parts }) as unknown as SessionV1.WithParts

describe("estimateMessageTokens", () => {
  test("counts text at 4 chars per token", () => {
    const est = estimateMessageTokens(msg([{ type: "text", text: "a".repeat(400) }]))
    expect(est).toBe(100)
  })

  test("counts tool output mass", () => {
    const est = estimateMessageTokens(
      msg([
        {
          type: "tool",
          tool: "bash",
          state: { status: "completed", output: "x".repeat(800), input: {}, title: "bash" },
        } as unknown as SessionV1.WithParts["parts"][number],
      ]),
    )
    // tool name + output chars, /4
    expect(est).toBeGreaterThanOrEqual(200)
  })

  test("counts media parts that used to be invisible", () => {
    const image = msg([{ type: "file", mime: "image/png", url: "file:///a.png" } as never])
    const pdf = msg([{ type: "file", mime: "application/pdf", url: "file:///a.pdf" } as never])
    const text = msg([{ type: "file", mime: "text/plain", url: "file:///a.txt" } as never])
    expect(estimateMessageTokens(image)).toBe(MEDIA_TOKEN_ESTIMATES.image)
    expect(estimateMessageTokens(pdf)).toBe(MEDIA_TOKEN_ESTIMATES.pdf)
    expect(estimateMessageTokens(text)).toBe(MEDIA_TOKEN_ESTIMATES.file)
  })

  test("estimateHistoryTokens sums messages", () => {
    const est = estimateHistoryTokens([
      msg([{ type: "text", text: "b".repeat(40) }]),
      msg([{ type: "text", text: "c".repeat(40) }]),
    ])
    expect(est).toBe(20)
  })
})

describe("truncateAtBoundary", () => {
  test("returns short content untouched", () => {
    const r = truncateAtBoundary("short", 100)
    expect(r).toEqual({ text: "short", truncated: false })
  })

  test("cuts at the last sentence end, not mid-word", () => {
    const text = "x".repeat(60) + " end of long first sentence. Short tail here. More."
    const r = truncateAtBoundary(text, 100)
    expect(r.truncated).toBe(true)
    expect(r.text.endsWith("sentence.")).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(101)
    expect(r.text).not.toContain("tail")
  })

  test("falls back to a line break when there is no sentence end", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line-${i} ${"x".repeat(10)}`).join("\n")
    const r = truncateAtBoundary(lines, 60)
    expect(r.truncated).toBe(true)
    expect(r.text.split("\n").length).toBeGreaterThan(1)
    expect(r.text.endsWith("line-2 xxxxxxxxxx")).toBe(true)
  })

  test("falls back to a space boundary before hard-cutting", () => {
    const text = `${"longword ".repeat(40)}end`
    const r = truncateAtBoundary(text, 100)
    expect(r.truncated).toBe(true)
    expect(r.text.endsWith("longword")).toBe(true)
  })
})
