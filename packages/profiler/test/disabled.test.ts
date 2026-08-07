import { beforeAll, describe, expect, test } from "bun:test"

// bun test runs all files in one process, so the enabled flag is forced off
// explicitly instead of relying on env at import time.
const core = await import("../src/core")

beforeAll(() => core._configure({ enabled: false }))

describe("disabled mode", () => {
  test("isEnabled is false", () => {
    expect(core.isEnabled()).toBe(false)
  })

  test("wrap passes through without recording", () => {
    let calls = 0
    const fn = core.wrap("m.f.d", () => {
      calls += 1
      return 1
    })
    expect(fn()).toBe(1)
    expect(calls).toBe(1)
    expect(core.snapshot().functions.length).toBe(0)
  })

  test("measure and instrument are transparent", () => {
    const value = core.measure("m.f.dm", () => 5)
    expect(value).toBe(5)
    const svc = { run() { return 1 } }
    expect(core.instrument("m.f.ds", svc).run()).toBe(1)
    expect(core.snapshot().functions.length).toBe(0)
  })
})
