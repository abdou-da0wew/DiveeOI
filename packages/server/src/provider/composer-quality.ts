// Catalog-based local quality estimates for Composer when benchmark data is unavailable.
// These are heuristics, not benchmark scores. The router uses them only after explicit opt-in.

export interface Quality {
  readonly tier: number
  readonly score: number
  readonly reasons: ReadonlyArray<string>
  readonly lineage: string
}

type ModelLike = {
  readonly id: string
  readonly name?: string
  readonly family?: string
  readonly capabilities?: {
    readonly reasoning?: boolean
    readonly input?: {
      readonly image?: boolean
      readonly pdf?: boolean
      readonly audio?: boolean
      readonly video?: boolean
    }
  }
  readonly limit?: { readonly context?: number; readonly output?: number }
  readonly release_date?: string
  readonly status?: string
}

const FAMILY_PRIORS: Readonly<Record<string, number>> = {
  "big pickle": 3.7,
  "gpt oss": 3.8,
  claude: 4.6,
  anthropic: 4.6,
  openai: 4.5,
  gpt: 4.5,
  gemini: 4.4,
  google: 4.4,
  grok: 4.1,
  xai: 4.1,
  deepseek: 4.5,
  glm: 4.45,
  zhipu: 4.45,
  kimi: 4.35,
  moonshot: 4.35,
  minimax: 4.3,
  qwen: 4.2,
  doubao: 4.15,
  seed: 4.1,
  nemotron: 4.0,
  mimo: 3.95,
  mistral: 3.9,
  codestral: 3.9,
  devstral: 3.85,
  llama: 3.8,
  gemma: 3.8,
  stepfun: 3.75,
  step: 3.7,
  hunyuan: 3.7,
  ling: 3.7,
  longcat: 3.8,
  granite: 3.45,
  hermes: 3.45,
  qwq: 3.6,
  r1: 3.7,
  trinity: 3.4,
  beam: 3.4,
  solar: 3.3,
  phi: 3.2,
  starcoder: 3.3,
  exo: 2.8,
}
const FAMILY_KEYS = Object.keys(FAMILY_PRIORS).sort((a, b) => b.length - a.length)
const STRONG: Readonly<Record<string, number>> = {
  flagship: 0.45,
  ultra: 0.35,
  max: 0.3,
  pro: 0.25,
  opus: 0.4,
  sonnet: 0.2,
  coder: 0.25,
  thinking: 0.2,
  reasoner: 0.25,
  reasoning: 0.15,
  super: 0.25,
}
const SMALL: Readonly<Record<string, number>> = {
  nano: -0.9,
  tiny: -0.9,
  micro: -0.8,
  mini: -0.55,
  small: -0.65,
  lite: -0.5,
  light: -0.4,
  lightning: -0.45,
  flash: -0.2,
  turbo: -0.15,
  air: -0.35,
  haiku: -0.45,
  scout: -0.25,
  distill: -0.7,
  qlora: -0.8,
  experimental: -0.35,
  preview: -0.15,
  alpha: -0.3,
}

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter(Boolean)
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const normalize = (value: string) =>
  " " +
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim() +
  " "

function familyOf(model: ModelLike) {
  const identity = normalize([model.family ?? "", model.id, model.name ?? ""].join(" "))
  const declared = model.family ? normalize(model.family).trim() : ""
  if (declared && FAMILY_PRIORS[declared] !== undefined) return declared
  for (const family of FAMILY_KEYS) {
    if (identity.includes(normalize(family))) return family
  }
  return (
    tokenize([model.family ?? "", model.id, model.name ?? ""].join(" ")).find(
      (token) => !/^\d/.test(token) && token.length > 1,
    ) ?? "unknown"
  )
}

function version(value: string): number[] {
  const match = value.match(/(?:^|[^a-z])v?(\d+)(?:[._-](\d+))?/i)
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : []
}

function compareVersions(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left - right
  }
  return 0
}

/** Heuristic quality estimate from model catalog metadata. */
export function classify(model: ModelLike, preferred: ReadonlyArray<string> = []): Quality {
  const family = familyOf(model)
  const identity = [model.id, model.name ?? ""].join(" ")
  const words = new Set(tokenize(identity))
  const reasons: string[] = []
  let tier = FAMILY_PRIORS[family] ?? 2.8
  reasons.push(FAMILY_PRIORS[family] === undefined ? "unknown family prior: " + family : "family prior: " + family)

  for (const word of words) {
    if (STRONG[word] !== undefined) {
      tier += STRONG[word]
      reasons.push("variant " + word + " +" + STRONG[word])
    }
    if (SMALL[word] !== undefined) {
      tier += SMALL[word]
      reasons.push("variant " + word + " " + SMALL[word])
    }
  }

  const input = model.capabilities?.input
  const context = Math.max(0, model.limit?.context ?? 0)
  const output = Math.max(0, model.limit?.output ?? 0)
  let score = clamp(tier, 0, 5) * 15

  if (model.capabilities?.reasoning) {
    score += 5
    if (FAMILY_PRIORS[family] === undefined) tier += 0.2
    reasons.push("reasoning support")
  }
  for (const [supported, bonus, label] of [
    [input?.image, 2.5, "vision input"],
    [input?.pdf, 1.5, "PDF input"],
    [input?.audio, 1, "audio input"],
    [input?.video, 1, "video input"],
  ] as const) {
    if (supported) {
      score += bonus
      reasons.push(label)
    }
  }
  if (context > 0) {
    score += clamp(Math.log2(context / 32_000) * 1.6, 0, 6)
    if (context >= 100_000) reasons.push("context " + Math.round(context / 1000) + "k")
  }
  if (output > 0) {
    score += clamp(Math.log2(output / 8_000) * 1.1, 0, 4)
    if (output >= 16_000) reasons.push("output " + Math.round(output / 1000) + "k")
  }

  const released = model.release_date ? Date.parse(model.release_date) : NaN
  if (Number.isFinite(released)) {
    const ageDays = (Date.now() - released) / 86_400_000
    if (ageDays >= -30 && ageDays <= 180) {
      score += 2
      reasons.push("recent release metadata")
    } else if (ageDays > 730) {
      score -= 1.5
      reasons.push("older release metadata")
    }
  }
  if (model.status === "alpha") {
    score -= 2
    tier -= 0.15
    reasons.push("alpha status")
  } else if (model.status === "beta") {
    score -= 0.75
    tier -= 0.05
    reasons.push("beta status")
  }

  for (const pattern of preferred) {
    if (!matches(model, pattern)) continue
    tier = 5
    score += 15
    reasons.push("preferred (" + pattern + ")")
    break
  }

  return {
    tier: clamp(tier, 0, 5),
    score: Math.round(clamp(score, 0, 100)),
    reasons,
    lineage: family + "-" + (version(identity).join(".") || "0"),
  }
}

/** Glob-ish match: '*' matches any number of characters and '?' matches one. */
export function matches(model: ModelLike, pattern: string) {
  const text = [model.id, model.name ?? ""].join(" ").toLowerCase()
  const target = pattern.toLowerCase().trim()
  if (!target) return false
  if (!target.includes("*") && !target.includes("?")) return text.includes(target)
  const escaped = target
    .split("")
    .map((char) => (char === "*" ? ".*" : char === "?" ? "." : ".^$+()|[]{}\\".includes(char) ? "\\" + char : char))
    .join("")
  return new RegExp("^" + escaped + "$").test(text) || new RegExp("\\s" + escaped + "$").test(text)
}

export function compareQuality(a: Quality, b: Quality) {
  if (b.tier !== a.tier) return b.tier - a.tier
  if (b.score !== a.score) return b.score - a.score
  return a.lineage < b.lineage ? 1 : a.lineage > b.lineage ? -1 : 0
}

/** Compare generations only within the same detected family. */
export function compareLineage(a: ModelLike, b: ModelLike) {
  if (familyOf(a) !== familyOf(b)) return 0
  return compareVersions(version([b.id, b.name ?? ""].join(" ")), version([a.id, a.name ?? ""].join(" ")))
}

export * as ComposerQuality from "./composer-quality"
