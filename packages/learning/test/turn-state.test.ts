import { expect, test } from "bun:test"
import { clearRetrieved, getRetrieved, recordRetrieved, resetRetrieved } from "../src/grounding/turn-state"

test("turn retrieval state resets, accumulates, and clears per session", () => {
  resetRetrieved("turn-state")
  recordRetrieved("turn-state", ["a", "b"])
  recordRetrieved("turn-state", ["b", "c"])
  expect([...getRetrieved("turn-state")]).toEqual(["a", "b", "c"])
  clearRetrieved("turn-state")
  expect(getRetrieved("turn-state").size).toBe(0)
})

test("turn retrieval state is bounded across sessions and citations", () => {
  for (let index = 0; index < 2_049; index++) resetRetrieved(`bounded-${index}`)
  expect(getRetrieved("bounded-0").size).toBe(0)

  recordRetrieved("bounded-large", Array.from({ length: 20_001 }, (_, index) => `chunk-${index}`))
  expect(getRetrieved("bounded-large").size).toBe(20_000)
  clearRetrieved("bounded-large")
})
