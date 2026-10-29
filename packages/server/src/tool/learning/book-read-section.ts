// packages/server/src/tool/learning/book-read-section.ts
//
// book_read_section tool — read a full section by ID or page range.
// Allowed in targeted sessions (plan §9.3).

import { recordRetrieved } from "@diveeoi/learning/grounding/turn-state"
import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { TargetedLearning } from "@diveeoi/learning"
import DESCRIPTION from "./book-read-section.txt"

export const Parameters = Schema.Struct({
  bookId: Schema.String,
  sectionId: Schema.optional(Schema.String).annotate({
    description: "The section ID to read. Either this or pageStart+pageEnd must be provided.",
  }),
  pageStart: Schema.optional(Schema.Number).annotate({ description: "Start page (1-indexed)" }),
  pageEnd: Schema.optional(Schema.Number).annotate({ description: "End page (inclusive)" }),
})

export const BookReadSectionTool = Tool.define(
  "book_read_section",
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
              title: "Section unavailable",
              metadata: {} as Record<string, unknown>,
              output: "The book library is currently unavailable.",
            }
          }

          if (params.sectionId) {
            const section = yield* Effect.promise(() => (store.db!.get<{
                  id: string
                  title: string | null
                  text: string
                  heading_path: string | null
                  page_start: number | null
                  page_end: number | null
                }>(
                  "SELECT id, title, text, heading_path, page_start, page_end FROM sections WHERE id = ? AND book_id = ?",
                  params.sectionId,
                  params.bookId,
                )).catch(() => null))
            if (!section) {
              return {
                title: "Section not found",
                metadata: {} as Record<string, unknown>,
                output: `Section ${params.sectionId} not found in book ${params.bookId}.`,
              }
            }
            // Passages of this section are citable: record them and list their ids.
            const base = section.id.replace(/-p\d+$/, "")
            const ids = yield* Effect.promise(() => (store.db!.all<{ id: string }>(
                  "SELECT id FROM chunks WHERE book_id = ? AND section_id IN (?, ?) ORDER BY ord",
                  params.bookId,
                  section.id,
                  base,
                )).catch(() => [] as { id: string }[]))
            recordRetrieved(ctx.sessionID, ids.map((r) => r.id))
            return {
              title: `Section: ${section.title ?? "(untitled)"}`,
              metadata: { sectionId: section.id, headingPath: section.heading_path ?? undefined },
              output: `${section.heading_path ? `[${section.heading_path}]\n` : ""}${section.text}${ids.length ? `\n\nCitable passages in this section: ${ids.map((r) => `[${r.id}]`).join(" ")}` : ""}`,
            }
          }

          if (params.pageStart !== undefined && params.pageEnd !== undefined) {
            const chunks = yield* Effect.promise(() => (store.db!.all<{ id: string; text: string; section_id: string; page: number | null }>(
                  "SELECT id, text, section_id, page FROM chunks WHERE book_id = ? AND page >= ? AND page <= ? ORDER BY ord",
                  params.bookId,
                  params.pageStart,
                  params.pageEnd,
                )).catch(() => [] as never[]))
            if (chunks.length === 0) {
              return {
                title: "No chunks in page range",
                metadata: {} as Record<string, unknown>,
                output: `No content found on pages ${params.pageStart}-${params.pageEnd}.`,
              }
            }
            recordRetrieved(ctx.sessionID, chunks.map((c) => c.id))
            return {
              title: `Pages ${params.pageStart}-${params.pageEnd}`,
              metadata: { chunkCount: chunks.length },
              output: chunks.map((c) => `[${c.id}] (p. ${c.page ?? "?"})\n${c.text}`).join("\n\n"),
            }
          }

          return {
            title: "Missing parameters",
            metadata: {} as Record<string, unknown>,
            output: "Provide either sectionId or both pageStart and pageEnd.",
          }
        }),
    }
  }),
)
