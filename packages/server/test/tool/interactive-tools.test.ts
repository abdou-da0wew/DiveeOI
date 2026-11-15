import { describe, expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Database } from "@diveeoi/db/database/database"
import { ExamAttemptTable, ExamTable } from "@diveeoi/db/exam/sql"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { CreateExamTool } from "../../src/tool/learning/create-exam"
import { ExportExamTool } from "../../src/tool/learning/export-exam"
import { GradeExamTool } from "../../src/tool/learning/grade-exam"
import { ReviewExamTool } from "../../src/tool/learning/review-exam"
import { RichUITool } from "../../src/tool/rich-ui"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, Database.defaultLayer))

function makeCtx(
  events: unknown[] = [],
  sessionID = SessionID.descending(),
  extra?: Record<string, unknown>,
  asks: unknown[] = [],
): Tool.Context {
  return {
    sessionID,
    extra,
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata(input) {
      events.push(input)
      return Effect.void
    },
    ask(input) {
      asks.push(input)
      return Effect.void
    },
  }
}

describe("interactive UI tools", () => {
  it.effect("create_ui validates the component spec and stores render metadata", () =>
    Effect.gen(function* () {
      const info = yield* RichUITool
      const tool = yield* info.init()
      const events: unknown[] = []
      const execute = tool.execute as unknown as (args: unknown, ctx: Tool.Context) => ReturnType<typeof tool.execute>
      const result = yield* execute(
        {
          spec: {
            title: "Ohm's law",
            layout: "grid",
            components: [
              { type: "metric", label: "Voltage", value: 12, unit: "V" },
              {
                type: "simulation",
                title: "Current",
                controls: [{ type: "slider", id: "voltage", label: "Voltage", min: 0, max: 24, step: 1, value: 12 }],
                outputs: [
                  {
                    label: "Current",
                    expression: {
                      op: "div",
                      left: { op: "input", name: "voltage" },
                      right: { op: "literal", value: 60 },
                    },
                  },
                ],
              },
            ],
          },
        },
        makeCtx(events),
      )

      expect(result.title).toBe("Ohm's law")
      expect(result.metadata.richUi).toMatchObject({
        title: "Ohm's law",
        layout: "grid",
        components: [{ type: "metric" }, { type: "simulation" }],
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ title: "Ohm's law" })
    }),
  )

  it.effect("create_ui composes shared state, conditionals, computed values, and local actions", () =>
    Effect.gen(function* () {
      const info = yield* RichUITool
      const tool = yield* info.init()
      const result = yield* tool.execute(
        {
          spec: {
            title: "Worker planner",
            state: [
              { key: "workers", value: 2 },
              { key: "enabled", value: true },
            ],
            components: [
              {
                type: "tabs",
                id: "plannerTabs",
                tabs: [
                  {
                    id: "capacity",
                    label: "Capacity",
                    components: [
                      { type: "state-value", key: "workers", label: "Workers" },
                      {
                        type: "computed",
                        id: "throughput",
                        label: "Throughput",
                        expression: {
                          op: "mul",
                          left: { op: "input", name: "workers" },
                          right: { op: "literal", value: 120 },
                        },
                      },
                      {
                        type: "button",
                        id: "addWorker",
                        label: "Add worker",
                        actions: [{ type: "increment", key: "workers", by: 1 }],
                      },
                    ],
                  },
                  {
                    id: "settings",
                    label: "Settings",
                    components: [
                      { type: "field", id: "enabledField", key: "enabled", label: "Enabled", control: "toggle" },
                      {
                        type: "conditional",
                        id: "enabledHint",
                        key: "enabled",
                        equals: true,
                        components: [{ type: "text", content: "Planner enabled" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        makeCtx(),
      )

      expect(result.metadata.richUi).toMatchObject({
        state: [
          { key: "workers", value: 2 },
          { key: "enabled", value: true },
        ],
        components: [{ type: "tabs" }],
      })
    }),
  )

  it.effect("create_ui returns an actionable validation error instead of rendering unknown code", () =>
    Effect.gen(function* () {
      const info = yield* RichUITool
      const tool = yield* info.init()
      const events: unknown[] = []
      const execute = tool.execute as unknown as (args: unknown, ctx: Tool.Context) => ReturnType<typeof tool.execute>
      const result = yield* execute(
        { spec: { title: "Unsafe", components: [{ type: "script", code: "alert(1)" }] } },
        makeCtx(events),
      )

      expect(result.metadata.error).toBe(true)
      expect(result.output).toContain("Unsupported UI component type")
      expect(events).toHaveLength(0)
    }),
  )

  it.effect("create_exam, grade_exam, review_exam, and export_exam complete a private assessment lifecycle", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db.run("PRAGMA foreign_keys = OFF")
      const dataDirectory = yield* Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "diveeoi-exam-lifecycle-")))
      const sessionID = SessionID.descending()
      const encryptionContext = { examEncryptionDirectory: dataDirectory }
      try {
        const createInfo = yield* CreateExamTool
        const create = yield* createInfo.init()
        const created = yield* create.execute(
          {
            title: "Current and circuits",
            attemptsAllowed: 2,
            adaptive: { enabled: true, questionsPerAttempt: 2, startDifficulty: 3, masteryThreshold: 0.8 },
            grading: { partialCredit: true, negativeMarking: 0.2 },
            questions: [
              {
                id: "current-meaning",
                type: "boolean",
                prompt: "Electric current is a rate of charge flow.",
                difficulty: 2,
                points: 1,
              },
              {
                id: "ohm-law",
                type: "short",
                prompt: "Explain Ohm's law.",
                difficulty: 4,
                points: 2,
                state: [
                  { key: "voltage", value: 12 },
                  { key: "resistance", value: 6 },
                ],
                components: [
                  { type: "field", id: "voltageInput", key: "voltage", label: "Voltage", control: "number" },
                  { type: "field", id: "resistanceInput", key: "resistance", label: "Resistance", control: "number" },
                ],
              },
            ],
            answerKey: [
              {
                questionId: "current-meaning",
                correctOptionIDs: ["true"],
                explanation: "Current is charge per unit time.",
              },
              {
                questionId: "ohm-law",
                manualReview: true,
                explanation: "Review the relationship between V, I, and R.",
              },
            ],
          },
          makeCtx([], sessionID, encryptionContext),
        )
        const examID = created.metadata.exam?.id
        expect(examID).toBeTruthy()
        expect(created.output).not.toContain("charge per unit time")

        const gradeInfo = yield* GradeExamTool
        const grade = yield* gradeInfo.init()
        const submitted = yield* grade.execute(
          {
            examID: examID!,
            attemptNumber: 1,
            elapsedMs: 42_000,
            answers: [
              { questionId: "current-meaning", answer: "true" },
              { questionId: "ohm-law", answer: "Voltage is equal to current multiplied by resistance." },
            ],
            interactiveState: { "ohm-law": { voltage: 12, resistance: 6 } },
          },
          makeCtx([], sessionID, encryptionContext),
        )
        expect(submitted.metadata.examGrade).toMatchObject({
          score: 1,
          maximum: 3,
          percentage: 33.33,
          needsReview: true,
          needsReviewCount: 1,
          attemptsRemaining: 1,
        })
        expect(submitted.metadata.examGrade?.nextAttempt?.questions.map((question) => question.id)).toEqual([
          "current-meaning",
          "ohm-law",
        ])
        const invalidInteractive = yield* grade.execute(
          {
            examID: examID!,
            attemptNumber: 2,
            answers: [
              { questionId: "current-meaning", answer: "true" },
              { questionId: "ohm-law", answer: "Voltage is equal to current multiplied by resistance." },
            ],
            interactiveState: { "ohm-law": { notDeclared: 12 } },
          },
          makeCtx([], sessionID, encryptionContext),
        )
        expect(invalidInteractive.output).toContain("undeclared or incorrectly typed field")
        const attemptRows = yield* db.select().from(ExamAttemptTable).all()
        expect(attemptRows).toHaveLength(1)
        expect(attemptRows[0]?.interaction_json).toMatchObject({ "ohm-law": { voltage: 12, resistance: 6 } })

        const reviewInfo = yield* ReviewExamTool
        const review = yield* reviewInfo.init()
        const reviewed = yield* review.execute(
          {
            examID: examID!,
            attemptNumber: 1,
            reviews: [{ questionId: "ohm-law", earned: 2, feedback: "The relationship is correct." }],
          },
          makeCtx([], sessionID, encryptionContext),
        )
        expect(reviewed.metadata.examGrade).toMatchObject({ score: 3, percentage: 100, needsReview: false })
        expect(reviewed.metadata.analytics).toMatchObject({
          attemptCount: 1,
          averagePercentage: 100,
          bestPercentage: 100,
        })

        const duplicate = yield* grade.execute(
          {
            examID: examID!,
            attemptNumber: 1,
            answers: [
              { questionId: "current-meaning", answer: "true" },
              { questionId: "ohm-law", answer: "Voltage is equal to current multiplied by resistance." },
            ],
          },
          makeCtx([], sessionID, encryptionContext),
        )
        expect(duplicate.output).toContain("already graded")
        expect(duplicate.metadata.examGrade?.percentage).toBe(100)

        const asks: unknown[] = []
        const exportInfo = yield* ExportExamTool
        const exportTool = yield* exportInfo.init()
        const exported = yield* exportTool.execute(
          { examID: examID!, format: "json" },
          makeCtx([], sessionID, encryptionContext, asks),
        )
        expect(asks).toHaveLength(1)
        expect(exported.attachments).toHaveLength(1)
        expect(exported.attachments?.[0]?.mime).toBe("application/json")
        const dataUrl = exported.attachments?.[0]?.url ?? ""
        const exportedJSON = Buffer.from(dataUrl.split(",")[1] ?? "", "base64").toString("utf8")
        expect(exportedJSON).toContain("interactiveState")
        expect(exportedJSON).toContain("attemptCount")
        expect(exportedJSON).not.toContain("secret_ciphertext")
      } finally {
        yield* Effect.promise(() => rm(dataDirectory, { recursive: true, force: true }))
      }
    }),
  )

  it.effect("create_exam emits a validated exam without exposing an answer key", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db.run("PRAGMA foreign_keys = OFF")
      const info = yield* CreateExamTool
      const tool = yield* info.init()
      const events: unknown[] = []
      const dataDirectory = yield* Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "diveeoi-exam-create-")))
      const sessionID = SessionID.descending()
      const execute = tool.execute as unknown as (args: unknown, ctx: Tool.Context) => ReturnType<typeof tool.execute>
      const result = yield* execute(
        {
          title: "Science check",
          durationMinutes: 15,
          questions: [
            {
              id: "q1",
              type: "boolean",
              prompt: "Energy can be transferred.",
              components: [
                {
                  type: "simulation",
                  title: "Energy calculator",
                  controls: [{ type: "slider", id: "mass", label: "Mass", min: 1, max: 10, step: 1, value: 2 }],
                  outputs: [
                    {
                      label: "Energy",
                      expression: {
                        op: "mul",
                        left: { op: "input", name: "mass" },
                        right: { op: "literal", value: 9.8 },
                      },
                    },
                  ],
                },
              ],
            },
          ],
          answerKey: [
            { questionId: "q1", correctOptionIDs: ["true"], explanation: "Energy is transferred between systems." },
          ],
        },
        makeCtx(events, sessionID, { examEncryptionDirectory: dataDirectory }),
      )

      expect(result.title).toBe("Science check")
      expect(result.metadata.exam).toMatchObject({
        title: "Science check",
        questions: [{ id: "q1", type: "boolean", options: [{ id: "true" }, { id: "false" }] }],
      })
      expect(JSON.stringify(result.metadata.exam)).not.toContain("correctAnswers")
      expect(JSON.stringify(result.metadata.exam)).not.toContain("expectedAnswer")
      expect(JSON.stringify(result.metadata.exam)).not.toContain("Energy is transferred between systems")
      expect(result.output).not.toContain("Energy is transferred between systems")
      const stored = yield* db.select().from(ExamTable).all()
      expect(stored).toHaveLength(1)
      expect(stored[0]?.secret_ciphertext).toBeTruthy()
      expect(stored[0]?.secret_ciphertext).not.toContain("Energy is transferred between systems")
      expect(stored[0]?.grading_json).toMatchObject({ partialCredit: true, negativeMarking: 0.25 })
      expect(events).toHaveLength(1)
      yield* Effect.promise(() => rm(dataDirectory, { recursive: true, force: true }))
    }),
  )
})
