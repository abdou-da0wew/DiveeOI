import type { ExamAdaptiveSettings, ExamQuestion, ExamSpec } from "./chat-ui"
import { parseChatUISpec } from "./chat-ui-parse"
import { finite, identifier, object, optionalString, string } from "./exam-parse-helpers"
import type { Parsed } from "./exam-parse-helpers"

export { parseExamAnswerKey } from "./exam-answer-key-parse"

export function parseExamDraft(
  value: unknown,
  id: string,
  random: () => number = Math.random,
  options: { randomize?: boolean } = {},
): Parsed<ExamSpec> {
  const input = object(value)
  if (!input) return { ok: false, error: "Exam must be an object" }
  const title = string(input.title, "title", 120)
  const instructions = optionalString(input.instructions, "instructions", 800)
  if (!title.ok) return title
  if (!instructions.ok) return instructions

  const duration =
    input.durationMinutes === undefined ? undefined : finite(input.durationMinutes, "durationMinutes", 1, 240)
  if (duration && !duration.ok) return duration
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 60) {
    return { ok: false, error: "An exam needs between 1 and 60 questions" }
  }

  if (input.randomizeQuestions !== undefined && typeof input.randomizeQuestions !== "boolean") {
    return { ok: false, error: "randomizeQuestions must be a boolean" }
  }

  const questions: ExamQuestion[] = []
  const ids = new Set<string>()
  for (const raw of input.questions) {
    const question = object(raw)
    if (!question) return { ok: false, error: "Each exam question must be an object" }

    const questionId = identifier(question.id, "question.id")
    const prompt = string(question.prompt, "question.prompt", 1200)
    const points =
      question.points === undefined
        ? { ok: true as const, value: 1 }
        : finite(question.points, "question.points", 0.1, 100)
    if (!questionId.ok) return questionId
    if (!prompt.ok) return prompt
    if (!points.ok) return points
    if (ids.has(questionId.value)) return { ok: false, error: "Question IDs must be unique" }
    ids.add(questionId.value)
    if (!["single", "multiple", "boolean", "short"].includes(String(question.type))) {
      return { ok: false, error: "Question type must be single, multiple, boolean, or short" }
    }

    const type = question.type as ExamQuestion["type"]
    const difficulty =
      question.difficulty === undefined
        ? { ok: true as const, value: 3 }
        : finite(question.difficulty, "question.difficulty", 1, 5)
    if (!difficulty.ok || !Number.isInteger(difficulty.value)) {
      return { ok: false, error: `Question ${questionId.value} difficulty must be an integer from 1 to 5` }
    }
    const options: Array<{ id: string; label: string }> = []
    if (type === "single" || type === "multiple" || type === "boolean") {
      const rawOptions =
        type === "boolean"
          ? [
              { id: "true", label: "True" },
              { id: "false", label: "False" },
            ]
          : question.options
      if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 8) {
        return { ok: false, error: `Question ${questionId.value} needs between 2 and 8 options` }
      }
      const optionIds = new Set<string>()
      for (const rawOption of rawOptions) {
        const option = object(rawOption)
        if (!option) return { ok: false, error: "Exam option must be an object" }
        const optionId = identifier(option.id, "option.id")
        const label = string(option.label, "option.label", 220)
        if (!optionId.ok) return optionId
        if (!label.ok) return label
        if (optionIds.has(optionId.value)) return { ok: false, error: "Option IDs must be unique within a question" }
        optionIds.add(optionId.value)
        options.push({ id: optionId.value, label: label.value })
      }
    }

    const hasComponents = question.components !== undefined
    const hasState = question.state !== undefined
    const interactive = hasComponents
      ? parseChatUISpec(
          { title: "Question material", components: question.components, state: question.state, layout: "stack" },
          `exam-${questionId.value}`,
        )
      : { ok: true as const, value: undefined }
    if (!interactive.ok) return interactive
    if (hasState && !hasComponents)
      return { ok: false, error: `Question ${questionId.value} cannot declare state without components` }

    questions.push({
      id: questionId.value,
      type,
      prompt: prompt.value,
      ...(options.length ? { options } : {}),
      points: points.value,
      difficulty: difficulty.value as 1 | 2 | 3 | 4 | 5,
      ...(interactive.value?.state ? { state: interactive.value.state } : {}),
      ...(interactive.value?.components ? { components: interactive.value.components } : {}),
    })
  }

  const attempts =
    input.attemptsAllowed === undefined
      ? { ok: true as const, value: 1 }
      : finite(input.attemptsAllowed, "attemptsAllowed", 1, 10)
  if (!attempts.ok || !Number.isInteger(attempts.value)) {
    return { ok: false, error: "attemptsAllowed must be an integer from 1 to 10" }
  }

  let adaptive: ExamAdaptiveSettings | undefined
  if (input.adaptive !== undefined) {
    const rawAdaptive = object(input.adaptive)
    if (!rawAdaptive || rawAdaptive.enabled !== true) {
      return { ok: false, error: "adaptive must be an object with enabled: true" }
    }
    const count =
      rawAdaptive.questionsPerAttempt === undefined
        ? { ok: true as const, value: Math.min(10, questions.length) }
        : finite(rawAdaptive.questionsPerAttempt, "adaptive.questionsPerAttempt", 1, Math.min(60, questions.length))
    const start =
      rawAdaptive.startDifficulty === undefined
        ? { ok: true as const, value: 3 }
        : finite(rawAdaptive.startDifficulty, "adaptive.startDifficulty", 1, 5)
    const threshold =
      rawAdaptive.masteryThreshold === undefined
        ? { ok: true as const, value: 0.8 }
        : finite(rawAdaptive.masteryThreshold, "adaptive.masteryThreshold", 0.5, 1)
    if (!count.ok || !Number.isInteger(count.value) || !start.ok || !Number.isInteger(start.value) || !threshold.ok) {
      return { ok: false, error: "adaptive settings are outside their allowed ranges" }
    }
    adaptive = {
      enabled: true,
      questionsPerAttempt: count.value,
      startDifficulty: start.value as 1 | 2 | 3 | 4 | 5,
      masteryThreshold: threshold.value,
    }
  }

  if (input.randomizeQuestions === true && options.randomize !== false) {
    for (let index = questions.length - 1; index > 0; index--) {
      const raw = random()
      const bounded = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : 0
      const target = Math.floor(bounded * (index + 1))
      ;[questions[index], questions[target]] = [questions[target]!, questions[index]!]
    }
  }

  return {
    ok: true,
    value: {
      id,
      version: 1,
      title: title.value,
      instructions: instructions.value ?? "Answer every question, then submit your exam.",
      ...(duration?.ok ? { durationMinutes: duration.value } : {}),
      ...(input.randomizeQuestions === true ? { randomizeQuestions: true } : {}),
      attemptsAllowed: attempts.value,
      ...(adaptive ? { adaptive } : {}),
      questions,
      totalPoints: questions.reduce((sum, question) => sum + question.points, 0),
    },
  }
}
