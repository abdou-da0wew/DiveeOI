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
  // Agent subsystems (draft-10)
  maxConcurrentTasks: number
  heartbeatIntervalMs: number
  watchdogStallMs: number
  ftsBatchRows: number
  anchorCacheTTLms: number
  anchorCheckpointEveryToolCalls: number
  ftsOptimizeDebounceMs: number
  shellMetadataFlushMs: number
  todoReminderEveryToolCalls: number
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
  maxConcurrentTasks: 2,
  heartbeatIntervalMs: 45000,
  watchdogStallMs: 240000,
  ftsBatchRows: 2000,
  anchorCacheTTLms: 300000,
  anchorCheckpointEveryToolCalls: 15,
  ftsOptimizeDebounceMs: 300000,
  shellMetadataFlushMs: 250,
  todoReminderEveryToolCalls: 8,
}

const PROFILE_MULTIPLIERS: Record<ResourceProfile, Partial<AdaptiveTargets>> = {
  comfortable: {
    rssTargetMB: 350,
    heapTargetMB: 200,
    gcIntervalMs: 15000,
    maxToolConcurrency: 2,
    maxLLMStreamBuffer: 50,
    maxSSEQueueSize: 200,
    maxWSConnections: 200,
    ptyTicketCapacity: 500,
    ptyTicketTTLMs: 30000,
    cacheTTLMs: 120000,
    sqliteCacheMB: 16,
    maxConcurrentTasks: 1,
    heartbeatIntervalMs: 60000,
    watchdogStallMs: 300000,
    ftsBatchRows: 500,
    anchorCacheTTLms: 120000,
    anchorCheckpointEveryToolCalls: 0,
    ftsOptimizeDebounceMs: 600000,
    shellMetadataFlushMs: 500,
    todoReminderEveryToolCalls: 10,
  },
  balanced: {
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
    maxConcurrentTasks: 2,
    heartbeatIntervalMs: 45000,
    watchdogStallMs: 240000,
    ftsBatchRows: 2000,
    anchorCacheTTLms: 300000,
    anchorCheckpointEveryToolCalls: 15,
    ftsOptimizeDebounceMs: 300000,
    shellMetadataFlushMs: 250,
    todoReminderEveryToolCalls: 8,
  },
  constrained: {
    rssTargetMB: 700,
    heapTargetMB: 400,
    gcIntervalMs: 60000,
    maxToolConcurrency: 8,
    maxLLMStreamBuffer: 200,
    maxSSEQueueSize: 1000,
    maxWSConnections: 1000,
    ptyTicketCapacity: 5000,
    ptyTicketTTLMs: 120000,
    cacheTTLMs: 1800000,
    sqliteCacheMB: 128,
    maxConcurrentTasks: 4,
    heartbeatIntervalMs: 30000,
    watchdogStallMs: 180000,
    ftsBatchRows: 5000,
    anchorCacheTTLms: 600000,
    anchorCheckpointEveryToolCalls: 10,
    ftsOptimizeDebounceMs: 120000,
    shellMetadataFlushMs: 150,
    todoReminderEveryToolCalls: 6,
  },
  critical: {
    rssTargetMB: 1000,
    heapTargetMB: 600,
    gcIntervalMs: 120000,
    maxToolConcurrency: 16,
    maxLLMStreamBuffer: 400,
    maxSSEQueueSize: 2000,
    maxWSConnections: 2000,
    ptyTicketCapacity: 10000,
    ptyTicketTTLMs: 300000,
    cacheTTLMs: 3600000,
    sqliteCacheMB: 256,
    maxConcurrentTasks: 8,
    heartbeatIntervalMs: 15000,
    watchdogStallMs: 90000,
    ftsBatchRows: 10000,
    anchorCacheTTLms: 1200000,
    anchorCheckpointEveryToolCalls: 5,
    ftsOptimizeDebounceMs: 60000,
    shellMetadataFlushMs: 50,
    todoReminderEveryToolCalls: 3,
  },
}

export const computeTargets = (sys: SystemResources): AdaptiveTargets => {
  const profile = computeProfile(sys)
  const mult = PROFILE_MULTIPLIERS[profile]

  // A flat 500MB process budget is unreachable — the runtime, SQLite page
  // cache and native buffers exceed it before any request is served, which
  // made every profile report "over budget" forever. Size the budget from the
  // machine instead (15% RAM for RSS, 10% for the JS heap), with sane floors.
  const rssTargetMB = Math.min(8192, Math.max(1024, Math.round(sys.totalMemoryMB * 0.15)))
  const heapTargetMB = Math.min(4096, Math.max(512, Math.round(sys.totalMemoryMB * 0.1)))

  return {
    ...BASE_TARGETS,
    ...mult,
    rssTargetMB,
    heapTargetMB,
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
