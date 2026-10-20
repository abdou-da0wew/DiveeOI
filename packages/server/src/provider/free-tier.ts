// packages/server/src/provider/free-tier.ts
// Which models are reachable without a key?
//
// Measured against the live gateway (bare `Authorization: Bearer public`, no client headers):
// the `opencode` provider's free-price models are NOT uniformly anonymous. The gateway decides
// per model, and three distinct failures exist:
//
//   FreeTierError   403 - "OpenCode's free tier can only be used from within OpenCode"
//                      Free price, but an API key is required.
//   ModelError     401 - "Model X is not supported"
//                      Listed upstream but not routable.
//   ModelDeprecated 410 - "Model X has been deprecated."
//                      Retired upstream while the catalog still lists it as active.
//
// None of these depend on which client is calling (see ./user-agent.ts for the one thing the
// gateway *does* key on). The catalog cannot answer them either: `cost.input === 0` is true for
// every free model, there is no allow-anonymous flag, and a retired model keeps `status: "active"`
// until models.dev catches up - which is exactly how `exo-free` got selected and died. So the
// gateway is the only oracle, and this module *learns* from live traffic instead of shipping a
// list that rots (5 of 12 free models were already dead when this was measured).
//
// State is process-local, exactly like the circuit breakers in the retry design, and a fresh
// process re-learns cheaply because the cost of being wrong is one failed turn.

const keyRequired = new Set<string>()
const unusable = new Set<string>()

// A credential that cannot use one model usually cannot use any of that
// provider's free models. After a few refusals the provider itself is dropped, so
// the router stops walking one dead model per turn.
const PROVIDER_FAILURE_THRESHOLD = 3
const providerFailures = new Map<string, Set<string>>()
const keyRequiredProviders = new Set<string>()

const key = (providerID: string, modelID: string) => `${providerID}/${modelID}`

/** Model needs an API key; stop routing to it in this process. */
export function markKeyRequired(providerID: string, modelID: string) {
  keyRequired.add(key(providerID, modelID))
  const failures = providerFailures.get(providerID) ?? new Set<string>()
  failures.add(modelID)
  providerFailures.set(providerID, failures)
  if (failures.size >= PROVIDER_FAILURE_THRESHOLD) keyRequiredProviders.add(providerID)
}

/** Model is gone upstream (deprecated/retired); stop routing to it in this process. */
export function markUnusable(providerID: string, modelID: string) {
  unusable.add(key(providerID, modelID))
  keyRequired.add(key(providerID, modelID))
  const failures = providerFailures.get(providerID) ?? new Set<string>()
  failures.add(modelID)
  providerFailures.set(providerID, failures)
  if (failures.size >= PROVIDER_FAILURE_THRESHOLD) keyRequiredProviders.add(providerID)
}

export function needsKey(providerID: string, modelID: string) {
  return keyRequired.has(key(providerID, modelID))
}

export function isRoutable(providerID: string, modelID: string) {
  if (keyRequiredProviders.has(providerID)) return false
  return !keyRequired.has(key(providerID, modelID))
}

/** Test/reset seam. */
export function resetLearned() {
  keyRequired.clear()
  unusable.clear()
  providerFailures.clear()
  keyRequiredProviders.clear()
}

export function learned() {
  return {
    keyRequired: [...keyRequired],
    unusable: [...unusable],
    keyRequiredProviders: [...keyRequiredProviders],
  }
}

/** The gateway's free-tier failure shapes, matched on the parsed error body. */
export type FreeTierVerdict = "key-required" | "unusable" | undefined

/**
 * Classify a provider failure. The gateway answers with
 * `{"type":"error","error":{"type":"FreeTierError"|"ModelError"|"ModelDeprecated","message":…}}`,
 * and both the AI SDK and the native runtime surface that as the error's message/data. The
 * discriminator `type` is the reliable field, so it is matched first; the message phrasings are
 * a fallback for runtimes that flatten the error to text before it reaches here.
 */
export function classify(error: unknown): FreeTierVerdict {
  if (error === null || typeof error !== "object") return undefined
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  let statusDenied = false
  for (let depth = 0; depth < 6 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current)
    const value = current as Record<string, unknown>
    // Collect this level's own discriminators.
    let descend: unknown
    for (const field of [
      "message",
      "name",
      "type",
      "statusCode",
      "status",
      "code",
      "data",
      "body",
      "cause",
      "error",
      "responseBody",
      "reason",
    ]) {
      const next = value[field]
      if (typeof next === "string") parts.push(next)
      else if (typeof next === "number" && (field === "statusCode" || field === "status")) {
        // A numeric status is a discriminator too - 401/403 on its own mean "no access".
        if (next === 401 || next === 403) statusDenied = true
      } else if (next && typeof next === "object" && descend === undefined) descend = next
    }
    current = descend
  }
  const text = parts.join(" ").toLowerCase()
  if (!text && !statusDenied) return undefined
  if (text.includes("freetiererror") || text.includes("free tier can only be used")) return "key-required"
  if (statusDenied) return "key-required"
  // A generic auth failure is the same conclusion in a different envelope: the catalog
  // listed the model as free, but the credential in hand cannot use it. Treating it as
  // "needs a key" keeps the router from walking into the same dead end every turn.
  if (
    text.includes("unauthorized") ||
    text.includes("invalid token") ||
    text.includes("invalid_token") ||
    text.includes("authentication") ||
    text.includes("permission denied") ||
    text.includes("api key") ||
    text.includes("statuscode\":401") ||
    text.includes("status code 401")
  ) {
    return "key-required"
  }
  // `ModelDeprecated` (410) is a retirement, not a routing gap, but both mean the same thing to
  // this process: never select it again. Matching it here is what lets a run recover from a model
  // the catalog still advertises as active.
  if (
    text.includes("modelerror") ||
    text.includes("modeldeprecated") ||
    text.includes("model_deprecated") ||
    text.includes("has been deprecated") ||
    text.includes("is not supported") ||
    text.includes("model_not_found") ||
    text.includes("is retired")
  )
    return "unusable"
  return undefined
}

/** Record a failure so later selections stop choosing that model. */
export function learn(error: unknown, providerID: string, modelID: string): FreeTierVerdict {
  const verdict = classify(error)
  if (verdict === "key-required") markKeyRequired(providerID, modelID)
  else if (verdict === "unusable") markUnusable(providerID, modelID)
  return verdict
}

/**
 * Rank models for automatic selection (no explicit model configured).
 *
 * Order: reachable first, then live (not deprecated), then cheap, then most capable. Context
 * window is used as the capability proxy because it is the one capability number every catalog
 * entry carries - and for the anonymous tier, where everything costs nothing, price cannot
 * discriminate at all, so the smallest model would otherwise always win.
 *
 * "Not deprecated" is a *preference*, not a filter: the catalog retires models late, but when
 * every remaining model is deprecated an empty ranking would fail the turn outright, which is
 * strictly worse than trying one and learning from the refusal.
 *
 * Nothing here names a model: it is derived from the live catalog on every call.
 */
export function rankForUse<T extends { id: string; cost?: { input?: number }; limit?: { context?: number }; status?: string }>(
  models: ReadonlyArray<T>,
  providerID: string,
): T[] {
  return models
    .filter((model) => isRoutable(providerID, model.id))
    .slice()
    .sort((a, b) => {
      const live = Number(a.status === "deprecated") - Number(b.status === "deprecated")
      if (live !== 0) return live
      const cost = (a.cost?.input ?? 0) - (b.cost?.input ?? 0)
      if (cost !== 0) return cost
      const context = (b.limit?.context ?? 0) - (a.limit?.context ?? 0)
      if (context !== 0) return context
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

export * as ProviderFreeTier from "./free-tier"
