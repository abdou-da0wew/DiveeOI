import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@diveeoi/db/global"
import type { Model } from "./provider"

const BASE_URL = "https://artificialanalysis.ai/api/v2/language/models/free"
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
const CACHE_FILE = path.join(Global.Path.cache, "composer", "artificial-analysis-free.json")

type RawModel = {
  name?: string
  slug?: string
  evaluations?: {
    artificial_analysis_intelligence_index?: number | null
    artificial_analysis_coding_index?: number | null
    artificial_analysis_agentic_index?: number | null
    artificial_analysis_finance_and_accounting_index?: number | null
    artificial_analysis_strategy_and_ops_index?: number | null
    artificial_analysis_legal_index?: number | null
    artificial_analysis_healthcare_and_medical_index?: number | null
    artificial_analysis_engineering_index?: number | null
    artificial_analysis_economics_index?: number | null
  }
  performance?: {
    median_output_tokens_per_second?: number | null
    median_time_to_first_token_seconds?: number | null
    median_time_to_first_answer_token_seconds?: number | null
    median_end_to_end_response_time_seconds?: number | null
  }
}

type ModelScore = {
  readonly name: string
  readonly slug: string
  readonly score: number
  readonly intelligence?: number
  readonly coding?: number
  readonly agentic?: number
  readonly capabilityAverage?: number
  readonly outputTokensPerSecond?: number
  readonly timeToFirstTokenSeconds?: number
  readonly timeToFirstAnswerTokenSeconds?: number
  readonly endToEndResponseTimeSeconds?: number
}

const scores = new Map<string, ModelScore>()
let refreshedAt = 0
let lastAttemptAt = 0
let retryAfter = 0
let refreshing: Promise<void> | undefined
let cacheLoaded = false

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(free|latest|preview|experimental|reasoning)\b/g, " ")
    .replace(/[^a-z0-9]/g, "")
}

function values(input: RawModel): ModelScore | undefined {
  const evaluations = input.evaluations ?? {}
  const capabilityValues = [
    evaluations.artificial_analysis_finance_and_accounting_index,
    evaluations.artificial_analysis_strategy_and_ops_index,
    evaluations.artificial_analysis_legal_index,
    evaluations.artificial_analysis_healthcare_and_medical_index,
    evaluations.artificial_analysis_engineering_index,
    evaluations.artificial_analysis_economics_index,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  const capabilityAverage = capabilityValues.length
    ? capabilityValues.reduce((sum, value) => sum + value, 0) / capabilityValues.length
    : undefined
  const weighted = [
    [evaluations.artificial_analysis_intelligence_index, 0.3],
    [evaluations.artificial_analysis_coding_index, 0.3],
    [evaluations.artificial_analysis_agentic_index, 0.25],
    [capabilityAverage, 0.15],
  ] as const
  const available = weighted.filter(([value]) => typeof value === "number" && Number.isFinite(value))
  if (!input.slug || available.length === 0) return undefined

  const weight = available.reduce((total, [, part]) => total + part, 0)
  const indexScore = available.reduce((total, [value, part]) => total + Number(value) * part, 0) / weight
  const output = input.performance?.median_output_tokens_per_second
  const ttft = input.performance?.median_time_to_first_token_seconds
  const speedScore =
    typeof output === "number" && output > 0 ? Math.min(100, (Math.log1p(output) / Math.log1p(250)) * 100) : undefined
  const latencyScore = typeof ttft === "number" && ttft >= 0 ? Math.max(0, 100 * Math.exp(-ttft / 12)) : undefined
  const performanceParts = [speedScore, latencyScore].filter((value): value is number => value !== undefined)
  const performanceScore = performanceParts.length
    ? performanceParts.reduce((sum, value) => sum + value, 0) / performanceParts.length
    : undefined
  const score = performanceScore === undefined ? indexScore : indexScore * 0.82 + performanceScore * 0.18

  return {
    name: input.name ?? input.slug,
    slug: input.slug,
    score: Math.round(score * 10) / 10,
    intelligence: evaluations.artificial_analysis_intelligence_index ?? undefined,
    coding: evaluations.artificial_analysis_coding_index ?? undefined,
    agentic: evaluations.artificial_analysis_agentic_index ?? undefined,
    capabilityAverage,
    outputTokensPerSecond: output ?? undefined,
    timeToFirstTokenSeconds: ttft ?? undefined,
    timeToFirstAnswerTokenSeconds: input.performance?.median_time_to_first_answer_token_seconds ?? undefined,
    endToEndResponseTimeSeconds: input.performance?.median_end_to_end_response_time_seconds ?? undefined,
  }
}

function remember(score: ModelScore) {
  scores.set(normalize(score.slug), score)
  scores.set(normalize(score.name), score)
}

async function loadCache() {
  if (cacheLoaded) return
  cacheLoaded = true
  try {
    const parsed = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as {
      version?: number
      refreshedAt?: number
      retryAfter?: number
      scores?: ModelScore[]
    }
    if (parsed.version !== 1 || !Number.isFinite(parsed.refreshedAt) || !Array.isArray(parsed.scores)) return
    for (const item of parsed.scores) {
      if (item && typeof item.slug === "string" && typeof item.name === "string" && Number.isFinite(item.score)) {
        remember(item)
      }
    }
    if (scores.size > 0) refreshedAt = parsed.refreshedAt!
    if (Number.isFinite(parsed.retryAfter) && parsed.retryAfter! > Date.now()) retryAfter = parsed.retryAfter!
  } catch {
    // A missing/corrupt cache only means the next request refreshes the public catalog.
  }
}

async function persistCache() {
  const unique = [...new Map([...scores.values()].map((item) => [item.slug, item])).values()]
  const payload = JSON.stringify({ version: 1, refreshedAt, retryAfter, scores: unique })
  const directory = path.dirname(CACHE_FILE)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = `${CACHE_FILE}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, payload, { flag: "wx", mode: 0o600 })
    await fs.rename(temporary, CACHE_FILE)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function requestPage(apiKey: string, page: number) {
  const response = await fetch(`${BASE_URL}?page=${page}`, {
    headers: { "x-api-key": apiKey, accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const error = new Error(`Artificial Analysis catalog request failed (${response.status})`)
    Object.assign(error, { status: response.status, retryAfter: response.headers.get("retry-after") })
    throw error
  }
  return (await response.json()) as { pagination?: { total_pages?: number }; data?: RawModel[] }
}

/** Refresh the measured model catalog. A stale cache remains usable if the API is unavailable. */
export async function refresh(apiKey: string, force = false) {
  if (!apiKey.trim()) return
  await loadCache()
  const now = Date.now()
  if (!force && scores.size > 0 && now - refreshedAt < CACHE_TTL_MS) return
  if (!force && now < retryAfter) return
  if (!force && now - lastAttemptAt < 5 * 60 * 1000) return
  if (refreshing) return refreshing

  lastAttemptAt = now
  refreshing = (async () => {
    try {
      const first = await requestPage(apiKey, 1)
      const pages = Math.max(1, Math.min(first.pagination?.total_pages ?? 1, 20))
      const catalog = [...(first.data ?? [])]
      for (let page = 2; page <= pages; page++) {
        const next = await requestPage(apiKey, page)
        catalog.push(...(next.data ?? []))
      }

      const nextScores = new Map<string, ModelScore>()
      for (const item of catalog) {
        const score = values(item)
        if (!score) continue
        nextScores.set(normalize(score.slug), score)
        nextScores.set(normalize(score.name), score)
      }
      if (nextScores.size > 0) {
        scores.clear()
        for (const [key, value] of nextScores) scores.set(key, value)
        refreshedAt = Date.now()
        retryAfter = 0
        await persistCache()
      }
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0
      const retrySeconds =
        error && typeof error === "object" && "retryAfter" in error ? Number(error.retryAfter) : Number.NaN
      const delay =
        status === 429
          ? Number.isFinite(retrySeconds) && retrySeconds > 0
            ? Math.min(24 * 60 * 60 * 1000, retrySeconds * 1000)
            : 6 * 60 * 60 * 1000
          : 5 * 60 * 1000
      retryAfter = Date.now() + delay
      await persistCache().catch(() => undefined)
      throw error
    } finally {
      refreshing = undefined
    }
  })()

  return refreshing
}

/** Match provider catalog metadata to Artificial Analysis by normalized model identity. */
export function scoreFor(model: Model): ModelScore | undefined {
  const identities = [model.id, model.api?.id, model.name, model.family]
    .filter((value): value is string => !!value)
    .flatMap((value) => {
      const tail = value.split("/").at(-1) ?? value
      return [normalize(value), normalize(tail)]
    })
    .filter((value) => value.length > 0)
  for (const identity of identities) {
    const exact = scores.get(identity)
    if (exact) return exact
  }

  let best: { score: ModelScore; length: number } | undefined
  for (const [identity, score] of scores) {
    if (identity.length < 7) continue
    for (const candidate of identities) {
      if (candidate.length < 7) continue
      if (identity.includes(candidate) || candidate.includes(identity)) {
        const length = Math.min(identity.length, candidate.length)
        if (!best || length > best.length) best = { score, length }
      }
    }
  }
  return best?.score
}

export function catalogStatus() {
  return { models: new Set(scores.values()).size, refreshedAt }
}

export function reset() {
  scores.clear()
  refreshedAt = 0
  lastAttemptAt = 0
  retryAfter = 0
  refreshing = undefined
  cacheLoaded = false
}

export * as ArtificialAnalysis from "./artificial-analysis"
