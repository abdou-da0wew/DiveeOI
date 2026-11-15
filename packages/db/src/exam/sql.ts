import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import { SessionTable } from "../session/sql"

export const ExamTable = sqliteTable(
  "diveeoi_exam",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    spec_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    secret_ciphertext: text().notNull(),
    secret_iv: text().notNull(),
    secret_auth_tag: text().notNull(),
    grading_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    adaptive_difficulty: integer().notNull().default(3),
    attempts_allowed: integer().notNull().default(1),
    ...Timestamps,
  },
  (table) => [index("diveeoi_exam_session_idx").on(table.session_id, table.time_created)],
)

export const ExamAttemptTable = sqliteTable(
  "diveeoi_exam_attempt",
  {
    id: text().primaryKey(),
    exam_id: text()
      .notNull()
      .references(() => ExamTable.id, { onDelete: "cascade" }),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    attempt_number: integer().notNull(),
    difficulty: integer().notNull().default(3),
    answers_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    interaction_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
    grade_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    score: real().notNull().default(0),
    max_score: real().notNull().default(0),
    percentage: real(),
    needs_review: integer().notNull().default(0),
    elapsed_ms: integer().notNull().default(0),
    submitted_at: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("diveeoi_exam_attempt_number_idx").on(table.exam_id, table.attempt_number),
    index("diveeoi_exam_attempt_session_idx").on(table.session_id, table.submitted_at),
  ],
)
