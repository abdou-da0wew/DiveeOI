import { COENX_VIDEO_CAPABILITIES, type FeatureSupport, type RendererId } from "./capabilities"

export type OutputTarget = "mp4" | "interactive"
export type RuntimeProbe = {
  /** Packaged/native Rust binary availability for the Cairo frame renderer. */
  nativeBinary?: boolean
  /** FFmpeg availability for MP4 encoding. */
  ffmpeg?: boolean
}

export interface RendererPlan {
  backend: RendererId
  reasons: string[]
  /** Set when the preferred backend was rejected and a compatible one was selected. */
  fallback?: { from: RendererId; reason: string }
  requiredFeatures: string[]
  featureSupport: Record<string, Record<RendererId, FeatureSupport>>
}

const BACKEND_TARGETS: Record<RendererId, string[]> = {
  "static-svg": ["mp4"],
  "native-cairo": ["mp4"],
  "interactive-canvas": ["interactive"],
  "interactive-svg": ["interactive"],
}

const BACKEND_ORDER: Record<OutputTarget, RendererId[]> = {
  mp4: ["native-cairo", "static-svg"],
  interactive: ["interactive-canvas", "interactive-svg"],
}

const NATIVE_REQUIRED_RUNTIME: Partial<Record<RendererId, Array<keyof RuntimeProbe>>> = {
  "native-cairo": ["nativeBinary", "ffmpeg"],
  "static-svg": ["ffmpeg"],
}

function supportsAll(backend: RendererId, features: string[]): { ok: boolean; missing: string[]; partial: string[] } {
  const missing: string[] = []
  const partial: string[] = []
  for (const feature of features) {
    const entry = COENX_VIDEO_CAPABILITIES.features.find((item) => item.id === feature)
    if (!entry) {
      missing.push(feature)
      continue
    }
    const support = entry.support[backend] as FeatureSupport
    if (support === "unsupported") missing.push(feature)
    if (support === "partial") partial.push(feature)
  }
  return { ok: missing.length === 0, missing, partial }
}

/**
 * WP7 renderer-selection planner: required features + output target + runtime
 * probes + preference -> a concrete backend plan with reason codes. Never
 * silently changes semantics: unsupported features either fall back to a
 * backend that supports them (when automatic selection is allowed) or fail
 * with the feature IDs that cannot be satisfied.
 */
export function selectRenderer(options: {
  target: OutputTarget
  requiredFeatures?: string[]
  preference?: RendererId
  runtime?: RuntimeProbe
}): { ok: true; plan: RendererPlan } | { ok: false; plan: RendererPlan; missingFeatures: string[] } {
  const requiredFeatures = options.requiredFeatures ?? []
  const runtime = options.runtime ?? {}
  const candidates = BACKEND_ORDER[options.target]
  const featureSupport: Record<string, Record<RendererId, FeatureSupport>> = {}
  for (const feature of requiredFeatures) {
    const entry = COENX_VIDEO_CAPABILITIES.features.find((item) => item.id === feature)
    featureSupport[feature] =
      entry?.support ??
      Object.fromEntries(
        Object.keys(BACKEND_TARGETS).map((backend) => [backend, "unsupported" as FeatureSupport]),
      ) as Record<RendererId, FeatureSupport>
  }

  const ordered = options.preference
    ? [options.preference, ...candidates.filter((backend) => backend !== options.preference)]
    : candidates

  const reasons: string[] = []
  let fallback: RendererPlan["fallback"] | undefined
  const preferred = ordered[0]
  for (const backend of ordered) {
    const targetOk = BACKEND_TARGETS[backend].includes(options.target)
    if (!targetOk) {
      reasons.push(`${backend}: skipped (target ${options.target} not provided by this backend)`)
      continue
    }
    const runtimeKeys = NATIVE_REQUIRED_RUNTIME[backend] ?? []
    const missingRuntime = runtimeKeys.filter((key) => runtime[key] === false)
    if (missingRuntime.length) {
      reasons.push(`${backend}: skipped (missing runtime: ${missingRuntime.join(", ")})`)
      continue
    }
    const support = supportsAll(backend, requiredFeatures)
    if (!support.ok) {
      reasons.push(`${backend}: skipped (unsupported features: ${support.missing.join(", ")})`)
      continue
    }
    if (backend !== preferred && !fallback) {
      fallback = {
        from: preferred,
        reason: options.preference && backend !== options.preference
          ? "preferred backend unavailable for this target/feature set"
          : `preferred backend skipped: ${reasons.at(-1)?.replace(`${preferred}: `, "") ?? "unavailable"}`,
      }
    }
    if (support.partial.length) {
      reasons.push(`${backend}: selected (partial capabilities: ${support.partial.join(", ")})`)
    } else {
      reasons.push(`${backend}: selected (all ${requiredFeatures.length || 0} required features supported)`)
    }
    return {
      ok: true,
      plan: { backend, reasons, fallback, requiredFeatures, featureSupport },
    }
  }
  return {
    ok: false,
    missingFeatures: requiredFeatures,
    plan: {
      backend: candidates[0],
      reasons: [
        ...reasons,
        `no backend on target ${options.target} supports the requested feature set; supported features per backend are listed in coenx_video_capabilities`,
      ],
      requiredFeatures,
      featureSupport,
    },
  }
}
