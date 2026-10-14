// packages/memory/src/extraction-models.ts
// Model resolution for background extraction (draft-10 §0d: "no hardcoded models").
//
// This package used to hardcode a Zen endpoint, a `"public"` key and three model ids, two of
// which the live catalog now marks deprecated. That bypassed the provider layer entirely: it
// ignored the user's credentials, ignored `models.background.memory`, and failed silently the
// moment Zen renamed or retired a model.
//
// Model *names* are now derived from the live catalog (models.dev) at call time — nothing is
// hardcoded, so a retired model simply drops out of the candidate list. A host that owns the
// full provider pipeline (the server) can still override the whole thing by providing
// `ExtractionModels` with a Provider-backed resolver.

import { Effect } from "effect"
import { Context } from "effect"
import { ModelsDev } from "@diveeoi/db/models-dev"
import { ProviderV2 } from "@diveeoi/db/provider"
import { OpenAICompatible } from "@diveeoi/llm/providers"
import type { Model as LLMModel } from "@diveeoi/llm"

export interface ExtractionModel {
  /** `provider/model`, for logs and error messages. */
  readonly name: string
  readonly model: LLMModel
  readonly temperature: number
}

export interface ExtractionModelResolver {
  /**
   * An Effect value with no requirements: the catalog service is captured when the layer is
   * built, while the *read* still happens per call so a catalog refresh is picked up. This is
   * what keeps `ModelsDev` out of every caller's requirements.
   */
  readonly models: Effect.Effect<ReadonlyArray<ExtractionModel>, never>
}

export class ExtractionModels extends Context.Service<ExtractionModels, ExtractionModelResolver>()(
  "@diveeoi/memory/ExtractionModels",
) {
  /** Nothing resolved: extraction is skipped instead of calling a hardcoded endpoint. */
  static readonly none: ExtractionModelResolver = { models: Effect.succeed([]) }

  /** Build a resolver from an already-resolved catalog service. */
  static from(catalog: ModelsDev.Interface): ExtractionModelResolver {
    return { models: resolveFromCatalog(catalog) }
  }
}

/** The anonymous sentinel the OpenCode Zen gateway accepts in place of a key. */
const ANONYMOUS_KEY = "public"

/** Extraction is a mechanical job: low temperature, and a bounded candidate list. */
const TEMPERATURE = 0.1
const MAX_CANDIDATES = 3

/**
 * Rank for a *background* role.
 *
 * All anonymous candidates cost nothing, so price is not a useful tie-breaker; capability is.
 * Largest context window first means the most capable reachable model does the work, and the
 * list stays short so a refusal on one candidate falls through to the next.
 *
 * Reachability is not knowable from the catalog (free price != anonymously accessible), so this
 * only orders candidates. A refusal is handled at call time by trying the next one.
 */
const rank = (a: ModelsDev.Model, b: ModelsDev.Model) => {
  const context = (b.limit?.context ?? 0) - (a.limit?.context ?? 0)
  if (context !== 0) return context
  return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

const isUsable = (model: ModelsDev.Model) => {
  if (model.status === "deprecated") return false
  if (model.cost && (model.cost.input ?? 0) > 0) return false // paid model without a key
  if (model.attachment) return false // never route extraction to a vision-only entry
  return true
}

/**
 * Derive candidates from the live catalog — no model name is ever hardcoded.
 *
 * Only the free tier of the OpenCode Zen provider is considered, because this package holds no
 * credentials of its own; a host with real credentials overrides the resolver instead. Ranking
 * is by cost then context window, both read from the catalog.
 */
const resolveFromCatalog = (catalog: ModelsDev.Interface): Effect.Effect<ReadonlyArray<ExtractionModel>, never> =>
  Effect.gen(function* () {
    const providers: Record<string, ModelsDev.Provider> = yield* catalog
      .get()
      .pipe(Effect.catch(() => Effect.succeed<Record<string, ModelsDev.Provider>>({})))
    const entry = providers[String(ProviderV2.ID.opencode)]
    const baseURL = entry?.api
    if (!entry || !baseURL) return []
    const candidates: ModelsDev.Model[] = Object.values(entry.models).filter(isUsable).sort(rank).slice(0, MAX_CANDIDATES)
    if (candidates.length === 0) return []
    return candidates.map((model) => ({
      name: `${ProviderV2.ID.opencode}/${model.id}`,
      model: OpenAICompatible.configure({
        baseURL,
        apiKey: ANONYMOUS_KEY,
        provider: ProviderV2.ID.opencode,
      }).model(model.id),
      temperature: TEMPERATURE,
    })) satisfies ReadonlyArray<ExtractionModel>
  })

export * as ExtractionModelsModule from "./extraction-models"
