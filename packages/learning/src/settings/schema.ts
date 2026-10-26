// packages/learning/src/settings/schema.ts
//
// Targeted Learning settings — the single Effect Schema that drives
// config-file validation, the settings REST endpoints, and the UI form
// fields in both v1 and v2 layouts (plan §11.1).
//
// Every parameter from plan §11.4 lives here, with annotations the UI can
// read directly: label, help text, group, unit, min/max, advanced, danger,
// and an `applies` mode that tells the runtime when a change takes effect
// (live | recycle-workers | reindex | rebuild-fts | restart).
//
// DO NOT add a setting anywhere else — add it here, and the config file,
// the REST API, and the UI all pick it up automatically.

import { Schema } from "effect"

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/**
 * Custom annotation keys read by the UI form generator and by the runtime
 * to decide when a value change takes effect.
 */
export const SettingAnnotations = {
  /** Human-readable label shown above the field. */
  label: "@diveeoi/learning/label",
  /** One-line help text shown under the field. */
  help: "@diveeoi/learning/help",
  /** Settings group the field belongs to (Setup, Library, Embedding, ...). */
  group: "@diveeoi/learning/group",
  /** Unit suffix (ms, MB, tokens, ...). */
  unit: "@diveeoi/learning/unit",
  /** Numeric minimum. */
  min: "@diveeoi/learning/min",
  /** Numeric maximum. */
  max: "@diveeoi/learning/max",
  /** When a change to this field takes effect. */
  applies: "@diveeoi/learning/applies",
  /** Field is collapsed under "Advanced". */
  advanced: "@diveeoi/learning/advanced",
  /** Field is in the "Danger zone" and needs confirmation. */
  danger: "@diveeoi/learning/danger",
  /** Field is read-only (computed, not user-set). */
  readOnly: "@diveeoi/learning/readOnly",
} as const

export type AppliesMode = "live" | "recycle-workers" | "reindex" | "rebuild-fts" | "restart"

/**
 * Helper: tag a schema with the standard Targeted Learning annotations.
 * Use via `.annotate(annotations({ ... }))`.
 */
export const annotations = (opts: {
  label: string
  help?: string
  group: Group
  unit?: string
  min?: number
  max?: number
  applies: AppliesMode
  advanced?: boolean
  danger?: boolean
  readOnly?: boolean
}) => {
  const out: Record<string, unknown> = {
    [SettingAnnotations.label]: opts.label,
    [SettingAnnotations.group]: opts.group,
    [SettingAnnotations.applies]: opts.applies,
    description: opts.help ?? opts.label,
  }
  if (opts.help !== undefined) out[SettingAnnotations.help] = opts.help
  if (opts.unit !== undefined) out[SettingAnnotations.unit] = opts.unit
  if (opts.min !== undefined) out[SettingAnnotations.min] = opts.min
  if (opts.max !== undefined) out[SettingAnnotations.max] = opts.max
  if (opts.advanced) out[SettingAnnotations.advanced] = true
  if (opts.danger) out[SettingAnnotations.danger] = true
  if (opts.readOnly) out[SettingAnnotations.readOnly] = true
  return out
}

// ---------------------------------------------------------------------------
// Settings groups (UI section ordering, plan §11.5)
// ---------------------------------------------------------------------------

export const Group = Schema.Literals([
  "setup",
  "library",
  "memory",
  "embedding",
  "chunking",
  "indexing",
  "retrieval",
  "grounding",
  "resources",
  "language",
  "advanced",
])
export type Group = Schema.Schema.Type<typeof Group>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Boolean_ = (opts: Parameters<typeof annotations>[0] & { default?: boolean }) =>
  Schema.optional(Schema.Boolean).annotate(annotations(opts))

const Number_ = (opts: Parameters<typeof annotations>[0] & { default?: number }) =>
  Schema.optional(Schema.Number).annotate(annotations(opts))

const PositiveInt_ = (opts: Parameters<typeof annotations>[0] & { default?: number }) =>
  Schema.optional(Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0)))).annotate(annotations(opts))

const String_ = (opts: Parameters<typeof annotations>[0] & { default?: string }) =>
  Schema.optional(Schema.String).annotate(annotations(opts))

const Literals_ = <const Opts extends readonly string[]>(
  values: Opts,
  opts: Parameters<typeof annotations>[0] & { default?: Opts[number] },
) => Schema.optional(Schema.Literals(values)).annotate(annotations(opts))

// ---------------------------------------------------------------------------
// Sub-schemas (one per settings group)
// ---------------------------------------------------------------------------

export const DownloadSettings = Schema.Struct({
  endpoint: String_({
    label: "Download endpoint",
    help: "Hugging Face endpoint or a mirror. Defaults to huggingface.co.",
    group: "setup",
    applies: "live",
    default: "huggingface.co",
  }),
  maxConcurrent: PositiveInt_({
    label: "Max concurrent downloads",
    help: "Files download one at a time by default. Raise only on fast links.",
    group: "setup",
    unit: "files",
    min: 1,
    max: 4,
    applies: "live",
    default: 1,
  }),
  retries: PositiveInt_({
    label: "Retries per file",
    help: "Retry count for network errors, 429 and 5xx.",
    group: "setup",
    min: 0,
    max: 20,
    applies: "live",
    default: 6,
  }),
  stallTimeoutSec: PositiveInt_({
    label: "Stall timeout",
    help: "Abort a download if no bytes arrive for this many seconds.",
    group: "setup",
    unit: "sec",
    min: 5,
    max: 600,
    applies: "live",
    default: 30,
  }),
  verifyOnBoot: Literals_(["size", "sha256"] as const, {
    label: "Verify on boot",
    help: "Quick size check on every boot, or full sha256 (slower).",
    group: "setup",
    applies: "live",
    default: "size",
  }),
}).annotate({ description: "Model download pipeline settings" })

export const EmbeddingSettings = Schema.Struct({
  dtype: Literals_(["int8", "q4f16", "fp16", "fp32"] as const, {
    label: "Quantization dtype",
    help: "int8 (568 MB) is the default. fp32 is the quality reference. Others are optional.",
    group: "embedding",
    applies: "reindex",
    default: "int8",
    danger: true,
  }),
  device: Literals_(["auto", "cpu", "wasm"] as const, {
    label: "Device",
    help: "auto picks the best available backend; wasm is the always-works fallback.",
    group: "embedding",
    applies: "recycle-workers",
    default: "auto",
  }),
  maxLength: PositiveInt_({
    label: "Max sequence length",
    help: "bge-m3 max tokens per chunk. Higher = more context, more memory.",
    group: "embedding",
    unit: "tokens",
    min: 128,
    max: 2048,
    applies: "reindex",
    default: 512,
  }),
  batchSize: PositiveInt_({
    label: "Batch size",
    help: "Embedding batches per worker call.",
    group: "embedding",
    unit: "chunks",
    min: 1,
    max: 64,
    applies: "recycle-workers",
    default: 16,
  }),
  intraOpThreads: Literals_(["auto", "1", "2", "4", "8"] as const, {
    label: "Intra-op threads",
    help: "ONNX intra-op parallelism. auto = cores/2.",
    group: "embedding",
    applies: "recycle-workers",
    default: "auto",
    advanced: true,
  }),
  interOpThreads: PositiveInt_({
    label: "Inter-op threads",
    help: "ONNX inter-op parallelism.",
    group: "embedding",
    min: 1,
    max: 8,
    applies: "recycle-workers",
    default: 1,
    advanced: true,
  }),
  idleUnloadSec: PositiveInt_({
    label: "Idle unload",
    help: "Workers unload the model after this many seconds idle.",
    group: "embedding",
    unit: "sec",
    min: 0,
    max: 3600,
    applies: "live",
    default: 300,
  }),
  modelRevision: String_({
    label: "Model revision (commit SHA)",
    help: "Pinned Hugging Face commit SHA. Changing this requires re-embedding every book.",
    group: "embedding",
    applies: "reindex",
    danger: true,
  }),
}).annotate({ description: "Embedding model and runtime settings" })

export const ChunkingSettings = Schema.Struct({
  childTargetTokens: PositiveInt_({
    label: "Child target tokens",
    help: "Target size for child chunks that get embedded.",
    group: "chunking",
    unit: "tokens",
    min: 50,
    max: 500,
    applies: "reindex",
    default: 150,
  }),
  childMaxTokens: PositiveInt_({
    label: "Child max tokens",
    help: "Hard cap on child chunk size.",
    group: "chunking",
    unit: "tokens",
    min: 80,
    max: 1024,
    applies: "reindex",
    default: 220,
  }),
  childOverlapTokens: PositiveInt_({
    label: "Child overlap tokens",
    help: "Overlap between consecutive child chunks.",
    group: "chunking",
    unit: "tokens",
    min: 0,
    max: 100,
    applies: "reindex",
    default: 20,
  }),
  minChunkTokens: PositiveInt_({
    label: "Min chunk tokens",
    help: "Chunks smaller than this are merged into neighbours.",
    group: "chunking",
    unit: "tokens",
    min: 5,
    max: 100,
    applies: "reindex",
    default: 30,
  }),
  parentMaxTokens: PositiveInt_({
    label: "Parent max tokens",
    help: "Hard cap on parent (section) size. Parents larger than this split with overlap.",
    group: "chunking",
    unit: "tokens",
    min: 400,
    max: 8000,
    applies: "reindex",
    default: 1200,
  }),
  prependHeadingPath: Boolean_({
    label: "Prepend heading path",
    help: "Embed 'Chapter 3 > Section 2 > ...' before chunk text.",
    group: "chunking",
    applies: "reindex",
    default: true,
  }),
  stripHeadersFooters: Boolean_({
    label: "Strip headers / footers",
    help: "Remove repeated page headers and footers before chunking.",
    group: "chunking",
    applies: "reindex",
    default: true,
  }),
}).annotate({ description: "Chunking strategy settings" })

export const IndexingSettings = Schema.Struct({
  workersPerBook: PositiveInt_({
    label: "Workers per book",
    help: "Bun Workers spawned per book during indexing.",
    group: "indexing",
    unit: "workers",
    min: 1,
    max: 4,
    applies: "recycle-workers",
    default: 2,
  }),
  maxWorkers: Literals_(["auto", "1", "2", "3", "4", "6", "8"] as const, {
    label: "Max workers (global)",
    help: "Global worker cap across all books. auto = min(cores/2, 4).",
    group: "indexing",
    applies: "recycle-workers",
    default: "auto",
  }),
  maxConcurrentBooks: PositiveInt_({
    label: "Max concurrent books",
    help: "Books indexed in parallel.",
    group: "indexing",
    min: 1,
    max: 4,
    applies: "live",
    default: 1,
  }),
  pauseWhileChatting: Boolean_({
    label: "Pause while chatting",
    help: "Pause indexing fibers while a session is streaming.",
    group: "indexing",
    applies: "live",
    default: true,
  }),
  cpuPriority: Literals_(["low", "normal", "high"] as const, {
    label: "CPU priority",
    help: "Worker niceness. low keeps the chat responsive.",
    group: "indexing",
    applies: "recycle-workers",
    default: "low",
  }),
  maxMemoryMB: Literals_(["auto", "512", "1024", "2048", "4096"] as const, {
    label: "Max memory",
    help: "Soft per-process memory cap. auto = RAM/4.",
    group: "indexing",
    unit: "MB",
    applies: "live",
    default: "auto",
  }),
  checkpointEveryBatches: PositiveInt_({
    label: "Checkpoint every batches",
    help: "Persist ingest progress after this many embedding batches.",
    group: "indexing",
    min: 1,
    max: 50,
    applies: "live",
    default: 1,
  }),
}).annotate({ description: "Indexing worker pool settings" })

export const OcrSettings = Schema.Struct({
  enabled: Boolean_({
    label: "Enable OCR",
    help: "OCR scanned pages. Requires the optional OCR pack.",
    group: "indexing",
    applies: "live",
    default: false,
    advanced: true,
  }),
  languages: String_({
    label: "OCR languages",
    help: "Tesseract language codes, plus-separated (ara+eng).",
    group: "indexing",
    applies: "live",
    default: "ara+eng",
    advanced: true,
  }),
  dpi: PositiveInt_({
    label: "OCR DPI",
    help: "Render DPI for OCR.",
    group: "indexing",
    unit: "dpi",
    min: 100,
    max: 600,
    applies: "reindex",
    default: 200,
    advanced: true,
  }),
}).annotate({ description: "OCR settings (optional pack)" })

export const RetrievalSettings = Schema.Struct({
  bm25TopK: PositiveInt_({
    label: "BM25 top-K",
    help: "Candidate count from lexical search before fusion.",
    group: "retrieval",
    min: 5,
    max: 100,
    applies: "live",
    default: 30,
  }),
  denseTopK: PositiveInt_({
    label: "Dense top-K",
    help: "Candidate count from vector search before fusion.",
    group: "retrieval",
    min: 5,
    max: 100,
    applies: "live",
    default: 30,
  }),
  rrfK: PositiveInt_({
    label: "RRF k",
    help: "Reciprocal Rank Fusion constant.",
    group: "retrieval",
    min: 1,
    max: 200,
    applies: "live",
    default: 60,
    advanced: true,
  }),
  weightBm25: Number_({
    label: "BM25 weight",
    help: "RRF weight for the lexical list.",
    group: "retrieval",
    min: 0,
    max: 5,
    applies: "live",
    default: 1.0,
    advanced: true,
  }),
  weightDense: Number_({
    label: "Dense weight",
    help: "RRF weight for the dense list.",
    group: "retrieval",
    min: 0,
    max: 5,
    applies: "live",
    default: 1.0,
    advanced: true,
  }),
  autoWeightByLanguage: Boolean_({
    label: "Auto-weight by language",
    help: "Raise dense weight when the query language differs from the book's.",
    group: "retrieval",
    applies: "live",
    default: true,
  }),
  finalTopK: PositiveInt_({
    label: "Final top-K",
    help: "Chunks sent to the LLM after fusion and parent expansion.",
    group: "retrieval",
    min: 1,
    max: 30,
    applies: "live",
    default: 8,
  }),
  parentExpansion: Boolean_({
    label: "Parent expansion",
    help: "Expand child hits to their parent sections.",
    group: "retrieval",
    applies: "live",
    default: true,
  }),
  parentContextMaxTokens: PositiveInt_({
    label: "Parent context budget",
    help: "Token cap on the expanded parent context window.",
    group: "retrieval",
    unit: "tokens",
    min: 500,
    max: 16000,
    applies: "live",
    default: 2500,
  }),
  queryRewrite: Literals_(["heuristic", "llm", "off"] as const, {
    label: "Query rewrite",
    help: "heuristic folds key terms from the last turn (no LLM). llm asks the model. off disables.",
    group: "retrieval",
    applies: "live",
    default: "heuristic",
  }),
  rewriteTurns: PositiveInt_({
    label: "Rewrite turns",
    help: "How many recent turns the rewriter can see.",
    group: "retrieval",
    min: 1,
    max: 10,
    applies: "live",
    default: 2,
    advanced: true,
  }),
  vectorBackend: Literals_(["bruteforce", "sqlite-vec"] as const, {
    label: "Vector backend",
    help: "bruteforce = in-memory Float32 matrices. sqlite-vec is an optional later backend.",
    group: "retrieval",
    applies: "restart",
    default: "bruteforce",
    advanced: true,
  }),
  vectorCacheMB: PositiveInt_({
    label: "Vector cache",
    help: "Per-process LRU cache for loaded book vector matrices.",
    group: "retrieval",
    unit: "MB",
    min: 32,
    max: 4096,
    applies: "live",
    default: 256,
  }),
}).annotate({ description: "Hybrid retrieval settings" })

export const GateSettings = Schema.Struct({
  enabled: Boolean_({
    label: "Enable retrieval gate",
    help: "Refuse off-topic questions before they reach the LLM. Disabling is dangerous.",
    group: "grounding",
    applies: "live",
    default: true,
    danger: true,
  }),
  minDenseScore: Number_({
    label: "Min dense score",
    help: "Below this cosine, the gate refuses. Calibrated by the eval harness.",
    group: "grounding",
    min: 0,
    max: 1,
    applies: "live",
    default: 0.35,
    advanced: true,
  }),
  minFusedScore: Number_({
    label: "Min fused score",
    help: "Below this RRF score, the gate refuses.",
    group: "grounding",
    min: 0,
    max: 1,
    applies: "live",
    default: 0.1,
    advanced: true,
  }),
  allowSmallTalk: Boolean_({
    label: "Allow small talk",
    help: "Bypass the gate for greetings and meta questions about the session.",
    group: "grounding",
    applies: "live",
    default: true,
  }),
  refusalMessages: Schema.optional(
    Schema.Record(Schema.String, Schema.String),
  ).annotate({
    description: "Per-language refusal messages. Keys are BCP-47 language codes.",
  }),
}).annotate({ description: "Retrieval gate settings" })

export const GroundingSettings = Schema.Struct({
  verify: Literals_(["off", "flag", "retry"] as const, {
    label: "Verification mode",
    help: "off = no checks. flag = mark unverified claims. retry = re-ask once with the failures listed (buffered only).",
    group: "grounding",
    applies: "live",
    default: "flag",
  }),
  requireCitations: Boolean_({
    label: "Require citations",
    help: "Every factual claim must cite a retrieved chunk.",
    group: "grounding",
    applies: "live",
    default: true,
  }),
  maxContextTokens: PositiveInt_({
    label: "Max context tokens",
    help: "Token budget for the injected book context.",
    group: "grounding",
    unit: "tokens",
    min: 1000,
    max: 32000,
    applies: "live",
    default: 6000,
  }),
  allowCalculator: Boolean_({
    label: "Allow calculator",
    help: "Computation is not knowledge. A calculator tool is allowed in targeted sessions.",
    group: "grounding",
    applies: "live",
    default: true,
  }),
  answerLanguage: Literals_(["auto", "ar", "en"] as const, {
    label: "Answer language",
    help: "auto = follow the student's language. Quotes stay in the book's language.",
    group: "grounding",
    applies: "live",
    default: "auto",
  }),
}).annotate({ description: "Grounding and citation settings" })

export const StudentMemorySettings = Schema.Struct({
  enabled: Boolean_({
    label: "Enable student memory",
    help: "Persistent learner profile across sessions.",
    group: "memory",
    applies: "live",
    default: true,
  }),
  studentBudgetTokens: PositiveInt_({
    label: "Student memory budget",
    help: "Token budget for injected student profile memories.",
    group: "memory",
    unit: "tokens",
    min: 0,
    max: 4000,
    applies: "live",
    default: 600,
  }),
  bookNotesTopK: PositiveInt_({
    label: "Book notes top-K",
    help: "Top-K most relevant book notes injected per turn.",
    group: "memory",
    min: 0,
    max: 20,
    applies: "live",
    default: 5,
  }),
  bookNotesBudgetTokens: PositiveInt_({
    label: "Book notes budget",
    help: "Token budget for injected book notes.",
    group: "memory",
    unit: "tokens",
    min: 0,
    max: 8000,
    applies: "live",
    default: 800,
  }),
  maxStudentMemories: PositiveInt_({
    label: "Max student memories",
    help: "Per-instance cap on student memories.",
    group: "memory",
    min: 10,
    max: 1000,
    applies: "live",
    default: 200,
  }),
  maxBookNotesPerBook: PositiveInt_({
    label: "Max book notes per book",
    help: "Per-book cap on book notes.",
    group: "memory",
    min: 10,
    max: 2000,
    applies: "live",
    default: 500,
  }),
  dedupeSimilarity: Number_({
    label: "Dedupe similarity",
    help: "Cosine above this is treated as a duplicate when writing.",
    group: "memory",
    min: 0.5,
    max: 1,
    applies: "live",
    default: 0.92,
    advanced: true,
  }),
  autoWrite: Literals_(["auto", "ask"] as const, {
    label: "Auto-write",
    help: "auto = write learner-attribute memories silently. ask = prompt the student.",
    group: "memory",
    applies: "live",
    default: "auto",
  }),
  requireNoteCitations: Boolean_({
    label: "Require note citations",
    help: "A book note must carry at least one citation that resolves to a real chunk. Disabling is dangerous.",
    group: "memory",
    applies: "live",
    default: true,
    danger: true,
  }),
}).annotate({ description: "Student memory and book notes settings" })

export const LanguageSettings = Schema.Struct({
  normalizeAlef: Boolean_({
    label: "Normalize alef variants",
    help: "Unify أ إ آ ا to ا in normalized text.",
    group: "language",
    applies: "rebuild-fts",
    default: true,
  }),
  normalizeYa: Boolean_({
    label: "Normalize ya",
    help: "Unify ي ى to ي.",
    group: "language",
    applies: "rebuild-fts",
    default: true,
  }),
  normalizeTaMarbuta: Boolean_({
    label: "Normalize ta marbuta",
    help: "Unify ة to ه in normalized text.",
    group: "language",
    applies: "rebuild-fts",
    default: true,
  }),
  stripDiacritics: Boolean_({
    label: "Strip diacritics",
    help: "Drop fatha, kasra, damma, sukun, shadda, tanwin from normalized text.",
    group: "language",
    applies: "rebuild-fts",
    default: true,
  }),
  stripTatweel: Boolean_({
    label: "Strip tatweel",
    help: "Drop the tatweel elongation character.",
    group: "language",
    applies: "rebuild-fts",
    default: true,
  }),
  nfkc: Boolean_({
    label: "NFKC fold",
    help: "Fold presentation-form letters to their canonical form.",
    group: "language",
    applies: "rebuild-fts",
    default: true,
  }),
  fixReversedRuns: Literals_(["auto", "on", "off"] as const, {
    label: "Fix reversed runs",
    help: "Detect and repair reversed or disconnected Arabic runs.",
    group: "language",
    applies: "reindex",
    default: "auto",
  }),
  lightStemming: Boolean_({
    label: "Light stemming",
    help: "Apply light Arabic stemming to normalized text. Off by default.",
    group: "language",
    applies: "rebuild-fts",
    default: false,
    advanced: true,
  }),
}).annotate({ description: "Arabic / English text normalization settings" })

export const SummariesSettings = Schema.Struct({
  mode: Literals_(["extractive", "llm"] as const, {
    label: "Summary mode",
    help: "extractive = outline + top terms + intro excerpt. llm = ask a small model.",
    group: "library",
    applies: "live",
    default: "extractive",
  }),
  llmModel: String_({
    label: "LLM model",
    help: "provider/model for LLM summaries. none disables the LLM path.",
    group: "library",
    applies: "live",
    default: "none",
    advanced: true,
  }),
}).annotate({ description: "Book summary settings" })

// ---------------------------------------------------------------------------
// Top-level schema
// ---------------------------------------------------------------------------

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate(
    annotations({
      label: "Enable Targeted Learning",
      help: "Master switch. When off, the feature is hidden from the composer and settings.",
      group: "setup",
      applies: "live",
    }),
  ),
  dataDir: Schema.optional(Schema.String).annotate(
    annotations({
      label: "Data directory",
      help: "Where the model, books, books.db and setup.json live. Defaults to <dataDir>/targeted-learning.",
      group: "advanced",
      applies: "restart",
      advanced: true,
    }),
  ),
  maxBookSizeMB: PositiveInt_({
    label: "Max book size",
    help: "Upload size cap.",
    group: "library",
    unit: "MB",
    min: 10,
    max: 1024,
    applies: "live",
    default: 200,
  }),
  keepSourceFiles: Boolean_({
    label: "Keep source files",
    help: "Keep uploaded PDFs/DOCX/TXTs in books/ for re-indexing. Disable to save disk.",
    group: "library",
    applies: "live",
    default: true,
  }),

  download: Schema.optional(DownloadSettings).annotate({ description: "Download pipeline" }),
  embedding: Schema.optional(EmbeddingSettings).annotate({ description: "Embedding model" }),
  chunking: Schema.optional(ChunkingSettings).annotate({ description: "Chunking" }),
  indexing: Schema.optional(IndexingSettings).annotate({ description: "Indexing" }),
  ocr: Schema.optional(OcrSettings).annotate({ description: "OCR (optional)" }),
  retrieval: Schema.optional(RetrievalSettings).annotate({ description: "Retrieval" }),
  gate: Schema.optional(GateSettings).annotate({ description: "Retrieval gate" }),
  grounding: Schema.optional(GroundingSettings).annotate({ description: "Grounding" }),
  memory: Schema.optional(StudentMemorySettings).annotate({ description: "Student memory" }),
  language: Schema.optional(LanguageSettings).annotate({ description: "Text normalization" }),
  summaries: Schema.optional(SummariesSettings).annotate({ description: "Book summaries" }),
}).annotate({
  title: "Targeted Learning",
  description: "Self-hosted, book-grounded learning sessions (RAGed-Session).",
  identifier: "ConfigTargetedLearning",
})

export type Info = Schema.Schema.Type<typeof Info>

/**
 * The JSON key under which this entire schema sits in the DiveeOI config file.
 */
export const CONFIG_KEY = "targetedLearning" as const
