// packages/learning/src/settings/defaults.ts
//
// Default values for every Targeted Learning setting. These are the same
// values baked into the schema in schema.ts; this file exists so the
// runtime can ask "what's the default for X?" without instantiating the
// schema. It is also the source of truth for `tl:config reset`.
//
// We deliberately use a loose record type here: the Effect Schema's
// inferred type marks every field as `optional` (because they're all
// `Schema.optional(...)`), but the defaults object is a fully-populated
// tree. The runtime's `withDefaults()` function does the merge and the
// schema validation handles the type-checking at the boundary.

export type SettingsTree = Record<string, unknown>

export const DEFAULTS: SettingsTree = {
  enabled: true,
  dataDir: undefined, // resolved at runtime from Global.Path.data
  maxBookSizeMB: 200,
  keepSourceFiles: true,

  download: {
    endpoint: "huggingface.co",
    maxConcurrent: 1,
    retries: 6,
    stallTimeoutSec: 30,
    verifyOnBoot: "size",
  },

  embedding: {
    dtype: "int8",
    device: "auto",
    maxLength: 512,
    batchSize: 16,
    intraOpThreads: "auto",
    interOpThreads: 1,
    idleUnloadSec: 300,
    modelRevision: undefined, // pinned by manifest generator
  },

  chunking: {
    childTargetTokens: 150,
    childMaxTokens: 220,
    childOverlapTokens: 20,
    minChunkTokens: 30,
    parentMaxTokens: 1200,
    prependHeadingPath: true,
    stripHeadersFooters: true,
  },

  indexing: {
    workersPerBook: 2,
    maxWorkers: "auto",
    maxConcurrentBooks: 1,
    pauseWhileChatting: true,
    cpuPriority: "low",
    maxMemoryMB: "auto",
    checkpointEveryBatches: 1,
  },

  ocr: {
    enabled: false,
    languages: "ara+eng",
    dpi: 200,
  },

  retrieval: {
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
    vectorBackend: "bruteforce",
    vectorCacheMB: 256,
  },

  gate: {
    enabled: true,
    minDenseScore: 0.35,
    minFusedScore: 0.1,
    allowSmallTalk: true,
    refusalMessages: {
      en: "This isn't covered in the selected book(s).",
      ar: "هذا الموضوع غير موجود في الكتاب أو الكتب المحددة.",
    },
  },

  grounding: {
    verify: "flag",
    requireCitations: true,
    maxContextTokens: 6000,
    allowCalculator: true,
    answerLanguage: "auto",
  },

  memory: {
    enabled: true,
    studentBudgetTokens: 600,
    bookNotesTopK: 5,
    bookNotesBudgetTokens: 800,
    maxStudentMemories: 200,
    maxBookNotesPerBook: 500,
    dedupeSimilarity: 0.92,
    autoWrite: "auto",
    requireNoteCitations: true,
  },

  language: {
    normalizeAlef: true,
    normalizeYa: true,
    normalizeTaMarbuta: true,
    stripDiacritics: true,
    stripTatweel: true,
    nfkc: true,
    fixReversedRuns: "auto",
    lightStemming: false,
  },

  summaries: {
    mode: "extractive",
    llmModel: "none",
  },
}

/**
 * Deep-merge a user-provided partial config onto the defaults.
 * `undefined` keys are not overwritten.
 */
export function withDefaults(user: SettingsTree | undefined): SettingsTree {
  if (!user) return structuredClone(DEFAULTS)
  // Shallow-per-section merge; the schema is two levels deep at most.
  const out = structuredClone(DEFAULTS) as SettingsTree
  for (const [k, v] of Object.entries(user)) {
    if (v === undefined) continue
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const sectionDefaults = (out[k] ?? {}) as SettingsTree
      out[k] = { ...sectionDefaults, ...(v as SettingsTree) }
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * The three presets surfaced in the UI. Setup writes one of these to the
 * config based on the benchmark; the user can edit afterward.
 */
export const PRESETS: Record<"low" | "balanced" | "high", SettingsTree> = {
  low: {
    embedding: { dtype: "int8", device: "auto", maxLength: 256, batchSize: 8 },
    indexing: { workersPerBook: 1, maxWorkers: "1", pauseWhileChatting: true },
    retrieval: { vectorCacheMB: 64, finalTopK: 5, parentContextMaxTokens: 1500 },
    memory: { studentBudgetTokens: 300, bookNotesBudgetTokens: 400 },
  },
  balanced: {
    // Same as DEFAULTS
  },
  high: {
    embedding: { dtype: "fp32", device: "auto", maxLength: 512, batchSize: 32 },
    indexing: { workersPerBook: 2, maxWorkers: "4", pauseWhileChatting: false },
    retrieval: { vectorCacheMB: 512, finalTopK: 12, parentContextMaxTokens: 4000 },
    memory: { studentBudgetTokens: 1000, bookNotesBudgetTokens: 1200 },
  },
}
