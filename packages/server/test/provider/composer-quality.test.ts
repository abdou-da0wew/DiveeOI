import { describe, expect, it } from "bun:test"
import { ComposerQuality } from "../../src/provider/composer-quality"

const model = (input: {
  id: string
  name?: string
  family?: string
  context?: number
  output?: number
  reasoning?: boolean
  image?: boolean
  release_date?: string
  status?: string
}) => ({
  id: input.id,
  name: input.name ?? input.id,
  family: input.family,
  capabilities: {
    temperature: true,
    reasoning: input.reasoning ?? true,
    attachment: input.image ?? false,
    toolcall: true,
    input: { text: true, audio: false, image: input.image ?? false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: { context: input.context ?? 200_000, output: input.output ?? 32_000 },
  release_date: input.release_date ?? "2026-10-01",
  status: input.status ?? "active",
})

describe("ComposerQuality", () => {
  it("ranks a frontier family above a small model", () => {
    const strong = ComposerQuality.classify(model({ id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free" }))
    const weak = ComposerQuality.classify(model({ id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free" }))
    expect(strong.tier).toBeGreaterThan(weak.tier)
    expect(strong.score).toBeGreaterThan(weak.score)
  })

  it("counts a variant word once, not once per occurrence", () => {
    // "lightning" appears in both the id and the name; it must be applied once.
    const twice = ComposerQuality.classify(model({ id: "nemotron-3.5-lightning", name: "Nemotron 3.5 Lightning" }))
    const once = ComposerQuality.classify(model({ id: "nemotron-3.5", name: "Nemotron 3.5" }))
    expect(twice.tier).toBeGreaterThan(once.tier - 1.2)
    expect(twice.tier).toBeLessThan(once.tier)
  })

  it("demotes the cheap variants of a family", () => {
    const flash = ComposerQuality.classify(model({ id: "qwen3-coder-flash" }))
    const coder = ComposerQuality.classify(model({ id: "qwen3-coder" }))
    expect(coder.tier).toBeGreaterThan(flash.tier)
  })

  it("keeps the newer generation of a family ahead of the older one", () => {
    const older = model({ id: "deepseek-v3.2-free", name: "DeepSeek V3.2 Free" })
    const newer = model({ id: "deepseek-v4.1-free", name: "DeepSeek V4.1 Free" })
    expect(ComposerQuality.compareLineage(newer, older)).toBeLessThan(0)
  })

  it("lets the user's similarity list win over the table", () => {
    const model_ = model({ id: "amazing-9000-free", name: "Amazing 9000 Free" })
    const plain = ComposerQuality.classify(model_)
    const preferred = ComposerQuality.classify(model_, ["amazing-9000*"])
    expect(preferred.tier).toBeGreaterThan(plain.tier)
    expect(preferred.score).toBeGreaterThan(plain.score)
    expect(preferred.reasons.join(" ")).toContain("preferred")
  })

  it("matches glob patterns against id and name", () => {
    const model_ = model({ id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free" })
    expect(ComposerQuality.matches(model_, "deepseek-v4*")).toBe(true)
    expect(ComposerQuality.matches(model_, "*flash*")).toBe(true)
    expect(ComposerQuality.matches(model_, "glm-5*")).toBe(false)
  })

  it("sorts by tier first, then score", () => {
    const a = ComposerQuality.classify(model({ id: "glm-5.3-flash-free", name: "GLM-5.3 Flash Free" }))
    const b = ComposerQuality.classify(model({ id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free" }))
    expect(ComposerQuality.compareQuality(a, b)).toBeLessThan(0)
  })
})
