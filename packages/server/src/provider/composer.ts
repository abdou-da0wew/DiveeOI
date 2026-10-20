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
//   3. Models that actually work: a model that completed a turn recently is preferred over
//      one that never did, however good the catalog says it is.
//   4. Best capabilities: multimodality, reasoning, then the larger context window.
//
// A model that errors, or answers with nothing, is not used again for a day. The ban
// outlives the process: it is written to the database and read back at boot, so a restart
// does not send the user straight back to the model that just failed.

import { ProviderV2 } from "@diveeoi/db/provider"
import { ModelV2 } from "@diveeoi/db/model"
import { ProviderFreeTier } from "./free-tier"
import { ComposerQuality } from "./composer-quality"
import type { Info, Model } from "./provider"

export const PROVIDER_ID = ProviderV2.ID.make("divee")
export const MODEL_ID = ModelV2.ID.make("composer")
export const PROVIDER_NAME = "Divee"
export const MODEL_NAME = "DiveeComposer"

/** Routing options, read from the instance config. */
export interface Options {
  /** User similarity list: glob patterns of models that should be treated as known-good. */
  readonly preferred: ReadonlyArray<string>
  /** Quality bar a candidate must clear (0..5). Below it, the best available is still used. */
  readonly minTier: number
}

export const DEFAULT_OPTIONS: Options = { preferred: [], minTier: 2 }

/** A resolved route: the concrete model a composer turn is actually sent to. */
export interface Target {
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
}

/** A candidate plus why it scored what it scored. */
export interface Selection extends Target {
  readonly model: Model
  readonly quality: ComposerQuality.Quality
}

// The synthetic model object is created per resolution and carries its chosen target, so a
// turn that resolved to A keeps talking to A even if the router would now pick B. The tag is a
// WeakMap (not a schema field) so it never leaks into responses or persisted messages.
const routes = new WeakMap<Model, Selection>()

/**
 * How long a model that failed is left alone.
 *
 * A day, not a minute: the free tier refuses models for reasons that do not clear
 * (a model retired, a gateway outage, a model that answers with an empty reply), and
 * retrying it every minute is what makes the app feel broken. The ban is persisted, so
 * it survives a restart.
 */
export const BAN_MS = 24 * 60 * 60 * 1000

/** key -> timestamp the ban expires at. */
const bans = new Map<string, number>()

/** key -> how often the model completed a turn, and when it last did. */
const successes = new Map<string, { count: number; lastAt: number }>()

/**
 * Notified whenever a model is banned, so the server can write the ban to the
 * database. The composer itself stays a plain module with no service dependencies.
 */
type BanListener = (model: string, until: number) => void
let banListener: BanListener | undefined

const key = (providerID: string, modelID: string) => `${providerID}/${modelID}`

export function isComposer(providerID: string, modelID: string) {
  return providerID === PROVIDER_ID && modelID === MODEL_ID
}

/** The concrete model a composer turn resolved to, or undefined for a normal model. */
export function targetOf(model: Model | undefined): Target | undefined {
  return model ? routes.get(model) : undefined
}

/** The full selection (target + quality) a composer turn resolved to. */
export function selectionOf(model: Model | undefined): Selection | undefined {
  return model ? routes.get(model) : undefined
}

/**
 * A model failed: it is not used again for a day.
 *
 * Called for every error and for a turn that produced no answer at all.
 */
export function recordFailure(providerID: string, modelID: string) {
  const id = key(providerID, modelID)
  const until = Date.now() + BAN_MS
  bans.set(id, until)
  successes.delete(id)
  banListener?.(id, until)
}

/** A model completed a turn: it is evidence that it works. */
export function recordSuccess(providerID: string, modelID: string) {
  const id = key(providerID, modelID)
  const current = successes.get(id)
  successes.set(id, { count: (current?.count ?? 0) + 1, lastAt: Date.now() })
}

/** Register the listener that persists a ban. Returns a function that removes it. */
export function onBan(listener: BanListener) {
  banListener = listener
  return () => {
    if (banListener === listener) banListener = undefined
  }
}

/** The bans that are still in force, as `provider/model -> expiry timestamp`. */
export function activeBans(): Record<string, number> {
  const now = Date.now()
  const out: Record<string, number> = {}
  for (const [id, until] of bans) {
    if (until <= now) {
      bans.delete(id)
      continue
    }
    out[id] = until
  }
  return out
}

/** Read the bans back at boot, so a restart does not re-enable a model that just failed. */
export function restoreBans(record: Record<string, number>) {
  const now = Date.now()
  for (const [id, until] of Object.entries(record)) {
    if (typeof until === "number" && until > now) bans.set(id, until)
  }
}

/** Test/reset seam. */
export function reset() {
  bans.clear()
  successes.clear()
  banListener = undefined
}

/** Is the model currently banned? */
export function isBanned(providerID: string, modelID: string) {
  const until = bans.get(key(providerID, modelID))
  if (until === undefined) return false
  if (Date.now() >= until) {
    bans.delete(key(providerID, modelID))
    return false
  }
  return true
}

/**
 * How much evidence there is that a model works, 0 to 100.
 *
 * A model that answered a turn minutes ago is the one the user is actually getting
 * answers from; a model that last worked days ago is stale evidence; a model that never
 * answered is no evidence at all.
 */
export function workingScore(providerID: string, modelID: string) {
  const record = successes.get(key(providerID, modelID))
  if (!record) return 0
  const age = Date.now() - record.lastAt
  if (age <= 60 * 60 * 1000) return 100
  if (age <= 6 * 60 * 60 * 1000) return 70
  if (age <= BAN_MS) return 40
  return 10
}

/** Free (zero-price) model that can drive an agent loop. */
function usable(model: Model) {
  if (model.status === "deprecated") return false
  if (!model.capabilities.toolcall) return false
  if (model.cost.input !== 0 || model.cost.output !== 0) return false
  return true
}

interface Candidate extends Selection {
  readonly score: number
  /** The user's similarity list matched this model. */
  readonly preferred: boolean
  /** Evidence that this model works, 0 to 100. */
  readonly working: number
  /** The context window, in tokens. */
  readonly context: number
}

/**
 * The bundled free tier serves its models anonymously (no key). A model there is reachable
 * on the first turn, while a model on a provider that needs credentials only works if that
 * provider happens to be connected and authorised - and the catalog lists plenty of those as
 * free too. So the bundled tier gets a reachability bonus on top of its quality: it wins
 * against an equally good model elsewhere, and a clearly better model still wins.
 */
const FREE_TIER_PROVIDER = "opencode"
const FREE_TIER_AFFINITY = 1

function candidates(providers: Record<ProviderV2.ID, Info>, options: Options): Candidate[] {
  const out: Candidate[] = []
  for (const [id, provider] of Object.entries(providers)) {
    const providerID = id as ProviderV2.ID
    if (providerID === PROVIDER_ID) continue
    const bundled = String(providerID) === FREE_TIER_PROVIDER
    for (const model of Object.values(provider.models)) {
      if (!usable(model)) continue
      if (!ProviderFreeTier.isRoutable(String(providerID), String(model.id))) continue
      const quality = ComposerQuality.classify(model, options.preferred)
      const working = workingScore(String(providerID), String(model.id))
      const reach = bundled ? FREE_TIER_AFFINITY : 0
      const context = model.limit?.context ?? 0
      out.push({
        providerID,
        modelID: model.id,
        model,
        quality: { ...quality, tier: Math.min(5, quality.tier + reach) },
        // The reachability bonus is deliberately larger than the score spread between
        // adjacent tiers: a model that works anonymously today beats one that may need a
        // key, and a *clearly* better model still wins on tier.
        score: quality.score + working / 10 + reach * 30,
        working,
        context,
        preferred: quality.reasons.some((reason) => reason.startsWith("preferred")),
      })
    }
  }
  return out.sort((a, b) => {
    // The user's similarity list outranks everything else, including reachability.
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1
    // A model that actually answers comes before a model that only looks good in the
    // catalog. The free tier refuses models for reasons the catalog never shows, so
    // "it worked ten minutes ago" is worth more than "it is the biggest model".
    if (a.working !== b.working) return b.working - a.working
    if (a.quality.tier !== b.quality.tier) return b.quality.tier - a.quality.tier
    // Between two models of the same quality, the one that holds more of the conversation
    // wins: a bigger window means fewer compactions and fewer lost turns.
    if (a.context !== b.context) return b.context - a.context
    if (a.score !== b.score) return b.score - a.score
    // Same family: the newer generation wins.
    const lineage = ComposerQuality.compareLineage(a.model, b.model)
    if (lineage !== 0) return lineage
    return key(String(a.providerID), String(a.modelID)) < key(String(b.providerID), String(b.modelID)) ? -1 : 1
  })
}

/**
 * The model the router would pick right now, or undefined when no free model is reachable.
 *
 * Candidates below the configured quality bar are only used when nothing better exists, so
 * the router always has somewhere to go even when the free pool is only small models.
 */
export function select(providers: Record<ProviderV2.ID, Info>, options: Options = DEFAULT_OPTIONS): Selection | undefined {
  const list = candidates(providers, options)
  if (list.length === 0) return undefined
  // A banned model is not used. If every free model is banned the router still has to
  // go somewhere - refusing to answer at all is worse than trying a model that failed
  // yesterday - so the ban is only a preference when nothing else is left.
  const usable = list.filter((candidate) => !isBanned(String(candidate.providerID), String(candidate.modelID)))
  const pool = usable.length > 0 ? usable : list
  const good = pool.find((candidate) => candidate.quality.tier >= options.minTier)
  return good ?? pool[0]
}

/**
 * Build the synthetic `Info` for DiveeComposer.
 *
 * The single model mirrors the currently selected candidate: capabilities, context window,
 * cost, variants and reasoning flag all come from it, so the UI shows what this router can
 * actually do right now. When no free model is reachable the provider is omitted entirely.
 */
export function build(providers: Record<ProviderV2.ID, Info>, options: Options = DEFAULT_OPTIONS): Info | undefined {
  const selected = select(providers, options)
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
  routes.set(model, {
    providerID: selected.providerID,
    modelID: selected.modelID,
    model: source,
    quality: selected.quality,
  })

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
export function withProvider(
  providers: Record<ProviderV2.ID, Info>,
  options: Options = DEFAULT_OPTIONS,
): Record<ProviderV2.ID, Info> {
  const provider = build(providers, options)
  if (!provider) return providers
  // Divee goes first: it is the default model and the app renders the first provider as the
  // headline entry in every model list.
  return { [PROVIDER_ID]: provider, ...providers }
}

/** The composer provider for a given catalog, or undefined. */
export function provider(providers: Record<ProviderV2.ID, Info>, options: Options = DEFAULT_OPTIONS): Info | undefined {
  return build(providers, options)
}

/** Fresh synthetic model (tagged with its current target) or undefined. */
export function model(providers: Record<ProviderV2.ID, Info>, options: Options = DEFAULT_OPTIONS): Model | undefined {
  return build(providers, options)?.models[MODEL_ID]
}

/** Description used in logs: `divee/composer -> provider/model`. */
export function describe(target: Target) {
  return `${PROVIDER_ID}/${MODEL_ID} -> ${target.providerID}/${target.modelID}`
}

export * as Composer from "./composer"
