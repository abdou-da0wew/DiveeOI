import type { ExamAnswerKeyEntry, ExamSpec, ParseResult } from "./chat-ui"
import { finite, identifier, object, optionalString, string } from "./exam-parse-helpers"
import type { Parsed } from "./exam-parse-helpers"

export function parseExamAnswerKey(value: unknown, exam: ExamSpec): Parsed<ExamAnswerKeyEntry[]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > exam.questions.length) {
    return { ok: false, error: "answerKey must contain at least one entry and cannot exceed the question count" }
  }
  const questions = new Map(exam.questions.map((question) => [question.id, question]))
  const seen = new Set<string>()
  const result: ExamAnswerKeyEntry[] = []
  for (const raw of value) {
    const entry = object(raw)
    if (!entry) return { ok: false, error: "Each answer key entry must be an object" }
    const questionId = identifier(entry.questionId, "answerKey.questionId")
    if (!questionId.ok) return questionId
    const question = questions.get(questionId.value)
    if (!question) return { ok: false, error: `Answer key references an unknown question: ${questionId.value}` }
    if (seen.has(questionId.value)) return { ok: false, error: `Duplicate answer key entry: ${questionId.value}` }
    seen.add(questionId.value)

    let correctOptionIDs: string[] | undefined
    if (entry.correctOptionIDs !== undefined) {
      if (
        !Array.isArray(entry.correctOptionIDs) ||
        entry.correctOptionIDs.length < 1 ||
        entry.correctOptionIDs.length > 8
      ) {
        return { ok: false, error: `Answer key for ${questionId.value} needs 1 to 8 correct option IDs` }
      }
      const ids = entry.correctOptionIDs.map((item) => identifier(item, "correctOptionID"))
      const invalid = ids.find((item) => !item.ok)
      if (invalid && !invalid.ok) return invalid
      correctOptionIDs = ids.map((item) => (item.ok ? item.value : ""))
      if (new Set(correctOptionIDs).size !== correctOptionIDs.length) {
        return { ok: false, error: `Correct option IDs must be unique for ${questionId.value}` }
      }
      const options = new Set((question.options ?? []).map((option) => option.id))
      if (correctOptionIDs.some((id) => !options.has(id))) {
        return { ok: false, error: `Answer key for ${questionId.value} references an unknown option` }
      }
      if (question.type !== "multiple" && correctOptionIDs.length !== 1) {
        return { ok: false, error: `Question ${questionId.value} must have exactly one correct option` }
      }
    }

    let acceptedAnswers: string[] | undefined
    if (entry.acceptedAnswers !== undefined) {
      if (
        !Array.isArray(entry.acceptedAnswers) ||
        entry.acceptedAnswers.length < 1 ||
        entry.acceptedAnswers.length > 20
      ) {
        return { ok: false, error: `Accepted answers for ${questionId.value} must contain 1 to 20 values` }
      }
      acceptedAnswers = []
      for (const rawAnswer of entry.acceptedAnswers) {
        const answer = string(rawAnswer, "acceptedAnswer", 500)
        if (!answer.ok) return answer
        acceptedAnswers.push(answer.value)
      }
    }

    const explanation = optionalString(entry.explanation, "answerKey.explanation", 800)
    if (!explanation.ok) return explanation
    if (entry.manualReview !== undefined && typeof entry.manualReview !== "boolean") {
      return { ok: false, error: `manualReview for ${questionId.value} must be a boolean` }
    }

    let criteria: ExamAnswerKeyEntry["criteria"]
    if (entry.criteria !== undefined) {
      if (!Array.isArray(entry.criteria) || entry.criteria.length < 1 || entry.criteria.length > 12) {
        return { ok: false, error: `Rubric for ${questionId.value} must contain 1 to 12 criteria` }
      }
      criteria = []
      const criterionIDs = new Set<string>()
      let total = 0
      for (const rawCriterion of entry.criteria) {
        const criterion = object(rawCriterion)
        if (!criterion) return { ok: false, error: "Rubric criteria must be objects" }
        const id = identifier(criterion.id, "criterion.id")
        const description = string(criterion.description, "criterion.description", 180)
        const points = finite(criterion.points, "criterion.points", 0.01, question.points)
        if (!id.ok) return id
        if (!description.ok) return description
        if (!points.ok) return points
        if (criterionIDs.has(id.value)) return { ok: false, error: `Duplicate rubric criterion: ${id.value}` }
        criterionIDs.add(id.value)
        if (!Array.isArray(criterion.keywords) || criterion.keywords.length < 1 || criterion.keywords.length > 20) {
          return { ok: false, error: `Criterion ${id.value} needs 1 to 20 keywords` }
        }
        const keywords: string[] = []
        for (const rawKeyword of criterion.keywords) {
          const keyword = string(rawKeyword, "criterion.keyword", 80)
          if (!keyword.ok) return keyword
          keywords.push(keyword.value)
        }
        if (criterion.match !== undefined && criterion.match !== "all" && criterion.match !== "any") {
          return { ok: false, error: `Criterion ${id.value} match must be all or any` }
        }
        total += points.value
        if (total > question.points + 1e-6) {
          return { ok: false, error: `Rubric criteria for ${questionId.value} exceed the question's point value` }
        }
        criteria.push({
          id: id.value,
          description: description.value,
          points: points.value,
          keywords,
          match: (criterion.match ?? "all") as "all" | "any",
        })
      }
      if (Math.abs(total - question.points) > 1e-6) {
        return {
          ok: false,
          error: `Rubric criteria for ${questionId.value} must total exactly ${question.points} points`,
        }
      }
    }

    if (question.type === "single" || question.type === "multiple" || question.type === "boolean") {
      if (!correctOptionIDs?.length)
        return { ok: false, error: `Objective question ${questionId.value} needs correctOptionIDs` }
    } else if (!acceptedAnswers?.length && !criteria?.length && entry.manualReview !== true) {
      return {
        ok: false,
        error: `Written question ${questionId.value} needs acceptedAnswers, a rubric, or manualReview: true`,
      }
    }

    result.push({
      questionId: questionId.value,
      ...(correctOptionIDs ? { correctOptionIDs } : {}),
      ...(acceptedAnswers ? { acceptedAnswers } : {}),
      ...(explanation.value ? { explanation: explanation.value } : {}),
      ...(entry.manualReview === true ? { manualReview: true } : {}),
      ...(criteria ? { criteria } : {}),
    })
  }

  for (const question of exam.questions) {
    if (!["single", "multiple", "boolean", "short"].includes(question.type)) continue
    if (!seen.has(question.id)) return { ok: false, error: `Missing grading rule for question ${question.id}` }
  }
  return { ok: true, value: result }
}
