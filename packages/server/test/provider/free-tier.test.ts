import { describe, expect, test } from "bun:test"
import {
  classify,
  isRoutable,
  learn,
  markKeyRequired,
  markUnusable,
  needsKey,
  rankForUse,
  resetLearned,
} from "@/provider/free-tier"

// The shapes the gateway actually returns (measured, not invented).
const freeTierBody = {
  type: "error",
  error: { type: "FreeTierError", message: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode" },
}
const modelGoneBody = { type: "error", error: { type: "ModelError", message: "Model grok-code is not supported" } }
// exo-free answered with this (410) while models.dev still listed it `status: "active"`, which is
// how the catalog-based deprecation filter could not catch it and the turn died on every retry.
const modelDeprecatedBody = {
  type: "error",
  error: { type: "ModelDeprecated", message: "Model exo-free has been deprecated." },
  metadata: { model: "exo-free" },
}

describe("provider free-tier", () => {
  test("classifies the gateway's FreeTierError as key-required", () => {
    expect(classify(freeTierBody)).toBe("key-required")
    expect(classify({ message: "FreeTierError: free tier can only be used from within OpenCode" })).toBe("key-required")
  })

  test("classifies retired models as unusable", () => {
    expect(classify(modelGoneBody)).toBe("unusable")
    expect(classify({ message: "Model xyz is not supported" })).toBe("unusable")
  })

  test("classifies a 410 ModelDeprecated as unusable", () => {
    expect(classify(modelDeprecatedBody)).toBe("unusable")
    expect(classify({ type: "ModelDeprecated", message: "Model exo-free has been deprecated." })).toBe("unusable")
    expect(classify({ message: "Model exo-free has been deprecated." })).toBe("unusable")
  })

  test("a ModelDeprecated failure actually removes the model from routing", () => {
    // Regression: classify() used to return undefined here, so learn() recorded nothing and the
    // same retired model was selected again on every following turn.
    resetLearned()
    const asSdkError = {
      name: "APIError",
      data: { message: "Model exo-free has been deprecated.", statusCode: 410, responseBody: JSON.stringify(modelDeprecatedBody) },
    }
    expect(learn(asSdkError, "opencode", "exo-free")).toBe("unusable")
    expect(isRoutable("opencode", "exo-free")).toBe(false)
    resetLearned()
    expect(isRoutable("opencode", "exo-free")).toBe(true)
  })

  test("ignores unrelated failures", () => {
    expect(classify(new Error("boom"))).toBeUndefined()
    expect(classify({ message: "rate limit exceeded" })).toBeUndefined()
    expect(classify(null)).toBeUndefined()
    expect(classify("nope")).toBeUndefined()
  })

  test("digs through nested causes the way the runtimes wrap errors", () => {
    const nested = { message: "wrapped", cause: { data: { body: freeTierBody } } }
    expect(classify(nested)).toBe("key-required")
  })

  test("learning makes a model unroutable for the rest of the process", () => {
    resetLearned()
    expect(isRoutable("opencode", "big-pickle")).toBe(true)
    expect(learn(freeTierBody, "opencode", "big-pickle")).toBe("key-required")
    expect(needsKey("opencode", "big-pickle")).toBe(true)
    expect(isRoutable("opencode", "big-pickle")).toBe(false)
    // a different model is unaffected
    expect(isRoutable("opencode", "space-bunny-free")).toBe(true)
    resetLearned()
    expect(isRoutable("opencode", "big-pickle")).toBe(true)
  })

  test("retired models are excluded from routing too", () => {
    resetLearned()
    markUnusable("opencode", "grok-code")
    expect(isRoutable("opencode", "grok-code")).toBe(false)
    markKeyRequired("opencode", "muse-spark-free")
    expect(needsKey("opencode", "muse-spark-free")).toBe(true)
    resetLearned()
  })

  test("survives a self-referencing cause chain", () => {
    const loop: any = { message: "hi" }
    loop.cause = loop
    expect(() => classify(loop)).not.toThrow()
  })

  test("classifies an authorization failure as key-required", () => {
    // A model the catalog lists as free but the credential cannot use: the gateway says
    // unauthorized, the SDK says the token is invalid, or the SDK reports a 401.
    expect(classify({ message: "Unauthorized: {\"error\":{\"message\":\"invalid token\"}}" })).toBe("key-required")
    expect(classify({ message: "Anthropic API key is missing. Pass it using the 'apiKey' parameter" })).toBe(
      "key-required",
    )
    expect(classify({ name: "APIError", data: { message: "unauthorized", statusCode: 401 } })).toBe("key-required")
    expect(classify({ statusCode: 401 })).toBe("key-required")
  })

  test("drops a provider once several of its models refuse the credential", () => {
    // Otherwise the router walks one dead model per turn through a provider whose
    // credential is bad for all of them.
    resetLearned()
    expect(isRoutable("gateway", "model-a")).toBe(true)
    learn({ message: "Unauthorized" }, "gateway", "model-a")
    learn({ message: "Unauthorized" }, "gateway", "model-b")
    // One more refusal and the provider itself is out.
    expect(isRoutable("gateway", "model-a")).toBe(false)
    expect(isRoutable("gateway", "model-c")).toBe(true)
    learn({ message: "Unauthorized" }, "gateway", "model-c")
    expect(isRoutable("gateway", "model-c")).toBe(false)
    // A different provider is unaffected.
    expect(isRoutable("other", "model-a")).toBe(true)
    resetLearned()
    expect(isRoutable("gateway", "model-c")).toBe(true)
  })
})

describe("provider free-tier rankForUse", () => {
  const model = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    cost: { input: 0 },
    limit: { context: 262144 },
    ...extra,
  })

  test("prefers a live model over a deprecated one of equal cost and context", () => {
    const ranked = rankForUse(
      [model("exo-free", { status: "deprecated" }), model("space-bunny-free", { status: "active" })],
      "opencode",
    )
    expect(ranked[0]?.id).toBe("space-bunny-free")
    // Deprecated models stay in the list as a last resort rather than vanishing.
    expect(ranked.map((m) => m.id).sort()).toEqual(["exo-free", "space-bunny-free"])
  })

  test("still returns a deprecated model when it is all there is", () => {
    // An empty ranking fails the turn outright, which is worse than trying one and learning.
    const ranked = rankForUse([model("exo-free", { status: "deprecated" })], "opencode")
    expect(ranked.map((m) => m.id)).toEqual(["exo-free"])
  })

  test("drops learned-unusable models before ranking", () => {
    resetLearned()
    markUnusable("opencode", "exo-free")
    const ranked = rankForUse(
      [model("exo-free", { status: "active" }), model("space-bunny-free", { status: "active" })],
      "opencode",
    )
    expect(ranked.map((m) => m.id)).toEqual(["space-bunny-free"])
    resetLearned()
  })

  test("treats a missing status as live", () => {
    const ranked = rankForUse(
      [model("a-model", { status: "deprecated" }), model("b-model")],
      "opencode",
    )
    expect(ranked[0]?.id).toBe("b-model")
  })
})
