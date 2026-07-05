export type BurstStrategy = "truncate" | "buffer" | "abort"
export type BurstAction = "warn" | "truncate" | "abort"

export interface StreamLimiterOptions {
  readonly maxBytesPerSecond: number
  readonly maxBurstBytes: number
  readonly windowMs: number
  readonly strategy: BurstStrategy
  readonly action: BurstAction
}

export const DEFAULT_OPTIONS: StreamLimiterOptions = {
  maxBytesPerSecond: 1024 * 1024,
  maxBurstBytes: 10 * 1024 * 1024,
  windowMs: 1000,
  strategy: "truncate",
  action: "truncate",
}

export class BurstLimitExceeded extends Error {
  override readonly name = "BurstLimitExceeded"
  constructor(
    public readonly rate: number,
    public readonly total: number,
    public readonly limit: number,
  ) {
    super(`Burst limit exceeded: ${rate} bytes/s (limit: ${limit} bytes/s, total: ${total} bytes)`)
  }
}

export class StreamLimiter {
  private window: number[] = []
  private totalBytes = 0
  private lastCheck = Date.now()
  private aborted = false

  constructor(private options: StreamLimiterOptions = DEFAULT_OPTIONS) {}

  check(bytes: number): BurstAction {
    if (this.aborted) return "abort"

    const now = Date.now()
    this.window.push(bytes)
    this.totalBytes += bytes

    if (this.window.length > 100) {
      const removed = this.window.shift() ?? 0
      this.totalBytes -= removed
    }

    const elapsed = now - this.lastCheck
    if (elapsed < this.options.windowMs / 2) return "warn"

    const rate = this.totalBytes / (elapsed / 1000)
    this.lastCheck = now

    if (rate > this.options.maxBytesPerSecond) {
      if (this.totalBytes > this.options.maxBurstBytes) {
        this.aborted = true
        return "abort"
      }
      return this.options.action
    }

    return "warn"
  }

  isAborted(): boolean {
    return this.aborted
  }

  reset(): void {
    this.window = []
    this.totalBytes = 0
    this.lastCheck = Date.now()
    this.aborted = false
  }

  getStats(): { rate: number; total: number; aborted: boolean } {
    const elapsed = Date.now() - this.lastCheck || 1
    return {
      rate: this.totalBytes / (elapsed / 1000),
      total: this.totalBytes,
      aborted: this.aborted,
    }
  }
}
