// packages/learning/src/grounding/post.ts
//
// After-answer verification (plan §9.6). Checks every [chunk_id] citation in the model's final
// reply: the passage exists and was shown to the model this turn. Returns a short note to append
// to the reply, or null when everything checks out. `grounding.verify`: off | flag | retry
// (retry currently behaves as flag; a re-ask needs the loop to re-run the step).

import { Effect } from "effect"
import { getRuntime } from "../runtime"
import { withDefaults } from "../settings/defaults"
import { verify, type Citation } from "./verifier"
import { extractCitedChunkIds, getRetrieved } from "./turn-state"

type Tree = Record<string, unknown>

const isArabic = (text: string) => {
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  return letters > 0 && (text.match(/[\u0600-\u06FF]/g)?.length ?? 0) / letters > 0.4
}

export const verifyAnswerNote = async (input: {
  sessionId: string
  answer: string
  settings?: Tree
}): Promise<string | null> => {
  const grounding = (withDefaults(input.settings).grounding ?? {}) as Tree
  const mode = (grounding.verify as string) ?? "flag"
  if (mode === "off") return null
  const runtime = getRuntime()
  const db = runtime?.booksStore.available ? runtime.booksStore.db : null
  if (!db) return null
  const ar = isArabic(input.answer)

  const cited = extractCitedChunkIds(input.answer)
  if (cited.length === 0) {
    if (grounding.requireCitations !== false && input.answer.trim().length > 240) {
      return ar
        ? "⚠ لا تحتوي هذه الإجابة على مراجع من الكتاب، لذا لم يمكن التحقق منها."
        : "⚠ This answer cites no passages from the book, so it could not be verified."
    }
    return null
  }

  const marks = cited.map(() => "?").join(",")
  const rows = await db.all<{ id: string; text: string }>(`SELECT id, text FROM chunks WHERE id IN (${marks})`, ...cited)
  const chunksByText = new Map(rows.map((r) => [r.id, r.text]))
  const citations: Citation[] = cited.map((chunkId) => ({ chunkId }))
  const { results, allVerified } = await Effect.runPromise(
    verify({ citations, retrievedChunkIds: getRetrieved(input.sessionId), chunksByText, mode: "flag" }),
  )
  if (allVerified) return null
  const bad = results
    .filter((r) => !r.verified)
    .map((r) => `[${r.citation.chunkId}] (${!r.chunkExists ? (ar ? "غير موجود" : "not in the library") : ar ? "لم يُعرض هذا الدور" : "not shown to the model this turn"})`)
  return ar
    ? `⚠ تعذّر التحقق من ${bad.length} مرجع: ${bad.join("، ")}`
    : `⚠ ${bad.length} citation${bad.length === 1 ? "" : "s"} could not be verified: ${bad.join(", ")}`
}
