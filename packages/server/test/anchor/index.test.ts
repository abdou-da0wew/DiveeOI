import { afterEach, describe, expect, test } from "bun:test"
import { SessionV1 } from "@diveeoi/db/v1/session"
import { ModelV2 } from "@diveeoi/db/model"
import { ProviderV2 } from "@diveeoi/db/provider"
import { Effect } from "effect"
import { AnchorContentIndex, indexableText } from "@/anchor/content-index"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

// Real SQLite, no mocks: the whole point of this indexer is a specific FTS5 MATCH expression and
// a specific tokenizer workaround, neither of which a stubbed query would exercise.
const it = testEffect(AnchorContentIndex.defaultLayer)

const session = () => SessionID.make("ses_test_index")

const message = (id: string, text: string): SessionV1.WithParts => {
  const messageID = MessageID.ascending()
  return {
    info: {
      id: messageID,
      parentID: MessageID.ascending(),
      role: "assistant" as const,
      sessionID: session(),
      mode: "build" as const,
      agent: "build",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: ModelV2.ID.make("test-model"),
      providerID: ProviderV2.ID.make("test"),
      time: { created: Date.now() },
    },
    parts: [
      {
        id: PartID.make(id),
        sessionID: session(),
        messageID,
        type: "text" as const,
        text,
        time: { start: Date.now(), end: Date.now() },
      },
    ],
  }
}

describe("anchor content index", () => {
  it.effect("indexes text and finds it again by content", () =>
    Effect.gen(function* () {
      const index = yield* AnchorContentIndex.Service
      const seed = "the retry budget is three attempts per model before rotation"

      const added = yield* index.index({
        sessionID: session(),
        messages: [message("prt_a", seed)],
      })
      expect(added).toBe(1)

      const hits = yield* index.search({ sessionID: session(), query: "retry budget" })
      expect(hits.length).toBe(1)
      expect(hits[0].ref).toBe("prt_a")
      // bm25 is a relevance score where more negative is better; it must be a real number, not
      // NaN, or ORDER BY rank is meaningless.
      expect(Number.isFinite(hits[0].rank)).toBe(true)
    }),
  )

  it.effect("is idempotent: re-indexing the same parts adds nothing", () =>
    Effect.gen(function* () {
      const index = yield* AnchorContentIndex.Service
      const messages = [message("prt_b", "the compaction epoch increments on every anchor write")]

      expect(yield* index.index({ sessionID: session(), messages })).toBe(1)
      expect(yield* index.index({ sessionID: session(), messages })).toBe(0)

      // Duplicate rows would skew BM25 ranking, so there must be exactly one hit.
      const hits = yield* index.search({ sessionID: session(), query: "compaction epoch" })
      expect(hits.length).toBe(1)
    }),
  )

  it.effect("finds an identifier both whole and word-split", () =>
    Effect.gen(function* () {
      const index = yield* AnchorContentIndex.Service
      yield* index.index({
        sessionID: session(),
        messages: [message("prt_c", "we call useAdaptiveTargets to read the shell flush interval")],
      })

      // The whole identifier, as it appears in the source.
      const whole = yield* index.search({ sessionID: session(), query: "useAdaptiveTargets" })
      expect(whole.map((hit) => hit.ref)).toEqual(["prt_c"])

      // The same identifier as separate words, which only matches the split copy.
      const split = yield* index.search({ sessionID: session(), query: "Adaptive Targets" })
      expect(split.map((hit) => hit.ref)).toEqual(["prt_c"])
    }),
  )

  it.effect("keeps sessions isolated from each other", () =>
    Effect.gen(function* () {
      const index = yield* AnchorContentIndex.Service
      const other = SessionID.make("ses_test_other")
      yield* index.index({ sessionID: session(), messages: [message("prt_d", "anchors belong to one session")] })

      const mine = yield* index.search({ sessionID: session(), query: "anchors" })
      expect(mine.length).toBe(1)

      const theirs = yield* index.search({ sessionID: other, query: "anchors" })
      expect(theirs.length).toBe(0)
    }),
  )

  it.effect("treats FTS operators in the query as literal text", () =>
    Effect.gen(function* () {
      const index = yield* AnchorContentIndex.Service
      yield* index.index({
        sessionID: session(),
        messages: [message("prt_e", "the fix was to quote the MATCH argument in the content index")],
      })

      // Unquoted, this is FTS5 syntax and would be a parse error rather than a search.
      const hits = yield* index.search({ sessionID: session(), query: 'quoted AND "MATCH' })
      expect(Array.isArray(hits)).toBe(true)
    }),
  )

  it.effect("skips text too short to be worth ranking", () =>
    Effect.gen(function* () {
      const index = yield* AnchorContentIndex.Service
      expect(yield* index.index({ sessionID: session(), messages: [message("prt_f", "ok")] })).toBe(0)
    }),
  )

  it.effect("returns nothing for an empty query instead of erroring", () =>
    Effect.gen(function* () {
      const index = yield* AnchorContentIndex.Service
      expect(yield* index.search({ sessionID: session(), query: "   " })).toEqual([])
    }),
  )
})

describe("indexableText", () => {
  test("appends a word-split copy while keeping the original intact", () => {
    const out = indexableText("getAdaptiveTargets")
    expect(out).toContain("getAdaptiveTargets")
    expect(out).toContain("get Adaptive Targets")
  })

  test("leaves already-spaced prose alone", () => {
    expect(indexableText("hello world")).toBe("hello world\nhello world")
  })

  test("splits before a capital that follows a digit", () => {
    // The split is before the capital, not between the digit and the following lowercase run.
    expect(indexableText("utf8Decode")).toBe("utf8Decode\nutf8 Decode")
    expect(indexableText("v2Api")).toContain("v2 Api")
  })
})
