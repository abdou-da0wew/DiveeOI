export * as ConfigTargetedLearningV1 from "./targeted-learning"

import { Schema } from "effect"

/**
 * Targeted Learning config schema — the minimal version that lives in
 * @diveeoi/db so the DiveeOI config file accepts the `targetedLearning`
 * key. The full settings schema with UI annotations (label, help, group,
 * applies mode, danger flag) lives in @diveeoi/learning/settings, which
 * re-exports this and adds the annotations the UI form generator reads.
 *
 * Keeping the bare schema here avoids a circular dependency:
 * @diveeoi/learning depends on @diveeoi/db (for Global, Database, etc.),
 * so @diveeoi/db cannot depend on @diveeoi/learning. The @diveeoi/learning
 * package is the single source of truth for the FULL schema; this file is
 * just the validated config-file shape.
 */
export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Master switch. When off, the feature is hidden from the composer and settings.",
  }),
  dataDir: Schema.optional(Schema.String).annotate({
    description: "Where the model, books, books.db and setup.json live. Defaults to <dataDir>/targeted-learning.",
  }),
  maxBookSizeMB: Schema.optional(Schema.Number).annotate({ description: "Upload size cap in MB." }),
  keepSourceFiles: Schema.optional(Schema.Boolean).annotate({
    description: "Keep uploaded PDFs/DOCX/TXTs in books/ for re-indexing.",
  }),

  download: Schema.optional(
    Schema.Struct({
      endpoint: Schema.optional(Schema.String),
      maxConcurrent: Schema.optional(Schema.Number),
      retries: Schema.optional(Schema.Number),
      stallTimeoutSec: Schema.optional(Schema.Number),
      verifyOnBoot: Schema.optional(Schema.Literals(["size", "sha256"])),
    }),
  ),
  embedding: Schema.optional(
    Schema.Struct({
      dtype: Schema.optional(Schema.Literals(["int8", "q4f16", "fp16", "fp32"])),
      device: Schema.optional(Schema.Literals(["auto", "cpu", "wasm"])),
      maxLength: Schema.optional(Schema.Number),
      batchSize: Schema.optional(Schema.Number),
      intraOpThreads: Schema.optional(Schema.Union([Schema.Literal("auto"), Schema.String])),
      interOpThreads: Schema.optional(Schema.Number),
      idleUnloadSec: Schema.optional(Schema.Number),
      modelRevision: Schema.optional(Schema.String),
    }),
  ),
  chunking: Schema.optional(
    Schema.Struct({
      childTargetTokens: Schema.optional(Schema.Number),
      childMaxTokens: Schema.optional(Schema.Number),
      childOverlapTokens: Schema.optional(Schema.Number),
      minChunkTokens: Schema.optional(Schema.Number),
      parentMaxTokens: Schema.optional(Schema.Number),
      prependHeadingPath: Schema.optional(Schema.Boolean),
      stripHeadersFooters: Schema.optional(Schema.Boolean),
    }),
  ),
  indexing: Schema.optional(
    Schema.Struct({
      workersPerBook: Schema.optional(Schema.Number),
      maxWorkers: Schema.optional(Schema.Union([Schema.Literal("auto"), Schema.String])),
      maxConcurrentBooks: Schema.optional(Schema.Number),
      pauseWhileChatting: Schema.optional(Schema.Boolean),
      cpuPriority: Schema.optional(Schema.Literals(["low", "normal", "high"])),
      maxMemoryMB: Schema.optional(Schema.Union([Schema.Literal("auto"), Schema.String])),
      checkpointEveryBatches: Schema.optional(Schema.Number),
    }),
  ),
  ocr: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      languages: Schema.optional(Schema.String),
      dpi: Schema.optional(Schema.Number),
    }),
  ),
  retrieval: Schema.optional(
    Schema.Struct({
      bm25TopK: Schema.optional(Schema.Number),
      denseTopK: Schema.optional(Schema.Number),
      rrfK: Schema.optional(Schema.Number),
      weightBm25: Schema.optional(Schema.Number),
      weightDense: Schema.optional(Schema.Number),
      autoWeightByLanguage: Schema.optional(Schema.Boolean),
      finalTopK: Schema.optional(Schema.Number),
      parentExpansion: Schema.optional(Schema.Boolean),
      parentContextMaxTokens: Schema.optional(Schema.Number),
      queryRewrite: Schema.optional(Schema.Literals(["heuristic", "llm", "off"])),
      rewriteTurns: Schema.optional(Schema.Number),
      vectorBackend: Schema.optional(Schema.Literals(["bruteforce", "sqlite-vec"])),
      vectorCacheMB: Schema.optional(Schema.Number),
    }),
  ),
  gate: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      minDenseScore: Schema.optional(Schema.Number),
      minFusedScore: Schema.optional(Schema.Number),
      allowSmallTalk: Schema.optional(Schema.Boolean),
      refusalMessages: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
  grounding: Schema.optional(
    Schema.Struct({
      verify: Schema.optional(Schema.Literals(["off", "flag", "retry"])),
      requireCitations: Schema.optional(Schema.Boolean),
      maxContextTokens: Schema.optional(Schema.Number),
      allowCalculator: Schema.optional(Schema.Boolean),
      answerLanguage: Schema.optional(Schema.Literals(["auto", "ar", "en"])),
    }),
  ),
  memory: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean),
      studentBudgetTokens: Schema.optional(Schema.Number),
      bookNotesTopK: Schema.optional(Schema.Number),
      bookNotesBudgetTokens: Schema.optional(Schema.Number),
      maxStudentMemories: Schema.optional(Schema.Number),
      maxBookNotesPerBook: Schema.optional(Schema.Number),
      dedupeSimilarity: Schema.optional(Schema.Number),
      autoWrite: Schema.optional(Schema.Literals(["auto", "ask"])),
      requireNoteCitations: Schema.optional(Schema.Boolean),
    }),
  ),
  language: Schema.optional(
    Schema.Struct({
      normalizeAlef: Schema.optional(Schema.Boolean),
      normalizeYa: Schema.optional(Schema.Boolean),
      normalizeTaMarbuta: Schema.optional(Schema.Boolean),
      stripDiacritics: Schema.optional(Schema.Boolean),
      stripTatweel: Schema.optional(Schema.Boolean),
      nfkc: Schema.optional(Schema.Boolean),
      fixReversedRuns: Schema.optional(Schema.Literals(["auto", "on", "off"])),
      lightStemming: Schema.optional(Schema.Boolean),
    }),
  ),
  summaries: Schema.optional(
    Schema.Struct({
      mode: Schema.optional(Schema.Literals(["extractive", "llm"])),
      llmModel: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "ConfigTargetedLearning" })
export type Info = Schema.Schema.Type<typeof Info>
