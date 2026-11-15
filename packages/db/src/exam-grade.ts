import type {
  ExamAdaptiveSettings,
  ExamAnswerKeyEntry,
  ExamGrade,
  ExamGradingConfig,
  ExamQuestion,
  ExamQuestionGrade,
  ExamSpec,
} from "./chat-ui"

export type ExamAnswer = string | string[]

const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/\s+/g, " ")
    .trim()

const answered = (value: ExamAnswer | undefined) =>
  Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0

function choiceGrade(input: {
  question: ExamQuestion
  expected: string[]
  answer: ExamAnswer | undefined
  config: ExamGradingConfig
  explanation?: string
}): ExamQuestionGrade {
  const { question, expected, answer, config, explanation } = input
  const selected = Array.isArray(answer) ? answer : typeof answer === "string" ? [answer] : []
  const expectedSet = new Set(expected)
  const selectedSet = new Set(selected)
  const correct = [...selectedSet].filter((id) => expectedSet.has(id)).length
  const incorrect = [...selectedSet].filter((id) => !expectedSet.has(id)).length
  const exact = correct === expectedSet.size && incorrect === 0 && selectedSet.size === expectedSet.size
  let ratio = exact ? 1 : 0
  if (question.type === "multiple" && config.partialCredit && selectedSet.size > 0) {
    ratio = Math.max(0, Math.min(1, (correct - incorrect * config.negativeMarking) / expectedSet.size))
  }
  const earned = Number((question.points * ratio).toFixed(4))
  const status = exact ? "correct" : earned > 0 ? "partial" : answered(answer) ? "incorrect" : "unanswered"
  return {
    questionId: question.id,
    earned,
    maximum: question.points,
    status,
    feedback:
      status === "correct"
        ? "Correct"
        : status === "partial"
          ? "Partially correct"
          : status === "unanswered"
            ? "Not answered"
            : "Incorrect",
    ...(explanation ? { explanation } : {}),
    correctOptionIDs: expected,
  }
}

function writtenGrade(input: {
  question: ExamQuestion
  entry: ExamAnswerKeyEntry
  answer: ExamAnswer | undefined
  config: ExamGradingConfig
}): ExamQuestionGrade {
  const { question, entry, answer, config } = input
  const response = typeof answer === "string" ? normalize(answer) : ""
  if (!response) {
    return {
      questionId: question.id,
      earned: 0,
      maximum: question.points,
      status: "unanswered",
      feedback: "Not answered",
      ...(entry.explanation ? { explanation: entry.explanation } : {}),
    }
  }

  const exact = (entry.acceptedAnswers ?? []).some((accepted) => normalize(accepted) === response)
  if (exact) {
    return {
      questionId: question.id,
      earned: question.points,
      maximum: question.points,
      status: "correct",
      feedback: "Accepted answer",
      ...(entry.explanation ? { explanation: entry.explanation } : {}),
    }
  }

  const criteria = entry.criteria ?? []
  if (criteria.length === 0 || entry.manualReview === true) {
    return {
      questionId: question.id,
      earned: 0,
      maximum: question.points,
      status: "needs-review",
      feedback: "Requires tutor review",
      ...(entry.explanation ? { explanation: entry.explanation } : {}),
    }
  }

  const matched = criteria.map((criterion) => {
    const terms = criterion.keywords.map(normalize)
    const matches = terms.map((term) => response.includes(term))
    const ok = criterion.match === "any" ? matches.some(Boolean) : matches.every(Boolean)
    return { criterion, matched: ok }
  })
  const fullCriteria = matched.reduce((sum, item) => sum + (item.matched ? item.criterion.points : 0), 0)
  const rubricMaximum = criteria.reduce((sum, item) => sum + item.points, 0)
  const earned = Number(
    (config.partialCredit ? fullCriteria : fullCriteria >= rubricMaximum ? rubricMaximum : 0).toFixed(4),
  )
  const status = earned >= question.points - 1e-6 ? "correct" : earned > 0 ? "partial" : "incorrect"
  return {
    questionId: question.id,
    earned,
    maximum: question.points,
    status,
    feedback:
      status === "correct"
        ? "Rubric met"
        : status === "partial"
          ? "Some rubric criteria met"
          : "Rubric criteria not met",
    ...(entry.explanation ? { explanation: entry.explanation } : {}),
    criteria: matched.map(({ criterion, matched: didMatch }) => ({
      id: criterion.id,
      description: criterion.description,
      earned: didMatch ? criterion.points : 0,
      maximum: criterion.points,
      matched: didMatch,
    })),
  }
}

export function gradeExamAttempt(input: {
  exam: ExamSpec
  answerKey: ExamAnswerKeyEntry[]
  answers: Record<string, ExamAnswer>
  config: ExamGradingConfig
  attemptNumber: number
  attemptsAllowed: number
}): ExamGrade {
  const keys = new Map(input.answerKey.map((entry) => [entry.questionId, entry]))
  const questionResults: ExamQuestionGrade[] = input.exam.questions.map((question) => {
    const entry = keys.get(question.id)
    if (!entry) {
      return {
        questionId: question.id,
        earned: 0,
        maximum: question.points,
        status: "needs-review",
        feedback: "No automatic grading rule exists for this question",
      }
    }
    if (question.type === "single" || question.type === "multiple" || question.type === "boolean") {
      return choiceGrade({
        question,
        expected: entry.correctOptionIDs ?? [],
        answer: input.answers[question.id],
        config: input.config,
        explanation: entry.explanation,
      })
    }
    return writtenGrade({ question, entry, answer: input.answers[question.id], config: input.config })
  })

  const score = Number(questionResults.reduce((sum, result) => sum + result.earned, 0).toFixed(4))
  const maximum = Number(questionResults.reduce((sum, result) => sum + result.maximum, 0).toFixed(4))
  const needsReviewCount = questionResults.filter((result) => result.status === "needs-review").length
  const percentage = maximum > 0 ? Number(((score / maximum) * 100).toFixed(2)) : 0
  return {
    examId: input.exam.id,
    attemptNumber: input.attemptNumber,
    score,
    maximum,
    percentage,
    needsReview: needsReviewCount > 0,
    needsReviewCount,
    questionResults,
    attemptsAllowed: input.attemptsAllowed,
    attemptsRemaining: Math.max(0, input.attemptsAllowed - input.attemptNumber),
  }
}

export function nextAdaptiveDifficulty(current: number, percentage: number, settings?: ExamAdaptiveSettings) {
  if (!settings?.enabled) return current
  const next = percentage >= settings.masteryThreshold * 100 ? current + 1 : current - 1
  return Math.max(1, Math.min(5, next))
}

export function selectAdaptiveQuestions(input: {
  exam: ExamSpec
  difficulty: number
  random?: () => number
}): ExamSpec {
  const { exam } = input
  const settings = exam.adaptive
  if (!settings?.enabled || exam.questions.length <= settings.questionsPerAttempt) {
    return {
      ...exam,
      questions: [...exam.questions],
      totalPoints: exam.questions.reduce((sum, item) => sum + item.points, 0),
    }
  }
  const random = input.random ?? Math.random
  const sorted = [...exam.questions].sort((a, b) => {
    const distance = Math.abs((a.difficulty ?? 3) - input.difficulty) - Math.abs((b.difficulty ?? 3) - input.difficulty)
    return distance || (a.id < b.id ? -1 : 1)
  })
  const selected = sorted.slice(0, settings.questionsPerAttempt)
  if (exam.randomizeQuestions) {
    for (let index = selected.length - 1; index > 0; index--) {
      const raw = random()
      const bounded = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : 0
      const target = Math.floor(bounded * (index + 1))
      ;[selected[index], selected[target]] = [selected[target]!, selected[index]!]
    }
  }
  return {
    ...exam,
    questions: selected,
    totalPoints: selected.reduce((sum, item) => sum + item.points, 0),
  }
}
