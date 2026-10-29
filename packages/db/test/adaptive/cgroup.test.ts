import { describe, expect, test } from "bun:test"
import {
  cgroupMemoryBudget,
  hierarchyDirectories,
  minimumFinite,
  parseCgroupCpuQuota,
  parseCgroupLimit,
} from "../../src/adaptive/cgroup"

describe("cgroup resource limits", () => {
  test("walks from the process group through every ancestor to the mount root", () => {
    expect(hierarchyDirectories("/sys/fs/cgroup", "/system.slice/service/container")).toEqual([
      "/sys/fs/cgroup/system.slice/service/container",
      "/sys/fs/cgroup/system.slice/service",
      "/sys/fs/cgroup/system.slice",
      "/sys/fs/cgroup",
    ])
  })

  test("rejects traversal components in a cgroup path", () => {
    expect(hierarchyDirectories("/sys/fs/cgroup", "/tenant/../host")).toEqual(["/sys/fs/cgroup"])
  })

  test("uses the tightest memory limit and available budget across ancestors", () => {
    expect(
      cgroupMemoryBudget([
        { limit: "max", usage: "100" },
        { limit: "1024", usage: "900" },
        { limit: "4096", usage: "3000" },
      ]),
    ).toEqual({ limitBytes: 1024, availableBytes: 124 })
  })

  test("ignores unlimited sentinels and takes the tightest CPU quota", () => {
    expect(parseCgroupLimit("9223372036854771712")).toBeUndefined()
    expect(parseCgroupCpuQuota("max 100000")).toBeUndefined()
    expect(
      minimumFinite([
        parseCgroupCpuQuota("150000 100000"),
        parseCgroupCpuQuota("50000", "100000"),
      ]),
    ).toBe(0.5)
  })
})
