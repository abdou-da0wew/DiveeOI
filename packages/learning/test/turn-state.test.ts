import { expect, test } from "bun:test"
import {
  CITATION_TURN_WINDOW,
  clearRetrieved,
  getRetrieved,
  recordRetrieved,
  resetRetrieved,
} from "../src/grounding/turn-state"

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

test("starting a new turn keeps earlier turns verifiable within the window (#9/#15)", () => {
  clearRetrieved("window-cross-turn")
  resetRetrieved("window-cross-turn")
  recordRetrieved("window-cross-turn", ["early-1", "early-2"])

  resetRetrieved("window-cross-turn") // turn 2 starts: history must survive
  expect(getRetrieved("window-cross-turn").has("early-1")).toBe(true)

  resetRetrieved("window-cross-turn") // turn 3: model cites a turn-1 passage
  recordRetrieved("window-cross-turn", ["now"])
  const shown = getRetrieved("window-cross-turn")
  expect(shown.has("early-2")).toBe(true)
  expect(shown.has("now")).toBe(true)
  clearRetrieved("window-cross-turn")
})

test("the window keeps only the last CITATION_TURN_WINDOW turns", () => {
  clearRetrieved("window-evict")
  for (let turn = 0; turn < CITATION_TURN_WINDOW + 2; turn++) {
    resetRetrieved("window-evict")
    recordRetrieved("window-evict", [`t${turn}`])
  }
  const shown = getRetrieved("window-evict")
  expect(shown.has("t0")).toBe(false)
  expect(shown.has("t1")).toBe(false)
  expect(shown.has(`t${CITATION_TURN_WINDOW + 1}`)).toBe(true)
  expect(shown.size).toBe(CITATION_TURN_WINDOW)
  clearRetrieved("window-evict")
})

test("recording without a started turn opens one implicitly", () => {
  clearRetrieved("window-implicit")
  recordRetrieved("window-implicit", ["solo"])
  expect([...getRetrieved("window-implicit")]).toEqual(["solo"])
  clearRetrieved("window-implicit")
})

test("the chunk cap spans the whole window, evicting oldest ids first", () => {
  clearRetrieved("window-cap")
  resetRetrieved("window-cap")
  recordRetrieved("window-cap", ["old"])
  for (let turn = 0; turn < 4; turn++) {
    resetRetrieved("window-cap")
    recordRetrieved("window-cap", Array.from({ length: 6_000 }, (_, index) => `w${turn}-${index}`))
  }
  const shown = getRetrieved("window-cap")
  expect(shown.size).toBe(20_000)
  expect(shown.has("old")).toBe(false) // oldest id evicted first
  expect(shown.has("w3-0")).toBe(true)
  clearRetrieved("window-cap")
})

test("clearRetrieved wipes the entire window and untracked sessions report empty", () => {
  clearRetrieved("window-clear")
  resetRetrieved("window-clear")
  recordRetrieved("window-clear", ["a"])
  resetRetrieved("window-clear")
  recordRetrieved("window-clear", ["b"])
  expect(getRetrieved("window-clear").size).toBe(2)
  clearRetrieved("window-clear")
  expect(getRetrieved("window-clear").size).toBe(0)
  expect(getRetrieved("never-tracked").size).toBe(0)
})
