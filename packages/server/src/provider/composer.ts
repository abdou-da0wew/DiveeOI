// packages/server/src/provider/composer.ts
// DiveeComposer — the built-in model router.
//
// The user selects one model: `divee/composer` ("DiveeComposer"). It is never sent to a
// provider. Every turn it resolves to the best free model that is currently reachable, and
// only that underlying `provider/model` is used for the request.
//
// Why a synthetic model instead of a config alias:
//   - capabilities (image/pdf/audio/video inputs, context window, reasoning, variants) must
//     track whichever model the router picked, so the UI enables the right attachments;
//   - the free tier can refuse a model at any time (see ./free-tier), and the router must be
//     able to move without the user re-picking a model;
//   - the selection must stay on the server: the client only ever sees "DiveeComposer".
//
// Routing policy, in order:
//   1. Reachable models only (ProviderFreeTier.isRoutable) with tool calling enabled.
//   2. Free models (zero input/output cost) — the built-in `opencode` gateway first, since
//      that is the free tier this app ships with.
//   3. Best capabilities: multimodality, reasoning, then the larger context window.
//   4. Models in a failure cooldown are skipped until it expires.
//
// State is process-local, like ./free-tier. A fresh process re-learns cheaply.

import { ProviderV2 } from "@diveeoi/db/provider"
import { ModelV2 } from "@diveeoi/db/model"
import { ProviderFreeTier } from "./free-tier"
import type { Info, Model } from "./provider"

export const PROVIDER_ID = ProviderV2.ID.make("divee")
export const MODEL_ID = ModelV2.ID.make("composer")
export const PROVIDER_NAME = "Divee"
export const MODEL_NAME = "DiveeComposer"

/** A resolved route: the concrete model a composer turn is actually sent to. */
export interface Target {
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
}

// The synthetic model object is created per resolution and carries its chosen target, so a
// turn that resolved to A keeps talking to A even if the router would now pick B. The tag is a
// WeakMap (not a schema field) so it never leaks into responses or persisted messages.
const routes = new WeakMap<Model, Target>()

// Transient failures (rate limit, 5xx, timeout) put a model in a short cooldown instead of
// banning it for the process like the free-tier decisions do.
const COOLDOWN_MS = 120_000
const cooldown = new Map<string, number>()

const key = (providerID: string, modelID: string) => `${providerID}/${modelID}`

export function isComposer(providerID: string, modelID: string) {
  return providerID === PROVIDER_ID && modelID === MODEL_ID
}

/** The concrete model a composer turn resolved to, or undefined for a normal model. */
export function targetOf(model: Model | undefined): Target | undefined {
  return model ? routes.get(model) : undefined
}

/** Put a model in cooldown so the router prefers something else for a while. */
export function recordFailure(providerID: string, modelID: string) {
  cooldown.set(key(providerID, modelID), Date.now() + COOLDOWN_MS)
}

/** Test/reset seam. */
export function reset() {
  cooldown.clear()
}

function cooling(providerID: string, modelID: string) {
  const until = cooldown.get(key(providerID, modelID))
  if (until === undefined) return false
  if (Date.now() >= until) {
    cooldown.delete(key(providerID, modelID))
    return false
  }
  return true
}

/** Free (zero-price) model that can drive an agent loop. */
function usable(model: Model) {
  if (model.status === "deprecated") return false
  if (!model.capabilities.toolcall) return false
  if (model.cost.input !== 0 || model.cost.output !== 0) return false
  return true
}

function score(model: Model, providerID: string) {
  let value = 0
  // The bundled free tier: prefer it over any other provider's free models.
  if (String(providerID) === "opencode") value += 1000
  const input = model.capabilities.input
  if (input.image) value += 120
  if (input.pdf) value += 40
  if (input.audio) value += 40
  if (input.video) value += 40
  if (model.capabilities.reasoning) value += 30
  // Capability proxy that every catalog entry carries. Capped so a giant window cannot
  // outrank multimodality on its own.
  value += Math.min(model.limit.context ?? 0, 1_000_000) / 10_000
  return value
}

interface Candidate extends Target {
  readonly model: Model
  readonly score: number
}

function candidates(providers: Record<ProviderV2.ID, Info>): Candidate[] {
  const out: Candidate[] = []
  for (const [id, provider] of Object.entries(providers)) {
    const providerID = id as ProviderV2.ID
    if (providerID === PROVIDER_ID) continue
    for (const model of Object.values(provider.models)) {
      if (!usable(model)) continue
      if (!ProviderFreeTier.isRoutable(String(providerID), String(model.id))) continue
      out.push({ providerID, modelID: model.id, model, score: score(model, String(providerID)) })
    }
  }
  return out.sort((a, b) => {
    const cool = Number(cooling(String(a.providerID), String(a.modelID))) - Number(cooling(String(b.providerID), String(b.modelID)))
    if (cool !== 0) return cool
    if (b.score !== a.score) return b.score - a.score
    const context = (b.model.limit.context ?? 0) - (a.model.limit.context ?? 0)
    if (context !== 0) return context
    return key(String(a.providerID), String(a.modelID)) < key(String(b.providerID), String(b.modelID)) ? -1 : 1
  })
}

/** The model the router would pick right now, or undefined when no free model is reachable. */
export function select(providers: Record<ProviderV2.ID, Info>): Candidate | undefined {
  return candidates(providers)[0]
}

/**
 * Build the synthetic `Info` for DiveeComposer.
 *
 * The single model mirrors the currently selected candidate: capabilities, context window,
 * cost, variants and reasoning flag all come from it, so the UI shows what this router can
 * actually do right now. When no free model is reachable the provider is omitted entirely.
 */
export function build(providers: Record<ProviderV2.ID, Info>): Info | undefined {
  const selected = select(providers)
  if (!selected) return undefined

  const source = selected.model
  const model: Model = {
    ...source,
    id: MODEL_ID,
    providerID: PROVIDER_ID,
    name: MODEL_NAME,
    // The provider must never receive this id: getLanguage resolves the target first and uses
    // the underlying api id. Keeping the source api id here also keeps metadata honest.
    api: { ...source.api, id: source.api.id },
    // Routing is transparent to the user; the model stays usable regardless of the target's
    // own permission-ish flags, which are re-derived per turn.
    options: { ...source.options },
    variants: { ...source.variants },
  }
  routes.set(model, { providerID: selected.providerID, modelID: selected.modelID })

  return {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    source: "custom",
    env: [],
    options: {},
    models: { [MODEL_ID]: model },
  }
}

/** Provider list with DiveeComposer appended when it has somewhere to route. */
export function withProvider(providers: Record<ProviderV2.ID, Info>): Record<ProviderV2.ID, Info> {
  const provider = build(providers)
  if (!provider) return providers
  return { ...providers, [PROVIDER_ID]: provider }
}

/** The composer provider for a given catalog, or undefined. */
export function provider(providers: Record<ProviderV2.ID, Info>): Info | undefined {
  return build(providers)
}

/** Fresh synthetic model (tagged with its current target) or undefined. */
export function model(providers: Record<ProviderV2.ID, Info>): Model | undefined {
  return build(providers)?.models[MODEL_ID]
}

/** Description used in logs: `divee/composer -> provider/model`. */
export function describe(target: Target) {
  return `${PROVIDER_ID}/${MODEL_ID} -> ${target.providerID}/${target.modelID}`
}

export * as Composer from "./composer"
