// packages/db/test/io/storage.test.ts
import { afterEach, describe, expect, test } from "bun:test"
import fsp from "node:fs/promises"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  classFromDeviceName,
  classifySysDevice,
  configureStorageEnv,
  describeDirection,
  describeIo,
  devToMajorMinor,
  fsTypeFromMagic,
  rankOf,
  resetStorageEnv,
  rotationalFromQueue,
  slowestOf,
  storageInfoFor,
  type IoStorageEnv,
} from "../../src/io/storage"

/** Inverse of gnu_dev_makedev for tests (majors ≤ 4095, minors ≤ 2^20). */
const encodeDev = (major: number, minor: number): number =>
  (minor & 0xff) | ((major & 0xfff) << 8) | ((minor & ~0xff) << 12)

afterEach(() => resetStorageEnv())

describe("dev_t decoding", () => {
  test("decodes classic sd/nvme device numbers", () => {
    expect(devToMajorMinor(encodeDev(8, 0))).toEqual({ major: 8, minor: 0 })
    expect(devToMajorMinor(encodeDev(8, 1))).toEqual({ major: 8, minor: 1 })
    expect(devToMajorMinor(encodeDev(259, 4))).toEqual({ major: 259, minor: 4 })
    expect(devToMajorMinor(encodeDev(259, 17))).toEqual({ major: 259, minor: 17 })
    expect(devToMajorMinor(encodeDev(254, 0))).toEqual({ major: 254, minor: 0 })
  })

  test("decodes minors above 255 (new-style encoding)", () => {
    expect(devToMajorMinor(encodeDev(8, 261))).toEqual({ major: 8, minor: 261 })
  })
})

describe("sysfs parsing", () => {
  test("queue/rotational values map to classes", () => {
    expect(rotationalFromQueue("1\n")).toBe("hdd")
    expect(rotationalFromQueue("0\n")).toBe("ssd")
    expect(rotationalFromQueue("junk")).toBeUndefined()
  })

  test("device-name heuristics", () => {
    expect(classFromDeviceName("nvme0n1")).toBe("ssd")
    expect(classFromDeviceName("vda")).toBe("ssd")
    expect(classFromDeviceName("mmcblk0")).toBe("ssd")
    expect(classFromDeviceName("sda")).toBeUndefined()
  })

  test("fs type magics", () => {
    expect(fsTypeFromMagic(0x6969)?.name).toBe("nfs")
    expect(fsTypeFromMagic(0x6969)?.cls).toBe("network")
    expect(fsTypeFromMagic(0xff534d42)?.cls).toBe("network")
    expect(fsTypeFromMagic(0x7461636f)?.name).toBe("overlay")
    expect(fsTypeFromMagic(0xef53)).toBeUndefined()
  })

  test("classifySysDevice reads the whole disk holding the partition", async () => {
    const sysRoot = path.join("/tmp", `io-storage-test-${process.pid}`)
    const diskDir = path.join(sysRoot, "devices", "pci", "disk-sda")
    mkdirSync(path.join(diskDir, "sda1"), { recursive: true })
    mkdirSync(path.join(diskDir, "queue"), { recursive: true })
    writeFileSync(path.join(diskDir, "queue", "rotational"), "1\n")
    mkdirSync(path.join(sysRoot, "dev", "block"), { recursive: true })
    // sysfs-style relative symlink partition → whole disk
    await fsp.symlink(path.join(diskDir, "sda1"), path.join(sysRoot, "dev", "block", "8:1"))

    const result = await classifySysDevice(8, 1, mockEnv(sysRoot))
    expect(result).toEqual({ device: "disk-sda", class: "hdd" })
    rmSync(sysRoot, { recursive: true, force: true })
  })

  test("classifySysDevice: ssd disk, direct dev node without symlink", async () => {
    const sysRoot = path.join("/tmp", `io-storage-test-ssd-${process.pid}`)
    mkdirSync(path.join(sysRoot, "dev", "block", "259:0", "queue"), { recursive: true })
    writeFileSync(path.join(sysRoot, "dev", "block", "259:0", "queue", "rotational"), "0\n")

    const result = await classifySysDevice(259, 0, mockEnv(sysRoot))
    expect(result).toEqual({ device: "259:0", class: "ssd" })
    rmSync(sysRoot, { recursive: true, force: true })
  })

  test("classifySysDevice: device-mapper and loop devices stay unknown", async () => {
    const sysRoot = path.join("/tmp", `io-storage-test-dm-${process.pid}`)
    mkdirSync(path.join(sysRoot, "dev", "block", "253:0", "dm"), { recursive: true })
    writeFileSync(path.join(sysRoot, "dev", "block", "253:0", "dm", "uuid"), "LVM-abc\n")
    const dmResult = await classifySysDevice(253, 0, mockEnv(sysRoot))
    expect(dmResult.class).toBe("unknown")

    mkdirSync(path.join(sysRoot, "dev", "block", "7:0"), { recursive: true })
    const loopResult = await classifySysDevice(7, 0, mockEnv(sysRoot))
    expect(loopResult.class).toBe("unknown")
    rmSync(sysRoot, { recursive: true, force: true })
  })

  test("classifySysDevice falls back to unknown when sysfs is absent", async () => {
    const result = await classifySysDevice(8, 0, mockEnv(path.join("/tmp", `io-no-such-sys-${process.pid}`)))
    expect(result.class).toBe("unknown")
  })
})

describe("directions", () => {
  test("labels both ends and picks the pacing end", () => {
    expect(describeDirection("ssd", "hdd")).toEqual({ src: "ssd", dst: "hdd", label: "ssd→hdd", slowest: "hdd" })
    expect(describeDirection("hdd", "ssd").label).toBe("hdd→ssd")
    expect(describeDirection("ssd", "ssd").slowest).toBe("ssd")
  })

  test("pacing rank orders caution", () => {
    expect(rankOf("hdd")).toBeLessThan(rankOf("network"))
    expect(rankOf("network")).toBeLessThan(rankOf("unknown"))
    expect(rankOf("unknown")).toBeLessThan(rankOf("ssd"))
    expect(slowestOf("ssd", "hdd")).toBe("hdd")
    expect(slowestOf("unknown", "network")).toBe("network")
  })
})

describe("storageInfoFor (mock env)", () => {
  test("classifies via st_dev + sysfs and caches the device", async () => {
    const sysRoot = path.join("/tmp", `io-storage-info-${process.pid}`)
    mkdirSync(path.join(sysRoot, "dev", "block", "8:16", "queue"), { recursive: true })
    writeFileSync(path.join(sysRoot, "dev", "block", "8:16", "queue", "rotational"), "1\n")

    let statCalls = 0
    configureStorageEnv({
      sysRoot,
      stat: async () => {
        statCalls += 1
        return { dev: encodeDev(8, 16) }
      },
    })

    const first = await storageInfoFor("/data/books")
    expect(first.class).toBe("hdd")
    expect(first.major).toBe(8)
    expect(first.minor).toBe(16)
    expect(first.device).toBe("8:16")

    await storageInfoFor("/data/other")
    await storageInfoFor("/data/more")
    expect(statCalls).toBe(3) // one stat per path (cheap), device lookup cached

    const second = await storageInfoFor("/data/books")
    expect(second.class).toBe("hdd")
    rmSync(sysRoot, { recursive: true, force: true })
  })

  test("network filesystems classify via statfs magic", async () => {
    configureStorageEnv({
      sysRoot: "/tmp/no-such-sys",
      stat: async () => ({ dev: encodeDev(0, 42) }),
      statfs: async () => ({ type: 0x6969 }),
    })
    const info = await storageInfoFor("/mnt/nfs-share")
    expect(info.class).toBe("network")
    expect(info.fsType).toBe("nfs")
  })

  test("missing paths degrade to unknown without throwing", async () => {
    configureStorageEnv({
      stat: async () => {
        throw new Error("ENOENT")
      },
    })
    const info = await storageInfoFor("/gone")
    expect(info.class).toBe("unknown")
  })

  test("describeIo produces a log label for an operation", async () => {
    const sysRoot = path.join("/tmp", `io-storage-describe-${process.pid}`)
    // 8:0 backs the fast path (ssd), 259:0 the slow path (hdd).
    mkdirSync(path.join(sysRoot, "dev", "block", "8:0", "queue"), { recursive: true })
    writeFileSync(path.join(sysRoot, "dev", "block", "8:0", "queue", "rotational"), "0\n")
    mkdirSync(path.join(sysRoot, "dev", "block", "259:0", "queue"), { recursive: true })
    writeFileSync(path.join(sysRoot, "dev", "block", "259:0", "queue", "rotational"), "1\n")

    const devs = new Map([
      [encodeDev(8, 0), "/fast/model-dir"],
      [encodeDev(259, 0), "/slow/worktrees"],
    ])
    configureStorageEnv({
      sysRoot,
      stat: async (p: string) => {
        const hit = [...devs.entries()].find(([, known]) => p === known || p.startsWith(`${known}/`))
        if (!hit) throw new Error(`unknown path ${p}`)
        return { dev: hit[0] }
      },
    })

    const direction = await describeIo("/fast/model-dir/model.onnx", "/slow/worktrees/wt1")
    expect(direction.label).toBe("ssd→hdd")
    expect(direction.slowest).toBe("hdd")
    expect(direction.srcInfo.device).toBe("8:0")
    expect(direction.dstInfo.device).toBe("259:0")
    rmSync(sysRoot, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------

function mockEnv(sysRoot: string): IoStorageEnv {
  return {
    sysRoot,
    readFile: (p) => fsp.readFile(p, "utf8"),
    readlink: (p) => fsp.readlink(p),
    realpath: (p) => fsp.realpath(p),
    stat: async () => ({ dev: encodeDev(8, 0) }),
    statfs: undefined,
  }
}
