import { describe, expect, it } from "bun:test"
import type { SystemResources } from "../../src/adaptive/detect"
import { computeProfile, computeTargets, resolveProfile } from "../../src/adaptive/profiles"

const resources = (totalMemoryMB: number, availableMemoryMB: number, cpuCores = 8): SystemResources => ({
  totalMemoryMB,
  availableMemoryMB,
  cpuCores,
  platform: "linux",
  storageHint: "unknown",
})

describe("adaptive resource profiles", () => {
  it("reduces worker, queue, and cache capacities as pressure rises", () => {
    const comfortable = computeTargets(resources(16_384, 8_192))
    const balanced = computeTargets(resources(8_192, 2_048))
    const constrained = computeTargets(resources(4_096, 600))
    const critical = computeTargets(resources(2_048, 100))

    for (const key of [
      "maxToolConcurrency",
      "maxConcurrentTasks",
      "maxLLMStreamBuffer",
      "maxSSEQueueSize",
      "maxWSConnections",
      "ptyTicketCapacity",
      "sqliteCacheMB",
      "ftsBatchRows",
    ] as const) {
      expect(comfortable[key]).toBeGreaterThanOrEqual(balanced[key])
      expect(balanced[key]).toBeGreaterThanOrEqual(constrained[key])
      expect(constrained[key]).toBeGreaterThanOrEqual(critical[key])
    }
    expect(comfortable.maxToolConcurrency).toBe(8)
    expect(critical.maxToolConcurrency).toBe(1)
    expect(critical.rssTargetMB).toBeLessThan(1024)
    expect(critical.heapTargetMB).toBeLessThanOrEqual(critical.rssTargetMB)
  })

  it("caps tool concurrency by available CPU cores", () => {
    const targets = computeTargets(resources(16_384, 8_192, 2))
    expect(targets.maxToolConcurrency).toBe(2)
  })

  it("sheds resources immediately and recovers one profile at a time with headroom", () => {
    const pressure = resources(8_192, 1_500)
    expect(computeProfile(pressure)).toBe("constrained")
    expect(resolveProfile("comfortable", pressure)).toBe("constrained")

    const recovery = resources(8_192, 5_000)
    expect(resolveProfile("critical", recovery)).toBe("constrained")
    expect(resolveProfile("constrained", recovery)).toBe("balanced")
    expect(resolveProfile("balanced", recovery)).toBe("comfortable")
  })
})
