// packages/db/src/adaptive/profiles.ts
import type { SystemResources } from "./detect"

export type ResourceProfile = "comfortable" | "balanced" | "constrained" | "critical"

export interface AdaptiveTargets {
  rssTargetMB: number
  heapTargetMB: number
  gcIntervalMs: number
  maxToolConcurrency: number
  maxLLMStreamBuffer: number
  maxSSEQueueSize: number
  maxWSConnections: number
  ptyTicketCapacity: number
  ptyTicketTTLMs: number
  cacheTTLMs: number
  sqliteCacheMB: number
  llmRequestTimeoutMs: number
  dbQueryTimeoutMs: number
}

// Hysteresis thresholds (prevent oscillation)
const PROFILE_THRESHOLDS = {
  comfortable: { minFreeMB: 4096, minFreeRatio: 0.5 },
  balanced:    { minFreeMB: 1024, minFreeRatio: 0.2 },
  constrained: { minFreeMB: 512,  minFreeRatio: 0.1 },
  critical:    { minFreeMB: 0,    minFreeRatio: 0 },
} as const

export const computeProfile = (sys: SystemResources): ResourceProfile => {
  const freeMB = sys.availableMemoryMB
  const freeRatio = sys.availableMemoryMB / sys.totalMemoryMB

  if (freeMB >= PROFILE_THRESHOLDS.comfortable.minFreeMB && freeRatio >= PROFILE_THRESHOLDS.comfortable.minFreeRatio) return "comfortable"
  if (freeMB >= PROFILE_THRESHOLDS.balanced.minFreeMB && freeRatio >= PROFILE_THRESHOLDS.balanced.minFreeRatio) return "balanced"
  if (freeMB >= PROFILE_THRESHOLDS.constrained.minFreeMB && freeRatio >= PROFILE_THRESHOLDS.constrained.minFreeRatio) return "constrained"
  return "critical"
}

// Base targets scaled by profile multipliers
const BASE_TARGETS: AdaptiveTargets = {
  rssTargetMB: 500,
  heapTargetMB: 300,
  gcIntervalMs: 30000,
  maxToolConcurrency: 4,
  maxLLMStreamBuffer: 100,
  maxSSEQueueSize: 500,
  maxWSConnections: 500,
  ptyTicketCapacity: 2000,
  ptyTicketTTLMs: 60000,
  cacheTTLMs: 600000,
  sqliteCacheMB: 64,
  llmRequestTimeoutMs: 60000,
  dbQueryTimeoutMs: 5000,
}

const PROFILE_MULTIPLIERS: Record<ResourceProfile, Partial<AdaptiveTargets>> = {
  comfortable: { rssTargetMB: 700, heapTargetMB: 400, gcIntervalMs: 60000, maxToolConcurrency: 8, maxLLMStreamBuffer: 200, maxSSEQueueSize: 1000, maxWSConnections: 1000, ptyTicketCapacity: 5000, ptyTicketTTLMs: 120000, cacheTTLMs: 1800000, sqliteCacheMB: 128 },
  balanced: { rssTargetMB: 500, heapTargetMB: 300, gcIntervalMs: 30000, maxToolConcurrency: 4, maxLLMStreamBuffer: 100, maxSSEQueueSize: 500, maxWSConnections: 500, ptyTicketCapacity: 2000, ptyTicketTTLMs: 60000, cacheTTLMs: 600000, sqliteCacheMB: 64 },
  constrained: { rssTargetMB: 350, heapTargetMB: 200, gcIntervalMs: 15000, maxToolConcurrency: 2, maxLLMStreamBuffer: 50, maxSSEQueueSize: 200, maxWSConnections: 200, ptyTicketCapacity: 500, ptyTicketTTLMs: 30000, cacheTTLMs: 120000, sqliteCacheMB: 16 },
  critical: { rssTargetMB: 250, heapTargetMB: 150, gcIntervalMs: 8000, maxToolConcurrency: 1, maxLLMStreamBuffer: 25, maxSSEQueueSize: 100, maxWSConnections: 100, ptyTicketCapacity: 200, ptyTicketTTLMs: 15000, cacheTTLMs: 60000, sqliteCacheMB: 8 },
}

export const computeTargets = (sys: SystemResources): AdaptiveTargets => {
  const profile = computeProfile(sys)
  const mult = PROFILE_MULTIPLIERS[profile]
  const baseRSS = Math.min(BASE_TARGETS.rssTargetMB, Math.round(sys.totalMemoryMB * 0.12))
  const baseHeap = Math.min(BASE_TARGETS.heapTargetMB, Math.round(sys.totalMemoryMB * 0.07))

  return {
    ...BASE_TARGETS,
    ...mult,
    rssTargetMB: Math.min(mult.rssTargetMB ?? BASE_TARGETS.rssTargetMB, baseRSS),
    heapTargetMB: Math.min(mult.heapTargetMB ?? BASE_TARGETS.heapTargetMB, baseHeap),
    maxToolConcurrency: Math.max(1, Math.min(mult.maxToolConcurrency ?? BASE_TARGETS.maxToolConcurrency, sys.cpuCores)),
  }
}

// Smooth interpolation for live updates (prevents jumps)
export const interpolateTargets = (current: AdaptiveTargets, next: AdaptiveTargets, factor = 0.3): AdaptiveTargets => {
  const keys = Object.keys(current) as (keyof AdaptiveTargets)[]
  return keys.reduce((acc, k) => {
    acc[k] = Math.round(current[k] + (next[k] - current[k]) * factor)
    return acc
  }, {} as AdaptiveTargets)
}
