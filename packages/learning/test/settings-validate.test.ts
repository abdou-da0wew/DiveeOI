import { expect, test } from "bun:test"
import { validateSettingsPayload } from "../src/settings/validate"

test("in-range values pass", () => {
  expect(validateSettingsPayload({ gate: { minDenseScore: 0.4 }, retrieval: { finalTopK: 6 }, embedding: { dtype: "fp16" } })).toEqual([])
})
test("out-of-range, wrong-type and bad enum are rejected", () => {
  expect(validateSettingsPayload({ gate: { minDenseScore: 9 } }).length).toBe(1)
  expect(validateSettingsPayload({ retrieval: { finalTopK: -1 } }).length).toBe(1)
  expect(validateSettingsPayload({ embedding: { dtype: "int3" } }).length).toBe(1)
  expect(validateSettingsPayload({ enabled: "yes" }).length).toBe(1)
})
