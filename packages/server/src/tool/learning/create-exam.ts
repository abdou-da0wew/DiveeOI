import { randomUUID } from "node:crypto"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { Effect, Schema } from "effect"
import type { ExamSpec, ExamGradingConfig } from "@diveeoi/db/chat-ui"
import { parseExamAnswerKey, parseExamDraft } from "@diveeoi/db/exam-parse"
import { selectAdaptiveQuestions } from "@diveeoi/db/exam-grade"
import { Database } from "@diveeoi/db/database/database"
import { ExamTable } from "@diveeoi/db/exam/sql"
import { encryptExamSecret } from "../../exam/crypto"
import * as Tool from "../tool"
import { richUIComponentsSchema } from "../rich-ui-schema"
import { richUIComponentDefinition } from "../rich-ui-component-schema"
import { richUIExpressionDefinition } from "../rich-ui-shared-schema"

type ExamMetadata = { error?: boolean; exam?: ExamSpec }

const parameters: JSONSchema7 = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 120 },
    instructions: { type: "string", maxLength: 800 },
    durationMinutes: { type: "integer", minimum: 1, maximum: 240 },
    randomizeQuestions: { type: "boolean" },
    attemptsAllowed: { type: "integer", minimum: 1, maximum: 10 },
    adaptive: {
      type: "object",
      properties: {
        enabled: { const: true },
        questionsPerAttempt: { type: "integer", minimum: 1, maximum: 60 },
        startDifficulty: { type: "integer", minimum: 1, maximum: 5 },
        masteryThreshold: { type: "number", minimum: 0.5, maximum: 1 },
      },
      required: ["enabled"],
      additionalProperties: false,
    },
    grading: {
      type: "object",
      properties: {
        partialCredit: { type: "boolean" },
        negativeMarking: { type: "number", minimum: 0, maximum: 1 },
      },
      additionalProperties: false,
    },
    answerKey: {
      type: "array",
      minItems: 1,
      maxItems: 60,
      items: {
        type: "object",
        properties: {
          questionId: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
          correctOptionIDs: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
          acceptedAnswers: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", maxLength: 500 } },
          explanation: { type: "string", maxLength: 800 },
          manualReview: { type: "boolean" },
          criteria: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
                description: { type: "string", maxLength: 180 },
                points: { type: "number", exclusiveMinimum: 0 },
                keywords: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", maxLength: 80 } },
                match: { enum: ["all", "any"] },
              },
              required: ["id", "description", "points", "keywords"],
              additionalProperties: false,
            },
          },
        },
        required: ["questionId"],
        additionalProperties: false,
      },
    },
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 60,
      items: {
        type: "object",
        properties: {
          id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
          type: { enum: ["single", "multiple", "boolean", "short"] },
          prompt: { type: "string", maxLength: 1200 },
          points: { type: "number", minimum: 0.1, maximum: 100 },
          difficulty: { type: "integer", minimum: 1, maximum: 5 },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
                label: { type: "string", maxLength: 220 },
              },
              required: ["id", "label"],
              additionalProperties: false,
            },
          },
          state: {
            type: "array",
            maxItems: 24,
            items: {
              type: "object",
              properties: {
                key: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
                value: { type: ["string", "number", "boolean"] },
              },
              required: ["key", "value"],
              additionalProperties: false,
            },
          },
          components: richUIComponentsSchema,
        },
        required: ["id", "type", "prompt"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "questions", "answerKey"],
  additionalProperties: false,
  definitions: {
    Expression: richUIExpressionDefinition,
    ChatUIComponent: richUIComponentDefinition,
  },
}

export const CreateExamTool = Tool.define(
  "create_exam",
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return {
      description: `Create an interactive exam, quiz, test, or question set. Questions support single choice, multiple choice, true/false, and written answers. Supply a private answerKey for every question: objective questions use correctOptionIDs; written questions use acceptedAnswers or a points-based rubric with keywords. The server encrypts this key at rest and strips it from the persisted tool-call input before any browser sync. Never repeat the key in visible question text, UI metadata, tool output, or the final response. Set \`randomizeQuestions: true\` to randomize order. Set attemptsAllowed for retries. Set adaptive.enabled with difficulty 1-5 and questionsPerAttempt to choose a difficulty-matched subset, then the server adapts the next attempt based on the prior percentage. grading.partialCredit and grading.negativeMarking configure scoring. Interactive question settings are submitted with answers. Use only book-grounded facts in Targeted Learning.`,
      parameters: Schema.Struct({
        title: Schema.String,
        instructions: Schema.optional(Schema.String),
        durationMinutes: Schema.optional(Schema.Number),
        randomizeQuestions: Schema.optional(Schema.Boolean),
        attemptsAllowed: Schema.optional(Schema.Number),
        adaptive: Schema.optional(Schema.Unknown),
        grading: Schema.optional(Schema.Unknown),
        answerKey: Schema.Array(Schema.Unknown),
        questions: Schema.Array(Schema.Unknown),
      }),
      jsonSchema: parameters,
      execute: (
        args: {
          title: string
          instructions?: string
          durationMinutes?: number
          randomizeQuestions?: boolean
          attemptsAllowed?: number
          adaptive?: unknown
          grading?: unknown
          answerKey: unknown[]
          questions: unknown[]
        },
        ctx: Tool.Context,
      ): Effect.Effect<{ title: string; output: string; metadata: ExamMetadata }> =>
        Effect.gen(function* () {
          const parsed = parseExamDraft(args, randomUUID())
          if (!parsed.ok) {
            return {
              title: "Unable to create exam",
              output: `The exam specification is invalid: ${parsed.error}. Correct the questions and call create_exam again.`,
              metadata: { error: true },
            }
          }

          const exam = parsed.value
          const answerKey = parseExamAnswerKey(args.answerKey, exam)
          if (!answerKey.ok) {
            return {
              title: "Unable to create exam",
              output: `The private answer key or rubric is invalid: ${answerKey.error}. Correct it and call create_exam again.`,
              metadata: { error: true },
            }
          }

          const grading = parseGradingConfig(args.grading)
          if (!grading.ok) {
            return {
              title: "Unable to create exam",
              output: `The grading configuration is invalid: ${grading.error}. Correct it and call create_exam again.`,
              metadata: { error: true },
            }
          }

          const currentDifficulty = exam.adaptive?.startDifficulty ?? 3
          const currentAttempt = selectAdaptiveQuestions({ exam, difficulty: currentDifficulty })
          const secret = yield* Effect.tryPromise({
            try: () =>
              encryptExamSecret(
                { answerKey: answerKey.value },
                typeof ctx.extra?.examEncryptionDirectory === "string" ? ctx.extra.examEncryptionDirectory : undefined,
              ),
            catch: (error) =>
              new Error(
                `Could not protect the private answer key: ${error instanceof Error ? error.message : String(error)}`,
              ),
          }).pipe(Effect.orDie)
          yield* db
            .insert(ExamTable)
            .values({
              id: exam.id,
              session_id: ctx.sessionID,
              title: exam.title,
              spec_json: exam as unknown as Record<string, unknown>,
              secret_ciphertext: secret.ciphertext,
              secret_iv: secret.iv,
              secret_auth_tag: secret.authTag,
              grading_json: {
                ...grading.value,
                currentQuestionIDs: currentAttempt.questions.map((question) => question.id),
              },
              adaptive_difficulty: currentDifficulty,
              attempts_allowed: exam.attemptsAllowed,
            })
            .run()
            .pipe(Effect.orDie)

          yield* ctx.metadata({ title: exam.title, metadata: { exam: currentAttempt } })
          return {
            title: exam.title,
            output: `Created "${exam.title}" with ${currentAttempt.questions.length} questions in this attempt (${exam.questions.length} question bank entries), worth ${currentAttempt.totalPoints} points. The private answer key and rubric are encrypted and server-side only. Attempts allowed: ${exam.attemptsAllowed}. The exam is ready in its own tab.`,
            metadata: { exam: currentAttempt },
          }
        }),
    }
  }),
)

function parseGradingConfig(value: unknown): { ok: true; value: ExamGradingConfig } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: { partialCredit: true, negativeMarking: 0.25 } }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ok: false, error: "grading must be an object" }
  const input = value as Record<string, unknown>
  if (input.partialCredit !== undefined && typeof input.partialCredit !== "boolean") {
    return { ok: false, error: "grading.partialCredit must be a boolean" }
  }
  const negativeMarking = input.negativeMarking ?? 0.25
  if (
    typeof negativeMarking !== "number" ||
    !Number.isFinite(negativeMarking) ||
    negativeMarking < 0 ||
    negativeMarking > 1
  ) {
    return { ok: false, error: "grading.negativeMarking must be between 0 and 1" }
  }
  return { ok: true, value: { partialCredit: input.partialCredit !== false, negativeMarking } }
}
