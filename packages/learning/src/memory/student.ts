// packages/learning/src/memory/student.ts
//
// Student profile + memory (plan §10.2).
//
// Lives in the MAIN DiveeOI database, not books.db — student memories must
// survive losing the library (plan §10.2 table).
//
// Phase 4 implementation. Phase 1 ships the schema stub and the
// guards so the API can return "not yet implemented" cleanly.

import { Effect, Schema } from "effect"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const StudentMemoryKind = Schema.Literals(["preference", "style", "level", "gap", "goal"])
export type StudentMemoryKind = Schema.Schema.Type<typeof StudentMemoryKind>

export const StudentProfile = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  locale: Schema.optional(Schema.String), // BCP-47
  createdAt: Schema.Number,
})
export type StudentProfile = Schema.Schema.Type<typeof StudentProfile>

export const StudentMemory = Schema.Struct({
  id: Schema.String,
  studentId: Schema.String,
  kind: StudentMemoryKind,
  text: Schema.String,
  sourceSessionId: Schema.optional(Schema.String),
  pinned: Schema.Boolean,
  uses: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type StudentMemory = Schema.Schema.Type<typeof StudentMemory>

// ---------------------------------------------------------------------------
// Guards (plan §10.5)
// ---------------------------------------------------------------------------

export interface WriteGuard {
  /** Max bytes per memory. */
  maxBytes: number
  /** Cosine above which a new memory is treated as a duplicate of an existing one. */
  dedupeSimilarity: number
  /** Per-student cap on memories. */
  maxMemories: number
  /** Per-turn rate limit. */
  perTurnLimit: number
}

export const DEFAULT_WRITE_GUARD: WriteGuard = {
  maxBytes: 2048,
  dedupeSimilarity: 0.92,
  maxMemories: 200,
  perTurnLimit: 3,
}

/**
 * Validate that a student memory is a LEARNER attribute, not a world fact.
 * Plan §10.5: "The student-scope write tool only accepts learner attributes
 * as kinds, not world facts."
 */
export const isLearnerAttribute = (kind: StudentMemoryKind, text: string): boolean => {
  // Phase 4 implements a real classifier (LLM or rule-based).
  // Phase 1 ships the kind check.
  if (!["preference", "style", "level", "gap", "goal"].includes(kind)) return false
  // Reject obviously world-fact texts.
  if (text.length > 1000) return false
  return true
}

// ---------------------------------------------------------------------------
// CRUD — Phase 4
// ---------------------------------------------------------------------------

export const listMemories = (
  _studentId: string,
): Effect.Effect<StudentMemory[], never> => Effect.succeed([])

export const writeMemory = (
  _input: Omit<StudentMemory, "id" | "uses" | "createdAt" | "updatedAt">,
  _guard: WriteGuard = DEFAULT_WRITE_GUARD,
): Effect.Effect<StudentMemory, never> =>
  // Phase 4 implements the real write with dedupe + per-turn limit + cap.
  Effect.die("Student memory write not yet implemented (Phase 4).")

export const deleteMemory = (_id: string): Effect.Effect<void, never> => Effect.void

export const pinMemory = (_id: string, _pinned: boolean): Effect.Effect<void, never> => Effect.void
