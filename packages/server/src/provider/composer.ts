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
//   1. Configured providers only; provider/model quota failures are learned and cooled down.
//   2. Free models only, with tool calling enabled and live availability metadata.
//   3. A model must fit the active session's existing context usage.
//   4. Artificial Analysis measurements where available; otherwise local estimates only after
//      explicit user consent, with successful-turn history as a bounded reliability signal.
//
// A model that errors, or answers with nothing, is not used again for a day. The ban
// outlives the process: it is written to the database and read back at boot, so a restart
// does not send the user straight back to the model that just failed.

import { ProviderV2 } from "@diveeoi/db/provider"
import { ModelV2 } from "@diveeoi/db/model"
import { ProviderFreeTier } from "./free-tier"
import { ComposerQuality } from "./composer-quality"
import { ArtificialAnalysis } from "./artificial-analysis"
import type { Info, Model } from "./provider"

export const PROVIDER_ID = ProviderV2.ID.make("divee")
export const MODEL_ID = ModelV2.ID.make("composer")
export const PROVIDER_NAME = "Divee"
export const MODEL_NAME = "DiveeComposer"

/** Routing options, read from the instance config. */
export interface Options {
  /** User similarity list: glob patterns of models that should be treated as known-good. */
  readonly preferred: ReadonlyArray<string>
  /** Quality bar a candidate should clear (0..5). */
  readonly minTier: number
  /** Consider every configured provider, or only OpenCode. */
  readonly useAllProviders?: boolean
  /** Prefer at least this much headroom above the session's current input-token usage. */
  readonly contextHeadroomRatio?: number
  /** Providers for which Divee has an available credential or explicit auth configuration. */
  readonly availableProviders?: ReadonlySet<string>
  /** Models whose provider catalog explicitly declares zero pricing. */
  readonly knownFreeModels?: ReadonlySet<string>
  /** Latest measured input-token usage for the active session, if known. */
  readonly contextUsageTokens?: number
  /** Explicit user consent to use catalog heuristics when no AA measurement exists. */
  readonly allowUnmeasuredRanking?: boolean
}

export const DEFAULT_OPTIONS: Options = {
  preferred: [],
  minTier: 3,
  useAllProviders: true,
  contextHeadroomRatio: 1.2,
  allowUnmeasuredRanking: false,
}

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
type SuccessListener = (model: string, record: { count: number; lastAt: number }) => void
let banListener: BanListener | undefined
let successListener: SuccessListener | undefined

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
  const record = { count: (current?.count ?? 0) + 1, lastAt: Date.now() }
  successes.set(id, record)
  successListener?.(id, record)
}

/** Register the listener that persists a ban. Returns a function that removes it. */
export function onBan(listener: BanListener) {
  banListener = listener
  return () => {
    if (banListener === listener) banListener = undefined
  }
}

/** Register a listener for successful routed turns. */
export function onSuccess(listener: SuccessListener) {
  successListener = listener
  return () => {
    if (successListener === listener) successListener = undefined
  }
}

/** Persistable evidence that a provider/model completed a real turn. */
export function workingModels(): Record<string, { count: number; lastAt: number }> {
  return Object.fromEntries(successes)
}

/** Restore proven-working models from the previous process. */
export function restoreWorkingModels(record: Record<string, { count: number; lastAt: number }>) {
  const now = Date.now()
  for (const [id, value] of Object.entries(record)) {
    if (
      value &&
      Number.isFinite(value.count) &&
      value.count > 0 &&
      Number.isFinite(value.lastAt) &&
      value.lastAt <= now + 60_000
    ) {
      successes.set(id, { count: value.count, lastAt: value.lastAt })
    }
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
  successListener = undefined
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
 * A recent successful turn is useful evidence, but one lucky response is not enough to
 * certify a model. Confidence grows with repeated successes and decays with age.
 */
export function workingScore(providerID: string, modelID: string) {
  const record = successes.get(key(providerID, modelID))
  if (!record) return 0
  const age = Math.max(0, Date.now() - record.lastAt)
  const freshness =
    age <= 60 * 60 * 1000 ? 1 : age <= 6 * 60 * 60 * 1000 ? 0.85 : age <= BAN_MS ? 0.65 : age <= 7 * BAN_MS ? 0.4 : 0
  if (freshness === 0) return 0
  const confidence = Math.min(1, Math.log2(record.count + 1) / Math.log2(9))
  return Math.round(confidence * freshness * 100)
}

/** Free (zero-price) model that can drive an agent loop. */
function usable(model: Model) {
  if (model.status === "deprecated") return false
  if (!model.capabilities.toolcall) return false
  if (model.limit.context <= 0) return false
  if (model.cost.input !== 0 || model.cost.output !== 0) return false
  if (model.cost.cache.read !== 0 || model.cost.cache.write !== 0) return false
  if (
    model.cost.tiers?.some(
      (tier) => tier.input !== 0 || tier.output !== 0 || tier.cache.read !== 0 || tier.cache.write !== 0,
    )
  )
    return false
  if (
    model.cost.experimentalOver200K &&
    (model.cost.experimentalOver200K.input !== 0 ||
      model.cost.experimentalOver200K.output !== 0 ||
      model.cost.experimentalOver200K.cache.read !== 0 ||
      model.cost.experimentalOver200K.cache.write !== 0)
  )
    return false
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
  readonly analyticsScore?: number
}

/** OpenCode-only mode remains available as a compatibility choice in Settings. */
const FREE_TIER_PROVIDER = "opencode"

/**
 * `route` is the strict pool a request may be sent to. `display` is the free catalog only,
 * ignoring cooldowns, benchmark consent and context fit, and is used solely so the synthetic
 * provider stays visible; it must never be turned into a route.
 */
type CandidateMode = "route" | "display"

function candidates(
  providers: Record<ProviderV2.ID, Info>,
  options: Options,
  mode: CandidateMode = "route",
): Candidate[] {
  const out: Candidate[] = []
  for (const [id, provider] of Object.entries(providers)) {
    const providerID = id as ProviderV2.ID
    if (providerID === PROVIDER_ID) continue
    const bundled = String(providerID) === FREE_TIER_PROVIDER
    if (!(options.useAllProviders ?? true) && !bundled) continue
    if (mode === "route" && options.availableProviders && !options.availableProviders.has(String(providerID))) continue
    for (const model of Object.values(provider.models)) {
      if (!usable(model)) continue
      if (options.knownFreeModels && !options.knownFreeModels.has(key(String(providerID), String(model.id)))) continue
      if (mode === "route" && !ProviderFreeTier.isRoutable(String(providerID), String(model.id))) continue
      const measured = ArtificialAnalysis.scoreFor(model)
      // Missing measurements are never silently presented as benchmark-backed rankings.
      // The user must explicitly enable the lower-confidence local estimate in Models settings.
      if (mode === "route" && !measured && !(options.allowUnmeasuredRanking ?? false)) continue

      const baseQuality = ComposerQuality.classify(model, options.preferred)
      const working = workingScore(String(providerID), String(model.id))
      const context = model.limit?.context ?? 0
      const qualityScore = measured ? baseQuality.score * 0.25 + measured.score * 0.75 : baseQuality.score
      // Keep the catalog estimate as a small stabilizer around measured results. For an
      // unmeasured model, the local tier is the estimate and is labelled as such.
      const tier = measured ? (measured.score / 20) * 0.8 + baseQuality.tier * 0.2 : baseQuality.tier
      const quality = {
        ...baseQuality,
        tier: Math.max(0, Math.min(5, tier)),
        score: Math.round(qualityScore),
        reasons: measured
          ? [...baseQuality.reasons, `Artificial Analysis ${measured.score}/100 (${measured.slug})`]
          : [...baseQuality.reasons, "local catalog heuristic; no Artificial Analysis measurement"],
      }
      out.push({
        providerID,
        modelID: model.id,
        model,
        quality,
        // Successful history is a bounded tie-breaker, never a reason to ignore a stronger model.
        score: qualityScore + Math.min(8, working * 0.08),
        working,
        context,
        analyticsScore: measured?.score,
        preferred: quality.reasons.some((reason) => reason.startsWith("preferred")),
      })
    }
  }
  const usage = Math.max(0, options.contextUsageTokens ?? 0)
  if (mode === "route" && usage > 0) {
    // Never route an active conversation to a window smaller than the context already used.
    // Prefer the configured headroom when possible; if the pool has no such candidate, keep
    // only models that still have enough room for the current context itself.
    const fitting = out.filter((candidate) => candidate.context >= usage)
    const headroom = fitting.filter((candidate) => candidate.context >= usage * (options.contextHeadroomRatio ?? 1.2))
    out.length = 0
    out.push(...(headroom.length ? headroom : fitting))
  }
  return out.sort((a, b) => {
    // The user's similarity list outranks everything else, including reachability.
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1
    // Quality leads. Recent successful turns provide a bounded reliability boost rather
    // than permanently locking Composer to the first model that happened to work.
    if (a.quality.tier !== b.quality.tier) return b.quality.tier - a.quality.tier
    if (a.score !== b.score) return b.score - a.score
    if (a.working !== b.working) return b.working - a.working
    // Between two models of the same quality, the one that holds more of the conversation
    // wins: a bigger window means fewer compactions and fewer lost turns.
    if (a.context !== b.context) return b.context - a.context
    // Same family: the newer generation wins.
    const lineage = ComposerQuality.compareLineage(a.model, b.model)
    if (lineage !== 0) return lineage
    return key(String(a.providerID), String(a.modelID)) < key(String(b.providerID), String(b.modelID)) ? -1 : 1
  })
}

/**
 * The model the router would pick right now, or undefined when no eligible route exists.
 *
 * The quality bar and health checks are strict. If nothing suitable is available there is no
 * route (see `unavailableReason`) instead of a fallback to a weak, paid, undersized, or
 * previously failed model. Catalogue visibility is separate: see `build`.
 */
export function select(
  providers: Record<ProviderV2.ID, Info>,
  options: Options = DEFAULT_OPTIONS,
  contextUsageTokens = options.contextUsageTokens ?? 0,
): Selection | undefined {
  const list = candidates(providers, { ...options, contextUsageTokens })
  if (list.length === 0) return undefined
  const qualified = list.filter(
    (candidate) =>
      candidate.quality.tier >= options.minTier && !isBanned(String(candidate.providerID), String(candidate.modelID)),
  )
  if (qualified.length === 0) return undefined

  // The candidate list already incorporates a bounded success-history boost. Keep the
  // quality-first order so a newly available stronger model can replace an older known-good one.
  return qualified[0]
}

/**
 * Representative catalog model for the provider/model list while routing is blocked (no
 * benchmark consent, provider quota cooldown, bans, quality bar). Display metadata only: it
 * is never attached to the route WeakMap, so it cannot reach a provider. Requests still go
 * through select() and its strict eligibility checks.
 */
function displayCandidate(
  providers: Record<ProviderV2.ID, Info>,
  options: Options,
  contextUsageTokens: number,
): Selection | undefined {
  const list = candidates(providers, options, "display")
  if (list.length === 0) return undefined
  const fitting = contextUsageTokens > 0 ? list.filter((candidate) => candidate.context >= contextUsageTokens) : list
  return (fitting.length ? fitting : list)[0]
}

/**
 * Why Composer has no route right now, or undefined when it has one. Used for a clear
 * no-route error instead of a bare "model not found". Never includes credentials.
 */
export function unavailableReason(
  providers: Record<ProviderV2.ID, Info>,
  options: Options = DEFAULT_OPTIONS,
  contextUsageTokens = options.contextUsageTokens ?? 0,
): string | undefined {
  if (select(providers, options, contextUsageTokens)) return undefined
  const catalog = candidates(providers, options, "display")
  if (catalog.length === 0)
    return "no known-free, tool-capable model with a usable context window is present in the catalogue"
  if (
    options.availableProviders &&
    !catalog.some((candidate) => options.availableProviders!.has(String(candidate.providerID)))
  )
    return "no authenticated provider currently exposes one of the known-free catalogue models"
  const routable = candidates(providers, { ...options, contextUsageTokens }, "route")
  if (routable.length === 0) {
    if (catalog.every((candidate) => !ProviderFreeTier.isRoutable(String(candidate.providerID), String(candidate.modelID))))
      return "every eligible free provider is cooling down after a quota or availability failure"
    if (!(options.allowUnmeasuredRanking ?? false) && catalog.some((candidate) => candidate.analyticsScore === undefined))
      return "no Artificial Analysis measurement matches the available free models; add an Artificial Analysis key or enable local ranking in Settings > Models"
    return "no eligible free model has a context window large enough for the current session"
  }
  return "the available free models are below the configured quality bar or are temporarily banned after failures"
}

/**
 * Build the synthetic `Info` for DiveeComposer.
 *
 * The single model mirrors a viable route when one exists. If routing is temporarily blocked,
 * it remains visible using a representative free catalog model, but receives no route tag.
 * This keeps DiveeComposer discoverable without silently bypassing consent or health checks.
 */
export function build(
  providers: Record<ProviderV2.ID, Info>,
  options: Options = DEFAULT_OPTIONS,
  contextUsageTokens = options.contextUsageTokens ?? 0,
): Info | undefined {
  const selected = select(providers, options, contextUsageTokens)
  const representative = selected ?? displayCandidate(providers, options, contextUsageTokens)
  if (!representative) return undefined

  const source = representative.model
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
  if (selected) {
    routes.set(model, {
      providerID: selected.providerID,
      modelID: selected.modelID,
      model: source,
      quality: selected.quality,
    })
  }

  return {
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    source: "custom",
    env: [],
    options: {},
    models: { [MODEL_ID]: model },
  }
}

/** Provider list with DiveeComposer always visible when a configured free catalog exists. */
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
export function model(
  providers: Record<ProviderV2.ID, Info>,
  options: Options = DEFAULT_OPTIONS,
  contextUsageTokens = options.contextUsageTokens ?? 0,
): Model | undefined {
  const result = build(providers, options, contextUsageTokens)?.models[MODEL_ID]
  // build() may return a display-only model so the provider does not disappear from the UI.
  // Requests must only receive a model that passed select() and has a concrete target tag.
  return result && routes.has(result) ? result : undefined
}

/** Description used in logs: `divee/composer -> provider/model`. */
export function describe(target: Target) {
  return `${PROVIDER_ID}/${MODEL_ID} -> ${target.providerID}/${target.modelID}`
}

export * as Composer from "./composer"
