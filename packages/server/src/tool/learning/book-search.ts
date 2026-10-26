// packages/server/src/tool/learning/book-search.ts
//
// book_search tool — hybrid retrieval (BM25 + dense) scoped to the session's books.
// Allowed in targeted sessions (plan §9.3).

import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { TargetedLearning } from "@diveeoi/learning"
import { retrieve } from "@diveeoi/learning/retrieve/hybrid"
import { embed } from "@diveeoi/learning/embed/pipeline"
import DESCRIPTION from "./book-search.txt"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "The search query — what to look for in the book(s)" }),
  bookIds: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Specific book IDs to search. If omitted, searches all attached books.",
  }),
})

export const BookSearchTool = Tool.define(
  "book_search",
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
              title: "Book search unavailable",
              metadata: {},
              output: "The book library is currently unavailable.",
            }
          }

          // Get the session's attached book IDs from context metadata, or use
          // the explicit bookIds parameter.
          const bookIds = params.bookIds ?? (ctx.extra?.bookIds as string[] | undefined) ?? []
          if (bookIds.length === 0) {
            return {
              title: "No books attached",
              metadata: {},
              output: "No books are attached to this session. Use @book: to attach one.",
            }
          }

          // Try to get a dense vector for the query (will fail gracefully if
          // the embedding pipeline isn't initialized).
          const queryVec = yield* embed(params.query).pipe(
            Effect.matchEffect({
              onFailure: () => Effect.succeed(null),
              onSuccess: (v) => Effect.succeed(v),
            }),
          )

          const result = yield* retrieve(
            store.db,
            {
              bookIds,
              query: params.query,
              bm25TopK: 30,
              denseTopK: 30,
              rrfK: 60,
              weightBm25: 1.0,
              weightDense: 1.0,
              autoWeightByLanguage: true,
              finalTopK: 8,
              parentExpansion: true,
              parentContextMaxTokens: 2500,
              queryRewrite: "heuristic",
              rewriteTurns: 2,
              recentUserTurns: [],
              gate: {
                enabled: true,
                minDenseScore: 0.0,
                minFusedScore: 0.0,
                allowSmallTalk: true,
                language: "en",
                libraryAvailable: true,
                refusalMessages: { en: "not covered", ar: "غير موجود" },
              },
            },
            queryVec,
          )

          if (result.candidates.length === 0) {
            return {
              title: "No results",
              metadata: { gateDecision: result.gateDecision },
              output:
                result.gateDecision === "refused"
                  ? "This topic is not covered in the attached book(s)."
                  : "No matching passages found.",
            }
          }

          const lines = result.candidates.map(
            (c) =>
              `[${c.chunkId}] (p. ${c.page ?? "?"}, section ${c.sectionId})\n${c.text}\n${c.parent ? `\nParent section:\n${c.parent.text}` : ""}`,
          )
          return {
            title: `Found ${result.candidates.length} passages`,
            metadata: {
              gateDecision: result.gateDecision,
              candidateCount: result.candidates.length,
              totalContextTokens: result.totalContextTokens,
            },
            output: lines.join("\n\n---\n\n"),
          }
        }),
    }
  }),
)
