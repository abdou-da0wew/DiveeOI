// packages/server/src/provider/composer-quality.ts
// Quality classifier for the models DiveeComposer can route to.
//
// The catalog has no quality score: `cost.input === 0` is true for every free model, and
// nothing in models.dev says "this one is good at code". So the score is computed from four
// independent signals, each of which is a real, checkable property of the model:
//
//   1. Family tier   - a curated table of the model families that actually appear in free
//                      tiers, with the generation that is known to be capable.
//   2. Variant tier  - the words in the model name ("pro", "ultra", "flash", "nano",
//                      "distill", "preview", ...) move a model up or down inside its family.
//   3. Lineage       - within a family the newer generation wins (v4.2 > v4.1 > v3.2), so a
//                      provider that ships several generations routes to the best one.
//   4. Capabilities  - reasoning, tool calling, vision, context window and output budget,
//                      read from the catalog entry itself.
//
// The tier table is deliberately conservative: an unknown family gets a middling tier rather
// than a free pass, so a new "amazing-9000" model has to earn its place. Users can override
// the ranking with `performance.composer.preferred` (glob patterns that boost a model) and
// `performance.composer.min_tier` (the quality bar a candidate must clear).

export interface Quality {
  /** 0 (unusable) .. 5 (flagship). */
  readonly tier: number
  /** 0..100, comparable within the same candidate pool. */
  readonly score: number
  /** Human readable reasons, logged with the routing decision. */
  readonly reasons: ReadonlyArray<string>
  /** Family + generation, e.g. "deepseek-v4.1". Used to compare candidates of one family. */
  readonly lineage: string
}

type ModelLike = {
  readonly id: string
  readonly name?: string
  readonly family?: string
  readonly capabilities?: {
    readonly reasoning?: boolean
    readonly toolcall?: boolean
    readonly attachment?: boolean
    readonly input?: { readonly image?: boolean; readonly pdf?: boolean; readonly audio?: boolean; readonly video?: boolean }
  }
  readonly limit?: { readonly context?: number; readonly output?: number }
  readonly release_date?: string
  readonly status?: string
}

/**
 * Base tier per model family. Keys are matched against the model id/name, lower-cased.
 * The value is the tier of the family's *current best* generation; the version lineage and
 * the variant words adjust from there.
 */
const FAMILY_TIERS: Record<string, number> = {
  // Frontier labs
  claude: 5,
  anthropic: 5,
  gpt: 5,
  openai: 5,
  gemini: 4.5,
  google: 4.5,
  grok: 4,
  xai: 4,
  // Strong open weights
  deepseek: 4.5,
  glm: 4.5,
  zhipu: 4.5,
  kimi: 4.5,
  moonshot: 4.5,
  minimax: 4.5,
  qwen: 4,
  qwen3: 4,
  doubao: 4,
  seed: 4,
  step: 3.5,
  stepfun: 3.5,
  hy3: 3.5,
  hunyuan: 3.5,
  nemotron: 3.5,
  langchain: 3.5,
  mimo: 3.5,
  ling: 3.5,
  longcat: 3.5,
  agentic: 3.5,
  gemma: 3,
  mistral: 3,
  devstral: 3,
  magistral: 3,
  llama: 2.5,
  gpt_oss: 3,
  "gpt-oss": 3,
  exo: 1.5,
  // Named / community models we know the quality of
  "big-pickle": 4.5,
  "big pickle": 4.5,
  pickle: 4,
  beam: 3.5,
  laguna: 3,
  trinity: 3,
  solar: 2.5,
  qwq: 3,
  hermes: 3,
  phi: 2,
  granite: 2,
  codestral: 3,
  starcoder: 2.5,
  r1: 3.5,
}

/** Words that mark a model as the stronger variant of its family. */
const STRONG_TOKENS: Record<string, number> = {
  ultra: 0.5,
  pro: 0.5,
  max: 0.5,
  flagship: 0.6,
  opus: 0.6,
  sonnet: 0.3,
  premium: 0.4,
  plus: 0.3,
  coder: 0.4,
  thinking: 0.4,
  reasoner: 0.4,
  super: 0.5,
  vl: 0.2,
}

/** Words that mark a model as the cheaper/smaller variant of its family. */
const WEAK_TOKENS: Record<string, number> = {
  nano: -1.2,
  mini: -0.7,
  small: -0.9,
  tiny: -1.2,
  lite: -0.8,
  light: -0.6,
  lightning: -0.8,
  flash: -0.3,
  turbo: -0.3,
  air: -0.6,
  haiku: -0.8,
  quasar: -0.5,
  scout: -0.5,
  exp: -0.7,
  experimental: -0.8,
  preview: -0.4,
  alpha: -0.6,
  beta: -0.2,
  distill: -1.4,
  qlora: -1.5,
}

/** Parse the first dotted version of a model name, e.g. "V4.1" -> [4, 1]. */
function version(name: string): number[] {
  const match = name.match(/(\d+)(?:[.\-_](\d+))?/)
  if (!match) return []
  const major = Number(match[1])
  const minor = match[2] ? Number(match[2]) : 0
  return [major, minor]
}

const tokenize = (text: string) => text.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean)

function familyOf(model: ModelLike): { family: string; rest: string } {
  const text = `${model.id} ${model.name ?? ""}`.toLowerCase()
  const tokens = tokenize(text)
  // Prefer an explicit family field when the catalog provides one.
  const declared = model.family?.toLowerCase()
  if (declared && FAMILY_TIERS[declared] !== undefined) {
    return { family: declared, rest: tokens.filter((t) => t !== declared).join(" ") }
  }
  // Multi-word families ("big pickle", "gpt oss") only match as a phrase.
  for (const key of Object.keys(FAMILY_TIERS)) {
    if (!key.includes(" ")) continue
    if (text.includes(key)) return { family: key, rest: tokens.join(" ") }
  }
  for (const token of tokens) {
    if (FAMILY_TIERS[token] !== undefined) return { family: token, rest: tokens.filter((t) => t !== token).join(" ") }
  }
  // Fall back to the first token that is not a version-ish word.
  const fallback = tokens.find((t) => !/^\d/.test(t) && t.length > 1) ?? tokens[0] ?? "unknown"
  return { family: fallback, rest: tokens.filter((t) => t !== fallback).join(" ") }
}

/** Compare two version arrays: positive when a is newer than b. */
function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left - right
  }
  return 0
}

/**
 * Score one model.
 *
 * `preferred` is the user's similarity list: glob patterns of model names that should be
 * treated as known-good. A matching model gets a large boost and a clear reason in the log.
 */
export function classify(model: ModelLike, preferred: ReadonlyArray<string> = []): Quality {
  const { family, rest } = familyOf(model)
  const reasons: string[] = []

  let tier = FAMILY_TIERS[family] ?? 2.5
  if (FAMILY_TIERS[family] === undefined) reasons.push(`family "${family}" is not in the tier table`)

  // Variant words. The id and the name are tokenized together, so the same word can appear
  // twice ("opus" in the id and in the name) - count it once.
  const words = new Set(tokenize(`${model.id} ${model.name ?? ""}`))
  for (const word of words) {
    const strong = STRONG_TOKENS[word]
    if (strong !== undefined) {
      tier += strong
      reasons.push(`"${word}" +${strong}`)
    }
    const weak = WEAK_TOKENS[word]
    if (weak !== undefined) {
      tier += weak
      reasons.push(`"${word}" ${weak}`)
    }
  }

  // The family token itself is a version when the family is numeric-ish ("qwen3", "glm-5").
  const familyVersion = version(family)

  // Capability signals.
  const capabilities = model.capabilities
  const context = model.limit?.context ?? 0
  const output = model.limit?.output ?? 0
  let score = tier * 12

  if (capabilities?.reasoning) {
    score += 6
    reasons.push("reasoning")
  }
  if (capabilities?.input?.image) {
    score += 5
    reasons.push("vision")
  }
  if (capabilities?.input?.pdf) {
    score += 2
    reasons.push("pdf")
  }
  if (context >= 200_000) {
    score += 6
    reasons.push(`context ${Math.round(context / 1000)}k`)
  } else if (context >= 100_000) {
    score += 3
    reasons.push(`context ${Math.round(context / 1000)}k`)
  }
  if (output >= 32_000) {
    score += 2
    reasons.push(`output ${Math.round(output / 1000)}k`)
  }

  // Recency: a model released in the last ~6 months is more likely to be current.
  const released = model.release_date ? Date.parse(model.release_date) : NaN
  if (!Number.isNaN(released)) {
    const ageDays = (Date.now() - released) / 86_400_000
    if (ageDays <= 180) {
      score += 3
      reasons.push("recent")
    } else if (ageDays > 540) {
      score -= 3
      reasons.push("older")
    }
  }

  // The user's similarity list wins over the table: a preferred model is treated as
  // top-tier, so it is picked before anything the built-in ranking prefers.
  for (const pattern of preferred) {
    if (matches(model, pattern)) {
      score += 40
      tier = 5
      reasons.push(`preferred (${pattern})`)
      break
    }
  }

  const lineage = `${family}-${version(`${model.id} ${model.name ?? ""}`).join(".") || "0"}`
  return { tier: Math.max(0, Math.min(5, tier)), score: Math.round(score), reasons, lineage }
}

/** Glob-ish match: `*` matches anything, `?` matches one character. */
export function matches(model: ModelLike, pattern: string): boolean {
  const text = `${model.id} ${model.name ?? ""}`.toLowerCase()
  const target = pattern.toLowerCase().trim()
  if (!target) return false
  if (!target.includes("*") && !target.includes("?")) return text.includes(target)
  const escaped = target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`).test(text) || new RegExp(`\\s${escaped}$`).test(text)
}

/** Compare two classified models: better first. */
export function compareQuality(a: Quality, b: Quality): number {
  if (b.tier !== a.tier) return b.tier - a.tier
  if (b.score !== a.score) return b.score - a.score
  return a.lineage < b.lineage ? 1 : a.lineage > b.lineage ? -1 : 0
}

/** Version-aware comparison inside one family: newer generation first. */
export function compareLineage(a: ModelLike, b: ModelLike): number {
  const va = version(`${a.id} ${a.name ?? ""}`)
  const vb = version(`${b.id} ${b.name ?? ""}`)
  return compareVersions(vb, va)
}

export * as ComposerQuality from "./composer-quality"
