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
  [ProviderV2.ID.make("other")]: provider("other", [
    model({ id: "MiMo-V2.6-Flash Free", providerID: "other" }),
  ]),
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
