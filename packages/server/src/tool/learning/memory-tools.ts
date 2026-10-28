// packages/server/src/tool/learning/memory-tools.ts
//
// Student memory and book-note tools (plan §10). Allowed in targeted sessions only.
//   student_memory_read / student_memory_write  – how THIS student learns (never facts about the subject)
//   book_note_read / book_note_write            – findings from a book; every note cites [chunk_id]s

import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { TargetedLearning } from "@diveeoi/learning"
import { getUserSettings } from "@diveeoi/learning/runtime"
import {
  listBookNotes,
  listStudentMemories,
  writeBookNote,
  writeStudentMemory,
} from "@diveeoi/learning/memory/service"

const unavailable = (title: string) => ({ title, metadata: {}, output: "The book library is currently unavailable." })

export const StudentMemoryReadTool = Tool.define(
  "student_memory_read",
  Effect.gen(function* () {
    return {
      description:
        "Read what is remembered about how this student likes to be taught (preferences, style, level, gaps, goals). It is already provided in your context each turn; use this only to re-check.",
      parameters: Schema.Struct({}),
      execute: (_params: {}, _ctx: Tool.Context) =>
        Effect.sync(() => {
          const rows = listStudentMemories()
          return {
            title: `${rows.length} student memories`,
            metadata: { count: rows.length },
            output: rows.length === 0 ? "Nothing is remembered about this student yet." : rows.map((r) => `- [${r.kind}] ${r.text}`).join("\n"),
          }
        }),
    }
  }),
)

export const StudentMemoryWriteTool = Tool.define(
  "student_memory_write",
  Effect.gen(function* () {
    return {
      description:
        "Remember something about HOW this student learns, so every future session can adapt. kind: preference | style | level | gap | goal. Only learner attributes (e.g. 'prefers step-by-step worked examples', 'explain in Arabic first'), never facts about the subject. At most 3 per turn.",
      parameters: Schema.Struct({
        kind: Schema.String.annotate({ description: "preference | style | level | gap | goal" }),
        text: Schema.String.annotate({ description: "One short sentence about the student." }),
      }),
      execute: (params: { kind: string; text: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const r = yield* Effect.promise(() =>
            writeStudentMemory({
              kind: params.kind,
              text: params.text,
              sessionId: ctx.sessionID,
              turnKey: `${ctx.sessionID}:${ctx.messageID}`,
              settings: getUserSettings(),
            }),
          )
          return {
            title: r.ok ? (r.merged ? "Already remembered" : "Remembered") : "Not saved",
            metadata: {},
            output: r.ok ? (r.merged ? "That was already remembered." : "Saved.") : r.reason,
          }
        }),
    }
  }),
)

export const BookNoteReadTool = Tool.define(
  "book_note_read",
  Effect.gen(function* () {
    const tl = yield* TargetedLearning
    return {
      description:
        "Read findings saved from earlier sessions about a book (where a topic is, how the book defines or notates something, common confusions). Re-read the cited passage before relying on a note.",
      parameters: Schema.Struct({ bookId: Schema.String }),
      execute: (params: { bookId: string }, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!tl.booksStore.available || !tl.booksStore.db) return unavailable("Notes unavailable")
          const notes = yield* Effect.promise(() => listBookNotes(tl.booksStore.db!, params.bookId))
          const live = notes.filter((n) => !n.stale)
          return {
            title: `${live.length} notes`,
            metadata: { count: live.length },
            output:
              live.length === 0
                ? "No saved notes for this book yet."
                : live.map((n) => `- [${n.kind}] ${n.text} (${n.citations.map((c) => `[${c.chunkId}]`).join(" ")})`).join("\n"),
          }
        }),
    }
  }),
)

export const BookNoteWriteTool = Tool.define(
  "book_note_write",
  Effect.gen(function* () {
    const tl = yield* TargetedLearning
    return {
      description:
        "Save a finding about a book so it is not re-derived next time. kind: where | definition | notation | example-pattern | confusion. citations MUST list the [chunk_id]s you read it from; notes without real citations are rejected.",
      parameters: Schema.Struct({
        bookId: Schema.String,
        kind: Schema.String,
        text: Schema.String,
        citations: Schema.Array(Schema.String).annotate({ description: "chunk ids the finding comes from" }),
      }),
      execute: (params: { bookId: string; kind: string; text: string; citations: readonly string[] }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!tl.booksStore.available || !tl.booksStore.db) return unavailable("Note not saved")
          const r = yield* Effect.promise(() =>
            writeBookNote({
              db: tl.booksStore.db!,
              bookId: params.bookId,
              kind: params.kind,
              text: params.text,
              citedChunkIds: [...params.citations],
              sessionId: ctx.sessionID,
              turnKey: `${ctx.sessionID}:${ctx.messageID}`,
              settings: getUserSettings(),
            }),
          )
          return {
            title: r.ok ? (r.merged ? "Note already saved" : "Note saved") : "Not saved",
            metadata: {},
            output: r.ok ? (r.merged ? "A very similar note already exists." : "Saved.") : r.reason,
          }
        }),
    }
  }),
)
