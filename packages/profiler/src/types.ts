export interface ProcessMem {
  rssMB: number
  heapUsedMB: number
  externalMB: number
}

export interface NodeStats {
  key: string // "module.file.function" — full path
  name: string // last segment
  calls: number
  errors: number
  totalMs: number
  minMs: number
  maxMs: number
  heapDeltaMB: number // cumulative heapUsed delta across calls
  heapDeltaMaxMB: number
  rssDeltaMB: number // cumulative rss delta across calls
  concurrentMax: number
}

export interface Aggregates {
  functions: NodeStats[] // leaf stats, sorted by totalMs desc
  files: Record<string, NodeStats> // aggregated by middle segment
  modules: Record<string, NodeStats> // aggregated by first segment
  total: NodeStats // all keys combined
}

export interface ScopeEvent {
  durMs: number
  heapDeltaMB?: number
  rssDeltaMB?: number
  error?: boolean
}
