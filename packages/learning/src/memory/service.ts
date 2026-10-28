// packages/learning/src/memory/service.ts
//
// Student memory + book notes (plan §10).
//
//   Student profile  → <dataDir>/student.db  (its own SQLite file: survives losing books.db, and
//                      needs no migration of the chat database)
//   Book notes       → books.db `book_notes`  (meaningless without the books)
//
// Guards (plan §10.5): size caps, per-scope maximums, dedupe, per-turn rate limit, notes must cite
// real passages of the book, notes go stale when the book's source hash changes.

import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import type { BooksDbHandle } from "../store"
import { getRuntime } from "../runtime"
import { withDefaults } from "../settings/defaults"
import { ensureEmbedder } from "../embed/ensure"
import { embed } from "../embed/pipeline"

type Tree = Record<string, unknown>

export const DEFAULT_STUDENT = "default"
export const STUDENT_KINDS = ["preference", "style", "level", "gap", "goal"] as const
export const NOTE_KINDS = ["where", "definition", "notation", "example-pattern", "confusion"] as const
const MAX_BYTES = 2048
const PER_TURN_LIMIT = 3

export type WriteResult = { ok: true; id: string; merged: boolean } | { ok: false; reason: string }

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const memorySettings = (settings?: Tree) => (withDefaults(settings).memory ?? {}) as Tree
const tokens = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}
const cosine = (a: Float32Array, b: Float32Array) => {
  let s = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i]! * b[i]!
  return s
}
const toB64 = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64")
const fromB64 = (s: string) => {
  const buf = Buffer.from(s, "base64")
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

/** Best-effort embedding of a short text; null when the model isn't ready. */
export const tryEmbedText = async (text: string, settings?: Tree): Promise<Float32Array | null> => {
  if (!getRuntime()) return null
  return Effect.runPromise(
    ensureEmbedder(settings).pipe(
      Effect.flatMap(() => embed(text)),
      Effect.orElseSucceed(() => null),
    ),
  )
}

const turns = new Map<string, number>()
const takeTurnSlot = (turnKey?: string) => {
  if (!turnKey) return true
  const n = (turns.get(turnKey) ?? 0) + 1
  turns.set(turnKey, n)
  if (turns.size > 500) turns.delete(turns.keys().next().value as string)
  return n <= PER_TURN_LIMIT
}

// ---------------------------------------------------------------------------
// student.db
// ---------------------------------------------------------------------------

let opened: { file: string; db: Database } | null = null
const studentDb = (): Database | null => {
  const runtime = getRuntime()
  if (!runtime) return null
  const file = path.join(runtime.dataDir, "student.db")
  if (opened?.file === file) return opened.db
  try {
    mkdirSync(runtime.dataDir, { recursive: true })
    const db = new Database(file, { create: true })
    db.exec("PRAGMA journal_mode = WAL")
    db.exec(`
      CREATE TABLE IF NOT EXISTS student_profiles (id TEXT PRIMARY KEY, name TEXT, locale TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS student_memories (
        id TEXT PRIMARY KEY, student_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, embedding TEXT,
        source_session_id TEXT, pinned INTEGER NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_student_memories_student ON student_memories (student_id);
    `)
    db.run("INSERT OR IGNORE INTO student_profiles (id, created_at) VALUES (?, ?)", [DEFAULT_STUDENT, Date.now()])
    opened = { file, db }
    return db
  } catch {
    return null // degraded: chats keep working without student memory
  }
}

export interface StudentMemoryRow {
  id: string
  kind: string
  text: string
  pinned: boolean
  uses: number
  sourceSessionId?: string
  updatedAt: number
}

export const listStudentMemories = (studentId = DEFAULT_STUDENT): StudentMemoryRow[] => {
  const db = studentDb()
  if (!db) return []
  return (
    db
      .query("SELECT id, kind, text, pinned, uses, source_session_id, updated_at FROM student_memories WHERE student_id = ? ORDER BY pinned DESC, uses DESC, updated_at DESC")
      .all(studentId) as any[]
  ).map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    pinned: !!r.pinned,
    uses: r.uses,
    sourceSessionId: r.source_session_id ?? undefined,
    updatedAt: r.updated_at,
  }))
}

export const deleteStudentMemory = (id: string): boolean => {
  const db = studentDb()
  if (!db) return false
  return db.run("DELETE FROM student_memories WHERE id = ?", [id]).changes > 0
}

export const pinStudentMemory = (id: string, pinned: boolean): boolean => {
  const db = studentDb()
  if (!db) return false
  return db.run("UPDATE student_memories SET pinned = ?, updated_at = ? WHERE id = ?", [pinned ? 1 : 0, Date.now(), id]).changes > 0
}

export const writeStudentMemory = async (input: {
  kind: string
  text: string
  sessionId?: string
  turnKey?: string
  settings?: Tree
  studentId?: string
}): Promise<WriteResult> => {
  const mem = memorySettings(input.settings)
  if (mem.enabled === false) return { ok: false, reason: "Student memory is turned off in settings." }
  const db = studentDb()
  if (!db) return { ok: false, reason: "Student memory is unavailable." }
  if (!(STUDENT_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, reason: `kind must be one of ${STUDENT_KINDS.join(", ")} (learner attributes only, never facts about the subject).` }
  }
  const text = input.text.trim().replace(/\s+/g, " ")
  if (text.length < 3) return { ok: false, reason: "Memory text is empty." }
  if (Buffer.byteLength(text) > MAX_BYTES) return { ok: false, reason: `Memory is longer than ${MAX_BYTES} bytes.` }
  if (!takeTurnSlot(input.turnKey)) return { ok: false, reason: `At most ${PER_TURN_LIMIT} memories can be written per turn.` }
  const studentId = input.studentId ?? DEFAULT_STUDENT

  const existing = db.query("SELECT id, text, embedding FROM student_memories WHERE student_id = ?").all(studentId) as any[]
  const vec = await tryEmbedText(text, input.settings)
  const threshold = Number(mem.dedupeSimilarity ?? 0.92)
  const mine = tokens(text)
  for (const row of existing) {
    const dup =
      row.text === text ||
      jaccard(mine, tokens(row.text)) >= 0.85 ||
      (vec && row.embedding && cosine(vec, fromB64(row.embedding)) >= threshold)
    if (dup) {
      db.run("UPDATE student_memories SET updated_at = ? WHERE id = ?", [Date.now(), row.id])
      return { ok: true, id: row.id, merged: true }
    }
  }
  if (existing.length >= Number(mem.maxStudentMemories ?? 200)) {
    return { ok: false, reason: "The student memory is full. Ask the student to delete some in Settings." }
  }
  const id = `sm_${randomUUID().replace(/-/g, "").slice(0, 14)}`
  const now = Date.now()
  db.run(
    "INSERT INTO student_memories (id, student_id, kind, text, embedding, source_session_id, pinned, uses, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
    [id, studentId, input.kind, text, vec ? toB64(vec) : null, input.sessionId ?? null, now, now],
  )
  return { ok: true, id, merged: false }
}

/** System-prompt block with the student's profile, pinned first, under the token budget. */
export const studentProfileBlock = (settings?: Tree, studentId = DEFAULT_STUDENT): string | null => {
  const mem = memorySettings(settings)
  if (mem.enabled === false) return null
  const rows = listStudentMemories(studentId)
  if (rows.length === 0) return null
  const cap = Number(mem.studentBudgetTokens ?? 600) * 4
  const lines: string[] = []
  const used: string[] = []
  let size = 0
  for (const r of rows) {
    const line = `- [${r.kind}] ${r.text}`
    if (size + line.length > cap && lines.length > 0) break
    lines.push(line)
    used.push(r.id)
    size += line.length
  }
  const db = studentDb()
  if (db) for (const id of used) db.run("UPDATE student_memories SET uses = uses + 1 WHERE id = ?", [id])
  return `<student_profile>\nWhat you know about THIS student (how they learn). Adapt your teaching to it. It is not a source of facts about the subject.\n${lines.join("\n")}\n</student_profile>`
}

// ---------------------------------------------------------------------------
// book notes (books.db)
// ---------------------------------------------------------------------------

export interface BookNoteRow {
  id: string
  bookId: string
  bookTitle?: string
  kind: string
  text: string
  citations: { chunkId: string; sourceHash: string; page?: number | null }[]
  stale: boolean
  updatedAt: number
}

export const writeBookNote = async (input: {
  db: BooksDbHandle
  bookId: string
  kind: string
  text: string
  citedChunkIds: string[]
  sessionId?: string
  turnKey?: string
  settings?: Tree
}): Promise<WriteResult> => {
  const mem = memorySettings(input.settings)
  if (mem.enabled === false) return { ok: false, reason: "Student memory is turned off in settings." }
  if (!(NOTE_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, reason: `kind must be one of ${NOTE_KINDS.join(", ")}.` }
  }
  const text = input.text.trim().replace(/\s+/g, " ")
  if (text.length < 3) return { ok: false, reason: "Note text is empty." }
  if (Buffer.byteLength(text) > MAX_BYTES) return { ok: false, reason: `Note is longer than ${MAX_BYTES} bytes.` }
  if (!takeTurnSlot(input.turnKey)) return { ok: false, reason: `At most ${PER_TURN_LIMIT} memories can be written per turn.` }

  const book = await input.db.get<{ source_hash: string; status: string }>("SELECT source_hash, status FROM books WHERE id = ?", input.bookId)
  if (!book || book.status !== "ready") return { ok: false, reason: "That book is not available." }

  const requireCitations = mem.requireNoteCitations !== false
  const cited = [...new Set(input.citedChunkIds)]
  if (requireCitations && cited.length === 0) {
    return { ok: false, reason: "A book note must cite at least one passage ([chunk_id]) it comes from." }
  }
  let citations: BookNoteRow["citations"] = []
  if (cited.length > 0) {
    const marks = cited.map(() => "?").join(",")
    const rows = await input.db.all<{ id: string; page: number | null }>(
      `SELECT id, page FROM chunks WHERE book_id = ? AND id IN (${marks})`,
      input.bookId,
      ...cited,
    )
    if (rows.length !== cited.length) {
      return { ok: false, reason: "Some cited passages do not exist in this book. Cite chunk ids you actually read." }
    }
    citations = rows.map((r) => ({ chunkId: r.id, sourceHash: book.source_hash, page: r.page }))
  }

  const existing = await input.db.all<{ id: string; text: string; embedding: string | null }>(
    "SELECT id, text, embedding FROM book_notes WHERE book_id = ? AND stale = 0",
    input.bookId,
  )
  if (existing.length >= Number(mem.maxBookNotesPerBook ?? 500)) return { ok: false, reason: "This book has too many notes." }
  const vec = await tryEmbedText(text, input.settings)
  const threshold = Number(mem.dedupeSimilarity ?? 0.92)
  const mine = tokens(text)
  for (const row of existing) {
    const dup =
      row.text === text ||
      jaccard(mine, tokens(row.text)) >= 0.85 ||
      (vec && row.embedding && cosine(vec, fromB64(row.embedding)) >= threshold)
    if (dup) {
      await input.db.run("UPDATE book_notes SET updated_at = ? WHERE id = ?", Date.now(), row.id)
      return { ok: true, id: row.id, merged: true }
    }
  }
  const id = `bn_${randomUUID().replace(/-/g, "").slice(0, 14)}`
  const now = Date.now()
  await input.db.run(
    "INSERT INTO book_notes (id, book_id, source_hash, kind, text, citations_json, embedding, source_session_id, stale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    id,
    input.bookId,
    book.source_hash,
    input.kind,
    text,
    JSON.stringify(citations),
    vec ? toB64(vec) : null,
    input.sessionId ?? null,
    now,
    now,
  )
  return { ok: true, id, merged: false }
}

const parseNote = (r: any): BookNoteRow => ({
  id: r.id,
  bookId: r.book_id,
  bookTitle: r.title ?? undefined,
  kind: r.kind,
  text: r.text,
  citations: (() => {
    try {
      return JSON.parse(r.citations_json)
    } catch {
      return []
    }
  })(),
  stale: !!r.stale || (r.current_hash != null && r.current_hash !== r.source_hash),
  updatedAt: r.updated_at,
})

export const listBookNotes = async (db: BooksDbHandle, bookId?: string): Promise<BookNoteRow[]> => {
  const sql =
    "SELECT n.*, b.title AS title, b.source_hash AS current_hash FROM book_notes n LEFT JOIN books b ON b.id = n.book_id" +
    (bookId ? " WHERE n.book_id = ?" : "") +
    " ORDER BY n.updated_at DESC"
  const rows = bookId ? await db.all<any>(sql, bookId) : await db.all<any>(sql)
  return rows.map(parseNote)
}

export const deleteBookNote = async (db: BooksDbHandle, id: string): Promise<boolean> => {
  const row = await db.get<{ id: string }>("SELECT id FROM book_notes WHERE id = ?", id)
  if (!row) return false
  await db.run("DELETE FROM book_notes WHERE id = ?", id)
  return true
}

/** The notes most relevant to this question, for the books in scope (plan §10.4: never a dump). */
export const relevantBookNotes = async (input: {
  db: BooksDbHandle
  bookIds: string[]
  query: string
  queryVec: Float32Array | null
  settings?: Tree
}): Promise<string | null> => {
  const mem = memorySettings(input.settings)
  if (mem.enabled === false || input.bookIds.length === 0) return null
  const marks = input.bookIds.map(() => "?").join(",")
  const rows = (
    await input.db.all<any>(
      `SELECT n.*, b.title AS title, b.source_hash AS current_hash FROM book_notes n JOIN books b ON b.id = n.book_id WHERE n.book_id IN (${marks}) AND n.stale = 0`,
      ...input.bookIds,
    )
  ).filter((r) => r.current_hash === r.source_hash)
  if (rows.length === 0) return null
  const q = tokens(input.query)
  const scored = rows
    .map((r) => {
      const score =
        input.queryVec && r.embedding ? cosine(input.queryVec, fromB64(r.embedding)) : jaccard(q, tokens(r.text))
      return { r, score }
    })
    .filter((x) => (input.queryVec ? x.score >= 0.3 : x.score > 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(mem.bookNotesTopK ?? 5))
  if (scored.length === 0) return null
  const cap = Number(mem.bookNotesBudgetTokens ?? 800) * 4
  const lines: string[] = []
  let size = 0
  for (const { r } of scored) {
    const n = parseNote(r)
    const line = `- [${n.kind} · ${n.bookTitle ?? ""}] ${n.text} (${n.citations.map((c) => `[${c.chunkId}]`).join(" ")})`
    if (size + line.length > cap && lines.length > 0) break
    lines.push(line)
    size += line.length
  }
  return `<book_notes>\nFindings saved from earlier sessions. They point to passages; re-read the passage with book_read_section before relying on one.\n${lines.join("\n")}\n</book_notes>`
}
