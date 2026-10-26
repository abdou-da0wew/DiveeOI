// packages/learning/src/store/schema.ts
//
// books.db schema (plan §6.3). Names indicative — Drizzle migrations follow
// the rest of the repo (TS files default-exporting { id, up(tx) }).
//
// IMPORTANT: there are NO cross-database foreign keys between books.db and
// the main DB. Sessions refer to books by UUID and resolve at runtime.

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

// ---------------------------------------------------------------------------
// meta — single-row table for schema version, normalizer version, embed sig
// ---------------------------------------------------------------------------

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
})

// ---------------------------------------------------------------------------
// books
// ---------------------------------------------------------------------------

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  author: text("author"),
  lang: text("lang"), // BCP-47 like "ar" or "en"; null = unknown
  sourceHash: text("source_hash").notNull(),
  sourcePath: text("source_path").notNull(), // relative to dataDir/targeted-learning/books/
  pages: integer("pages"),
  status: text("status").notNull(), // pending | parsing | chunking | embedding | indexing | ready | failed
  error: text("error"),
  parentCount: integer("parent_count").default(0).notNull(),
  chunkCount: integer("chunk_count").default(0).notNull(),
  embedSignature: text("embed_signature").notNull(), // JSON: { repo, revision, dtype, maxLength }
  normalizerVersion: integer("normalizer_version").notNull(),
  createdAt: integer("created_at").notNull(),
  indexedAt: integer("indexed_at"),
  summaryJson: text("summary_json"), // extractive summary
})

// ---------------------------------------------------------------------------
// sections — the parent chunks (the LLM sees these)
// ---------------------------------------------------------------------------

export const sections = sqliteTable("sections", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  parentId: text("parent_id"), // self-reference for nested sections
  level: integer("level").notNull(), // 1 = chapter, 2 = section, 3 = subsection
  title: text("title"),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
  ord: integer("ord").notNull(), // 0-based order in the book
  text: text("text").notNull(), // original text, not normalized
  headingPath: text("heading_path"), // "Chapter 3 > Section 2" for display
})

// ---------------------------------------------------------------------------
// chunks — the child chunks (these get embedded)
// ---------------------------------------------------------------------------

export const chunks = sqliteTable("chunks", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  sectionId: text("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  ord: integer("ord").notNull(),
  page: integer("page"),
  text: text("text").notNull(), // original text
  textNorm: text("text_norm").notNull(), // normalized for search
  tokenCount: integer("token_count").notNull(),
})

// chunks_fts — FTS5 over text_norm. Created via raw SQL in the migration
// because drizzle-orm/sqlite-core does not yet have a stable FTS5 builder.
// The trigger keeps chunks_fts in sync with chunks on insert/update/delete.

// ---------------------------------------------------------------------------
// chunk_vecs — Float32 BLOB, 1024 dims
// ---------------------------------------------------------------------------

export const chunkVecs = sqliteTable("chunk_vecs", {
  chunkId: text("chunk_id").primaryKey().references(() => chunks.id, { onDelete: "cascade" }),
  vec: text("vec").notNull(), // stored as base64 Float32Array, 1024 floats = 4096 bytes
})

// ---------------------------------------------------------------------------
// ingest_jobs
// ---------------------------------------------------------------------------

export const ingestJobs = sqliteTable("ingest_jobs", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(), // parse | chunk | embed | index | summary
  status: text("status").notNull(), // queued | running | paused | complete | failed | cancelled
  progress: integer("progress").default(0).notNull(), // 0-100
  checkpointJson: text("checkpoint_json"),
  error: text("error"),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
})

// ---------------------------------------------------------------------------
// book_notes — see memory/book-notes.ts (plan §10.2)
// ---------------------------------------------------------------------------

export const bookNotes = sqliteTable("book_notes", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  sourceHash: text("source_hash").notNull(), // snapshot at write time
  kind: text("kind").notNull(), // where | definition | notation | example-pattern | confusion
  text: text("text").notNull(),
  citationsJson: text("citations_json").notNull(), // JSON array of { chunkId, sourceHash, page }
  embedding: text("embedding"), // base64 Float32Array
  sourceSessionId: text("source_session_id"),
  stale: integer("stale", { mode: "boolean" }).default(false).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

// ---------------------------------------------------------------------------
// Migration SQL — used by the books.db initializer (see store/index.ts)
// ---------------------------------------------------------------------------

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS \`meta\` (\`key\` TEXT PRIMARY KEY, \`value\` TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS \`books\` (
  \`id\` TEXT PRIMARY KEY,
  \`slug\` TEXT NOT NULL,
  \`title\` TEXT NOT NULL,
  \`author\` TEXT,
  \`lang\` TEXT,
  \`source_hash\` TEXT NOT NULL,
  \`source_path\` TEXT NOT NULL,
  \`pages\` INTEGER,
  \`status\` TEXT NOT NULL,
  \`error\` TEXT,
  \`parent_count\` INTEGER NOT NULL DEFAULT 0,
  \`chunk_count\` INTEGER NOT NULL DEFAULT 0,
  \`embed_signature\` TEXT NOT NULL,
  \`normalizer_version\` INTEGER NOT NULL,
  \`created_at\` INTEGER NOT NULL,
  \`indexed_at\` INTEGER,
  \`summary_json\` TEXT
);

CREATE TABLE IF NOT EXISTS \`sections\` (
  \`id\` TEXT PRIMARY KEY,
  \`book_id\` TEXT NOT NULL,
  \`parent_id\` TEXT,
  \`level\` INTEGER NOT NULL,
  \`title\` TEXT,
  \`page_start\` INTEGER,
  \`page_end\` INTEGER,
  \`ord\` INTEGER NOT NULL,
  \`text\` TEXT NOT NULL,
  \`heading_path\` TEXT,
  FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS \`chunks\` (
  \`id\` TEXT PRIMARY KEY,
  \`book_id\` TEXT NOT NULL,
  \`section_id\` TEXT NOT NULL,
  \`ord\` INTEGER NOT NULL,
  \`page\` INTEGER,
  \`text\` TEXT NOT NULL,
  \`text_norm\` TEXT NOT NULL,
  \`token_count\` INTEGER NOT NULL,
  FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON DELETE CASCADE,
  FOREIGN KEY (\`section_id\`) REFERENCES \`sections\`(\`id\`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS \`idx_chunks_book_ord\` ON \`chunks\`(\`book_id\`, \`ord\`);
CREATE INDEX IF NOT EXISTS \`idx_chunks_section\` ON \`chunks\`(\`section_id\`);

CREATE VIRTUAL TABLE IF NOT EXISTS \`chunks_fts\` USING fts5(
  \`text_norm\`,
  content='chunks',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS \`chunks_ai\` AFTER INSERT ON \`chunks\` BEGIN
  INSERT INTO \`chunks_fts\`(\`rowid\`, \`text_norm\`) VALUES (new.rowid, new.\`text_norm\`);
END;
CREATE TRIGGER IF NOT EXISTS \`chunks_ad\` AFTER DELETE ON \`chunks\` BEGIN
  INSERT INTO \`chunks_fts\`(\`chunks_fts\`, \`rowid\`, \`text_norm\`) VALUES('delete', old.rowid, old.\`text_norm\`);
END;
CREATE TRIGGER IF NOT EXISTS \`chunks_au\` AFTER UPDATE ON \`chunks\` BEGIN
  INSERT INTO \`chunks_fts\`(\`chunks_fts\`, \`rowid\`, \`text_norm\`) VALUES('delete', old.rowid, old.\`text_norm\`);
  INSERT INTO \`chunks_fts\`(\`rowid\`, \`text_norm\`) VALUES (new.rowid, new.\`text_norm\`);
END;

CREATE TABLE IF NOT EXISTS \`chunk_vecs\` (
  \`chunk_id\` TEXT PRIMARY KEY,
  \`vec\` TEXT NOT NULL,
  FOREIGN KEY (\`chunk_id\`) REFERENCES \`chunks\`(\`id\`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS \`ingest_jobs\` (
  \`id\` TEXT PRIMARY KEY,
  \`book_id\` TEXT NOT NULL,
  \`stage\` TEXT NOT NULL,
  \`status\` TEXT NOT NULL,
  \`progress\` INTEGER NOT NULL DEFAULT 0,
  \`checkpoint_json\` TEXT,
  \`error\` TEXT,
  \`started_at\` INTEGER,
  \`finished_at\` INTEGER,
  FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS \`book_notes\` (
  \`id\` TEXT PRIMARY KEY,
  \`book_id\` TEXT NOT NULL,
  \`source_hash\` TEXT NOT NULL,
  \`kind\` TEXT NOT NULL,
  \`text\` TEXT NOT NULL,
  \`citations_json\` TEXT NOT NULL,
  \`embedding\` TEXT,
  \`source_session_id\` TEXT,
  \`stale\` INTEGER NOT NULL DEFAULT 0,
  \`created_at\` INTEGER NOT NULL,
  \`updated_at\` INTEGER NOT NULL,
  FOREIGN KEY (\`book_id\`) REFERENCES \`books\`(\`id\`) ON DELETE CASCADE
);
`
