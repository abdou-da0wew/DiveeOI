import type { JSONSchema7 } from "@ai-sdk/provider"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "@diveeoi/db/database/database"
import type { ExamAnalytics, ExamGrade } from "@diveeoi/db/chat-ui"
import { ExamAttemptTable, ExamTable } from "@diveeoi/db/exam/sql"
import { parseExamDraft } from "@diveeoi/db/exam-parse"
import * as Tool from "../tool"
import type { ExecuteResult } from "../tool"

type ReviewMetadata = {
  error?: boolean
  examGrade?: ExamGrade
  analytics?: ExamAnalytics
}
import { analytics } from "./exam-grading-shared"

export const ReviewExamTool = Tool.define(
  "review_exam",
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return {
      description: `Finalize written answers that grade_exam marked needs-review. Review the submitted answer against the question and the grounded learning material, then submit one review per question with awarded points between zero and that question's maximum and concise feedback. This is tutor/agent review, not a human sign-off. It updates the saved attempt score and removes reviewed questions from its pending-review count. Do not use this to overwrite an automatically graded objective question. The exam and attempt must belong to the current session.`,
      parameters: Schema.Struct({
        examID: Schema.String,
        attemptNumber: Schema.Number,
        reviews: Schema.Array(Schema.Unknown),
      }),
      jsonSchema: {
        type: "object",
        properties: {
          examID: { type: "string", minLength: 1, maxLength: 80 },
          attemptNumber: { type: "integer", minimum: 1, maximum: 10 },
          reviews: {
            type: "array",
            minItems: 1,
            maxItems: 60,
            items: {
              type: "object",
              properties: {
                questionId: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
                earned: { type: "number", minimum: 0, maximum: 100 },
                feedback: { type: "string", minLength: 1, maxLength: 600 },
              },
              required: ["questionId", "earned", "feedback"],
              additionalProperties: false,
            },
          },
        },
        required: ["examID", "attemptNumber", "reviews"],
        additionalProperties: false,
      } satisfies JSONSchema7,
      execute: (
        args: { examID: string; attemptNumber: number; reviews: unknown[] },
        ctx: Tool.Context,
      ): Effect.Effect<ExecuteResult<ReviewMetadata>> =>
        Effect.gen(function* () {
          if (
            !/^[A-Za-z0-9_-]{1,80}$/.test(args.examID) ||
            !Number.isInteger(args.attemptNumber) ||
            args.attemptNumber < 1
          ) {
            return {
              title: "Exam review failed",
              output: "The exam ID or attempt number is invalid.",
              metadata: { error: true },
            }
          }
          if (args.reviews.length < 1 || args.reviews.length > 60) {
            return {
              title: "Exam review failed",
              output: "Provide between 1 and 60 question reviews.",
              metadata: { error: true },
            }
          }
          const examRow = yield* db
            .select()
            .from(ExamTable)
            .where(eq(ExamTable.id, args.examID))
            .get()
            .pipe(Effect.orDie)
          if (!examRow || examRow.session_id !== ctx.sessionID) {
            return {
              title: "Exam review failed",
              output: "This exam does not exist in the current session.",
              metadata: { error: true },
            }
          }
          const attempt = yield* db
            .select()
            .from(ExamAttemptTable)
            .where(eq(ExamAttemptTable.exam_id, args.examID))
            .all()
            .pipe(Effect.orDie)
          const saved = attempt.find((item) => item.attempt_number === args.attemptNumber)
          if (!saved || saved.session_id !== ctx.sessionID) {
            return {
              title: "Exam review failed",
              output: "This attempt could not be found.",
              metadata: { error: true },
            }
          }
          const parsedExam = parseExamDraft(examRow.spec_json, examRow.id, Math.random, { randomize: false })
          if (!parsedExam.ok)
            return {
              title: "Exam review failed",
              output: "The saved exam definition is invalid.",
              metadata: { error: true },
            }
          const grade = saved.grade_json as unknown as ExamGrade
          const questions = new Map(parsedExam.value.questions.map((question) => [question.id, question]))
          const reviewIDs = new Set<string>()
          const reviews: Array<{ questionId: string; earned: number; feedback: string }> = []
          for (const raw of args.reviews) {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
              return {
                title: "Exam review failed",
                output: "Each review must be an object.",
                metadata: { error: true },
              }
            }
            const review = raw as Record<string, unknown>
            if (typeof review.questionId !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(review.questionId)) {
              return {
                title: "Exam review failed",
                output: "A review contains an invalid question ID.",
                metadata: { error: true },
              }
            }
            if (reviewIDs.has(review.questionId)) {
              return {
                title: "Exam review failed",
                output: `Duplicate review: ${review.questionId}`,
                metadata: { error: true },
              }
            }
            reviewIDs.add(review.questionId)
            const existing = grade.questionResults.find((result) => result.questionId === review.questionId)
            const question = questions.get(review.questionId)
            if (!existing || existing.status !== "needs-review" || !question || question.type !== "short") {
              return {
                title: "Exam review failed",
                output: `${review.questionId} is not awaiting written-answer review.`,
                metadata: { error: true },
              }
            }
            if (
              typeof review.earned !== "number" ||
              !Number.isFinite(review.earned) ||
              review.earned < 0 ||
              review.earned > existing.maximum
            ) {
              return {
                title: "Exam review failed",
                output: `Awarded points for ${review.questionId} must be between 0 and ${existing.maximum}.`,
                metadata: { error: true },
              }
            }
            if (typeof review.feedback !== "string" || !review.feedback.trim() || review.feedback.length > 600) {
              return {
                title: "Exam review failed",
                output: `Feedback for ${review.questionId} must be 1-600 characters.`,
                metadata: { error: true },
              }
            }
            reviews.push({ questionId: review.questionId, earned: review.earned, feedback: review.feedback.trim() })
          }

          for (const review of reviews) {
            const result = grade.questionResults.find((item) => item.questionId === review.questionId)!
            result.earned = Number(review.earned.toFixed(4))
            result.status =
              review.earned >= result.maximum - 1e-6 ? "correct" : review.earned > 0 ? "partial" : "incorrect"
            result.feedback = review.feedback
          }
          grade.score = Number(grade.questionResults.reduce((sum, item) => sum + item.earned, 0).toFixed(4))
          grade.percentage = grade.maximum > 0 ? Number(((grade.score / grade.maximum) * 100).toFixed(2)) : 0
          grade.needsReviewCount = grade.questionResults.filter((item) => item.status === "needs-review").length
          grade.needsReview = grade.needsReviewCount > 0
          yield* db
            .update(ExamAttemptTable)
            .set({
              grade_json: grade as unknown as Record<string, unknown>,
              score: grade.score,
              percentage: grade.percentage,
              needs_review: grade.needsReview ? 1 : 0,
            })
            .where(eq(ExamAttemptTable.id, saved.id))
            .run()
            .pipe(Effect.orDie)
          const refreshedAttempts = yield* db
            .select()
            .from(ExamAttemptTable)
            .where(eq(ExamAttemptTable.exam_id, args.examID))
            .all()
            .pipe(Effect.orDie)
          const stats = analytics(
            refreshedAttempts
              .toSorted((a, b) => a.attempt_number - b.attempt_number)
              .map((item) => item.percentage ?? 0),
          )
          yield* ctx.metadata({
            title: `Review saved: ${grade.percentage}%`,
            metadata: { examGrade: grade, analytics: stats },
          })
          return {
            title: `Written review saved: ${grade.score}/${grade.maximum}`,
            output: `Updated ${reviews.length} written response(s). Final score is ${grade.score}/${grade.maximum} (${grade.percentage}%). ${grade.needsReviewCount} response(s) still require review.`,
            metadata: { examGrade: grade, analytics: stats },
          }
        }),
    }
  }),
)
