// packages/learning/src/grounding/post.ts
//
// After-answer verification (plan §9.6). Checks every [chunk_id] citation in the model's final
// reply: the passage exists and was shown to the model this turn. Retry mode returns one repair
// prompt; the session loop removes the unverified draft before asking again.

import { Effect } from "effect"
import { getRuntime } from "../runtime"
import { withDefaults } from "../settings/defaults"
import { buildRetryPrompt, verify, type Citation, type VerifiedCitation } from "./verifier"
import { clearRetrieved, extractCitedChunkIds, getRetrieved } from "./turn-state"
import { logDiagnostic, withDiagnosticPromise } from "../diagnostics"

type Tree = Record<string, unknown>

export interface VerifyAnswerResult {
  verified: boolean
  note?: string
  retryPrompt?: string
}

const isArabic = (text: string) => {
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  return letters > 0 && (text.match(/[\u0600-\u06FF]/g)?.length ?? 0) / letters > 0.4
}

const noteForFailures = (failures: VerifiedCitation[], arabic: boolean) => {
  const bad = failures.map((failure) => {
    const reason = !failure.chunkExists
      ? arabic
        ? "غير موجود"
        : "not in the library"
      : !failure.chunkWasRetrievedThisTurn
        ? arabic
          ? "لم يُعرض هذا الدور"
          : "not shown to the model this turn"
        : arabic
          ? "الاقتباس لا يطابق النص"
          : "quoted text does not match"
    return `[${failure.citation.chunkId}] (${reason})`
  })
  return arabic
    ? `⚠ تعذّر التحقق من ${bad.length} مرجع: ${bad.join("، ")}`
    : `⚠ ${bad.length} citation${bad.length === 1 ? "" : "s"} could not be verified: ${bad.join(", ")}`
}

const verifyAnswerImpl = async (input: {
  sessionId: string
  answer: string
  settings?: Tree
  /** Allow a single repair pass. The caller must pass false after the retry. */
  allowRetry?: boolean
}): Promise<VerifyAnswerResult> => {
  const grounding = (withDefaults(input.settings).grounding ?? {}) as Tree
  const mode = (grounding.verify as string) ?? "flag"
  if (mode === "off") {
    clearRetrieved(input.sessionId)
    return { verified: true }
  }
  const runtime = getRuntime()
  const db = runtime?.booksStore.available ? runtime.booksStore.db : null
  if (!db) {
    clearRetrieved(input.sessionId)
    return { verified: true }
  }
  const ar = isArabic(input.answer)
  const cited = extractCitedChunkIds(input.answer)
  logDiagnostic(
    "grounding",
    "citations.extracted",
    { sessionId: input.sessionId, citationCount: cited.length, answerLength: input.answer.length },
    "trace",
  )
  if (cited.length === 0) {
    const note = grounding.requireCitations !== false && input.answer.trim().length > 240
      ? ar
        ? "⚠ لا تحتوي هذه الإجابة على مراجع من الكتاب، لذا لم يمكن التحقق منها."
        : "⚠ This answer cites no passages from the book, so it could not be verified."
      : undefined
    clearRetrieved(input.sessionId)
    return { verified: note === undefined, note }
  }

  const marks = cited.map(() => "?").join(",")
  const rows = await db.all<{ id: string; text: string }>(`SELECT id, text FROM chunks WHERE id IN (${marks})`, ...cited)
  const chunksByText = new Map(rows.map((row) => [row.id, row.text]))
  const citations: Citation[] = cited.map((chunkId) => ({ chunkId }))
  const { results, allVerified } = await Effect.runPromise(
    verify({ citations, retrievedChunkIds: getRetrieved(input.sessionId), chunksByText, mode: "flag" }),
  )
  const failures = results.filter((result) => !result.verified)
  logDiagnostic(
    "grounding",
    "citations.verified",
    {
      sessionId: input.sessionId,
      citationCount: cited.length,
      failureCount: failures.length,
      verified: allVerified,
      mode,
    },
    allVerified ? "info" : "warn",
  )
  if (allVerified) {
    clearRetrieved(input.sessionId)
    return { verified: true }
  }

  if (mode === "retry" && input.allowRetry !== false) {
    return { verified: false, retryPrompt: buildRetryPrompt(failures) }
  }
  clearRetrieved(input.sessionId)
  return { verified: false, note: noteForFailures(failures, ar) }
}

export const verifyAnswer = (input: Parameters<typeof verifyAnswerImpl>[0]): Promise<VerifyAnswerResult> =>
  withDiagnosticPromise(
    "grounding",
    "verify-answer",
    { sessionId: input.sessionId, answerText: input.answer, allowRetry: input.allowRetry !== false },
    () => verifyAnswerImpl(input),
  )

/** Compatibility helper for callers that only need the final warning note. */
export const verifyAnswerNote = async (input: {
  sessionId: string
  answer: string
  settings?: Tree
}): Promise<string | null> => {
  const result = await verifyAnswer({ ...input, allowRetry: false })
  return result.note ?? null
}
