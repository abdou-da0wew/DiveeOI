import { describe, expect, it } from "bun:test"
import type { SystemResources } from "../../src/adaptive/detect"
import { computeProfile, computeTargets, resolveProfile } from "../../src/adaptive/profiles"

const resources = (
  totalMemoryMB: number,
  availableMemoryMB: number,
  cpuCores = 8,
  storageHint: SystemResources["storageHint"] = "unknown",
): SystemResources => ({
  totalMemoryMB,
  availableMemoryMB,
  cpuCores,
  platform: "linux",
  storageHint,
})

describe("adaptive resource profiles", () => {
  it("reduces worker, queue, and cache capacities as pressure rises", () => {
    const comfortable = computeTargets(resources(16_384, 10_000))
    const balanced = computeTargets(resources(8_192, 4_096))
    const constrained = computeTargets(resources(4_096, 1_200))
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

  it("bounds SQLite cache targets on rotational storage", () => {
    const hdd = computeTargets(resources(7_168, 5_800, 8, "hdd"))
    const ssd = computeTargets(resources(7_168, 5_800, 8, "ssd"))

    expect(hdd.sqliteCacheMB).toBe(64)
    expect(ssd.sqliteCacheMB).toBe(192)
    expect(hdd.rssTargetMB).toBeLessThan(2_500)
    expect(hdd.heapTargetMB).toBeLessThan(1_600)
  })

  it("caps tool concurrency by available CPU cores", () => {
    const targets = computeTargets(resources(16_384, 8_192, 2))
    expect(targets.maxToolConcurrency).toBe(2)
  })

  it("sheds resources immediately and recovers one profile at a time with headroom", () => {
    const pressure = resources(8_192, 1_500)
    expect(computeProfile(pressure)).toBe("constrained")
    expect(resolveProfile("comfortable", pressure)).toBe("constrained")

    const recovery = resources(8_192, 6_000)
    expect(resolveProfile("critical", recovery)).toBe("constrained")
    expect(resolveProfile("constrained", recovery)).toBe("balanced")
    expect(resolveProfile("balanced", recovery)).toBe("comfortable")
  })
})
