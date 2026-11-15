import { describe, expect, test } from "bun:test"
import type { ExamTabEntry } from "./exam-tabs"
import { buildExamSubmissionPresentation, buildExamSubmissionReport } from "./exam-report"

describe("exam submission report", () => {
  test("includes every response, unanswered question, weights and exact elapsed time", () => {
    const entry: ExamTabEntry = {
      exam: {
        id: "science-report",
        version: 1,
        title: "Integrated Science",
        instructions: "Answer all questions.",
        durationMinutes: 20,
        totalPoints: 6,
        questions: [
          {
            id: "q1",
            type: "single",
            prompt: "Which law relates voltage, current and resistance?",
            options: [
              { id: "ohm", label: "Ohm's law" },
              { id: "newton", label: "Newton's law" },
            ],
            points: 2,
          },
          {
            id: "q2",
            type: "multiple",
            prompt: "Select two quantities.",
            options: [
              { id: "voltage", label: "Voltage" },
              { id: "current", label: "Current" },
            ],
            points: 3,
          },
          { id: "q3", type: "short", prompt: "Explain the relationship.", points: 1 },
        ],
      },
      sessionID: "session-report",
      startedAt: 1_000,
      answers: { q1: "ohm", q2: ["voltage", "current"] },
      questionState: { q2: { resistance: 6, enabled: true } },
      attemptNumber: 1,
      status: "submitted",
      presentation: "normal",
      elapsedMs: 123_000,
      submittedAt: 124_000,
      reportStatus: "pending",
    }

    const presentation = buildExamSubmissionPresentation(entry)
    expect(presentation).toEqual({
      kind: "exam-submission",
      label: "Exam submission",
      summary: "Integrated Science · #1 · 2/3",
      metadata: { exam: "Integrated Science", attempt: 1, questions: 3, answered: 2 },
    })

    const report = buildExamSubmissionReport(entry)
    expect(report).toContain('The student submitted exam "Integrated Science"')
    expect(report).toContain("Elapsed time: 02:03")
    expect(report).toContain("Time limit: 20 minutes")
    expect(report).toContain("Answered: 2/3")
    expect(report).toContain('"examID":"science-report"')
    expect(report).toContain('"attemptNumber":1')
    expect(report).toContain('"questionId":"q1","answer":"ohm"')
    expect(report).toContain('"questionId":"q2","answer":["voltage","current"]')
    expect(report).toContain('"q2":{"resistance":6,"enabled":true}')
    expect(report).toContain("Call the grade_exam tool now")
  })
})
