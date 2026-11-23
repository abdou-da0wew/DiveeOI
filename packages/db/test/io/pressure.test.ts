// packages/db/test/io/pressure.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  clearIoPressureCache,
  configurePressureEnv,
  diskstatsUtilization,
  parseDiskstats,
  parsePsi,
  pressureLevel,
  resetPressureEnv,
  sampleIoPressure,
  type DiskstatsSample,
} from "../../src/io/pressure"

const PSI_CALM = `some avg10=0.00 avg60=0.00 avg300=0.00 total=0
full avg10=0.00 avg60=0.00 avg300=0.00 total=0
`
const PSI_BUSY = `some avg10=25.00 avg60=10.00 avg300=4.00 total=12345
full avg10=4.00 avg60=1.00 avg300=0.50 total=999
`
const PSI_SATURATED = `some avg10=55.00 avg60=40.00 avg300=20.00 total=99999
full avg10=15.00 avg60=12.00 avg300=8.00 total=8888
`

const DISKSTATS = `   8       0 sda 1234 0 5678 900 10 0 20 40 0 1000 1500 0 0 0 0 0 0
   8       1 sda1 1000 0 2000 300 5 0 10 20 0 500 800 0 0 0 0 0 0
 259       0 nvme0n1 40000 500 90000 12000 30000 900 77000 56000 0 21000 68000 0 0 0 0 0
`

const diskstatsLine = (ioTicks: number): string =>
  `   8       0 sda 1234 0 5678 900 10 0 20 40 0 ${ioTicks} 1500 0 0 0 0 0 0\n` +
  `   8       1 sda1 1000 0 2000 300 5 0 10 20 0 500 800 0 0 0 0 0 0\n`

const sample = (at: number): DiskstatsSample => ({ at, ioTicks: parseDiskstats(DISKSTATS) })

beforeEach(() => resetPressureEnv())
afterEach(() => resetPressureEnv())

describe("PSI parsing", () => {
  test("extracts some/full 10s averages", () => {
    expect(parsePsi(PSI_CALM)).toEqual({ some: 0, full: 0 })
    expect(parsePsi(PSI_BUSY)).toEqual({ some: 25, full: 4 })
  })

  test("returns undefined for unparseable input", () => {
    expect(parsePsi("not a psi file")).toBeUndefined()
    expect(parsePsi("")).toBeUndefined()
  })

  test("full-only files report some as 0", () => {
    expect(parsePsi("full avg10=2.50 avg60=1.00 avg300=0.00 total=0")).toEqual({ some: 0, full: 2.5 })
  })
})

describe("diskstats utilization", () => {
  test("computes classic %util from io_ticks deltas", () => {
    const before = sample(0)
    // 8:0 had 1000ms → 1600ms of io_ticks over a 1000ms window → 60%.
    const next: DiskstatsSample = {
      at: 1000,
      ioTicks: (() => {
        const ticks = parseDiskstats(DISKSTATS)
        ticks.set("8:0", 1600)
        return ticks
      })(),
    }
    expect(diskstatsUtilization(before, next, "8:0")).toBe(60)
  })

  test("missing devices report undefined", () => {
    expect(diskstatsUtilization(sample(0), sample(1000), "9:9")).toBeUndefined()
  })

  test("parseDiskstats keeps every device", () => {
    const ticks = parseDiskstats(DISKSTATS)
    expect(ticks.get("8:0")).toBe(1000)
    expect(ticks.get("8:1")).toBe(500)
    expect(ticks.get("259:0")).toBe(21000)
  })
})

describe("level thresholds", () => {
  test("PSI thresholds dominate", () => {
    expect(pressureLevel({ psiSome: 0, psiFull: 0 })).toBe("calm")
    expect(pressureLevel({ psiSome: 12, psiFull: 0 })).toBe("busy")
    expect(pressureLevel({ psiSome: 41, psiFull: 0 })).toBe("saturated")
    expect(pressureLevel({ psiSome: 0, psiFull: 10 })).toBe("saturated")
  })

  test("utilization thresholds", () => {
    expect(pressureLevel({ utilization: 59 })).toBe("calm")
    expect(pressureLevel({ utilization: 61 })).toBe("busy")
    expect(pressureLevel({ utilization: 91 })).toBe("saturated")
  })

  test("load average thresholds", () => {
    expect(pressureLevel({ loadRatio: 0.2 })).toBe("calm")
    expect(pressureLevel({ loadRatio: 0.8 })).toBe("busy")
    expect(pressureLevel({ loadRatio: 2 })).toBe("saturated")
  })

  test("no signal at all stays calm (governor uses static limits)", () => {
    expect(pressureLevel({})).toBe("calm")
  })
})

describe("sampling", () => {
  test("prefers PSI when available", async () => {
    configurePressureEnv({
      readFile: async (p) => {
        if (p === "/proc/pressure/io") return PSI_BUSY
        if (p === "/proc/diskstats") return DISKSTATS
        throw new Error("ENOENT")
      },
      clock: () => 1000,
    })
    const pressure = await sampleIoPressure("8:0")
    expect(pressure.source).toBe("psi")
    expect(pressure.level).toBe("busy")
    expect(pressure.psiSome10).toBe(25)
  })

  test("falls back to diskstats utilization for the requested device", async () => {
    let call = 0
    configurePressureEnv({
      readFile: async (p) => {
        if (p === "/proc/diskstats") {
          call += 1
          // Samples 3s apart (past the 2s TTL); io_ticks 1000 → 2800 = 1800ms
          // of I/O over a 3000ms window → classic 60% util → "busy".
          return diskstatsLine(call === 1 ? 1000 : 2800)
        }
        throw new Error("ENOENT")
      },
      clock: () => 1000 + (call - 1) * 3000,
    })
    const first = await sampleIoPressure("8:0")
    expect(first.source).toBe("diskstats")
    expect(first.utilizationPct).toBeUndefined() // first sample has no delta yet
    const second = await sampleIoPressure("8:0")
    expect(second.source).toBe("diskstats")
    expect(second.utilizationPct).toBe(60)
    expect(second.level).toBe("busy")
  })

  test("caches samples within the TTL", async () => {
    let reads = 0
    configurePressureEnv({
      readFile: async (p) => {
        if (p === "/proc/pressure/io") {
          reads += 1
          return PSI_CALM
        }
        throw new Error("ENOENT")
      },
      clock: () => 5000,
    })
    await sampleIoPressure()
    await sampleIoPressure()
    await sampleIoPressure()
    expect(reads).toBe(1)
    clearIoPressureCache()
    await sampleIoPressure()
    expect(reads).toBe(2)
  })

  test("reports source none when nothing is available", async () => {
    configurePressureEnv({
      readFile: async () => {
        throw new Error("ENOENT")
      },
      clock: () => 0,
    })
    const pressure = await sampleIoPressure()
    expect(pressure.source).toBe("none")
    expect(pressure.level).toBe("calm")
  })
})
