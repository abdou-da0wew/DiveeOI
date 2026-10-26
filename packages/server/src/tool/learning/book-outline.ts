// packages/server/src/tool/learning/book-outline.ts
//
// book_outline tool — returns the table of contents for a book.
// Allowed in targeted sessions (plan §9.3).

import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { TargetedLearning } from "@diveeoi/learning"
import DESCRIPTION from "./book-outline.txt"

export const Parameters = Schema.Struct({
  bookId: Schema.String.annotate({ description: "The book ID from the session's attached books" }),
})

export const BookOutlineTool = Tool.define(
  "book_outline",
  Effect.gen(function* () {
    const tl = yield* TargetedLearning
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const store = tl.booksStore
          if (!store.available || !store.db) {
            return {
              title: "Book outline unavailable",
              metadata: {},
              output: "The book library is currently unavailable. Please try again later.",
            }
          }
          const sections = yield* Effect.tryPromise({
            try: () =>
              store.db!.all<{
                id: string
                title: string | null
                level: number
                page_start: number | null
                page_end: number | null
                heading_path: string | null
              }>(
                "SELECT id, title, level, page_start, page_end, heading_path FROM sections WHERE book_id = ? ORDER BY ord",
                params.bookId,
              ),
            catch: () => [] as Record<string, unknown>[],
          })
          const lines = sections.map(
            (s) =>
              `${"  ".repeat(s.level - 1)}- ${s.title ?? "(untitled)"} [${s.id}] (pp. ${s.page_start ?? "?"}-${s.page_end ?? "?"})`,
          )
          return {
            title: "Book outline",
            metadata: { bookId: params.bookId, sectionCount: sections.length },
            output: lines.join("\n") || "No sections found for this book.",
          }
        }),
    }
  }),
)
