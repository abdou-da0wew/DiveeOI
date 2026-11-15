import type { ChatUIAction, ChatUIComponent, ParseResult } from "./chat-ui"

type Parsed<T> = ParseResult<T>
type RecordValue = Record<string, unknown>

const object = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined

const string = (value: unknown, field: string, max = 600): Parsed<string> => {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    return { ok: false, error: `${field} must be a non-empty string of at most ${max} characters` }
  }
  return { ok: true, value: value.trim() }
}

const finite = (value: unknown, field: string, min = -1e9, max = 1e9): Parsed<number> => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return { ok: false, error: `${field} must be a finite number between ${min} and ${max}` }
  }
  return { ok: true, value }
}

const identifier = (value: unknown, field: string): Parsed<string> => {
  const result = string(value, field, 48)
  if (!result.ok) return result
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(result.value)
    ? result
    : { ok: false, error: `${field} must start with a letter and contain only letters, numbers, _ or -` }
}

export function parseChatUIButton(input: RecordValue): Parsed<ChatUIComponent> | undefined {
  if (input.type === "button") {
    const id = identifier(input.id, "button.id")
    const label = string(input.label, "button.label", 80)
    if (!id.ok) return id
    if (!label.ok) return label
    if (input.variant !== undefined && input.variant !== "primary" && input.variant !== "secondary")
      return { ok: false, error: "Button variant must be primary or secondary" }
    if (!Array.isArray(input.actions) || input.actions.length < 1 || input.actions.length > 8)
      return { ok: false, error: "Buttons need between 1 and 8 actions" }
    const actions: ChatUIAction[] = []
    for (const rawAction of input.actions) {
      const action = object(rawAction)
      if (!action) return { ok: false, error: "Button actions must be objects" }
      if (action.type === "submit") {
        if (Object.keys(action).some((key) => key !== "type")) {
          return { ok: false, error: "Submit actions do not accept extra properties" }
        }
        actions.push({ type: "submit" })
        continue
      }
      if (action.type === "refresh") {
        if (Object.keys(action).length !== 1)
          return { ok: false, error: "Refresh actions do not accept extra properties" }
        actions.push({ type: "refresh" })
        continue
      }
      if (action.type === "filter") {
        const filterKey = identifier(action.key, "filter.key")
        const value = action.value
        if (!filterKey.ok) return filterKey
        if (
          !["string", "number", "boolean"].includes(typeof value) ||
          (typeof value === "number" && !Number.isFinite(value)) ||
          (typeof value === "string" && value.length > 240)
        ) {
          return { ok: false, error: "Filter action requires a short primitive value" }
        }
        if (Object.keys(action).length !== 3)
          return { ok: false, error: "Filter actions do not accept extra properties" }
        actions.push({ type: "filter", key: filterKey.value, value: value as string | number | boolean })
        continue
      }
      if (action.type === "navigate") {
        const targetKey = identifier(action.key, "navigate.key")
        const target = identifier(action.target, "navigate.target")
        if (!targetKey.ok) return targetKey
        if (!target.ok) return target
        if (Object.keys(action).length !== 3)
          return { ok: false, error: "Navigate actions do not accept extra properties" }
        actions.push({ type: "navigate", key: targetKey.value, target: target.value })
        continue
      }
      const actionKey = identifier(action.key, "action.key")
      if (!actionKey.ok) return actionKey
      if (action.type === "set") {
        if (
          !["string", "number", "boolean"].includes(typeof action.value) ||
          (typeof action.value === "number" && !Number.isFinite(action.value)) ||
          (typeof action.value === "string" && action.value.length > 240)
        )
          return { ok: false, error: "Set actions need a short string, finite number, or boolean value" }
        actions.push({ type: "set", key: actionKey.value, value: action.value as string | number | boolean })
      } else if (action.type === "toggle") actions.push({ type: "toggle", key: actionKey.value })
      else if (action.type === "increment") {
        const by = finite(action.by, "action.by", -1e6, 1e6)
        if (!by.ok) return by
        actions.push({ type: "increment", key: actionKey.value, by: by.value })
      } else return { ok: false, error: "Unsupported UI action" }
    }
    return {
      ok: true,
      value: {
        type: "button",
        id: id.value,
        label: label.value,
        ...(input.variant ? { variant: input.variant as "primary" | "secondary" } : {}),
        actions,
      },
    }
  }
  return undefined
}
