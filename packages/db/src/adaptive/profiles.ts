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

// Profile boundaries are intentionally asymmetric when recovering from
// pressure: upgrade thresholds include a margin so small measurement changes
// do not repeatedly grow and shrink caches and worker pools.
const PROFILE_THRESHOLDS: Record<ResourceProfile, { minFreeMB: number; minFreeRatio: number }> = {
  // A desktop-class profile needs real headroom, not merely reclaimable page cache.
  comfortable: { minFreeMB: 4608, minFreeRatio: 0.6 },
  balanced: { minFreeMB: 3584, minFreeRatio: 0.5 },
  constrained: { minFreeMB: 768, minFreeRatio: 0.12 },
  critical: { minFreeMB: 0, minFreeRatio: 0 },
}

const PROFILE_ORDER: readonly ResourceProfile[] = ["comfortable", "balanced", "constrained", "critical"]

const freeResources = (sys: SystemResources) => {
  const totalMB = Math.max(1, Number.isFinite(sys.totalMemoryMB) ? sys.totalMemoryMB : 1)
  const freeMB = Math.max(0, Math.min(totalMB, Number.isFinite(sys.availableMemoryMB) ? sys.availableMemoryMB : 0))
  return { freeMB, freeRatio: freeMB / totalMB }
}

export const computeProfile = (sys: SystemResources): ResourceProfile => {
  const { freeMB, freeRatio } = freeResources(sys)

  if (freeMB >= PROFILE_THRESHOLDS.comfortable.minFreeMB && freeRatio >= PROFILE_THRESHOLDS.comfortable.minFreeRatio) return "comfortable"
  if (freeMB >= PROFILE_THRESHOLDS.balanced.minFreeMB && freeRatio >= PROFILE_THRESHOLDS.balanced.minFreeRatio) return "balanced"
  if (freeMB >= PROFILE_THRESHOLDS.constrained.minFreeMB && freeRatio >= PROFILE_THRESHOLDS.constrained.minFreeRatio) return "constrained"
  return "critical"
}

export const resolveProfile = (previous: ResourceProfile, sys: SystemResources): ResourceProfile => {
  const next = computeProfile(sys)
  const oldIndex = PROFILE_ORDER.indexOf(previous)
  const nextIndex = PROFILE_ORDER.indexOf(next)
  // Shed resources immediately when pressure increases; recover by one profile
  // at a time and only after 15% / 0.05 headroom beyond that profile's limits.
  if (nextIndex > oldIndex) return next
  if (nextIndex < oldIndex) {
    const upgrade = PROFILE_ORDER[oldIndex - 1]
    if (!upgrade) return next
    const threshold = PROFILE_THRESHOLDS[upgrade]
    const { freeMB, freeRatio } = freeResources(sys)
    return freeMB >= threshold.minFreeMB * 1.15 && freeRatio >= threshold.minFreeRatio + 0.05
      ? upgrade
      : previous
  }
  return previous
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

// Every capacity and cache target decreases with memory pressure. Shorter TTLs,
// smaller batches and more frequent checks reduce retained state in constrained
// and critical profiles rather than accidentally increasing it.
const PROFILE_MULTIPLIERS: Record<ResourceProfile, Partial<AdaptiveTargets>> = {
  comfortable: {
    gcIntervalMs: 60000,
    maxToolConcurrency: 16,
    maxLLMStreamBuffer: 400,
    maxSSEQueueSize: 2000,
    maxWSConnections: 2000,
    ptyTicketCapacity: 10000,
    ptyTicketTTLMs: 300000,
    cacheTTLMs: 1800000,
    sqliteCacheMB: 256,
    llmRequestTimeoutMs: 120000,
    dbQueryTimeoutMs: 10000,
    maxConcurrentTasks: 8,
    heartbeatIntervalMs: 30000,
    watchdogStallMs: 300000,
    ftsBatchRows: 10000,
    anchorCacheTTLms: 1200000,
    anchorCheckpointEveryToolCalls: 30,
    ftsOptimizeDebounceMs: 600000,
    shellMetadataFlushMs: 500,
    todoReminderEveryToolCalls: 10,
  },
  balanced: {
    gcIntervalMs: 30000,
    maxToolConcurrency: 4,
    maxLLMStreamBuffer: 160,
    maxSSEQueueSize: 700,
    maxWSConnections: 512,
    ptyTicketCapacity: 2500,
    ptyTicketTTLMs: 120000,
    cacheTTLMs: 420000,
    sqliteCacheMB: 96,
    llmRequestTimeoutMs: 90000,
    dbQueryTimeoutMs: 7500,
    maxConcurrentTasks: 2,
    heartbeatIntervalMs: 45000,
    watchdogStallMs: 240000,
    ftsBatchRows: 5000,
    anchorCacheTTLms: 600000,
    anchorCheckpointEveryToolCalls: 15,
    ftsOptimizeDebounceMs: 300000,
    shellMetadataFlushMs: 250,
    todoReminderEveryToolCalls: 12,
  },
  constrained: {
    gcIntervalMs: 12000,
    maxToolConcurrency: 2,
    maxLLMStreamBuffer: 64,
    maxSSEQueueSize: 400,
    maxWSConnections: 400,
    ptyTicketCapacity: 1500,
    ptyTicketTTLMs: 60000,
    cacheTTLMs: 120000,
    sqliteCacheMB: 48,
    llmRequestTimeoutMs: 60000,
    dbQueryTimeoutMs: 5000,
    maxConcurrentTasks: 1,
    heartbeatIntervalMs: 60000,
    watchdogStallMs: 150000,
    ftsBatchRows: 2000,
    anchorCacheTTLms: 120000,
    anchorCheckpointEveryToolCalls: 8,
    ftsOptimizeDebounceMs: 120000,
    shellMetadataFlushMs: 150,
    todoReminderEveryToolCalls: 20,
  },
  critical: {
    gcIntervalMs: 5000,
    maxToolConcurrency: 1,
    maxLLMStreamBuffer: 32,
    maxSSEQueueSize: 100,
    maxWSConnections: 100,
    ptyTicketCapacity: 250,
    ptyTicketTTLMs: 30000,
    cacheTTLMs: 60000,
    sqliteCacheMB: 16,
    llmRequestTimeoutMs: 30000,
    dbQueryTimeoutMs: 3000,
    maxConcurrentTasks: 1,
    heartbeatIntervalMs: 90000,
    watchdogStallMs: 90000,
    ftsBatchRows: 500,
    anchorCacheTTLms: 60000,
    anchorCheckpointEveryToolCalls: 4,
    ftsOptimizeDebounceMs: 60000,
    shellMetadataFlushMs: 50,
    todoReminderEveryToolCalls: 40,
  },
}

const MEMORY_BUDGET_RATIO: Record<ResourceProfile, { rss: number; heap: number }> = {
  comfortable: { rss: 0.28, heap: 0.18 },
  balanced: { rss: 0.22, heap: 0.14 },
  constrained: { rss: 0.16, heap: 0.1 },
  critical: { rss: 0.09, heap: 0.05 },
}

export const computeTargets = (sys: SystemResources, profile = computeProfile(sys)): AdaptiveTargets => {
  const mult = PROFILE_MULTIPLIERS[profile]
  const totalMemoryMB = Math.max(64, Number.isFinite(sys.totalMemoryMB) ? sys.totalMemoryMB : 4096)
  const budget = MEMORY_BUDGET_RATIO[profile]
  // Keep targets proportional to the detected memory limit without a 1 GB
  // floor: that floor made small containers permanently over-budget.
  const rssTargetMB = Math.max(64, Math.min(8192, Math.round(totalMemoryMB * budget.rss)))
  const heapTargetMB = Math.max(32, Math.min(rssTargetMB, Math.round(totalMemoryMB * budget.heap)))
  const cpuCores = Math.max(1, Number.isFinite(sys.cpuCores) ? Math.floor(sys.cpuCores) : 1)

  // Rotational disks benefit from a useful SQLite page cache, but very large
  // caches compete with the OS page cache and amplify memory pressure on small
  // machines. Keep HDD cache bounded while retaining mmap for repeated reads.
  const requestedCacheMB = mult.sqliteCacheMB ?? BASE_TARGETS.sqliteCacheMB
  const sqliteCacheMB =
    sys.storageHint === "hdd"
      ? Math.min(requestedCacheMB, 64)
      : Math.min(requestedCacheMB, profile === "comfortable" ? 192 : 96)

  return {
    ...BASE_TARGETS,
    ...mult,
    rssTargetMB,
    heapTargetMB,
    sqliteCacheMB,
    maxToolConcurrency: Math.max(1, Math.min(mult.maxToolConcurrency ?? BASE_TARGETS.maxToolConcurrency, cpuCores)),
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
