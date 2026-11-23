// packages/db/test/io/governor.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fsp from "node:fs/promises"
import path from "node:path"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import {
  configureIoGovernor,
  ioGovernorDisabled,
  ioGovernorStatus,
  pacedCopyFile,
  primeIoPressure,
  resetIoGovernor,
  setIoGovernorProfile,
  withIoLane,
} from "../../src/io/governor"
import { clearIoPressureCache, configurePressureEnv } from "../../src/io/pressure"
import { configureStorageEnv } from "../../src/io/storage"

const encodeDev = (major: number, minor: number): number =>
  (minor & 0xff) | ((major & 0xfff) << 8) | ((minor & ~0xff) << 12)

const tmpRoot = () => path.join("/tmp", `io-governor-test-${process.pid}`)

/** Map test paths to mock devices: /ssd/** → nvme (ssd), /hdd/** → sda (hdd). */
function mockStorageEnv(sysRoot: string, extraDevs: Array<[number, string]> = []) {
  const devs = new Map([
    [encodeDev(259, 0), "/ssd"],
    [encodeDev(8, 0), "/hdd"],
    ...extraDevs,
  ])
  configureStorageEnv({
    sysRoot,
    stat: async (p: string) => {
      const hit = [...devs.entries()].find(([, known]) => p === known || p.startsWith(`${known}/`))
      if (!hit) throw new Error(`unknown path ${p}`)
      return { dev: hit[0] }
    },
    statfs: undefined,
  })
}

beforeEach(() => {
  resetIoGovernor()
  setIoGovernorProfile(undefined)
  process.env["DIVEEOI_IO_GOVERNOR"] = ""
})
afterEach(() => {
  resetIoGovernor()
  delete process.env["DIVEEOI_IO_GOVERNOR"]
})

function hddSysRoot(): string {
  const sysRoot = path.join("/tmp", `io-governor-sys-${process.pid}`)
  mkdirSync(path.join(sysRoot, "dev", "block", "8:0", "queue"), { recursive: true })
  writeFileSync(path.join(sysRoot, "dev", "block", "8:0", "queue", "rotational"), "1\n")
  mkdirSync(path.join(sysRoot, "dev", "block", "259:0", "queue"), { recursive: true })
  writeFileSync(path.join(sysRoot, "dev", "block", "259:0", "queue", "rotational"), "0\n")
  // Whole disks used by the pacedCopyFile fixture (src on ssd, dst on hdd).
  mkdirSync(path.join(sysRoot, "dev", "block", "259:1", "queue"), { recursive: true })
  writeFileSync(path.join(sysRoot, "dev", "block", "259:1", "queue", "rotational"), "0\n")
  mkdirSync(path.join(sysRoot, "dev", "block", "8:32", "queue"), { recursive: true })
  writeFileSync(path.join(sysRoot, "dev", "block", "8:32", "queue", "rotational"), "1\n")
  return sysRoot
}

describe("lane limits", () => {
  test("ssd allows per-lane concurrency", async () => {
    const sysRoot = hddSysRoot()
    mockStorageEnv(sysRoot)
    let concurrent = 0
    let maxConcurrent = 0
    const run = () =>
      withIoLane("copy", { src: "/ssd/a", dst: "/ssd/b" }, async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((r) => setTimeout(r, 30))
        concurrent -= 1
      })
    await Promise.all([run(), run()])
    expect(maxConcurrent).toBe(2) // ssd copy limit = 2
    rmSync(sysRoot, { recursive: true, force: true })
  })

  test("slow media serialize ALL heavy lanes through one device slot", async () => {
    const sysRoot = hddSysRoot()
    mockStorageEnv(sysRoot)
    let active = 0
    let overlapped = false
    const run = (lane: "copy" | "ingest", src: string, dst: string) =>
      withIoLane(lane, { src, dst, label: `${lane}-test` }, async () => {
        active += 1
        if (active > 1) overlapped = true
        await new Promise((r) => setTimeout(r, 25))
        active -= 1
      })

    // Two DIFFERENT lanes on the same spinning disk: they must not overlap.
    await Promise.all([run("copy", "/ssd/a", "/hdd/b"), run("ingest", "/hdd/src", "/hdd/dst")])
    expect(overlapped).toBe(false)

    const status = await ioGovernorStatus()
    const slow = status.lanes.find((lane) => lane.slotKey.startsWith("slow:hdd"))
    expect(slow).toBeDefined()
    expect(slow?.completed).toBe(2)
    // The ingest (hdd→hdd) acquired last, so it owns the slot's direction record.
    expect(slow?.lastDirection).toBe("hdd→hdd")
    rmSync(sysRoot, { recursive: true, force: true })
  })

  test("profile scaling lowers ssd budgets", async () => {
    const sysRoot = hddSysRoot()
    mockStorageEnv(sysRoot)
    setIoGovernorProfile("critical")
    let concurrent = 0
    let maxConcurrent = 0
    const run = () =>
      withIoLane("copy", { src: "/ssd/a", dst: "/ssd/b" }, async () => {
        concurrent += 1
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((r) => setTimeout(r, 20))
        concurrent -= 1
      })
    await Promise.all([run(), run(), run()])
    expect(maxConcurrent).toBe(1) // critical profile → 1 slot even on ssd
    rmSync(sysRoot, { recursive: true, force: true })
  })
})

describe("pressure deferral", () => {
  test("saturated pressure delays a queued op until the pressure clears", async () => {
    const sysRoot = hddSysRoot()
    mockStorageEnv(sysRoot)

    // One shared fake clock for the governor AND the pressure sampler: every
    // poll advances 2.5s (past the 2s sample cache TTL). PSI stays saturated
    // while saturated, so the deferred op only proceeds once the slot frees.
    let now = 0
    configureIoGovernor({
      clock: () => now,
      sleep: async (ms) => {
        now += ms + 2000
      },
      log: () => {},
    })
    configurePressureEnv({
      clock: () => now,
      readFile: async (p) => {
        if (p === "/proc/pressure/io") return "some avg10=80.00 avg60=40.00 avg300=20.00 total=0\n"
        throw new Error("ENOENT")
      },
    })

    let releaseHeld!: () => void
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve
    })
    let holderStarted = false
    const holder = withIoLane("copy", { src: "/ssd/a", dst: "/hdd/held" }, async () => {
      holderStarted = true
      await held
    })

    // Deterministic: wait until the holder actually owns the slow slot.
    for (let i = 0; i < 200 && !holderStarted; i += 1) await new Promise((r) => setTimeout(r, 5))
    expect(holderStarted).toBe(true)

    let started = false
    const deferred = withIoLane("ingest", { dst: "/hdd/book" }, async () => {
      started = true
    })

    await new Promise((r) => setTimeout(r, 60))
    expect(started).toBe(false) // deferred while saturated

    // Pressure clears → the deferred op proceeds.
    primeIoPressure({ level: "calm", source: "psi", sampledAt: now, psiSome10: 0 } as never)
    releaseHeld()
    await Promise.all([holder, deferred])
    expect(started).toBe(true)
    clearIoPressureCache()
    rmSync(sysRoot, { recursive: true, force: true })
  })

  test("deferral gives up after the bounded wait and proceeds anyway", async () => {
    const sysRoot = hddSysRoot()
    mockStorageEnv(sysRoot)

    let now = 0
    configureIoGovernor({
      clock: () => now,
      sleep: async (ms) => {
        now += ms + 2000
      },
      log: () => {},
    })
    configurePressureEnv({
      clock: () => now,
      readFile: async (p) => {
        if (p === "/proc/pressure/io") return "some avg10=90.00 avg60=40.00 avg300=20.00 total=0\n"
        throw new Error("ENOENT")
      },
    })

    let releaseHeld!: () => void
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve
    })
    let holderStarted = false
    const holder = withIoLane("copy", { src: "/ssd/a", dst: "/hdd/held" }, async () => {
      holderStarted = true
      await held
    })
    for (let i = 0; i < 200 && !holderStarted; i += 1) await new Promise((r) => setTimeout(r, 5))
    expect(holderStarted).toBe(true)

    const result = withIoLane("ingest", { dst: "/hdd/book" }, async () => "done")
    await new Promise((r) => setTimeout(r, 30))
    releaseHeld()
    // Still queued behind the holder on the slow slot — wait for it and confirm
    // the deferral loop terminated instead of spinning forever.
    expect(await result).toBe("done")
    await holder
    clearIoPressureCache()
    rmSync(sysRoot, { recursive: true, force: true })
  })
})

describe("nested re-entrancy", () => {
  test("a sub-operation on the parent's slot runs inline instead of deadlocking", async () => {
    const sysRoot = hddSysRoot()
    mockStorageEnv(sysRoot)

    // Parent holds the slow slot; the nested call targets the same slot
    // (this is the ingest → OCR-pack-download shape that deadlocked before).
    await withIoLane("ingest", { dst: "/hdd/book", label: "parent" }, async (parent) => {
      const nestedResult = await withIoLane("download", { dst: "/hdd/book/ocr/pack.bin", label: "nested" }, async () => "nested-ok")
      expect(nestedResult).toBe("nested-ok")
      expect(parent.slotKey).toContain("slow:hdd")
    })

    // After the parent completes, an independent op on the same slow slot
    // must still serialize normally (the slot was properly released).
    const after = await withIoLane("copy", { src: "/ssd/a", dst: "/hdd/c" }, async () => "after-ok")
    expect(after).toBe("after-ok")
    rmSync(sysRoot, { recursive: true, force: true })
  })
})

describe("pacedCopyFile", () => {
  test("copies content sequentially and reports the direction", async () => {
    const sysRoot = hddSysRoot()
    const root = tmpRoot()
    const srcDir = path.join(root, "ssd-src")
    const dstDir = path.join(root, "hdd-dst")
    // Map the fixture dirs onto known devices: src on nvme (ssd), dst on sda (hdd).
    mockStorageEnv(sysRoot, [
      [encodeDev(259, 1), srcDir],
      [encodeDev(8, 32), dstDir],
    ])
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(dstDir, { recursive: true })

    // 2.5 MiB → exercises multiple 1 MiB chunks.
    const payload = Buffer.alloc(2.5 * 1024 * 1024)
    for (let i = 0; i < payload.length; i += 4096) payload.writeUInt32BE(i, i)
    const src = path.join(srcDir, "model.bin")
    const dst = path.join(dstDir, "model.bin")
    await fsp.writeFile(src, payload)

    const logs: string[] = []
    configureIoGovernor({ log: (line) => logs.push(line) })

    const result = await pacedCopyFile(src, dst, { label: "model copy" })
    expect(result.bytes).toBe(payload.length)
    expect(result.direction.label).toBe("ssd→hdd")
    expect(await fsp.readFile(dst)).toEqual(payload)

    const copyLog = logs.find((line) => line.includes("io[ssd→hdd] copy"))
    expect(copyLog).toBeDefined()
    expect(copyLog).toContain("2.5MB")

    rmSync(root, { recursive: true, force: true })
    rmSync(sysRoot, { recursive: true, force: true })
  })

  test("creates missing destination directories", async () => {
    const sysRoot = hddSysRoot()
    mockStorageEnv(sysRoot)
    const root = tmpRoot()
    mkdirSync(root, { recursive: true })
    const src = path.join(root, "in.txt")
    const dst = path.join(root, "nested", "deeper", "out.txt")
    await fsp.writeFile(src, "hello governor")

    await pacedCopyFile(src, dst)
    expect(await fsp.readFile(dst, "utf8")).toBe("hello governor")
    rmSync(root, { recursive: true, force: true })
    rmSync(sysRoot, { recursive: true, force: true })
  })
})

describe("disable switch", () => {
  test("DIVEEOI_IO_GOVERNOR=off runs ops immediately and still logs direction", async () => {
    process.env["DIVEEOI_IO_GOVERNOR"] = "off"
    expect(ioGovernorDisabled()).toBe(true)
    const logs: string[] = []
    configureIoGovernor({ log: (line) => logs.push(line) })
    const result = await withIoLane("copy", { src: "/any", dst: "/any2", label: "off-test" }, async () => 42)
    expect(result).toBe(42)
    expect(logs.some((line) => line.includes("governor off"))).toBe(true)
  })
})
