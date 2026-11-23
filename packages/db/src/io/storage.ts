// packages/db/src/io/storage.ts
//
// Storage classification: which medium does a path live on, and what does a
// given operation look like end to end ("ssd→hdd" and friends)?
//
// Classification is the input to the I/O governor (see ./governor.ts): heavy
// operations are paced one way on an SSD and a very different way on a spinning
// disk, and callers log the direction so "what is actually happening on disk"
// is visible in diagnostics.
//
// Linux detection (best effort, fully optional):
//   - path → st_dev → major:minor (new-style dev_t encoding)
//   - major:minor → /sys/dev/block/M:N → walk up to the whole disk that owns a
//     `queue/rotational` attribute (partitions don't have `queue/`)
//   - rotational 1 → hdd, 0 → ssd; name-based heuristics as fallback
//   - filesystem type via fs.statfs magics → network filesystems
// Everything degrades to "unknown" (conservative pacing) off Linux or in
// sandboxes that hide sysfs. All reads are cached — classification never adds
// meaningful I/O of its own.

import { realpathSync } from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

export type StorageClass = "ssd" | "hdd" | "network" | "unknown"

export interface StorageInfo {
  readonly path: string
  /** Device name when it could be resolved (e.g. "sda", "nvme0n1"). */
  readonly device: string | undefined
  readonly major: number | undefined
  readonly minor: number | undefined
  /** Filesystem type name when statfs is available (e.g. "ext4", "nfs"). */
  readonly fsType: string | undefined
  readonly class: StorageClass
}

// Pacing rank: smaller = more caution needed. HDD and network sit at the same
// caution level (both slow and unforgiving about concurrency); unknown is
// conservative; SSD is the fast path.
const CLASS_RANK: Record<StorageClass, number> = { hdd: 0, network: 1, unknown: 2, ssd: 3 }

export const rankOf = (cls: StorageClass): number => CLASS_RANK[cls]

export const slowestOf = (a: StorageClass, b: StorageClass): StorageClass =>
  rankOf(a) <= rankOf(b) ? a : b

export interface IoDirection {
  readonly src: StorageClass
  readonly dst: StorageClass
  /** Human label like "ssd→hdd" for logs and diagnostics. */
  readonly label: string
  /** The more constrained of the two ends — the pacing input. */
  readonly slowest: StorageClass
}

export const describeDirection = (src: StorageClass, dst: StorageClass): IoDirection => {
  const slowest = slowestOf(src, dst)
  return { src, dst, label: `${src}→${dst}`, slowest }
}

// ---------------------------------------------------------------------------
// Injectable environment (tests override these)
// ---------------------------------------------------------------------------

export interface IoStorageEnv {
  readonly sysRoot: string
  readonly readFile: (path: string) => Promise<string>
  readonly readlink: (path: string) => Promise<string>
  readonly realpath: (path: string) => Promise<string>
  readonly stat: (path: string) => Promise<{ dev: number }>
  readonly statfs: ((path: string) => Promise<{ type: number }>) | undefined
}

const realEnv = (): IoStorageEnv => ({
  sysRoot: process.env["DIVEEOI_IO_SYS_ROOT"] ?? "/sys",
  readFile: (p) => fsp.readFile(p, "utf8"),
  readlink: (p) => fsp.readlink(p),
  realpath: (p) => Promise.resolve(realpathSync(p)),
  stat: async (p) => (await fsp.stat(p)) as unknown as { dev: number },
  statfs: typeof fsp.statfs === "function" ? (p) => fsp.statfs(p) as Promise<{ type: number }> : undefined,
})

let env: IoStorageEnv = realEnv()

/** Test seam: override sysfs root or the raw readers. */
export const configureStorageEnv = (overrides: Partial<IoStorageEnv> & { sysRoot?: string }): void => {
  env = { ...realEnv(), ...overrides }
}

export const resetStorageEnv = (): void => {
  env = realEnv()
  deviceInfoCache.clear()
  fsTypeCache.clear()
}

// ---------------------------------------------------------------------------
// dev_t decoding (Linux new-style major:minor)
// ---------------------------------------------------------------------------

export function devToMajorMinor(dev: number): { major: number; minor: number } {
  // JS bitwise is 32-bit; real-world majors (≤4095) and minors (≤2^20) keep
  // the interesting bits inside 32 bits. Same formulas as os.major/os.minor.
  const major = (dev >>> 8) & 0xfff
  const minor = (dev & 0xff) | ((dev >>> 12) & ~0xff)
  return { major: major >>> 0, minor: minor >>> 0 }
}

// ---------------------------------------------------------------------------
// Filesystem type detection (network / special filesystems)
// ---------------------------------------------------------------------------

const FS_TYPE_NAMES: ReadonlyArray<{ magic: number; name: string; cls: StorageClass }> = [
  { magic: 0x6969, name: "nfs", cls: "network" },
  { magic: 0xff534d42, name: "cifs", cls: "network" },
  { magic: 0xfe534d42, name: "smb", cls: "network" },
  { magic: 0x01021997, name: "9p", cls: "network" },
  { magic: 0x517b, name: "afs", cls: "network" },
  { magic: 0x013111a8, name: "ocfs2", cls: "network" },
  { magic: 0x958458f6, name: "tmpfs", cls: "ssd" },
  { magic: 0x9fa2, name: "proc", cls: "ssd" },
  { magic: 0x7461636f, name: "overlay", cls: "unknown" },
]

export const fsTypeFromMagic = (magic: number): { name: string; cls: StorageClass } | undefined =>
  FS_TYPE_NAMES.find((entry) => entry.magic === (magic >>> 0))

// ---------------------------------------------------------------------------
// Device classification via sysfs
// ---------------------------------------------------------------------------

export const rotationalFromQueue = (text: string): "ssd" | "hdd" | undefined => {
  const value = text.trim()
  if (value === "1") return "hdd"
  if (value === "0") return "ssd"
  return undefined
}

export const classFromDeviceName = (name: string): StorageClass | undefined => {
  const lower = name.toLowerCase()
  if (lower.startsWith("nvme") || lower.startsWith("vd") || lower.startsWith("mmcblk")) return "ssd"
  return undefined
}

/**
 * Classify the whole disk that owns `major:minor`.
 * Walks up from /sys/dev/block/M:N until a directory with `queue/rotational`
 * (whole disks) or a `dm/` control dir (device-mapper: unknown) appears.
 */
export async function classifySysDevice(
  major: number,
  minor: number,
  theEnv: IoStorageEnv = env,
): Promise<{ device: string | undefined; class: StorageClass }> {
  const devBlock = path.join(theEnv.sysRoot, "dev", "block", `${major}:${minor}`)
  let cursor: string
  try {
    const link = await theEnv.readlink(devBlock).catch(() => undefined)
    const raw = link ? (link.startsWith("/") ? link : path.resolve(path.dirname(devBlock), link)) : devBlock
    cursor = await theEnv.realpath(raw).catch(() => raw)
  } catch {
    return { device: undefined, class: "unknown" }
  }

  const subtreeRoot = path.resolve(theEnv.sysRoot, "devices")
  for (let depth = 0; depth < 12; depth += 1) {
    const rotational = await theEnv
      .readFile(path.join(cursor, "queue", "rotational"))
      .then((text) => rotationalFromQueue(text), () => undefined)
    if (rotational) return { device: path.basename(cursor), class: rotational }

    const isDm = await theEnv
      .readFile(path.join(cursor, "dm", "uuid"))
      .then(
        () => true,
        () => false,
      )
    if (isDm) return { device: path.basename(cursor), class: "unknown" }

    if (path.basename(cursor).toLowerCase().startsWith("loop")) {
      return { device: path.basename(cursor), class: "unknown" }
    }

    const parent = path.dirname(cursor)
    if (parent === cursor || !parent.startsWith(subtreeRoot)) break
    cursor = parent
  }
  // Last resort: name heuristics on the deepest node we reached.
  return { device: path.basename(cursor), class: classFromDeviceName(path.basename(cursor)) ?? "unknown" }
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

const deviceInfoCache = new Map<string, { device: string | undefined; class: StorageClass }>()
const fsTypeCache = new Map<string, { name: string | undefined; cls: StorageClass | undefined }>()

const statDev = async (p: string): Promise<number | undefined> => {
  try {
    const info = await env.stat(p)
    return Number(info.dev)
  } catch {
    return undefined
  }
}

const statFsType = async (p: string): Promise<{ name: string | undefined; cls: StorageClass | undefined } | undefined> => {
  const cached = fsTypeCache.get(p)
  if (cached) return cached
  if (!env.statfs) return undefined
  try {
    const raw = await env.statfs(p)
    const found = raw ? fsTypeFromMagic(Number(raw.type)) : undefined
    const value = { name: found?.name, cls: found?.cls }
    fsTypeCache.set(p, value)
    return value
  } catch {
    return undefined
  }
}

/** Classify the storage backing `path`. Never throws; never does heavy I/O. */
export async function storageInfoFor(path: string): Promise<StorageInfo> {
  const dev = await statDev(path)
  if (dev === undefined) {
    return { path, device: undefined, major: undefined, minor: undefined, fsType: undefined, class: "unknown" }
  }
  const { major, minor } = devToMajorMinor(dev)
  const deviceKey = `${major}:${minor}`

  const network = await statFsType(path)
  if (network?.cls === "network") {
    return { path, device: network.name, major, minor, fsType: network.name, class: "network" }
  }

  let device = deviceInfoCache.get(deviceKey)
  if (!device) {
    device = await classifySysDevice(major, minor)
    deviceInfoCache.set(deviceKey, device)
  }

  return {
    path,
    device: device.device,
    major,
    minor,
    fsType: network?.name,
    class: device.class,
  }
}

/**
 * Describe an operation from `src` to `dst`: per-end classes, the log label,
 * and the end that should drive pacing. Never throws.
 */
export async function describeIo(
  src: string,
  dst: string,
): Promise<IoDirection & { srcInfo: StorageInfo; dstInfo: StorageInfo }> {
  try {
    const [srcInfo, dstInfo] = await Promise.all([storageInfoFor(src), storageInfoFor(dst)])
    return { ...describeDirection(srcInfo.class, dstInfo.class), srcInfo, dstInfo }
  } catch {
    const unknownInfo = (p: string): StorageInfo => ({
      path: p,
      device: undefined,
      major: undefined,
      minor: undefined,
      fsType: undefined,
      class: "unknown",
    })
    return { ...describeDirection("unknown", "unknown"), srcInfo: unknownInfo(src), dstInfo: unknownInfo(dst) }
  }
}
