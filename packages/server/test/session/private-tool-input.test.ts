import { describe, expect, test } from "bun:test"
import { isPrivateToolInput, redactToolInput } from "../../src/session/private-tool-input"

describe("private tool input boundaries", () => {
  test("redacts secret grading inputs while preserving the public question payload", () => {
    const input = {
      title: "Exam",
      questions: [{ id: "q1", prompt: "Question" }],
      answerKey: [{ questionId: "q1", correctOptionIDs: ["secret"] }],
      grading: { negativeMarking: 0.2 },
    }
    expect(isPrivateToolInput("create_exam")).toBe(true)
    expect(redactToolInput("create_exam", input)).toEqual({
      title: "Exam",
      questions: [{ id: "q1", prompt: "Question" }],
      answerKey: "[REDACTED]",
      grading: "[REDACTED]",
    })
    expect(input.answerKey).toEqual([{ questionId: "q1", correctOptionIDs: ["secret"] }])
  })

  test("does not rewrite unrelated tool inputs", () => {
    const input = { query: "hello", limit: 10 }
    expect(isPrivateToolInput("websearch")).toBe(false)
    expect(redactToolInput("websearch", input)).toBe(input)
  })
})
