import { createComposition } from "./authoring/composition"
import type { LearningCitation, Scene, VideoComposition } from "./model/types"

export interface EducationalVideoInput extends Omit<VideoComposition, "version" | "provenance"> {
  learningObjective: string
  citations: LearningCitation[]
}

export function createEducationalVideo(input: EducationalVideoInput) {
  return createComposition({
    ...input,
    provenance: {
      mode: "education",
      learningObjective: input.learningObjective,
      citations: input.citations,
    },
  })
}

export function citationsForVideo(citations: LearningCitation[]) {
  return citations.map((citation) => ({
    bookId: citation.bookId,
    passageId: citation.passageId,
    ...(citation.title ? { title: citation.title } : {}),
    ...(citation.page ? { page: citation.page } : {}),
    ...(citation.quote ? { quote: citation.quote } : {}),
  }))
}

// ---------------------------------------------------------------------------
// Targeted Learning interactive lesson kit
//
// Builds a click-through interactive lesson (.coenx4) from TL-shaped input:
// an intro scene, one quiz scene per question (retry on wrong answers, score
// tracking, tl:answer:* emits for the host app) and a graded results scene
// with replay. Every lesson carries citations through provenance.
// ---------------------------------------------------------------------------

export interface LessonQuizOption {
  id: string
  text: string
  correct?: boolean
}

export interface LessonQuizQuestion {
  id: string
  prompt: string
  options: LessonQuizOption[]
}

export interface InteractiveLessonInput {
  id: string
  title: string
  learningObjective: string
  citations: LearningCitation[]
  intro: { heading: string; body: string }
  questions: LessonQuizQuestion[]
  stage?: { width?: number; height?: number; fps?: number }
  /** Fraction of correct answers required to pass (0..1, default 0.7). */
  passThreshold?: number
}

/** Bounded defaults for generated lessons (fit the validation budget). */
const MAX_QUESTIONS = 16
const QUESTION_FRAMES = 900
const INTRO_FRAMES = 480
const RESULTS_FRAMES = 600
const ANSWER_LINGER_FRAMES = 75

const COLORS = {
  background: "#0f1522",
  panel: "#1a2337",
  accent: "#5b8cff",
  text: "#eef2f8",
  muted: "#93a0b8",
  success: "#3ecf8e",
  error: "#ff6b81",
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/

function lessonId(prefix: string, id: string) {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64)
  return `${prefix}-${safe}`
}

function assertLessonInput(input: InteractiveLessonInput) {
  if (!ID_PATTERN.test(input.id)) throw new Error("Lesson id must match [A-Za-z][A-Za-z0-9_-]{0,79}")
  if (!input.questions.length) throw new Error("A lesson needs at least one question")
  if (input.questions.length > MAX_QUESTIONS) throw new Error(`A lesson supports at most ${MAX_QUESTIONS} questions`)
  if (!input.citations.length) throw new Error("A lesson needs at least one citation for grounding")
  for (const question of input.questions) {
    if (!ID_PATTERN.test(question.id)) throw new Error(`Question id ${question.id} must match [A-Za-z][A-Za-z0-9_-]{0,79}`)
    if (question.options.length < 2 || question.options.length > 4) {
      throw new Error(`Question ${question.id} needs 2–4 options`)
    }
    if (!question.options.some((option) => option.correct)) {
      throw new Error(`Question ${question.id} has no correct option`)
    }
    for (const option of question.options) {
      if (!ID_PATTERN.test(option.id)) throw new Error(`Option id ${option.id} must match [A-Za-z][A-Za-z0-9_-]{0,79}`)
    }
  }
}

function wrapText(text: string, maxChars: number, maxLines: number) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (current && `${current} ${word}`.length > maxChars) {
      lines.push(current)
      current = word
      if (lines.length === maxLines) return lines.join("\n")
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines.join("\n")
}

function buildIntroScene(input: InteractiveLessonInput, stage: { width: number; height: number }): Scene {
  const centerX = stage.width / 2
  return {
    id: "intro",
    durationFrames: INTRO_FRAMES,
    background: COLORS.background,
    nodes: [
      { id: "intro-heading", kind: "text", x: centerX, y: 120, width: stage.width - 160, height: 60, text: input.intro.heading, color: COLORS.text, align: "center" },
      { id: "intro-body", kind: "text", x: centerX, y: 210, width: stage.width - 220, height: 140, text: wrapText(input.intro.body, 72, 6), color: COLORS.muted, align: "center" },
      { id: "intro-objective", kind: "text", x: centerX, y: 350, width: stage.width - 220, height: 28, text: wrapText(`Objective: ${input.learningObjective}`, 76, 2), color: COLORS.muted, align: "center" },
      { id: "intro-start", kind: "button", x: centerX, y: 430, width: 220, height: 56, text: "Start lesson", fill: COLORS.accent, color: COLORS.text, radius: 12 },
      { id: "intro-citations", kind: "text", x: centerX, y: stage.height - 34, width: stage.width - 160, height: 22, text: `Grounded in ${input.citations.length} retrieved source${input.citations.length === 1 ? "" : "s"}`, color: COLORS.muted, align: "center" },
    ],
    interactions: [
      {
        id: "intro-begin",
        trigger: { type: "click", targetId: "intro-start" },
        actions: [{ type: "goto", sceneId: lessonId("q", input.questions[0].id) }],
      },
    ],
  }
}

function buildQuestionScene(
  input: InteractiveLessonInput,
  question: LessonQuizQuestion,
  index: number,
  stage: { width: number; height: number },
): Scene {
  const centerX = stage.width / 2
  const stateKey = `q_${question.id}`
  const isLast = index === input.questions.length - 1
  const nextSceneId = isLast ? "results" : lessonId("q", input.questions[index + 1].id)
  const nodes: Scene["nodes"] = [
    { id: `${question.id}-hud`, kind: "text", x: 150, y: 40, width: 400, height: 26, text: `Question ${index + 1} of ${input.questions.length}`, color: COLORS.muted },
    { id: "hud-score", kind: "text", x: stage.width - 150, y: 40, width: 220, height: 26, text: "score", color: COLORS.muted, align: "right" },
    { id: `${question.id}-prompt`, kind: "text", x: centerX, y: 125, width: stage.width - 200, height: 90, text: wrapText(question.prompt, 64, 3), color: COLORS.text, align: "center" },
    { id: `${question.id}-status`, kind: "text", x: centerX, y: 505, width: stage.width - 200, height: 30, text: "Choose an answer", color: COLORS.muted, align: "center" },
  ]
  const interactions: NonNullable<Scene["interactions"]> = []

  const optionHeight = 52
  const gap = 14
  question.options.forEach((option, optionIndex) => {
    const optionId = lessonId("o", option.id)
    nodes.push({
      id: optionId,
      kind: "button",
      x: centerX,
      y: 228 + optionIndex * (optionHeight + gap),
      width: 540,
      height: optionHeight,
      text: option.text,
      fill: COLORS.panel,
      color: COLORS.text,
      radius: 10,
      borderColor: COLORS.accent,
    })
    const notAnswered = {
      op: "eq" as const,
      left: { op: "state" as const, key: stateKey },
      right: { op: "literal" as const, value: 0 },
    }
    if (option.correct) {
      interactions.push({
        id: `${optionId}-pick`,
        trigger: { type: "click", targetId: optionId },
        when: notAnswered,
        actions: [
          { type: "set", key: stateKey, value: 1 },
          { type: "increment", key: "score", amount: 1 },
          { type: "feedback", text: "Correct", tone: "success" },
          { type: "emit", event: "tl:answer:correct", payload: question.id },
          { type: "setNode", targetId: `${question.id}-status`, props: { text: "Correct — well done", color: COLORS.success } },
          {
            type: "setNode",
            targetId: "hud-score",
            props: { text: { op: "concat", items: [{ op: "literal", value: "score " }, { op: "state", key: "score" }] } },
          },
          { type: "setNode", targetId: optionId, props: { scale: 1.04 } },
        ],
      })
    } else {
      interactions.push({
        id: `${optionId}-pick`,
        trigger: { type: "click", targetId: optionId },
        when: notAnswered,
        actions: [
          { type: "feedback", text: "Not quite — try again", tone: "error" },
          { type: "emit", event: "tl:answer:wrong", payload: question.id },
          { type: "hide", targetId: optionId },
          { type: "setNode", targetId: `${question.id}-status`, props: { text: "Not quite — try another answer", color: COLORS.error } },
        ],
      })
    }
  })

  // Auto-advance once the question is answered correctly and the linger passed.
  interactions.push({
    id: `${question.id}-advance`,
    trigger: { type: "timer", frame: ANSWER_LINGER_FRAMES },
    when: { op: "eq", left: { op: "state", key: stateKey }, right: { op: "literal", value: 1 } },
    actions: [{ type: "goto", sceneId: nextSceneId }],
  })

  return {
    id: lessonId("q", question.id),
    durationFrames: QUESTION_FRAMES,
    background: COLORS.background,
    nodes,
    interactions,
  }
}

function buildResultsScene(
  input: InteractiveLessonInput,
  total: number,
  passScore: number,
  stage: { width: number; height: number },
): Scene {
  const centerX = stage.width / 2
  const resetActions = input.questions.map((question) => ({
    type: "set" as const,
    key: `q_${question.id}`,
    value: 0,
  }))
  return {
    id: "results",
    durationFrames: RESULTS_FRAMES,
    background: COLORS.background,
    nodes: [
      { id: "results-title", kind: "text", x: centerX, y: 120, width: stage.width - 200, height: 60, text: "Lesson complete", color: COLORS.text, align: "center" },
      { id: "results-score", kind: "text", x: centerX, y: 220, width: 400, height: 70, text: "score", color: COLORS.accent, align: "center" },
      { id: "results-verdict", kind: "text", x: centerX, y: 310, width: stage.width - 240, height: 40, text: "", color: COLORS.muted, align: "center" },
      { id: "results-replay", kind: "button", x: centerX, y: 420, width: 240, height: 56, text: "Try again", fill: COLORS.panel, color: COLORS.text, radius: 12, borderColor: COLORS.accent },
    ],
    interactions: [
      {
        id: "results-grade",
        trigger: { type: "timer", frame: 1 },
        actions: [
          {
            type: "setNode",
            targetId: "results-score",
            props: {
              text: { op: "concat", items: [{ op: "state", key: "score" }, { op: "literal", value: ` / ${total}` }] },
            },
          },
          {
            type: "setNode",
            targetId: "results-verdict",
            props: {
              text: {
                op: "if",
                cond: { op: "gte", left: { op: "state", key: "score" }, right: { op: "literal", value: passScore } },
                trueValue: { op: "literal", value: "Passed — mastery demonstrated" },
                falseValue: { op: "literal", value: "Review the material and retry the lesson" },
              },
              color: {
                op: "if",
                cond: { op: "gte", left: { op: "state", key: "score" }, right: { op: "literal", value: passScore } },
                trueValue: { op: "literal", value: COLORS.success },
                falseValue: { op: "literal", value: COLORS.error },
              },
            },
          },
          { type: "emit", event: "tl:lesson:complete", payload: `${input.id}:${total}` },
        ],
      },
      {
        id: "results-replay",
        trigger: { type: "click", targetId: "results-replay" },
        actions: [
          { type: "set", key: "score", value: 0 },
          ...resetActions,
          { type: "goto", sceneId: "intro" },
        ],
      },
    ],
  }
}

/**
 * Builds a complete interactive lesson composition for Targeted Learning:
 * intro, one quiz scene per question (retry-on-wrong, score tracking,
 * `tl:answer:correct` / `tl:answer:wrong` / `tl:lesson:complete` emits) and a
 * graded results scene with replay. The returned composition validates against
 * the standard model and packs into a portable .coenx4 container.
 */
export function createInteractiveLesson(input: InteractiveLessonInput): VideoComposition {
  assertLessonInput(input)
  const stage = {
    width: input.stage?.width ?? 960,
    height: input.stage?.height ?? 540,
    fps: input.stage?.fps ?? 30,
  }
  const total = input.questions.length
  const passThreshold = Math.max(0, Math.min(input.passThreshold ?? 0.7, 1))
  const passScore = Math.max(1, Math.ceil(passThreshold * total))
  const scenes = [
    buildIntroScene(input, stage),
    ...input.questions.map((question, index) => buildQuestionScene(input, question, index, stage)),
    buildResultsScene(input, total, passScore, stage),
  ]
  return createComposition({
    id: input.id,
    title: input.title,
    stage,
    initialState: { score: 0, ...Object.fromEntries(input.questions.map((question) => [`q_${question.id}`, 0])) },
    scenes,
    provenance: {
      mode: "education",
      learningObjective: input.learningObjective,
      citations: input.citations,
    },
  })
}

export * as VideoLearning from "./learning"
