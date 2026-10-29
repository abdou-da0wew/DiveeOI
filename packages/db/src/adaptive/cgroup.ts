export const parseCgroupLimit = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const parsed = Number(value.trim())
  // cgroup v1 commonly exposes an enormous sentinel instead of "max".
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 2 ** 60) return undefined
  return parsed
}

export const hierarchyDirectories = (mountPoint: string, groupPath?: string) => {
  const segments = (groupPath ?? "").split("/").filter(Boolean)
  // The kernel supplies these paths, but reject traversal components anyway so
  // a malformed proc entry can never escape the cgroup mount.
  if (segments.some((segment) => segment === "." || segment === "..")) return [mountPoint]
  return Array.from({ length: segments.length + 1 }, (_, index) => {
    const count = segments.length - index
    return count === 0 ? mountPoint : `${mountPoint}/${segments.slice(0, count).join("/")}`
  })
}

export const minimumFinite = (values: Array<number | undefined>): number | undefined => {
  const finite = values.filter((value): value is number => value !== undefined && Number.isFinite(value))
  return finite.length ? Math.min(...finite) : undefined
}

export const cgroupMemoryBudget = (samples: Array<{ limit: string | undefined; usage: string | undefined }>) => {
  const constrained = samples.flatMap((sample) => {
    const limit = parseCgroupLimit(sample.limit)
    if (limit === undefined) return []
    const usage = parseCgroupLimit(sample.usage) ?? 0
    return [{ limit, available: Math.max(0, limit - usage) }]
  })
  return {
    limitBytes: minimumFinite(constrained.map((sample) => sample.limit)),
    availableBytes: minimumFinite(constrained.map((sample) => sample.available)),
  }
}

export const parseCgroupCpuQuota = (quota: string | undefined, period?: string): number | undefined => {
  const [quotaText, periodText] = period === undefined ? quota?.trim().split(/\s+/) ?? [] : [quota, period]
  const quotaValue = parseCgroupLimit(quotaText)
  const periodValue = parseCgroupLimit(periodText)
  return quotaValue && periodValue ? quotaValue / periodValue : undefined
}
