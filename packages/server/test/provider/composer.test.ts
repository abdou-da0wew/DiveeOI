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
  pdf?: boolean
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
      reasoning: input.reasoning ?? false,
      attachment: input.image ?? false,
      toolcall: input.toolcall ?? true,
      input: {
        text: true,
        audio: false,
        image: input.image ?? false,
        video: false,
        pdf: input.pdf ?? false,
      },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: input.input ?? 0, output: input.output ?? 0, cache: { read: 0, write: 0 } },
    limit: { context: input.context ?? 32_000, output: 4_000 },
    options: {},
    headers: {},
    family: "",
    release_date: "",
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
    model({ id: "small-free", providerID: "opencode", context: 32_000 }),
    model({ id: "vision-free", providerID: "opencode", context: 200_000, image: true }),
    model({ id: "paid-model", providerID: "opencode", input: 3, output: 15, context: 1_000_000 }),
  ]),
  [ProviderV2.ID.make("other")]: provider("other", [
    model({ id: "other-free", providerID: "other", context: 500_000 }),
  ]),
})

describe("DiveeComposer", () => {
  it("routes to the best free model and mirrors its capabilities", () => {
    const info = Composer.build(providers())
    expect(info?.id).toBe(Composer.PROVIDER_ID)
    expect(info?.name).toBe("Divee")
    const resolved = info?.models[Composer.MODEL_ID]
    expect(resolved?.name).toBe("DiveeComposer")
    // vision-free beats small-free (multimodal) and the built-in gateway beats "other".
    expect(resolved?.capabilities.input.image).toBe(true)
    expect(resolved?.limit.context).toBe(200_000)
    expect(resolved?.cost.input).toBe(0)
    expect(Composer.targetOf(resolved)).toEqual({
      providerID: ProviderV2.ID.make("opencode"),
      modelID: ModelV2.ID.make("vision-free"),
    })
  })

  it("never offers a paid model", () => {
    const selected = Composer.select(providers())
    expect(String(selected?.modelID)).not.toBe("paid-model")
  })

  it("is appended alongside the normal providers", () => {
    const merged = Composer.withProvider(providers())
    expect(Object.keys(merged).sort()).toEqual(["divee", "opencode", "other"])
    // Free models stay selectable exactly as before.
    expect(Object.keys(merged[ProviderV2.ID.make("opencode")].models)).toContain("small-free")
  })

  it("is omitted when no free model is reachable", () => {
    const none = {
      [ProviderV2.ID.make("opencode")]: provider("opencode", [
        model({ id: "paid", providerID: "opencode", input: 1, output: 2 }),
      ]),
    }
    expect(Composer.build(none)).toBeUndefined()
    expect(Composer.withProvider(none)).toEqual(none)
  })

  it("skips models the free tier learned to refuse", () => {
    const list = providers()
    Composer.reset()
    expect(Composer.select(list)?.modelID).toBe(ModelV2.ID.make("vision-free"))
  })
})
