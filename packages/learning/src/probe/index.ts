// packages/learning/src/probe/index.ts
//
// Probe — the very first setup step (plan §5.1.1).
// Detects OS, arch, CPU cores, AVX support, RAM, free disk, GPU (informational),
// container detection, and libc. The result drives the recommendation engine
// that picks low / balanced / high and decides whether to enable the WASM
// fallback up front.

import os from "node:os"
import { existsSync, statfsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { Schema, Effect } from "effect"

export const Arch = Schema.Literals(["x64", "arm64", "ia32", "arm", "other"])
export type Arch = Schema.Schema.Type<typeof Arch>

export const Platform = Schema.Literals(["linux", "darwin", "win32", "other"])
export type Platform = Schema.Schema.Type<typeof Platform>

export const Libc = Schema.Literals(["glibc", "musl", "darwin", "unknown"])
export type Libc = Schema.Schema.Type<typeof Libc>

export const Container = Schema.Literals(["none", "docker", "podman", "lxc", "k8s", "unknown"])
export type Container = Schema.Schema.Type<typeof Container>

export const ProbeResult = Schema.Struct({
  platform: Platform,
  arch: Arch,
  libc: Libc,
  container: Container,
  cpuCores: Schema.Number,
  cpuModel: Schema.String,
  avx: Schema.Struct({
    avx: Schema.Boolean,
    avx2: Schema.Boolean,
    avx512: Schema.Boolean,
  }),
  totalMemoryMB: Schema.Number,
  freeDiskMB: Schema.Number,
  dataDirWritable: Schema.Boolean,
  gpu: Schema.optional(Schema.String),
  wasmFallbackRecommended: Schema.Boolean,
  recommendedProfile: Schema.Literals(["low", "balanced", "high"]),
}).annotate({ identifier: "TargetedLearning.ProbeResult" })
export type ProbeResult = Schema.Schema.Type<typeof ProbeResult>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const detectLibc = (platform: string): Libc => {
  if (platform === "darwin") return "darwin"
  if (platform !== "linux") return "unknown"
  // getconf GNU_LIBC_VERSION works on glibc; musl reports "musl"
  try {
    const out = execFileSync("getconf", ["GNU_LIBC_VERSION"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    if (out.toLowerCase().includes("glibc")) return "glibc"
  } catch {
    // fall through
  }
  try {
    const out = execFileSync("ldd", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    if (/musl/i.test(out)) return "musl"
    if (/glibc|gnu/i.test(out)) return "glibc"
  } catch {
    // fall through
  }
  // /lib/ld-musl-* or /lib64/ld-linux-x86-64.so.2
  if (existsSync("/lib/ld-musl-x86_64.so.1") || existsSync("/lib/ld-musl-aarch64.so.1")) return "musl"
  return "glibc"
}

const detectContainer = (): Container => {
  if (existsSync("/.dockerenv")) return "docker"
  if (existsSync("/run/.containerenv")) return "podman"
  // Kubernetes
  if (process.env.KUBERNETES_SERVICE_HOST !== undefined) return "k8s"
  // /proc/1/cgroup inspection (Linux only)
  try {
    if (existsSync("/proc/1/cgroup")) {
      const cgroup = execFileSync("cat", ["/proc/1/cgroup"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      if (/docker/i.test(cgroup)) return "docker"
      if (/lxc/i.test(cgroup)) return "lxc"
      if (/kubepods/i.test(cgroup)) return "k8s"
    }
  } catch {
    // ignore
  }
  return "unknown"
}

const detectAvx = (platform: string, arch: string): ProbeResult["avx"] => {
  if (arch !== "x64") return { avx: false, avx2: false, avx512: false }
  if (platform === "linux" && existsSync("/proc/cpuinfo")) {
    try {
      const cpuinfo = execFileSync("cat", ["/proc/cpuinfo"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      const flags = (cpuinfo.match(/^flags\s*:.*$/im)?.[0] ?? "").toLowerCase()
      return {
        avx: flags.includes(" avx "),
        avx2: flags.includes(" avx2 "),
        avx512: flags.includes(" avx512f "),
      }
    } catch {
      // fall through
    }
  }
  if (platform === "darwin") {
    try {
      const out = execFileSync("sysctl", ["-n", "machdep.cpu.features"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      const upper = out.toUpperCase()
      return {
        avx: upper.includes("AVX"),
        avx2: upper.includes("AVX2"),
        avx512: false,
      }
    } catch {
      // fall through
    }
  }
  // Windows: wmic or PowerShell. Best-effort; assume AVX2 on modern hardware.
  if (platform === "win32") {
    return { avx: true, avx2: true, avx512: false }
  }
  return { avx: false, avx2: false, avx512: false }
}

const detectGpu = (platform: string): string | undefined => {
  // Informational only — we don't yet ship a GPU ONNX runtime.
  if (platform === "linux") {
    try {
      const out = execFileSync("lspci", [], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      const match = out.match(/(?:NVIDIA|AMD|Advanced Micro Devices)[^\n]*/i)
      if (match) return match[0].trim()
    } catch {
      // ignore
    }
  }
  return undefined
}

const freeDiskMB = (dir: string): number => {
  try {
    const stats = statfsSync(dir)
    // bsize on linux, frsize on macOS — both are bytes per block.
    const blockSize = stats.bsize || stats.bsize
    return Math.floor((stats.bavail * blockSize) / (1024 * 1024))
  } catch {
    return 0
  }
}

const pickProfile = (cores: number, ramMB: number, wasmRecommended: boolean): ProbeResult["recommendedProfile"] => {
  if (wasmRecommended) return "low"
  if (cores >= 4 && ramMB >= 4096) return "balanced"
  if (cores >= 8 && ramMB >= 8192) return "high"
  return "low"
}

// ---------------------------------------------------------------------------
// Public probe
// ---------------------------------------------------------------------------

/**
 * Run the probe against a target data directory.
 * Pure, synchronous, never throws — wraps everything in Effect.
 */
export const probe = (dataDir: string): Effect.Effect<ProbeResult> =>
  Effect.gen(function* () {
    const platform = (process.platform as string) ?? "other"
    const arch = (process.arch as string) ?? "other"
    const libc = detectLibc(platform)
    const container = detectContainer()
    const cpuCores = os.cpus().length
    const cpuModel = os.cpus()[0]?.model ?? "unknown"
    const avx = detectAvx(platform, arch)
    const totalMemoryMB = Math.floor(os.totalmem() / (1024 * 1024))
    const free = freeDiskMB(dataDir)
    const gpu = detectGpu(platform)

    // WASM fallback is recommended on Alpine/musl (plan §4.6) or when AVX is missing.
    const wasmFallbackRecommended = libc === "musl" || (!avx.avx && arch === "x64")

    // Writable check — best-effort, defaults to true on errors.
    let dataDirWritable = true
    try {
      const { accessSync, constants } = require("node:fs") as typeof import("node:fs")
      accessSync(dataDir, constants.W_OK)
    } catch {
      dataDirWritable = false
    }

    const recommendedProfile = pickProfile(cpuCores, totalMemoryMB, wasmFallbackRecommended)

    return ProbeResult.make({
      platform: platform === "linux" || platform === "darwin" || platform === "win32" ? platform : "other",
      arch: arch === "x64" || arch === "arm64" || arch === "ia32" || arch === "arm" ? arch : "other",
      libc,
      container,
      cpuCores,
      cpuModel,
      avx,
      totalMemoryMB,
      freeDiskMB: free,
      dataDirWritable,
      gpu,
      wasmFallbackRecommended,
      recommendedProfile,
    })
  })
