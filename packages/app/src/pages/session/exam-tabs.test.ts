import { describe, expect, test } from "bun:test"
import {
  examTabs,
  examTimeRemaining,
  hydrateExamTabs,
  restoreExam,
  formatExamDuration,
  registerExam,
  setExamPresentation,
  setExamReportStatus,
  submitExam,
  updateExamAnswer,
  updateExamQuestionState,
  applyExamGrade,
  retryExam,
} from "./exam-tabs"

let sequence = 0
const makeExam = () => {
  const id = `exam-test-${++sequence}`
  return {
    id,
    version: 1 as const,
    title: "Science check",
    instructions: "Answer every question.",
    durationMinutes: 5,
    totalPoints: 3,
    questions: [
      {
        id: "q1",
        type: "single" as const,
        prompt: "Which one?",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        points: 1,
      },
      {
        id: "q2",
        type: "multiple" as const,
        prompt: "Select two.",
        options: [
          { id: "x", label: "X" },
          { id: "y", label: "Y" },
        ],
        points: 2,
      },
    ],
  }
}

describe("exam tab state", () => {
  test("stores answers, presentation state, elapsed time and report lifecycle", () => {
    const exam = makeExam()
    registerExam(exam, "session-test")
    const started = examTabs()[exam.id]
    expect(started.status).toBe("in-progress")
    expect(started.presentation).toBe("normal")

    updateExamAnswer(exam.id, "q1", "b")
    updateExamAnswer(exam.id, "q2", ["x", "y"])
    updateExamQuestionState(exam.id, "q2", { voltage: 12, current: 0.2 })
    expect(examTabs()[exam.id]?.answers).toEqual({ q1: "b", q2: ["x", "y"] })
    expect(examTabs()[exam.id]?.questionState.q2).toEqual({ voltage: 12, current: 0.2 })

    setExamPresentation(exam.id, "fill")
    expect(examTabs()[exam.id]?.presentation).toBe("fill")
    setExamPresentation(exam.id, "fullscreen")
    expect(examTabs()[exam.id]?.presentation).toBe("fullscreen")

    const submittedAt = started.startedAt + 92_000
    submitExam(exam.id, submittedAt)
    const submitted = examTabs()[exam.id]
    expect(submitted.status).toBe("submitted")
    expect(submitted.elapsedMs).toBe(92_000)
    expect(submitted.submittedAt).toBe(submittedAt)
    expect(submitted.reportStatus).toBe("pending")

    setExamReportStatus(exam.id, "sending")
    expect(examTabs()[exam.id]?.reportStatus).toBe("sending")
    setExamReportStatus(exam.id, "sent")
    expect(examTabs()[exam.id]?.reportStatus).toBe("sent")
  })

  test("does not overwrite an existing exam when a tool card is clicked twice", () => {
    const exam = makeExam()
    registerExam(exam, "session-test")
    updateExamAnswer(exam.id, "q1", "a")
    registerExam({ ...exam, title: "replacement" }, "session-test")
    expect(examTabs()[exam.id]?.exam.title).toBe("Science check")
    expect(examTabs()[exam.id]?.answers.q1).toBe("a")
  })

  test("restores an exam from a completed tool message with a fresh attempt clock", () => {
    const exam = makeExam()
    const before = Date.now()
    restoreExam(exam, "session-restored")
    const restored = examTabs()[exam.id]!
    expect(restored.sessionID).toBe("session-restored")
    // Regression (2026-11-23): restoreExam used to seed startedAt with the
    // create_exam message's time.created, so a duration-limited exam restored
    // mid-session instantly expired (remaining <= 0) and ExamWorkspace
    // auto-submitted it before the student answered anything. The attempt
    // clock must start at registration time in this browser.
    expect(restored.startedAt).toBeGreaterThanOrEqual(before)
    expect(restored.startedAt).toBeLessThanOrEqual(Date.now())
    expect(restored.status).toBe("in-progress")
    expect(restored.answers).toEqual({})
    expect(restored.questionState).toEqual({})
    // The countdown is FULL right after restore — a stale message timestamp
    // (hours old) must never eat into it.
    expect(examTimeRemaining(examTabs()[exam.id]!, Date.now())).toBe(exam.durationMinutes! * 60_000)
  })

  test("hydrates submitted attempts safely after a reload", () => {
    const exam = makeExam()
    hydrateExamTabs({
      [exam.id]: {
        exam,
        sessionID: "session-hydrated",
        startedAt: 10_000,
        submittedAt: 30_000,
        elapsedMs: 20_000,
        answers: { q1: "a" },
        questionState: { q1: { speed: 4 } },
        attemptNumber: 1,
        status: "submitted",
        presentation: "fullscreen",
        reportStatus: "sending",
      },
    })

    const restored = examTabs()[exam.id]
    expect(restored.presentation).toBe("normal")
    expect(restored.reportStatus).toBe("pending")
    expect(restored.elapsedMs).toBe(20_000)
    expect(restored.answers.q1).toBe("a")
    expect(restored.questionState.q1).toEqual({ speed: 4 })
  })

  test("computes countdown and formats elapsed time", () => {
    const exam = makeExam()
    registerExam(exam, "session-test")
    const current = examTabs()[exam.id]!
    expect(examTimeRemaining(current, current.startedAt + 30_000)).toBe(270_000)
    expect(formatExamDuration(92_000)).toBe("01:32")
    expect(formatExamDuration(3_661_000)).toBe("01:01:01")
  })
})

describe("exam retry lifecycle", () => {
  test("applies server grades and resets the next adaptive attempt", () => {
    const exam = makeExam()
    registerExam(exam, "session-retry")
    updateExamAnswer(exam.id, "q1", "a")
    submitExam(exam.id, examTabs()[exam.id]!.startedAt + 5_000)
    const nextAttempt = { ...exam, questions: [exam.questions[1]!], totalPoints: 2 }
    applyExamGrade(exam.id, {
      examId: exam.id,
      attemptNumber: 1,
      score: 1,
      maximum: 3,
      percentage: 33.33,
      needsReview: false,
      needsReviewCount: 0,
      questionResults: [{ questionId: "q1", earned: 1, maximum: 1, status: "correct", feedback: "Correct" }],
      attemptsAllowed: 3,
      attemptsRemaining: 2,
      nextAttempt,
    })
    expect(examTabs()[exam.id]?.grade?.percentage).toBe(33.33)
    expect(examTabs()[exam.id]?.reportStatus).toBe("sent")
    expect(retryExam(exam.id, 100_000)).toBe(true)
    expect(examTabs()[exam.id]?.attemptNumber).toBe(2)
    expect(examTabs()[exam.id]?.exam.questions.map((question) => question.id)).toEqual(["q2"])
    expect(examTabs()[exam.id]?.answers).toEqual({})
    expect(examTabs()[exam.id]?.questionState).toEqual({})
    expect(examTabs()[exam.id]?.status).toBe("in-progress")
  })
})
