// packages/db/src/adaptive/detect.ts
import { Effect } from "effect"
import { cpus, freemem, totalmem } from "node:os"
import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"

export type Platform = "windows" | "darwin" | "linux"

export interface SystemResources {
  totalMemoryMB: number
  availableMemoryMB: number // MemAvailable on Linux, physmem - wired on macOS, os.freemem elsewhere
  cpuCores: number
  platform: Platform
  storageHint: "hdd" | "ssd" | "unknown"
}

const mapPlatform = (platform: NodeJS.Platform): Platform => {
  if (platform === "win32") return "windows"
  if (platform === "darwin") return "darwin"
  return "linux"
}

const parseMemInfo = (content: string): Pick<SystemResources, "totalMemoryMB" | "availableMemoryMB"> => {
  const entries = new Map<string, number>()
  for (const line of content.split("\n")) {
    const [key, raw] = line.split(":")
    if (!key) continue
    const value = parseInt(raw ?? "", 10)
    entries.set(key, Number.isNaN(value) ? 0 : value)
  }
  const totalKB = entries.get("MemTotal") ?? 0
  const availableKB = entries.get("MemAvailable") ?? entries.get("MemFree") ?? 0
  return {
    totalMemoryMB: Math.round(totalKB / 1024),
    availableMemoryMB: Math.round(availableKB / 1024),
  }
}

const parseVmStatPages = (output: string, key: string): number => {
  const match = output.match(new RegExp(`${key}:\\s*(\\d+)`))
  if (!match) return 0
  const value = parseInt(match[1] ?? "", 10)
  return Number.isNaN(value) ? 0 : value
}

const runCommand = (command: string, args: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args)
    let stdout = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })

const readMemInfo: Effect.Effect<string, Error, never> = Effect.tryPromise({
  try: () => readFile("/proc/meminfo", "utf8"),
  catch: (cause) => new Error("Failed to read /proc/meminfo", { cause }),
})

const readMemSize: Effect.Effect<string, Error, never> = Effect.tryPromise({
  try: () => runCommand("sysctl", ["-n", "hw.memsize"]),
  catch: (cause) => new Error("Failed to read hw.memsize", { cause }),
})

const readVmStat: Effect.Effect<string, Error, never> = Effect.tryPromise({
  try: () => runCommand("vm_stat", []),
  catch: (cause) => new Error("Failed to read vm_stat", { cause }),
})

const readRootRotational: Effect.Effect<"hdd" | "ssd" | undefined, never, never> = Effect.gen(function* () {
  // /proc/mounts: `<device> <mountpoint> <fstype> ...`. Find the device backing `/`,
  // strip partition digits, and read its rotational flag (1 = spinning disk).
  const mounts = yield* Effect.tryPromise({
    try: () => readFile("/proc/mounts", "utf8"),
    catch: () => new Error("no /proc/mounts"),
  }).pipe(Effect.orElseSucceed(() => ""))
  const line = mounts.split("\n").find((entry) => {
    const fields = entry.split(/\s+/)
    return fields[1] === "/" && fields[0].startsWith("/dev/")
  })
  const device = line?.split(/\s+/)[0]?.replace(/^\/dev\//, "") ?? ""
  const disk = device.replace(/(.+?)(\d+)$/, "$1") || device
  if (!disk) return undefined
  const raw = yield* Effect.tryPromise({
    try: () => readFile(`/sys/block/${disk}/queue/rotational`, "utf8"),
    catch: () => new Error("no rotational file"),
  }).pipe(Effect.orElseSucceed(() => ""))
  const value = raw.trim()
  if (value === "1") return "hdd" as const
  if (value === "0") return "ssd" as const
  return undefined
})

const detectInternal = Effect.fn("Adaptive.detect")(function* () {
  const platform = mapPlatform(process.platform)
  const storage: SystemResources["storageHint"] =
    platform === "linux"
      ? ((yield* readRootRotational) ?? "unknown")
      : platform === "darwin"
        ? "ssd"
        : "unknown"
  if (platform === "linux") {
    const memInfo = yield* readMemInfo
    const { totalMemoryMB, availableMemoryMB } = parseMemInfo(memInfo)
    return { totalMemoryMB, availableMemoryMB, cpuCores: cpus().length, platform, storageHint: storage }
  }
  if (platform === "darwin") {
    const memSizeOutput = yield* readMemSize
    const vmStatOutput = yield* readVmStat
    const totalBytes = parseInt(memSizeOutput.trim(), 10)
    const pageSize = 4096
    const availableBytes =
      (parseVmStatPages(vmStatOutput, "Pages free") + parseVmStatPages(vmStatOutput, "Pages inactive")) * pageSize
    return {
      totalMemoryMB: Math.round(totalBytes / 1024 / 1024),
      availableMemoryMB: Math.round(availableBytes / 1024 / 1024),
      cpuCores: cpus().length,
      platform,
      storageHint: storage,
    }
  }
  return {
    totalMemoryMB: Math.round(totalmem() / 1024 / 1024),
    availableMemoryMB: Math.round(freemem() / 1024 / 1024),
    cpuCores: cpus().length,
    platform,
    storageHint: storage,
  }
})

const fallback = (): SystemResources => ({
  totalMemoryMB: 4096,
  availableMemoryMB: 1024,
  cpuCores: cpus().length,
  platform: mapPlatform(process.platform),
  storageHint: "unknown",
})

export const detectSystemResources: Effect.Effect<SystemResources, never, never> = detectInternal().pipe(
  Effect.catchCause((cause) =>
    Effect.logError("Adaptive detect failed", { cause }).pipe(Effect.as(fallback())),
  ),
)
