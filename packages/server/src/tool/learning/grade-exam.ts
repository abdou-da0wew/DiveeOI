import { randomUUID } from "node:crypto"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "@diveeoi/db/database/database"
import type { ExamAnswerKeyEntry, ExamGrade, ExamGradingConfig, ExamSpec } from "@diveeoi/db/chat-ui"
import { gradeExamAttempt, nextAdaptiveDifficulty, selectAdaptiveQuestions } from "@diveeoi/db/exam-grade"
import { parseExamDraft } from "@diveeoi/db/exam-parse"
import { ExamAttemptTable, ExamTable } from "@diveeoi/db/exam/sql"
import * as Tool from "../tool"
import type { ExecuteResult } from "../tool/tool"
import { decryptExamSecret } from "../../exam/crypto"
import {
  analytics,
  number,
  parameters,
  parseAnswers,
  parseInteractiveState,
  renderGrade,
  type GradeMetadata,
} from "./exam-grading-shared"

export const GradeExamTool = Tool.define(
  "grade_exam",
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return {
      description: `Grade a submitted DiveeOI exam by its examID. Use this for every create_exam submission; do not grade privately keyed questions from memory or disclose hidden keys. The server verifies the exam belongs to this session, decrypts its server-only answer key, performs objective grading and rubric-based partial credit, persists the attempt, and returns feedback without returning the key. Include attemptNumber from the submission report, all answers, elapsedMs, and interactiveState so simulation settings are retained. The server enforces the retry limit and returns the next adaptive question set when another attempt is available. Report provisional scores and identify any written responses that need manual review.`,
      parameters: Schema.Struct({
        examID: Schema.String,
        attemptNumber: Schema.Number,
        elapsedMs: Schema.optional(Schema.Number),
        answers: Schema.Array(Schema.Unknown),
        interactiveState: Schema.optional(Schema.Unknown),
      }),
      jsonSchema: parameters,
      execute: (
        args: {
          examID: string
          attemptNumber: number
          elapsedMs?: number
          answers: unknown[]
          interactiveState?: unknown
        },
        ctx: Tool.Context,
      ): Effect.Effect<ExecuteResult<GradeMetadata>> =>
        Effect.gen(function* () {
          if (!/^[a-zA-Z0-9_-]{1,80}$/.test(args.examID)) {
            return { title: "Exam grading failed", output: "The examID is invalid.", metadata: { error: true } }
          }
          if (!Number.isInteger(args.attemptNumber) || args.attemptNumber < 1 || args.attemptNumber > 10) {
            return {
              title: "Exam grading failed",
              output: "attemptNumber must be an integer from 1 to 10.",
              metadata: { error: true },
            }
          }
          const parsedAnswers = parseAnswers(args.answers)
          if (!parsedAnswers.ok)
            return { title: "Exam grading failed", output: parsedAnswers.error, metadata: { error: true } }
          const parsedState = parseInteractiveState(args.interactiveState)
          if (!parsedState.ok)
            return { title: "Exam grading failed", output: parsedState.error, metadata: { error: true } }

          const examRow = yield* db
            .select()
            .from(ExamTable)
            .where(eq(ExamTable.id, args.examID))
            .get()
            .pipe(Effect.orDie)
          if (!examRow || examRow.session_id !== ctx.sessionID) {
            return {
              title: "Exam grading failed",
              output: "This exam does not exist in the current session.",
              metadata: { error: true },
            }
          }

          const previous = yield* db
            .select()
            .from(ExamAttemptTable)
            .where(eq(ExamAttemptTable.exam_id, examRow.id))
            .all()
            .pipe(Effect.orDie)
          const savedAttempt = previous.find((attempt) => attempt.attempt_number === args.attemptNumber)
          if (savedAttempt) {
            const savedGrade = savedAttempt.grade_json as unknown as ExamGrade
            return {
              title: `Exam attempt ${savedGrade.attemptNumber} already graded`,
              output: `This submission was already graded.\n${renderGrade(savedGrade, previous.length)}`,
              metadata: { examGrade: savedGrade, analytics: analytics(previous.map((item) => item.percentage ?? 0)) },
            }
          }
          if (args.attemptNumber !== previous.length + 1) {
            return {
              title: "Exam grading failed",
              output: `Expected attempt ${previous.length + 1}, received ${args.attemptNumber}.`,
              metadata: { error: true },
            }
          }
          if (args.attemptNumber > examRow.attempts_allowed) {
            return {
              title: "Exam grading failed",
              output: "The retry limit for this exam has been reached.",
              metadata: { error: true },
            }
          }

          const rawExam = examRow.spec_json as unknown
          const parsedExam = parseExamDraft(rawExam, examRow.id, Math.random, { randomize: false })
          if (!parsedExam.ok) {
            return {
              title: "Exam grading failed",
              output: "The stored exam definition is invalid; an administrator must inspect this record.",
              metadata: { error: true },
            }
          }
          const fullExam = parsedExam.value
          const grading = examRow.grading_json as Record<string, unknown>
          const currentIDs = Array.isArray(grading.currentQuestionIDs)
            ? grading.currentQuestionIDs.filter((id): id is string => typeof id === "string")
            : fullExam.questions.map((question) => question.id)
          const activeQuestions = fullExam.questions.filter((question) => currentIDs.includes(question.id))
          if (activeQuestions.length === 0) {
            return {
              title: "Exam grading failed",
              output: "The current attempt does not have a valid question selection.",
              metadata: { error: true },
            }
          }
          if (new Set(currentIDs).size !== currentIDs.length || activeQuestions.length !== currentIDs.length) {
            return {
              title: "Exam grading failed",
              output: "The stored attempt question selection is inconsistent.",
              metadata: { error: true },
            }
          }
          const declaredState = new Map(
            activeQuestions.map((question) => [
              question.id,
              new Map((question.state ?? []).map((item) => [item.key, item.value])),
            ]),
          )
          for (const [questionID, state] of Object.entries(parsedState.value)) {
            const declared = declaredState.get(questionID)
            if (!declared) {
              return {
                title: "Exam grading failed",
                output: `Interactive state references a question outside this attempt: ${questionID}.`,
                metadata: { error: true },
              }
            }
            for (const [key, value] of Object.entries(state)) {
              if (!declared.has(key) || typeof declared.get(key) !== typeof value) {
                return {
                  title: "Exam grading failed",
                  output: `Interactive state contains an undeclared or incorrectly typed field: ${questionID}.${key}.`,
                  metadata: { error: true },
                }
              }
            }
          }
          const answerIDs = Object.keys(parsedAnswers.value)
          if (answerIDs.some((id) => !currentIDs.includes(id))) {
            return {
              title: "Exam grading failed",
              output: "The submission contains a question that was not part of this attempt.",
              metadata: { error: true },
            }
          }
          const attemptExam: ExamSpec = {
            ...fullExam,
            questions: activeQuestions,
            totalPoints: activeQuestions.reduce((sum, question) => sum + question.points, 0),
          }

          const secret = yield* Effect.tryPromise({
            try: () =>
              decryptExamSecret<{ answerKey: ExamAnswerKeyEntry[] }>(
                {
                  ciphertext: examRow.secret_ciphertext,
                  iv: examRow.secret_iv,
                  authTag: examRow.secret_auth_tag,
                },
                typeof ctx.extra?.examEncryptionDirectory === "string" ? ctx.extra.examEncryptionDirectory : undefined,
              ),
            catch: () =>
              new Error(
                "The private answer key could not be decrypted. Check the server's persisted exam encryption key.",
              ),
          }).pipe(Effect.orDie)
          const config: ExamGradingConfig = {
            partialCredit: grading.partialCredit !== false,
            negativeMarking: number(grading.negativeMarking, 0.25),
          }
          const currentDifficulty = examRow.adaptive_difficulty
          const grade = gradeExamAttempt({
            exam: attemptExam,
            answerKey: secret.answerKey,
            answers: parsedAnswers.value,
            config,
            attemptNumber: args.attemptNumber,
            attemptsAllowed: examRow.attempts_allowed,
          })
          const submittedAt = Date.now()
          const interaction = parsedState.value
          const nextDifficulty = nextAdaptiveDifficulty(currentDifficulty, grade.percentage, fullExam.adaptive)
          const canRetry = grade.attemptsRemaining > 0
          const nextAttempt = canRetry
            ? selectAdaptiveQuestions({ exam: fullExam, difficulty: nextDifficulty })
            : undefined
          if (nextAttempt) grade.nextAttempt = nextAttempt
          const nextGrading = {
            ...grading,
            currentQuestionIDs: nextAttempt?.questions.map((question) => question.id) ?? currentIDs,
          }

          yield* db
            .transaction((tx) =>
              Effect.gen(function* () {
                yield* tx
                  .insert(ExamAttemptTable)
                  .values({
                    id: randomUUID(),
                    exam_id: examRow.id,
                    session_id: ctx.sessionID,
                    attempt_number: args.attemptNumber,
                    difficulty: currentDifficulty,
                    answers_json: parsedAnswers.value,
                    interaction_json: interaction,
                    grade_json: grade as unknown as Record<string, unknown>,
                    score: grade.score,
                    max_score: grade.maximum,
                    percentage: grade.percentage,
                    needs_review: grade.needsReview ? 1 : 0,
                    elapsed_ms: Math.max(0, Math.min(14400000, Math.trunc(args.elapsedMs ?? 0))),
                    submitted_at: submittedAt,
                  })
                  .run()
                yield* tx
                  .update(ExamTable)
                  .set({
                    grading_json: nextGrading,
                    adaptive_difficulty: nextDifficulty,
                  })
                  .where(eq(ExamTable.id, examRow.id))
                  .run()
              }),
            )
            .pipe(Effect.orDie)

          const history = [...previous, { percentage: grade.percentage }]
          const stats = analytics(history.map((item) => item.percentage ?? 0))
          yield* ctx.metadata({
            title: `Exam result: ${grade.percentage}%`,
            metadata: { examGrade: grade, analytics: stats },
          })
          return {
            title: `Exam graded: ${grade.score}/${grade.maximum}`,
            output:
              renderGrade(grade, history.length) +
              `\n\nAnalytics: ${stats.attemptCount} attempt(s), average ${stats.averagePercentage}%, best ${stats.bestPercentage}%.`,
            metadata: { examGrade: grade, analytics: stats },
          }
        }),
    }
  }),
)
