// packages/learning/src/memory/book-notes.ts
//
// Book notes — findings the agent worked out about a specific book
// (plan §10.2). Lives in books.db because notes mean nothing without
// their book.
//
// Notes carry at least one citation that resolves to a real chunk (plan §10.5
// guard). Re-indexing a book with a changed source hash marks its notes
// `stale`. Stale notes are not injected until revalidated.
//
// Phase 4 implementation. Phase 1 ships the schema and guards.

import { Effect, Schema } from "effect"

export const BookNoteKind = Schema.Literals(["where", "definition", "notation", "example-pattern", "confusion"])
export type BookNoteKind = Schema.Schema.Type<typeof BookNoteKind>

export const Citation = Schema.Struct({
  chunkId: Schema.String,
  sourceHash: Schema.String,
  page: Schema.optional(Schema.Number),
})
export type Citation = Schema.Schema.Type<typeof Citation>

export const BookNote = Schema.Struct({
  id: Schema.String,
  bookId: Schema.String,
  sourceHash: Schema.String,
  kind: BookNoteKind,
  text: Schema.String,
  citations: Schema.Array(Citation),
  embedding: Schema.optional(Schema.String), // base64 Float32Array
  sourceSessionId: Schema.optional(Schema.String),
  stale: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type BookNote = Schema.Schema.Type<typeof BookNote>

// ---------------------------------------------------------------------------
// Guards (plan §10.5)
// ---------------------------------------------------------------------------

/**
 * A book note must carry at least one citation that resolves to a real
 * chunk. This stops memory from laundering outside knowledge into a
 * "grounded" session.
 *
 * requireNoteCitations is a danger-zone setting (plan §11.4) — disabling
 * it lets notes through with no citations, which breaks grounding.
 */
export const validateCitations = (
  note: Omit<BookNote, "id" | "stale" | "createdAt" | "updatedAt">,
  requireCitations = true,
): Effect.Effect<boolean, never> =>
  Effect.sync(() => {
    if (!requireCitations) return true
    return note.citations.length > 0
  })

// ---------------------------------------------------------------------------
// CRUD — Phase 4
// ---------------------------------------------------------------------------

export const listNotes = (_bookId: string): Effect.Effect<BookNote[], never> => Effect.succeed([])

export const writeNote = (
  _input: Omit<BookNote, "id" | "stale" | "createdAt" | "updatedAt">,
): Effect.Effect<BookNote, never> =>
  Effect.die("Book note write not yet implemented (Phase 4).")

export const deleteNote = (_id: string): Effect.Effect<void, never> => Effect.void

export const markStaleForBook = (_bookId: string, _newSourceHash: string): Effect.Effect<void, never> =>
  // Phase 4: UPDATE book_notes SET stale = 1 WHERE book_id = ? AND source_hash != ?
  Effect.void
