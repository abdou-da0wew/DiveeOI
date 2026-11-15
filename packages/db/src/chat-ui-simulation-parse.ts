import type { ChatUIControl, NumericExpression, ParseResult } from "./chat-ui"

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
export function parseNumericExpression(value: unknown, depth = 0): Parsed<NumericExpression> {
  const input = object(value)
  if (!input || depth > 8)
    return { ok: false, error: "Simulation expressions must be valid and no deeper than 8 levels" }
  const op = input.op
  if (op === "literal") {
    const result = finite(input.value, "expression.value", -1e12, 1e12)
    return result.ok ? { ok: true, value: { op, value: result.value } } : result
  }
  if (op === "input") {
    const name = identifier(input.name, "expression.name")
    return name.ok ? { ok: true, value: { op, name: name.value } } : name
  }
  if (op === "neg" || op === "abs" || op === "sqrt") {
    const nested = parseNumericExpression(input.value, depth + 1)
    return nested.ok ? { ok: true, value: { op, value: nested.value } } : nested
  }
  if (["add", "sub", "mul", "div", "pow", "min", "max"].includes(String(op))) {
    const left = parseNumericExpression(input.left, depth + 1)
    if (!left.ok) return left
    const right = parseNumericExpression(input.right, depth + 1)
    if (!right.ok) return right
    return { ok: true, value: { op: op as "add", left: left.value, right: right.value } as NumericExpression }
  }
  return { ok: false, error: "Unsupported simulation expression operator" }
}

export function numericExpressionInputs(expression: NumericExpression): string[] {
  if (expression.op === "input") return [expression.name]
  if (expression.op === "literal") return []
  if ("value" in expression) return numericExpressionInputs(expression.value)
  return [...numericExpressionInputs(expression.left), ...numericExpressionInputs(expression.right)]
}

export function parseChatUIControl(value: unknown): Parsed<ChatUIControl> {
  const input = object(value)
  if (!input) return { ok: false, error: "Simulation control must be an object" }
  const id = identifier(input.id, "control.id")
  if (!id.ok) return id
  const label = string(input.label, "control.label", 100)
  if (!label.ok) return label

  if (input.type === "slider") {
    const min = finite(input.min, "slider.min", -1e9, 1e9)
    const max = finite(input.max, "slider.max", -1e9, 1e9)
    const step = finite(input.step, "slider.step", 0.000001, 1e9)
    const current = finite(input.value, "slider.value", -1e9, 1e9)
    const unit = optionalString(input.unit, "slider.unit", 16)
    if (!min.ok) return min
    if (!max.ok) return max
    if (!step.ok) return step
    if (!current.ok) return current
    if (!unit.ok) return unit
    if (min.value >= max.value || current.value < min.value || current.value > max.value) {
      return { ok: false, error: "Slider min must be below max and value must be in range" }
    }
    return {
      ok: true,
      value: {
        type: "slider",
        id: id.value,
        label: label.value,
        min: min.value,
        max: max.value,
        step: step.value,
        value: current.value,
        ...(unit.value ? { unit: unit.value } : {}),
      },
    }
  }

  if (input.type === "toggle" && typeof input.value === "boolean") {
    return { ok: true, value: { type: "toggle", id: id.value, label: label.value, value: input.value } }
  }

  if (input.type === "select") {
    const selected = string(input.value, "select.value", 64)
    if (!selected.ok) return selected
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 8) {
      return { ok: false, error: "Select controls need between 2 and 8 options" }
    }
    const options: Array<{ label: string; value: string }> = []
    const values = new Set<string>()
    for (const item of input.options) {
      const option = object(item)
      if (!option) return { ok: false, error: "Select option must be an object" }
      const optionLabel = string(option.label, "option.label", 80)
      const optionValue = string(option.value, "option.value", 64)
      if (!optionLabel.ok) return optionLabel
      if (!optionValue.ok) return optionValue
      if (values.has(optionValue.value)) return { ok: false, error: "Select option values must be unique" }
      values.add(optionValue.value)
      options.push({ label: optionLabel.value, value: optionValue.value })
    }
    if (!options.some((option) => option.value === selected.value)) {
      return { ok: false, error: "Select value must match one of its options" }
    }
    return { ok: true, value: { type: "select", id: id.value, label: label.value, value: selected.value, options } }
  }

  return { ok: false, error: "Unsupported simulation control type" }
}
