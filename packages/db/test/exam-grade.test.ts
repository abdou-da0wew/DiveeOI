import { describe, expect, test } from "bun:test"
import { gradeExamAttempt, nextAdaptiveDifficulty, selectAdaptiveQuestions } from "../src/exam-grade"
import type { ExamSpec } from "../src/chat-ui"

const exam: ExamSpec = {
  id: "exam-graded",
  version: 1,
  title: "Science",
  instructions: "Answer all questions.",
  attemptsAllowed: 3,
  adaptive: { enabled: true, questionsPerAttempt: 2, startDifficulty: 3, masteryThreshold: 0.8 },
  questions: [
    {
      id: "choice",
      type: "multiple",
      prompt: "Choose both",
      points: 2,
      difficulty: 2,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
    },
    { id: "written", type: "short", prompt: "Define current", points: 3, difficulty: 3 },
    { id: "advanced", type: "short", prompt: "Explain resistance", points: 4, difficulty: 5 },
  ],
  totalPoints: 9,
}

describe("exam grading", () => {
  test("grades objective and rubric questions with configurable partial credit", () => {
    const grade = gradeExamAttempt({
      exam,
      answerKey: [
        { questionId: "choice", correctOptionIDs: ["a", "b"] },
        {
          questionId: "written",
          criteria: [
            { id: "definition", description: "Charge per time", points: 3, keywords: ["charge", "time"], match: "all" },
          ],
        },
      ],
      answers: { choice: ["a"], written: "Current is charge flowing per unit time" },
      config: { partialCredit: true, negativeMarking: 0.25 },
      attemptNumber: 1,
      attemptsAllowed: 3,
    })
    expect(grade.score).toBe(4)
    expect(grade.maximum).toBe(9)
    expect(grade.questionResults[0]?.status).toBe("partial")
    expect(grade.questionResults[1]?.status).toBe("correct")
    expect(grade.questionResults[2]?.status).toBe("needs-review")
    expect(grade.needsReviewCount).toBe(1)
  })

  test("honors all-or-nothing scoring and negative marking", () => {
    const grade = gradeExamAttempt({
      exam: { ...exam, questions: [exam.questions[0]!], totalPoints: 2, adaptive: undefined },
      answerKey: [{ questionId: "choice", correctOptionIDs: ["a", "b"] }],
      answers: { choice: ["a", "c"] },
      config: { partialCredit: false, negativeMarking: 1 },
      attemptNumber: 1,
      attemptsAllowed: 1,
    })
    expect(grade.score).toBe(0)
    expect(grade.questionResults[0]?.status).toBe("incorrect")
  })

  test("selects difficulty-adjacent questions and adapts future attempts", () => {
    const selected = selectAdaptiveQuestions({ exam, difficulty: 5, random: () => 0 })
    expect(selected.questions.map((item) => item.id)).toEqual(["advanced", "written"])
    expect(selected.totalPoints).toBe(7)
    expect(nextAdaptiveDifficulty(3, 95, exam.adaptive)).toBe(4)
    expect(nextAdaptiveDifficulty(3, 42, exam.adaptive)).toBe(2)
    expect(nextAdaptiveDifficulty(5, 100, exam.adaptive)).toBe(5)
  })
})
