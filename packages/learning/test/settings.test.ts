// packages/learning/test/settings.test.ts
//
// Unit tests for the settings schema (plan §11.4). Verifies the schema
// accepts valid configs, rejects invalid ones, and that defaults merge
// correctly.

import { expect, test, describe } from "bun:test"
import { Schema } from "effect"
import { Info, CONFIG_KEY } from "../src/settings/schema"
import { DEFAULTS, withDefaults, PRESETS } from "../src/settings/defaults"

describe("settings schema", () => {
  test("CONFIG_KEY is 'targetedLearning'", () => {
    expect(CONFIG_KEY).toBe("targetedLearning")
  })

  test("accepts an empty object (all fields optional)", () => {
    const result = Schema.decodeUnknownSync(Info)({})
    expect(result).toBeDefined()
  })

  test("accepts a fully-populated config", () => {
    const config = {
      enabled: true,
      dataDir: "/tmp/tl",
      maxBookSizeMB: 200,
      keepSourceFiles: true,
      download: { endpoint: "huggingface.co", maxConcurrent: 1, retries: 6, stallTimeoutSec: 30, verifyOnBoot: "size" },
      embedding: { dtype: "int8", device: "auto", maxLength: 512, batchSize: 16, intraOpThreads: "auto", interOpThreads: 1, idleUnloadSec: 300 },
      chunking: { childTargetTokens: 150, childMaxTokens: 220, childOverlapTokens: 20, minChunkTokens: 30, parentMaxTokens: 1200, prependHeadingPath: true, stripHeadersFooters: true },
      indexing: { workersPerBook: 2, maxWorkers: "auto", maxConcurrentBooks: 1, pauseWhileChatting: true, cpuPriority: "low", maxMemoryMB: "auto", checkpointEveryBatches: 1 },
      retrieval: { bm25TopK: 30, denseTopK: 30, rrfK: 60, weightBm25: 1.0, weightDense: 1.0, autoWeightByLanguage: true, finalTopK: 8, parentExpansion: true, parentContextMaxTokens: 2500, queryRewrite: "heuristic", rewriteTurns: 2, vectorBackend: "bruteforce", vectorCacheMB: 256 },
      gate: { enabled: true, minDenseScore: 0.35, minFusedScore: 0.1, allowSmallTalk: true, refusalMessages: { en: "no", ar: "لا" } },
      grounding: { verify: "flag", requireCitations: true, maxContextTokens: 6000, allowCalculator: true, answerLanguage: "auto" },
      memory: { enabled: true, studentBudgetTokens: 600, bookNotesTopK: 5, bookNotesBudgetTokens: 800, maxStudentMemories: 200, maxBookNotesPerBook: 500, dedupeSimilarity: 0.92, autoWrite: "auto", requireNoteCitations: true },
      language: { normalizeAlef: true, normalizeYa: true, normalizeTaMarbuta: true, stripDiacritics: true, stripTatweel: true, nfkc: true, fixReversedRuns: "auto", lightStemming: false },
      summaries: { mode: "extractive", llmModel: "none" },
    }
    const result = Schema.decodeUnknownSync(Info)(config)
    expect(result.embedding?.dtype).toBe("int8")
    expect(result.gate?.refusalMessages?.ar).toBe("لا")
  })

  test("rejects invalid dtype", () => {
    expect(() => Schema.decodeUnknownSync(Info)({ embedding: { dtype: "invalid" } })).toThrow()
  })

  test("rejects invalid verify mode", () => {
    expect(() => Schema.decodeUnknownSync(Info)({ grounding: { verify: "invalid" } })).toThrow()
  })

  test("DEFAULTS has every section populated", () => {
    expect(DEFAULTS.download).toBeDefined()
    expect(DEFAULTS.embedding).toBeDefined()
    expect(DEFAULTS.chunking).toBeDefined()
    expect(DEFAULTS.indexing).toBeDefined()
    expect(DEFAULTS.retrieval).toBeDefined()
    expect(DEFAULTS.gate).toBeDefined()
    expect(DEFAULTS.grounding).toBeDefined()
    expect(DEFAULTS.memory).toBeDefined()
    expect(DEFAULTS.language).toBeDefined()
    expect(DEFAULTS.summaries).toBeDefined()
  })

  test("DEFAULTS has Arabic + English refusal messages", () => {
    const gate = DEFAULTS.gate as { refusalMessages: Record<string, string> }
    expect(gate.refusalMessages.en).toBeTruthy()
    expect(gate.refusalMessages.ar).toBeTruthy()
  })

  test("withDefaults returns DEFAULTS when user is undefined", () => {
    const result = withDefaults(undefined)
    expect(result.enabled).toBe(true)
  })

  test("withDefaults merges user values onto defaults", () => {
    const result = withDefaults({ enabled: false, embedding: { dtype: "fp32" } }) as Record<string, unknown>
    expect(result.enabled).toBe(false)
    const embedding = result.embedding as { dtype: string; maxLength: number }
    expect(embedding.dtype).toBe("fp32")
    expect(embedding.maxLength).toBe(512) // from defaults
  })

  test("withDefaults does not overwrite with undefined", () => {
    const result = withDefaults({ enabled: undefined }) as Record<string, unknown>
    expect(result.enabled).toBe(true) // from defaults
  })

  test("PRESETS has low, balanced, high", () => {
    expect(PRESETS.low).toBeDefined()
    expect(PRESETS.balanced).toBeDefined()
    expect(PRESETS.high).toBeDefined()
  })

  test("PRESETS.high uses fp32 dtype", () => {
    const high = PRESETS.high as { embedding: { dtype: string } }
    expect(high.embedding.dtype).toBe("fp32")
  })

  test("PRESETS.low uses int8 dtype and 1 worker", () => {
    const low = PRESETS.low as { embedding: { dtype: string }; indexing: { workersPerBook: number } }
    expect(low.embedding.dtype).toBe("int8")
    expect(low.indexing.workersPerBook).toBe(1)
  })
})
