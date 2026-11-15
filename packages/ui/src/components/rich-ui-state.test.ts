import { describe, expect, test } from "bun:test"
import { mergeRichUIState, parseRichUIState, richUIStateStorageKey } from "./rich-ui-state"

describe("Rich UI state persistence", () => {
  test("restores only declared values with matching primitive types", () => {
    const initial = { name: "Ada", workers: 2, enabled: true }
    expect(mergeRichUIState(initial, { name: "Grace", workers: 4, enabled: false, token: "secret" })).toEqual({
      name: "Grace",
      workers: 4,
      enabled: false,
    })
  })

  test("rejects invalid values and malformed JSON without breaking the UI", () => {
    const initial = { name: "Ada", workers: 2, enabled: true }
    expect(mergeRichUIState(initial, { name: "x".repeat(48_001), workers: Number.NaN, enabled: "true" })).toEqual(
      initial,
    )
    expect(parseRichUIState(initial, "{")).toEqual(initial)
  })

  test("scopes saved state by session and UI identity", () => {
    expect(richUIStateStorageKey("session/one", "ui one")).toBe("diveeoi:rich-ui:v1:session%2Fone:ui%20one")
    expect(richUIStateStorageKey("session-a", "ui")).not.toBe(richUIStateStorageKey("session-b", "ui"))
  })
})
