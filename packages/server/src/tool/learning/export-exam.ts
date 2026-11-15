import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { Database } from "@diveeoi/db/database/database"
import { ExamAttemptTable, ExamTable } from "@diveeoi/db/exam/sql"
import * as Tool from "../tool"

const jsonSchema: JSONSchema7 = {
  type: "object",
  properties: {
    examID: { type: "string", minLength: 1, maxLength: 80 },
    format: { enum: ["json", "csv"] },
  },
  required: ["examID", "format"],
  additionalProperties: false,
}

function csvCell(value: unknown) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "")
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export const ExportExamTool = Tool.define(
  "export_exam",
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return {
      description: `Export a completed exam's attempt history, answers, scoring feedback, elapsed times, and aggregate analytics as JSON or CSV. The exam must belong to the current session. This export does not include the private answer key or rubric. Ask for export permission before creating the attachment.`,
      parameters: Schema.Struct({ examID: Schema.String, format: Schema.Literals(["json", "csv"]) }),
      jsonSchema,
      execute: (args: { examID: string; format: "json" | "csv" }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!/^[A-Za-z0-9_-]{1,80}$/.test(args.examID)) {
            return { title: "Exam export failed", output: "The exam ID is invalid.", metadata: { error: true } }
          }
          const exam = yield* db.select().from(ExamTable).where(eq(ExamTable.id, args.examID)).get().pipe(Effect.orDie)
          if (!exam || exam.session_id !== ctx.sessionID) {
            return {
              title: "Exam export failed",
              output: "This exam does not exist in the current session.",
              metadata: { error: true },
            }
          }
          yield* ctx.ask({
            permission: "export_exam",
            patterns: [args.examID],
            always: ["*"],
            metadata: {
              description: `Export ${exam.title} attempt history as ${args.format.toUpperCase()}`,
              examID: args.examID,
              format: args.format,
            },
          })
          const attempts = yield* db
            .select()
            .from(ExamAttemptTable)
            .where(eq(ExamAttemptTable.exam_id, args.examID))
            .all()
            .pipe(Effect.orDie)
          const ordered = attempts.toSorted((a, b) => a.attempt_number - b.attempt_number)
          const percentages = ordered.map((item) => item.percentage ?? 0)
          const analytics = {
            attemptCount: ordered.length,
            averagePercentage: percentages.length
              ? Number((percentages.reduce((sum, value) => sum + value, 0) / percentages.length).toFixed(2))
              : 0,
            bestPercentage: Number(Math.max(0, ...percentages).toFixed(2)),
            latestPercentage: Number((percentages.at(-1) ?? 0).toFixed(2)),
          }
          const records = ordered.map((item) => ({
            attemptNumber: item.attempt_number,
            difficulty: item.difficulty,
            answers: item.answers_json,
            interactiveState: item.interaction_json ?? {},
            grade: item.grade_json,
            score: item.score,
            maximum: item.max_score,
            percentage: item.percentage,
            needsReview: item.needs_review === 1,
            elapsedMs: item.elapsed_ms,
            submittedAt: new Date(item.submitted_at).toISOString(),
          }))
          let mime: string
          let filename: string
          let content: string
          if (args.format === "json") {
            mime = "application/json"
            filename = `${safeName(exam.title)}-attempts.json`
            content = JSON.stringify(
              {
                exam: { id: exam.id, title: exam.title },
                exportedAt: new Date().toISOString(),
                analytics,
                attempts: records,
              },
              null,
              2,
            )
          } else {
            mime = "text/csv"
            filename = `${safeName(exam.title)}-attempts.csv`
            const headers = [
              "attempt",
              "difficulty",
              "score",
              "maximum",
              "percentage",
              "needs_review",
              "elapsed_ms",
              "submitted_at",
              "answers",
              "interactive_state",
              "grade",
            ]
            const lines = [headers.map(csvCell).join(",")]
            for (const record of records) {
              lines.push(
                [
                  record.attemptNumber,
                  record.difficulty,
                  record.score,
                  record.maximum,
                  record.percentage,
                  record.needsReview,
                  record.elapsedMs,
                  record.submittedAt,
                  record.answers,
                  record.interactiveState,
                  record.grade,
                ]
                  .map(csvCell)
                  .join(","),
              )
            }
            content = lines.join("\n")
          }
          return {
            title: `Exported ${ordered.length} exam attempt(s)`,
            output: `Created ${filename}. The file contains attempt responses, submitted simulation settings, grading feedback, and aggregate analytics. Private answer keys are excluded.`,
            metadata: { format: args.format, attemptCount: ordered.length, analytics },
            attachments: [
              {
                type: "file" as const,
                mime,
                filename,
                url: `data:${mime};base64,${Buffer.from(content, "utf8").toString("base64")}`,
              },
            ],
          }
        }),
    }
  }),
)

function safeName(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "exam"
  )
}
