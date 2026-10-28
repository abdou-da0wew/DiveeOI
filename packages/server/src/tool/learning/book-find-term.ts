// packages/server/src/tool/learning/book-find-term.ts
//
// book_find_term tool — exact term / glossary lookup.
// Allowed in targeted sessions (plan §9.3).

import { recordRetrieved } from "@diveeoi/learning/grounding/turn-state"
import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { TargetedLearning } from "@diveeoi/learning"
import DESCRIPTION from "./book-find-term.txt"

export const Parameters = Schema.Struct({
  bookId: Schema.String,
  term: Schema.String.annotate({ description: "The exact term to look for (case-insensitive)" }),
  maxResults: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0)))).annotate({
    description: "Maximum number of results. Default 10.",
  }),
})

export const BookFindTermTool = Tool.define(
  "book_find_term",
  Effect.gen(function* () {
    const tl = yield* TargetedLearning
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const store = tl.booksStore
          if (!store.available || !store.db) {
            return {
              title: "Term lookup unavailable",
              metadata: {},
              output: "The book library is currently unavailable.",
            }
          }
          const max = params.maxResults ?? 10
          // Use LIKE for case-insensitive exact term match on both original
          // and normalized text.
          const pattern = `%${params.term.replace(/[%_]/g, "\\$&")}%`
          const chunks = yield* Effect.tryPromise({
            try: () =>
              store.db!.all<{ id: string; text: string; section_id: string; page: number | null }>(
                "SELECT id, text, section_id, page FROM chunks WHERE book_id = ? AND (text LIKE ? ESCAPE '\\' OR text_norm LIKE ? ESCAPE '\\') ORDER BY ord LIMIT ?",
                params.bookId,
                pattern,
                pattern,
                max,
              ),
            catch: () => [] as Record<string, unknown>[],
          })
          if (chunks.length === 0) {
            return {
              title: `No occurrences of "${params.term}"`,
              metadata: {},
              output: `The term "${params.term}" was not found in book ${params.bookId}.`,
            }
          }
          recordRetrieved(ctx.sessionID, chunks.map((c) => c.id))
          return {
            title: `Found ${chunks.length} occurrence(s) of "${params.term}"`,
            metadata: { term: params.term, count: chunks.length },
            output: chunks.map((c) => `[${c.id}] (p. ${c.page ?? "?"})\n${c.text}`).join("\n\n---\n\n"),
          }
        }),
    }
  }),
)
