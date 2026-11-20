import type { ChatUILearningComponent, ParseResult } from "./chat-ui"

type Parsed<T> = ParseResult<T>
type RecordValue = Record<string, unknown>
const object = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined

const string = (value: unknown, field: string, max = 240): Parsed<string> =>
  typeof value === "string" && value.trim() && value.length <= max
    ? { ok: true, value: value.trim() }
    : { ok: false, error: `${field} must be a non-empty string of at most ${max} characters` }

const id = (value: unknown, field: string): Parsed<string> => {
  const parsed = string(value, field, 48)
  if (!parsed.ok) return parsed
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(parsed.value)
    ? parsed
    : { ok: false, error: `${field} must be a valid identifier` }
}

const optionalText = (value: unknown, field: string, max = 320) => {
  if (value === undefined || value === null || value === "") return { ok: true as const, value: undefined }
  return string(value, field, max)
}

export function parseChatUILearningComponent(input: RecordValue): Parsed<ChatUILearningComponent> | undefined {
  if (input.type === "quiz") {
    const title = string(input.title, "quiz.title", 120)
    const description = optionalText(input.description, "quiz.description", 400)
    if (!title.ok) return title
    if (!description.ok) return description
    if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 10) {
      return { ok: false, error: "A quiz needs between 1 and 10 questions" }
    }
    const questions: Extract<ChatUILearningComponent, { type: "quiz" }>["questions"] = []
    for (const [questionIndex, rawQuestion] of input.questions.entries()) {
      const question = object(rawQuestion)
      if (!question) return { ok: false, error: "Quiz questions must be objects" }
      const questionID = id(question.id, `quiz.questions[${questionIndex}].id`)
      const prompt = string(question.prompt, "quiz question prompt", 420)
      const explanation = optionalText(question.explanation, "quiz explanation", 600)
      const selection = question.selection === undefined ? "single" : question.selection
      if (!questionID.ok) return questionID
      if (!prompt.ok) return prompt
      if (!explanation.ok) return explanation
      if (selection !== "single" && selection !== "multiple") {
        return { ok: false, error: "Quiz selection must be single or multiple" }
      }
      if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 6) {
        return { ok: false, error: "Each quiz question needs between 2 and 6 options" }
      }
      const options: Array<{ id: string; label: string }> = []
      for (const rawOption of question.options) {
        const option = object(rawOption)
        if (!option) return { ok: false, error: "Quiz options must be objects" }
        const optionID = id(option.id, "quiz option id")
        const label = string(option.label, "quiz option label", 180)
        if (!optionID.ok) return optionID
        if (!label.ok) return label
        options.push({ id: optionID.value, label: label.value })
      }
      if (new Set(options.map((option) => option.id)).size !== options.length) {
        return { ok: false, error: "Quiz option IDs must be unique within a question" }
      }
      if (!Array.isArray(question.correctOptionIds) || question.correctOptionIds.length < 1 || question.correctOptionIds.length > options.length) {
        return { ok: false, error: "Each quiz question needs at least one correct option ID" }
      }
      const correctOptionIds: string[] = []
      for (const rawID of question.correctOptionIds) {
        const parsedID = id(rawID, "quiz correct option id")
        if (!parsedID.ok) return parsedID
        if (!options.some((option) => option.id === parsedID.value)) {
          return { ok: false, error: `Quiz answer references unknown option: ${parsedID.value}` }
        }
        if (correctOptionIds.includes(parsedID.value)) {
          return { ok: false, error: "Quiz correct option IDs must be unique" }
        }
        correctOptionIds.push(parsedID.value)
      }
      if (selection === "single" && correctOptionIds.length !== 1) {
        return { ok: false, error: "Single-choice questions must have exactly one correct option" }
      }
      questions.push({
        id: questionID.value,
        prompt: prompt.value,
        selection,
        options,
        correctOptionIds,
        ...(explanation.value ? { explanation: explanation.value } : {}),
      })
    }
    if (new Set(questions.map((question) => question.id)).size !== questions.length) {
      return { ok: false, error: "Quiz question IDs must be unique" }
    }
    return {
      ok: true,
      value: {
        type: "quiz",
        title: title.value,
        ...(description.value ? { description: description.value } : {}),
        questions,
      },
    }
  }

  if (input.type === "diagram") {
    const title = string(input.title, "diagram.title", 120)
    const description = optionalText(input.description, "diagram.description", 400)
    if (!title.ok) return title
    if (!description.ok) return description
    const direction = input.direction === undefined ? "left-right" : input.direction
    if (direction !== "left-right" && direction !== "top-down") {
      return { ok: false, error: "Diagram direction must be left-right or top-down" }
    }
    if (!Array.isArray(input.nodes) || input.nodes.length < 2 || input.nodes.length > 12) {
      return { ok: false, error: "A diagram needs between 2 and 12 nodes" }
    }
    if (!Array.isArray(input.edges) || input.edges.length < 1 || input.edges.length > 24) {
      return { ok: false, error: "A diagram needs between 1 and 24 connections" }
    }
    const nodes: Extract<ChatUILearningComponent, { type: "diagram" }>["nodes"] = []
    for (const rawNode of input.nodes) {
      const node = object(rawNode)
      if (!node) return { ok: false, error: "Diagram nodes must be objects" }
      const nodeID = id(node.id, "diagram node id")
      const label = string(node.label, "diagram node label", 72)
      const detail = optionalText(node.detail, "diagram node detail", 360)
      const kind = node.kind === undefined ? "process" : node.kind
      if (!nodeID.ok) return nodeID
      if (!label.ok) return label
      if (!detail.ok) return detail
      if (!["start", "process", "decision", "output"].includes(String(kind))) {
        return { ok: false, error: "Diagram node kind must be start, process, decision, or output" }
      }
      nodes.push({
        id: nodeID.value,
        label: label.value,
        kind: kind as "start" | "process" | "decision" | "output",
        ...(detail.value ? { detail: detail.value } : {}),
      })
    }
    if (new Set(nodes.map((node) => node.id)).size !== nodes.length) {
      return { ok: false, error: "Diagram node IDs must be unique" }
    }
    const edges: Array<{ from: string; to: string; label?: string }> = []
    for (const rawEdge of input.edges) {
      const edge = object(rawEdge)
      if (!edge) return { ok: false, error: "Diagram connections must be objects" }
      const from = id(edge.from, "diagram edge.from")
      const to = id(edge.to, "diagram edge.to")
      const label = optionalText(edge.label, "diagram edge.label", 48)
      if (!from.ok) return from
      if (!to.ok) return to
      if (!label.ok) return label
      if (from.value === to.value || !nodes.some((node) => node.id === from.value) || !nodes.some((node) => node.id === to.value)) {
        return { ok: false, error: "Diagram connections must link two different declared nodes" }
      }
      edges.push({ from: from.value, to: to.value, ...(label.value ? { label: label.value } : {}) })
    }
    return {
      ok: true,
      value: {
        type: "diagram",
        title: title.value,
        direction,
        nodes,
        edges,
        ...(description.value ? { description: description.value } : {}),
      },
    }
  }
  return undefined
}
