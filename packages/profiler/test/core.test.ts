import { afterEach, beforeAll, describe, expect, test } from "bun:test"

const core = await import("../src/core")

beforeAll(() => core._configure({ enabled: true, sampleRate: 1 }))

afterEach(() => core._reset())

describe("gate", () => {
  test("isEnabled reflects the env flag", () => {
    expect(core.isEnabled()).toBe(true)
  })
})

describe("wrap", () => {
  test("measures sync calls and returns the value", () => {
    const fn = core.wrap("mod.file.fn", () => 42)
    expect(fn()).toBe(42)
    const stats = core.snapshot().functions.find((s) => s.key === "mod.file.fn")
    expect(stats).toBeDefined()
    expect(stats!.calls).toBe(1)
    expect(stats!.name).toBe("fn")
    expect(stats!.totalMs).toBeGreaterThanOrEqual(0)
  })

  test("records thrown errors", () => {
    const fn = core.wrap("mod.file.bad", () => {
      throw new Error("boom")
    })
    expect(() => fn()).toThrow("boom")
    const stats = core.snapshot().functions.find((s) => s.key === "mod.file.bad")
    expect(stats!.calls).toBe(1)
    expect(stats!.errors).toBe(1)
  })

  test("awaits async functions", async () => {
    const fn = core.wrap("mod.file.async", async (x: number) => x * 2)
    expect(await fn(4)).toBe(8)
    const stats = core.snapshot().functions.find((s) => s.key === "mod.file.async")
    expect(stats!.calls).toBe(1)
    expect(stats!.errors).toBe(0)
  })

  test("records async rejections", async () => {
    const fn = core.wrap("mod.file.asyncbad", async () => {
      throw new Error("nope")
    })
    await expect(fn()).rejects.toThrow("nope")
    const stats = core.snapshot().functions.find((s) => s.key === "mod.file.asyncbad")
    expect(stats!.errors).toBe(1)
  })

  test("does not double-wrap", () => {
    const fn = core.wrap("mod.file.fn", () => 1)
    const again = core.wrap("mod.file.fn", fn)
    again()
    const stats = core.snapshot().functions.find((s) => s.key === "mod.file.fn")
    expect(stats!.calls).toBe(1)
  })
})

describe("measure", () => {
  test("returns the value and records the scope", () => {
    const value = core.measure("mod.file.measured", () => 7)
    expect(value).toBe(7)
    expect(core.snapshot().functions.find((s) => s.key === "mod.file.measured")!.calls).toBe(1)
  })

  test("records sync throws", () => {
    expect(() => core.measure("mod.file.measuredbad", () => {
      throw new Error("x")
    })).toThrow("x")
    const stats = core.snapshot().functions.find((s) => s.key === "mod.file.measuredbad")
    expect(stats!.errors).toBe(1)
  })

  test("measureAsync resolves", async () => {
    const value = await core.measureAsync("mod.file.measuredAsync", async () => 9)
    expect(value).toBe(9)
    const stats = core.snapshot().functions.find((s) => s.key === "mod.file.measuredAsync")
    expect(stats!.calls).toBe(1)
  })

  test("measureAsync rejects", async () => {
    await expect(core.measureAsync("mod.file.measuredAsyncBad", async () => {
      throw new Error("y")
    })).rejects.toThrow("y")
    const stats = core.snapshot().functions.find((s) => s.key === "mod.file.measuredAsyncBad")
    expect(stats!.errors).toBe(1)
  })
})

describe("instrument", () => {
  test("wraps methods only, preserves values", () => {
    const svc = {
      value: 1,
      run() {
        return this.value + 1
      },
    }
    const instrumented = core.instrument("mod.file.Service", svc)
    expect(instrumented.value).toBe(1)
    expect(instrumented.run()).toBe(2)
    const stats = core.snapshot().functions.find((s) => s.key === "mod.file.Service.run")
    expect(stats!.calls).toBe(1)
  })
})

describe("snapshot aggregation", () => {
  test("groups by module, file, class and totals", () => {
    core.wrap("m.f.C1.methodA", () => 1)()
    core.wrap("m.f.C1.methodB", () => 2)()
    core.wrap("m.f.plain", () => 3)()
    const agg = core.snapshot()
    expect(agg.functions.length).toBe(3)
    expect(agg.modules["m"]!.calls).toBe(3)
    expect(agg.files["f"]!.calls).toBe(3)
    expect(agg.classes["C1"]!.calls).toBe(2)
    expect(agg.classes["C1"]!.name).toBe("C1")
    expect(agg.total.calls).toBe(3)
    expect(agg.total.totalMs).toBeGreaterThanOrEqual(0)
  })

  test("sorts functions by totalMs descending", () => {
    core.wrap("m.f.slow", () => {
      // busy wait to make it measurably slower than fast
      const end = performance.now() + 10
      while (performance.now() < end) {
        // spin
      }
    })()
    core.wrap("m.f.fast", () => 1)()
    const sorted = core.snapshot().functions.map((s) => s.key)
    expect(sorted[0]).toBe("m.f.slow")
  })
})

describe("concurrency", () => {
  test("tracks peak concurrency and active scopes", () => {
    const b1 = core._beginScope("m.f.concurrent")
    const b2 = core._beginScope("m.f.concurrent")
    expect(core.snapshot().active["m.f.concurrent"]).toBe(2)
    core._endScope(b2, false)
    core._endScope(b1, false)
    const stats = core.snapshot().functions.find((s) => s.key === "m.f.concurrent")
    expect(stats!.concurrentMax).toBe(2)
    expect(core.snapshot().active["m.f.concurrent"] ?? 0).toBe(0)
  })
})

describe("caller attribution", () => {
  test("sync chain attributes the caller", () => {
    const events: Array<{ key: string; caller?: string }> = []
    core._onScope((key, event) => events.push({ key, caller: event.caller }))
    const inner = core.wrap("m.f.inner", () => 1)
    const outer = core.wrap("m.f.outer", () => inner())
    outer()
    expect(events.find((e) => e.key === "m.f.outer")!.caller).toBeUndefined()
    expect(events.find((e) => e.key === "m.f.inner")!.caller).toBe("m.f.outer")
  })

  test("async chain attributes the caller", async () => {
    const events: Array<{ key: string; caller?: string }> = []
    core._onScope((key, event) => events.push({ key, caller: event.caller }))
    const inner = core.wrap("m.f.innerA", async () => 1)
    const outer = core.wrap("m.f.outerA", async () => inner())
    await outer()
    expect(events.find((e) => e.key === "m.f.innerA")!.caller).toBe("m.f.outerA")
  })
})

describe("gauges", () => {
  test("tracks current, min, max, sum, count", () => {
    core.gauge("db.pool.size", 4)
    core.gauge("db.pool.size", 6)
    core.gauge("db.pool.size", 2)
    const g = core.snapshot().states["db.pool.size"]
    expect(g!.current).toBe(2)
    expect(g!.min).toBe(2)
    expect(g!.max).toBe(6)
    expect(g!.sum).toBe(12)
    expect(g!.count).toBe(3)
  })

  test("gaugeDelta accumulates", () => {
    core.gaugeDelta("sessions.active", 1)
    core.gaugeDelta("sessions.active", 1)
    core.gaugeDelta("sessions.active", -1)
    const g = core.snapshot().states["sessions.active"]
    expect(g!.current).toBe(1)
    expect(g!.sum).toBe(1)
  })
})

describe("processMem", () => {
  test("returns MB-shaped values", () => {
    const mem = core.processMem()
    expect(typeof mem.rssMB).toBe("number")
    expect(typeof mem.heapUsedMB).toBe("number")
    expect(typeof mem.externalMB).toBe("number")
    expect(mem.rssMB).toBeGreaterThan(0)
    expect(mem.heapUsedMB).toBeGreaterThan(0)
  })
})
