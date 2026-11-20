import { afterEach, expect, test } from "bun:test"
import type { TlRuntime } from "../src/runtime"

const runtimeA = await import("../src/runtime")
const runtimeB = await import("@diveeoi/learning/runtime")

const fakeRuntime = {
  dataDir: "/tmp/diveeoi-test",
  modelDir: "/tmp/diveeoi-test/models",
  booksStore: {} as never,
  manifest: {} as never,
} as TlRuntime

afterEach(() => {
  runtimeA.setRuntime(null)
  runtimeA.setUserSettings(undefined)
})

test("shares the Targeted Learning runtime across relative and package imports", () => {
  runtimeA.setRuntime(fakeRuntime)
  expect(runtimeB.getRuntime()).toBe(fakeRuntime)
})

test("shares current settings across relative and package imports", () => {
  const settings = { embedding: { dtype: "int8" } }
  runtimeA.setUserSettings(settings)
  expect(runtimeB.getUserSettings()).toBe(settings)
})
