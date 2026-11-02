import { describe, expect, it } from "bun:test"
import { ModelV2 } from "@diveeoi/db/model"
import { ProviderV2 } from "@diveeoi/db/provider"
import { Composer } from "../../src/provider/composer"
import type { Info, Model } from "../../src/provider/provider"

const model = (input: {
  id: string
  providerID: string
  input?: number
  output?: number
  context?: number
  toolcall?: boolean
  image?: boolean
  reasoning?: boolean
  status?: "alpha" | "beta" | "deprecated" | "active"
}): Model =>
  ({
    id: ModelV2.ID.make(input.id),
    providerID: ProviderV2.ID.make(input.providerID),
    name: input.id,
    api: { id: input.id, url: "", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      temperature: true,
      reasoning: input.reasoning ?? true,
      attachment: input.image ?? false,
      toolcall: input.toolcall ?? true,
      input: {
        text: true,
        audio: false,
        image: input.image ?? false,
        video: false,
        pdf: false,
      },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: input.input ?? 0, output: input.output ?? 0, cache: { read: 0, write: 0 } },
    limit: { context: input.context ?? 200_000, output: 32_000 },
    options: {},
    headers: {},
    family: "",
    release_date: "2026-09-01",
    status: input.status ?? "active",
    variants: {},
  }) as unknown as Model

const provider = (id: string, models: Model[]): Info =>
  ({
    id: ProviderV2.ID.make(id),
    name: id,
    source: "custom",
    env: [],
    options: {},
    models: Object.fromEntries(models.map((m) => [m.id, m])),
  }) as unknown as Info

const providers = () => ({
  [ProviderV2.ID.make("opencode")]: provider("opencode", [
    model({ id: "DeepSeek V4.1 Flash Free", providerID: "opencode", image: true }),
    model({ id: "Nemotron 3.5 Lightning Free", providerID: "opencode" }),
    model({ id: "Paid Model", providerID: "opencode", input: 3, output: 15 }),
  ]),
  [ProviderV2.ID.make("other")]: provider("other", [model({ id: "MiMo-V2.6-Flash Free", providerID: "other" })]),
})

describe("DiveeComposer", () => {
  it("routes to the best free model and mirrors its capabilities", () => {
    const info = Composer.build(providers())
    expect(info?.id).toBe(Composer.PROVIDER_ID)
    expect(info?.name).toBe("Divee")
    const resolved = info?.models[Composer.MODEL_ID]
    expect(resolved?.name).toBe("DiveeComposer")
    // DeepSeek beats the Lightning variant and the MiMo model.
    expect(String(Composer.targetOf(resolved)?.modelID)).toBe("DeepSeek V4.1 Flash Free")
    expect(resolved?.capabilities.input.image).toBe(true)
    expect(resolved?.cost.input).toBe(0)
  })

  it("does not fall back to a model after every candidate has been banned", () => {
    Composer.reset()
    Composer.recordFailure("opencode", "DeepSeek V4.1 Flash Free")
    Composer.recordFailure("opencode", "Nemotron 3.5 Lightning Free")
    Composer.recordFailure("other", "MiMo-V2.6-Flash Free")
    expect(Composer.select(providers())).toBeUndefined()
    Composer.reset()
  })

  it("requires the configured minimum quality tier instead of choosing a weak fallback", () => {
    const selected = Composer.select(providers(), { ...Composer.DEFAULT_OPTIONS, minTier: 5 })
    expect(selected).toBeUndefined()
  })

  it("rejects models that charge cache or high-context tiers", () => {
    const priced = {
      [ProviderV2.ID.make("opencode")]: provider("opencode", [
        model({ id: "Cache Priced Free Model", providerID: "opencode" }),
      ]),
    }
    const candidate = priced[ProviderV2.ID.make("opencode")].models["Cache Priced Free Model"]
    candidate.cost.cache.read = 0.1
    expect(Composer.select(priced, { ...Composer.DEFAULT_OPTIONS, minTier: 0 })).toBeUndefined()
    candidate.cost.cache.read = 0
    candidate.cost.experimentalOver200K = {
      input: 0.1,
      output: 0,
      cache: { read: 0, write: 0 },
    }
    expect(Composer.select(priced, { ...Composer.DEFAULT_OPTIONS, minTier: 0 })).toBeUndefined()
  })

  it("never offers a paid model", () => {
    const selected = Composer.select(providers())
    expect(String(selected?.modelID)).not.toBe("Paid Model")
  })

  it("honours the user's similarity list", () => {
    const selected = Composer.select(providers(), { preferred: ["mimo-*"], minTier: 0 })
    expect(String(selected?.modelID)).toBe("MiMo-V2.6-Flash Free")
  })

  it("is the first provider in the list", () => {
    const merged = Composer.withProvider(providers())
    expect(Object.keys(merged)[0]).toBe(Composer.PROVIDER_ID)
    // Free models stay selectable exactly as before.
    expect(Object.keys(merged[ProviderV2.ID.make("opencode")].models)).toContain("DeepSeek V4.1 Flash Free")
  })

  it("skips a model that failed for a day", () => {
    Composer.reset()
    Composer.recordFailure("opencode", "DeepSeek V4.1 Flash Free")
    const selected = Composer.select(providers())
    expect(String(selected?.modelID)).not.toBe("DeepSeek V4.1 Flash Free")
    // The ban lasts a day, not a minute.
    expect(Composer.isBanned("opencode", "DeepSeek V4.1 Flash Free")).toBe(true)
    expect(Composer.BAN_MS).toBe(24 * 60 * 60 * 1000)
    Composer.reset()
  })

  it("restores successful-turn health history across process restarts", () => {
    Composer.reset()
    Composer.recordSuccess("opencode", "Verified Model")
    const history = Composer.workingModels()
    Composer.reset()
    Composer.restoreWorkingModels(history)
    expect(Composer.workingScore("opencode", "Verified Model")).toBeGreaterThan(0)
    Composer.reset()
  })

  it("does not route to unverified models once a working model is known", () => {
    Composer.reset()
    const pool = {
      [ProviderV2.ID.make("opencode")]: provider("opencode", [
        model({ id: "Verified Model", providerID: "opencode" }),
        model({ id: "Unverified Flagship Model", providerID: "opencode", reasoning: true, image: true }),
      ]),
    }
    Composer.recordSuccess("opencode", "Verified Model")
    const selected = Composer.select(pool, { ...Composer.DEFAULT_OPTIONS, minTier: 0 })
    expect(String(selected?.modelID)).toBe("Verified Model")
    Composer.reset()
  })

  it("prefers a model that actually works", () => {
    Composer.reset()
    // The MiMo model measured better on paper, but the DeepSeek one answered a turn.
    Composer.recordSuccess("opencode", "DeepSeek V4.1 Flash Free")
    const selected = Composer.select(providers(), { preferred: [], minTier: 0 })
    expect(String(selected?.modelID)).toBe("DeepSeek V4.1 Flash Free")
    Composer.reset()
  })

  it("prefers the bigger context window between two models of the same quality", () => {
    Composer.reset()
    const two = {
      [ProviderV2.ID.make("opencode")]: provider("opencode", [
        model({ id: "Small Context Model", providerID: "opencode", context: 32_000 }),
        model({ id: "Big Context Model", providerID: "opencode", context: 1_000_000 }),
      ]),
    }
    const selected = Composer.select(two, { preferred: [], minTier: 0 })
    expect(String(selected?.modelID)).toBe("Big Context Model")
  })

  it("reads the bans back after a restart", () => {
    Composer.reset()
    const until = Date.now() + Composer.BAN_MS
    Composer.restoreBans({ "opencode/DeepSeek V4.1 Flash Free": until })
    expect(Composer.isBanned("opencode", "DeepSeek V4.1 Flash Free")).toBe(true)
    // A ban that has expired is not restored.
    Composer.reset()
    Composer.restoreBans({ "opencode/DeepSeek V4.1 Flash Free": Date.now() - 1000 })
    expect(Composer.isBanned("opencode", "DeepSeek V4.1 Flash Free")).toBe(false)
  })

  it("can be restricted to the OpenCode provider", () => {
    const selected = Composer.select(providers(), { ...Composer.DEFAULT_OPTIONS, useAllProviders: false })
    expect(String(selected?.providerID)).toBe("opencode")
  })

  it("does not treat unknown pricing as free", () => {
    const pool = providers()
    const selected = Composer.select(pool, {
      ...Composer.DEFAULT_OPTIONS,
      knownFreeModels: new Set(["other/MiMo-V2.6-Flash Free"]),
    })
    expect(String(selected?.providerID)).toBe("other")
    expect(
      Composer.select(pool, {
        ...Composer.DEFAULT_OPTIONS,
        knownFreeModels: new Set(),
      }),
    ).toBeUndefined()
  })

  it("only routes through providers with available credentials", () => {
    const pool = providers()
    const selected = Composer.select(pool, {
      ...Composer.DEFAULT_OPTIONS,
      availableProviders: new Set(["other"]),
    })
    expect(String(selected?.providerID)).toBe("other")
    expect(
      Composer.select(pool, {
        ...Composer.DEFAULT_OPTIONS,
        availableProviders: new Set(["not-connected"]),
      }),
    ).toBeUndefined()
  })

  it("considers other connected providers when all-provider routing is enabled", () => {
    const onlyOther = {
      [ProviderV2.ID.make("other")]: provider("other", [model({ id: "MiMo-V2.6-Flash Free", providerID: "other" })]),
    }
    expect(String(Composer.select(onlyOther)?.providerID)).toBe("other")
    expect(Composer.select(onlyOther, { ...Composer.DEFAULT_OPTIONS, useAllProviders: false })).toBeUndefined()
  })

  it("rejects free models with unknown context limits", () => {
    const unknown = {
      [ProviderV2.ID.make("opencode")]: provider("opencode", [
        model({ id: "Unknown Context Free Model", providerID: "opencode", context: 0 }),
      ]),
    }
    expect(Composer.select(unknown, { ...Composer.DEFAULT_OPTIONS, minTier: 0 })).toBeUndefined()
  })

  it("never chooses a context window smaller than the active session context", () => {
    const two = {
      [ProviderV2.ID.make("opencode")]: provider("opencode", [
        model({ id: "Small Context Model", providerID: "opencode", context: 32_000 }),
        model({ id: "Adequate Context Model", providerID: "opencode", context: 128_000 }),
      ]),
    }
    const selected = Composer.select(
      two,
      { ...Composer.DEFAULT_OPTIONS, minTier: 0, contextHeadroomRatio: 1.2 },
      90_000,
    )
    expect(String(selected?.modelID)).toBe("Adequate Context Model")
    expect(selected?.model.limit.context).toBeGreaterThanOrEqual(90_000)
  })

  it("returns no route when every free model is smaller than the active session context", () => {
    const tooSmall = {
      [ProviderV2.ID.make("opencode")]: provider("opencode", [
        model({ id: "Tiny Context Model", providerID: "opencode", context: 32_000 }),
      ]),
    }
    expect(Composer.select(tooSmall, { ...Composer.DEFAULT_OPTIONS, minTier: 0 }, 64_000)).toBeUndefined()
  })

  it("is omitted when no free model is reachable", () => {
    const none = {
      [ProviderV2.ID.make("opencode")]: provider("opencode", [
        model({ id: "Paid Model", providerID: "opencode", input: 1, output: 2 }),
      ]),
    }
    expect(Composer.build(none)).toBeUndefined()
    expect(Composer.withProvider(none)).toEqual(none)
  })
})
