export interface ProcessMem {
  readonly rssMB: number
  readonly heapUsedMB: number
  readonly externalMB: number
}

/**
 * Per-key statistics. The key format is "module.file.function".
 * Keys with 4+ dot-separated segments are treated as
 * "module.file.class.function" and additionally aggregated into
 * the `classes` dimension.
 */
export interface NodeStats {
  key: string
  name: string
  calls: number
  errors: number
  totalMs: number
  minMs: number
  maxMs: number
  heapDeltaMB: number
  heapDeltaMaxMB: number
  rssDeltaMB: number
  concurrentMax: number
}

/** Absolute value gauge (pool sizes, active counts, queue lengths). */
export interface GaugeStats {
  current: number
  min: number
  max: number
  sum: number
  count: number
}

export interface Aggregates {
  /** Leaf scopes, sorted by totalMs descending. */
  readonly functions: NodeStats[]
  /** Aggregated by the second key segment (file). */
  readonly files: Record<string, NodeStats>
  /** Aggregated by the first key segment (module). */
  readonly modules: Record<string, NodeStats>
  /** Aggregated by the class segment (4+ segment keys only). */
  readonly classes: Record<string, NodeStats>
  /** Current gauge values. */
  readonly states: Record<string, GaugeStats>
  /** Scopes currently in flight. */
  readonly active: Record<string, number>
  readonly total: NodeStats
}

/**
 * Emitted when a sampled scope ends. `caller` is the key of the
 * enclosing scope (null at the root of the call tree).
 */
export interface ScopeEvent {
  durMs: number
  heapDeltaMB?: number
  rssDeltaMB?: number
  error?: boolean
  caller?: string
}
