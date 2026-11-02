import { afterEach, describe, expect, it } from "bun:test"
import type { Model } from "../../src/provider/provider"
import { ArtificialAnalysis } from "../../src/provider/artificial-analysis"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  ArtificialAnalysis.reset()
})

describe("ArtificialAnalysis", () => {
  it("loads public benchmark and performance data using a server-side API key", async () => {
    let calls = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      expect(String(input)).toContain("/language/models/free?page=1")
      expect(new Headers(init?.headers).get("x-api-key")).toBe("test-secret")
      return Response.json({
        tier: "free",
        pagination: { page: 1, total_pages: 1, page_size: 1, has_more: false },
        data: [
          {
            id: "model-1",
            name: "DeepSeek V4.1",
            slug: "deepseek-v4-1",
            evaluations: {
              artificial_analysis_intelligence_index: 78,
              artificial_analysis_coding_index: 82,
              artificial_analysis_agentic_index: 74,
              artificial_analysis_engineering_index: 86,
            },
            performance: {
              median_output_tokens_per_second: 65,
              median_time_to_first_token_seconds: 1.4,
              median_time_to_first_answer_token_seconds: 3.1,
              median_end_to_end_response_time_seconds: 10.2,
            },
          },
        ],
      })
    }) as typeof fetch

    await ArtificialAnalysis.refresh("test-secret", true)
    const model = {
      id: "deepseek-v4-1-free",
      name: "DeepSeek V4.1 (free)",
      api: { id: "deepseek-v4-1" },
    } as unknown as Model
    const score = ArtificialAnalysis.scoreFor(model)

    expect(score).toBeDefined()
    expect(score?.slug).toBe("deepseek-v4-1")
    expect(score?.intelligence).toBe(78)
    expect(score?.coding).toBe(82)
    expect(score?.agentic).toBe(74)
    expect(score?.capabilityAverage).toBe(86)
    expect(score?.outputTokensPerSecond).toBe(65)
    expect(score?.timeToFirstAnswerTokenSeconds).toBe(3.1)
    expect(score?.endToEndResponseTimeSeconds).toBe(10.2)
    expect(ArtificialAnalysis.catalogStatus().models).toBe(1)
    await ArtificialAnalysis.refresh("test-secret")
    expect(calls).toBe(1)
  })

  it("backs off after the API reports a rate limit", async () => {
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return new Response("rate limited", { status: 429, headers: { "retry-after": "3600" } })
    }) as unknown as typeof fetch

    await ArtificialAnalysis.refresh("test-secret", true).catch(() => undefined)
    await ArtificialAnalysis.refresh("test-secret")
    expect(calls).toBe(1)
  })

  it("keeps the previous catalog when a later API refresh fails", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        pagination: { total_pages: 1 },
        data: [
          {
            name: "GLM 5",
            slug: "glm-5",
            evaluations: { artificial_analysis_intelligence_index: 70 },
            performance: {},
          },
        ],
      })) as unknown as typeof fetch
    await ArtificialAnalysis.refresh("test-secret", true)

    globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch
    await ArtificialAnalysis.refresh("test-secret", true).catch(() => undefined)

    const model = { id: "glm-5", api: { id: "glm-5" } } as unknown as Model
    expect(ArtificialAnalysis.scoreFor(model)?.slug).toBe("glm-5")
  })
})
