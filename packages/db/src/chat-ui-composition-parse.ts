import type { ChatUIAction, ChatUIComponent, ParseResult } from "./chat-ui"
import { parseNumericExpression } from "./chat-ui-simulation-parse"
import { parseChatUIButton } from "./chat-ui-action-parse"

type Parsed<T> = ParseResult<T>
type RecordValue = Record<string, unknown>
type ParseChildren = (value: unknown, depth: number) => Parsed<ChatUIComponent[]>

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

const optionalString = (value: unknown, field: string, max = 240) => {
  if (value === undefined || value === null || value === "") return { ok: true as const, value: undefined }
  return string(value, field, max)
}

const identifier = (value: unknown, field: string): Parsed<string> => {
  const result = string(value, field, 48)
  if (!result.ok) return result
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(result.value)
    ? result
    : { ok: false, error: `${field} must start with a letter and contain only letters, numbers, _ or -` }
}

export function parseChatUICompositionComponent(
  input: RecordValue,
  parseChildren: ParseChildren,
  depth: number,
): Parsed<ChatUIComponent> | undefined {
  const components: ChatUIComponent[] = []
  if (input.type === "group") {
    const id = identifier(input.id, "group.id")
    const title = optionalString(input.title, "group.title", 120)
    if (!id.ok) return id
    if (!title.ok) return title
    const groupLayout = input.layout === undefined ? undefined : input.layout
    if (groupLayout !== undefined && !["stack", "row", "grid"].includes(String(groupLayout)))
      return { ok: false, error: "Group layout must be stack, row, or grid" }
    const children = parseChildren(input.components, depth + 1)
    if (!children.ok) return children
    const surface = input.surface === undefined ? "none" : input.surface
    const separator = input.separator === undefined ? "none" : input.separator
    const gap = input.gap === undefined ? "normal" : input.gap
    if (!["none", "subtle", "outlined"].includes(String(surface))) {
      return { ok: false, error: "Group surface must be none, subtle, or outlined" }
    }
    if (!["none", "top", "bottom", "between"].includes(String(separator))) {
      return { ok: false, error: "Group separator must be none, top, bottom, or between" }
    }
    if (!["tight", "normal", "relaxed"].includes(String(gap))) {
      return { ok: false, error: "Group gap must be tight, normal, or relaxed" }
    }
    components.push({
      type: "group",
      id: id.value,
      ...(groupLayout ? { layout: groupLayout as "stack" | "row" | "grid" } : {}),
      ...(title.value ? { title: title.value } : {}),
      surface: surface as "none" | "subtle" | "outlined",
      separator: separator as "none" | "top" | "bottom" | "between",
      gap: gap as "tight" | "normal" | "relaxed",
      components: children.value,
    })
    return { ok: true, value: components[0]! }
  }
  if (input.type === "tabs") {
    const id = identifier(input.id, "tabs.id")
    const title = optionalString(input.title, "tabs.title", 120)
    if (!id.ok) return id
    if (!title.ok) return title
    if (!Array.isArray(input.tabs) || input.tabs.length < 2 || input.tabs.length > 8)
      return { ok: false, error: "Tabs need between 2 and 8 panels" }
    const tabs: Array<{ id: string; label: string; components: ChatUIComponent[] }> = []
    for (const rawTab of input.tabs) {
      const tab = object(rawTab)
      if (!tab) return { ok: false, error: "Tab definitions must be objects" }
      const tabID = identifier(tab.id, "tab.id")
      const label = string(tab.label, "tab.label", 48)
      if (!tabID.ok) return tabID
      if (!label.ok) return label
      const children = parseChildren(tab.components, depth + 1)
      if (!children.ok) return children
      tabs.push({ id: tabID.value, label: label.value, components: children.value })
    }
    if (new Set(tabs.map((tab) => tab.id)).size !== tabs.length) return { ok: false, error: "Tab IDs must be unique" }
    const stateKey = input.key === undefined ? undefined : identifier(input.key, "tabs.key")
    if (stateKey && !stateKey.ok) return stateKey
    if (input.surface !== undefined && !["none", "subtle", "outlined"].includes(String(input.surface))) {
      return { ok: false, error: "Tabs surface must be none, subtle, or outlined" }
    }
    components.push({
      type: "tabs",
      id: id.value,
      ...(title.value ? { title: title.value } : {}),
      tabs,
      ...(stateKey?.ok ? { key: stateKey.value } : {}),
      ...(input.surface !== undefined ? { surface: input.surface as "none" | "subtle" | "outlined" } : {}),
    })
    return { ok: true, value: components[0]! }
  }
  if (input.type === "conditional") {
    const id = identifier(input.id, "conditional.id")
    const key = identifier(input.key, "conditional.key")
    if (!id.ok) return id
    if (!key.ok) return key
    const equals = input.equals
    if (
      !["string", "number", "boolean"].includes(typeof equals) ||
      (typeof equals === "number" && !Number.isFinite(equals)) ||
      (typeof equals === "string" && equals.length > 240)
    )
      return { ok: false, error: "Conditional comparison must be a short string, finite number, or boolean" }
    const children = parseChildren(input.components, depth + 1)
    if (!children.ok) return children
    components.push({
      type: "conditional",
      id: id.value,
      key: key.value,
      equals: equals as string | number | boolean,
      components: children.value,
    })
    return { ok: true, value: components[0]! }
  }
  if (input.type === "field") {
    const id = identifier(input.id, "field.id")
    const key = identifier(input.key, "field.key")
    const label = string(input.label, "field.label", 100)
    const placeholder = optionalString(input.placeholder, "field.placeholder", 120)
    if (!id.ok) return id
    if (!key.ok) return key
    if (!label.ok) return label
    if (!placeholder.ok) return placeholder
    if (!["text", "number", "toggle", "select"].includes(String(input.control)))
      return { ok: false, error: "Field control must be text, number, toggle, or select" }
    let options: Array<{ label: string; value: string }> | undefined
    if (input.control === "select") {
      if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 12)
        return { ok: false, error: "Select fields need between 2 and 12 options" }
      options = []
      for (const rawOption of input.options) {
        const option = object(rawOption)
        if (!option) return { ok: false, error: "Select options must be objects" }
        const optionLabel = string(option.label, "option.label", 64)
        const optionValue = string(option.value, "option.value", 64)
        if (!optionLabel.ok) return optionLabel
        if (!optionValue.ok) return optionValue
        options.push({ label: optionLabel.value, value: optionValue.value })
      }
      if (new Set(options.map((option) => option.value)).size !== options.length)
        return { ok: false, error: "Select option values must be unique" }
    }
    const required = input.required === undefined ? false : input.required
    if (typeof required !== "boolean") return { ok: false, error: "Field required must be a boolean" }
    const helpText = input.helpText === undefined ? undefined : string(input.helpText, "field.helpText", 240)
    if (helpText && !helpText.ok) return helpText
    const minLength = input.minLength === undefined ? undefined : finite(input.minLength, "field.minLength", 0, 240)
    const maxLength = input.maxLength === undefined ? undefined : finite(input.maxLength, "field.maxLength", 1, 240)
    const min = input.min === undefined ? undefined : finite(input.min, "field.min", -1e9, 1e9)
    const max = input.max === undefined ? undefined : finite(input.max, "field.max", -1e9, 1e9)
    for (const bound of [minLength, maxLength, min, max]) if (bound && !bound.ok) return bound
    if (minLength?.ok && !Number.isInteger(minLength.value))
      return { ok: false, error: "field.minLength must be an integer" }
    if (maxLength?.ok && !Number.isInteger(maxLength.value))
      return { ok: false, error: "field.maxLength must be an integer" }
    if (minLength?.ok && maxLength?.ok && minLength.value > maxLength.value)
      return { ok: false, error: "field.minLength cannot exceed maxLength" }
    if (min?.ok && max?.ok && min.value > max.value) return { ok: false, error: "field.min cannot exceed max" }
    let pattern: string | undefined
    if (input.pattern !== undefined) {
      if (typeof input.pattern !== "string" || input.pattern.length > 160)
        return { ok: false, error: "field.pattern must be a short string" }
      if (/[()|]/.test(input.pattern) || /\\[1-9]/.test(input.pattern) || input.pattern.includes("(?")) {
        return { ok: false, error: "field.pattern supports simple character classes and quantifiers only" }
      }
      try {
        new RegExp(input.pattern)
      } catch {
        return { ok: false, error: "field.pattern must be a valid regular expression" }
      }
      pattern = input.pattern
    }
    components.push({
      type: "field",
      id: id.value,
      key: key.value,
      label: label.value,
      control: input.control as "text" | "number" | "toggle" | "select",
      ...(placeholder.value ? { placeholder: placeholder.value } : {}),
      ...(options ? { options } : {}),
      required,
      ...(minLength?.ok ? { minLength: minLength.value } : {}),
      ...(maxLength?.ok ? { maxLength: maxLength.value } : {}),
      ...(min?.ok ? { min: min.value } : {}),
      ...(max?.ok ? { max: max.value } : {}),
      ...(pattern ? { pattern } : {}),
      ...(helpText?.ok ? { helpText: helpText.value } : {}),
    })
    return { ok: true, value: components[0]! }
  }
  if (input.type === "file-upload") {
    const id = identifier(input.id, "file-upload.id")
    const key = identifier(input.key, "file-upload.key")
    const label = string(input.label, "file-upload.label", 100)
    if (!id.ok) return id
    if (!key.ok) return key
    if (!label.ok) return label
    if (!Array.isArray(input.accept) || input.accept.length < 1 || input.accept.length > 8) {
      return { ok: false, error: "file-upload.accept must contain 1 to 8 supported MIME types" }
    }
    const allowed = new Set([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "application/pdf",
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
    ])
    const accept: string[] = []
    for (const item of input.accept) {
      if (typeof item !== "string" || !allowed.has(item))
        return { ok: false, error: "file-upload.accept contains an unsupported type" }
      accept.push(item)
    }
    let maxSizeMB = 8
    if (input.maxSizeMB !== undefined) {
      const parsedMaxSize = finite(input.maxSizeMB, "file-upload.maxSizeMB", 1, 12)
      if (!parsedMaxSize.ok) return parsedMaxSize
      maxSizeMB = parsedMaxSize.value
    }
    const multiple = input.multiple === undefined ? false : input.multiple
    const required = input.required === undefined ? false : input.required
    if (typeof multiple !== "boolean" || typeof required !== "boolean")
      return { ok: false, error: "file-upload multiple and required must be booleans" }
    const helpText = input.helpText === undefined ? undefined : string(input.helpText, "file-upload.helpText", 240)
    if (helpText && !helpText.ok) return helpText
    components.push({
      type: "file-upload",
      id: id.value,
      key: key.value,
      label: label.value,
      accept,
      multiple,
      maxSizeMB,
      required,
      ...(helpText?.ok ? { helpText: helpText.value } : {}),
    })
    return { ok: true, value: components[0]! }
  }
  const button = parseChatUIButton(input)
  if (button) return button
  if (input.type === "computed") {
    const id = identifier(input.id, "computed.id")
    const label = string(input.label, "computed.label", 100)
    const expression = parseNumericExpression(input.expression)
    const unit = optionalString(input.unit, "computed.unit", 16)
    if (!id.ok) return id
    if (!label.ok) return label
    if (!expression.ok) return expression
    if (!unit.ok) return unit
    let precision = 2
    if (input.precision !== undefined) {
      const parsed = finite(input.precision, "computed.precision", 0, 6)
      if (!parsed.ok) return parsed
      precision = parsed.value
    }
    components.push({
      type: "computed",
      id: id.value,
      label: label.value,
      expression: expression.value,
      ...(unit.value ? { unit: unit.value } : {}),
      precision,
    })
    return { ok: true, value: components[0]! }
  }
  if (input.type === "state-value") {
    const key = identifier(input.key, "state-value.key")
    const label = string(input.label, "state-value.label", 100)
    const unit = optionalString(input.unit, "state-value.unit", 16)
    if (!key.ok) return key
    if (!label.ok) return label
    if (!unit.ok) return unit
    components.push({
      type: "state-value",
      key: key.value,
      label: label.value,
      ...(unit.value ? { unit: unit.value } : {}),
    })
    return { ok: true, value: components[0]! }
  }
  return undefined
}
