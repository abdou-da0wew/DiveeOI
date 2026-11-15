import type { ChatUIState } from "./rich-ui-composition"

export function richUIStateStorageKey(sessionID: string, specID: string) {
  return `diveeoi:rich-ui:v1:${encodeURIComponent(sessionID)}:${encodeURIComponent(specID)}`
}

export function mergeRichUIState(initial: ChatUIState, candidate: unknown): ChatUIState {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return initial
  const restored = { ...initial }
  for (const [name, value] of Object.entries(candidate)) {
    if (!(name in initial) || typeof value !== typeof initial[name]) continue
    if (typeof value === "number" && !Number.isFinite(value)) continue
    if (typeof value === "string" && value.length > 48_000) continue
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      restored[name] = value
    }
  }
  return restored
}

export function parseRichUIState(initial: ChatUIState, raw: string): ChatUIState {
  try {
    return mergeRichUIState(initial, JSON.parse(raw))
  } catch {
    return initial
  }
}
