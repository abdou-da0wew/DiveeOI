import type { JSONSchema7 } from "@ai-sdk/provider"
import type { ExamAnalytics, ExamGrade } from "@diveeoi/db/chat-ui"
import type { ExamAnswer } from "@diveeoi/db/exam-grade"

export type GradeMetadata = {
  error?: boolean
  examGrade?: ExamGrade
  analytics?: ExamAnalytics
}

type InteractiveState = Record<string, Record<string, string | number | boolean>>

export const parameters: JSONSchema7 = {
  type: "object",
  properties: {
    examID: { type: "string", minLength: 1, maxLength: 80 },
    attemptNumber: { type: "integer", minimum: 1, maximum: 10 },
    elapsedMs: { type: "integer", minimum: 0, maximum: 14400000 },
    answers: {
      type: "array",
      minItems: 1,
      maxItems: 60,
      items: {
        type: "object",
        properties: {
          questionId: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
          answer: {
            anyOf: [
              { type: "string", maxLength: 2000 },
              { type: "array", minItems: 1, maxItems: 8, items: { type: "string", maxLength: 48 } },
            ],
          },
        },
        required: ["questionId", "answer"],
        additionalProperties: false,
      },
    },
    interactiveState: {
      type: "object",
      maxProperties: 60,
      additionalProperties: {
        type: "object",
        maxProperties: 24,
        additionalProperties: { type: ["string", "number", "boolean"] },
      },
    },
  },
  required: ["examID", "attemptNumber", "answers"],
  additionalProperties: false,
}

export function parseAnswers(
  value: unknown,
): { ok: true; value: Record<string, ExamAnswer> } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 60) {
    return { ok: false, error: "answers must be an array of 1 to 60 question responses" }
  }
  const result: Record<string, ExamAnswer> = {}
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return { ok: false, error: "Each answer must be an object" }
    const input = raw as Record<string, unknown>
    if (typeof input.questionId !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(input.questionId)) {
      return { ok: false, error: "Each answer needs a valid questionId" }
    }
    if (input.questionId in result) return { ok: false, error: `Duplicate answer: ${input.questionId}` }
    if (typeof input.answer === "string" && input.answer.length <= 2000) result[input.questionId] = input.answer
    else if (
      Array.isArray(input.answer) &&
      input.answer.length <= 8 &&
      input.answer.every((item) => typeof item === "string" && item.length <= 48)
    )
      result[input.questionId] = [...new Set(input.answer)] as string[]
    else return { ok: false, error: `Answer for ${input.questionId} must be a short string or option ID array` }
  }
  return { ok: true, value: result }
}

export function parseInteractiveState(
  value: unknown,
): { ok: true; value: InteractiveState } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: {} }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ok: false, error: "interactiveState must be an object" }
  const entries = Object.entries(value)
  if (entries.length > 60) return { ok: false, error: "interactiveState may contain at most 60 questions" }
  const result: InteractiveState = {}
  for (const [questionID, rawState] of entries) {
    if (
      !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(questionID) ||
      !rawState ||
      typeof rawState !== "object" ||
      Array.isArray(rawState)
    ) {
      return { ok: false, error: "interactiveState contains an invalid question or state object" }
    }
    const fields = Object.entries(rawState)
    if (fields.length > 24) return { ok: false, error: `Question ${questionID} has too many interactive settings` }
    result[questionID] = {}
    for (const [key, field] of fields) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(key))
        return { ok: false, error: `Invalid interactive state key: ${key}` }
      if (typeof field === "string" && field.length <= 240) result[questionID]![key] = field
      else if (typeof field === "number" && Number.isFinite(field)) result[questionID]![key] = field
      else if (typeof field === "boolean") result[questionID]![key] = field
      else return { ok: false, error: `Invalid interactive state value for ${questionID}.${key}` }
    }
  }
  return { ok: true, value: result }
}

export const number = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

export function analytics(values: number[]): ExamAnalytics {
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  return {
    attemptCount: values.length,
    averagePercentage: Number(average.toFixed(2)),
    bestPercentage: Number(Math.max(0, ...values).toFixed(2)),
    latestPercentage: Number((values.at(-1) ?? 0).toFixed(2)),
  }
}

export function renderGrade(grade: ExamGrade, attemptCount: number) {
  const lines = [
    `Attempt ${grade.attemptNumber}: ${grade.score}/${grade.maximum} (${grade.percentage}%).`,
    `Attempt ${attemptCount} of ${grade.attemptsAllowed}. ${grade.attemptsRemaining} retry/ies remaining.`,
    grade.needsReview
      ? `${grade.needsReviewCount} question(s) require tutor review; this score is provisional.`
      : "All questions were graded automatically.",
    ...grade.questionResults.map(
      (question) =>
        `- ${question.questionId}: ${question.earned}/${question.maximum}, ${question.status}. ${question.feedback}${question.explanation ? ` Explanation: ${question.explanation}` : ""}`,
    ),
  ]
  return lines.join("\n")
}
