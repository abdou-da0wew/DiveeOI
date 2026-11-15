import { describe, expect, test } from "bun:test"
import { parseUserMessage, serializeUserMessage } from "./user-message-metadata"

describe("user message presentation metadata", () => {
  test("round-trips metadata while preserving the complete agent-facing body", () => {
    const body = 'Grade this submitted exam.\n{"answers":[{"questionId":"q1","answer":"A"}]}'
    const encoded = serializeUserMessage(body, {
      kind: "exam-submission",
      label: "Exam submission",
      summary: "Science · Attempt 2 · 1/3 answered",
      metadata: { attempt: 2, answered: 1, questions: 3 },
    })

    expect(encoded).toContain("<!--diveeoi-user-message")
    expect(parseUserMessage(encoded)).toEqual({
      presentation: {
        kind: "exam-submission",
        label: "Exam submission",
        summary: "Science · Attempt 2 · 1/3 answered",
        metadata: { attempt: 2, answered: 1, questions: 3 },
      },
      body,
    })
  })

  test("preserves an existing trailing newline in the submitted body", () => {
    const body = "line one\nline two\n"
    expect(parseUserMessage(serializeUserMessage(body, { kind: "submission", label: "Submission" }))?.body).toBe(body)
  })

  test("escapes HTML-comment terminators and restores their original value", () => {
    const encoded = serializeUserMessage("payload", {
      kind: "form-submission",
      label: "Form",
      summary: "contains --> comment terminator",
    })

    expect(encoded).not.toContain("--> comment")
    expect(parseUserMessage(encoded)?.presentation.summary).toBe("contains --> comment terminator")
  })

  test("rejects malformed, unsupported, or oversized metadata without hiding the body", () => {
    expect(parseUserMessage("<!--diveeoi-user-message {bad}-->\nsecret")).toBeUndefined()
    expect(parseUserMessage(serializeUserMessage("body", { kind: "BAD KIND", label: "Label" }))).toBeUndefined()
    expect(serializeUserMessage("body", { kind: "submission", label: "x".repeat(81) })).toBe("body")
  })
})
