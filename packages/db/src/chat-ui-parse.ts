import type { ChatUIComponent, ChatUIControl, ChatUISpec, NumericExpression, ParseResult } from "./chat-ui"
import { numericExpressionInputs, parseChatUIControl, parseNumericExpression } from "./chat-ui-simulation-parse"
import { parseAdvancedChatUIComponent } from "./chat-ui-advanced-parse"
import { parseChatUICompositionComponent } from "./chat-ui-composition-parse"
import { parseChatUIState } from "./chat-ui-state-parse"
import { parseChatUILearningComponent } from "./chat-ui-learning-parse"
import { parseChatUIPlatformer } from "./chat-ui-platformer-parse"

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

export function parseChatUIComponents(
  value: unknown,
  depth = 0,
  budget: { count: number } = { count: 0 },
): Parsed<ChatUIComponent[]> {
  if (depth > 4) return { ok: false, error: "UI nesting cannot exceed 4 levels" }
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    return { ok: false, error: "A UI needs between 1 and 24 components per group" }
  }
  const components: ChatUIComponent[] = []
  for (const raw of value) {
    budget.count += 1
    if (budget.count > 64) return { ok: false, error: "A UI cannot contain more than 64 components" }
    const input = object(raw)
    if (!input) return { ok: false, error: "UI component must be an object" }
    const composition = parseChatUICompositionComponent(
      input,
      (children, childDepth) => parseChatUIComponents(children, childDepth, budget),
      depth,
    )
    if (composition) {
      if (!composition.ok) return composition
      components.push(composition.value)
      continue
    }
    const platformer = parseChatUIPlatformer(input)
    if (platformer) {
      if (!platformer.ok) return platformer
      components.push(platformer.value)
      continue
    }
    const learning = parseChatUILearningComponent(input)
    if (learning) {
      if (!learning.ok) return learning
      components.push(learning.value)
      continue
    }
    const advanced = parseAdvancedChatUIComponent(input)
    if (advanced) {
      if (!advanced.ok) return advanced
      components.push(advanced.value)
      continue
    }
    if (input.type === "divider") {
      const label = optionalString(input.label, "divider.label", 80)
      if (!label.ok) return label
      const style = input.style === undefined ? "solid" : input.style
      if (style !== "solid" && style !== "dashed") return { ok: false, error: "Divider style must be solid or dashed" }
      components.push({ type: "divider", style, ...(label.value ? { label: label.value } : {}) })
      continue
    }
    if (input.type === "heading") {
      const text = string(input.text, "heading.text", 160)
      if (!text.ok) return text
      const level = input.level === 3 ? 3 : input.level === 2 || input.level === undefined ? 2 : undefined
      if (!level) return { ok: false, error: "Heading level must be 2 or 3" }
      components.push({ type: "heading", text: text.value, level })
      continue
    }
    if (input.type === "text") {
      const content = string(input.content, "text.content", 1600)
      if (!content.ok) return content
      components.push({ type: "text", content: content.value })
      continue
    }
    if (input.type === "metric") {
      const label = string(input.label, "metric.label", 100)
      if (!label.ok) return label
      const value =
        typeof input.value === "string" ? string(input.value, "metric.value", 100) : finite(input.value, "metric.value")
      if (!value.ok) return value
      const unit = optionalString(input.unit, "metric.unit", 16)
      if (!unit.ok) return unit
      const tone = ["positive", "warning"].includes(String(input.tone))
        ? (input.tone as "positive" | "warning")
        : "default"
      components.push({
        type: "metric",
        label: label.value,
        value: value.value,
        ...(unit.value ? { unit: unit.value } : {}),
        tone,
      })
      continue
    }
    if (input.type === "callout") {
      const title = string(input.title, "callout.title", 100)
      const content = string(input.content, "callout.content", 800)
      if (!title.ok) return title
      if (!content.ok) return content
      const tone = ["success", "warning"].includes(String(input.tone)) ? (input.tone as "success" | "warning") : "info"
      components.push({ type: "callout", title: title.value, content: content.value, tone })
      continue
    }
    if (input.type === "progress") {
      const label = string(input.label, "progress.label", 100)
      const current = finite(input.value, "progress.value", 0, 1e9)
      const max = finite(input.max, "progress.max", 0.000001, 1e9)
      const unit = optionalString(input.unit, "progress.unit", 16)
      if (!label.ok) return label
      if (!current.ok) return current
      if (!max.ok) return max
      if (!unit.ok) return unit
      components.push({
        type: "progress",
        label: label.value,
        value: current.value,
        max: max.value,
        ...(unit.value ? { unit: unit.value } : {}),
      })
      continue
    }
    if (input.type === "chart") {
      const title = string(input.title, "chart.title", 120)
      if (!title.ok) return title
      if (input.kind !== "bar" && input.kind !== "line") return { ok: false, error: "Chart kind must be bar or line" }
      if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > 32) {
        return { ok: false, error: "Charts need between 2 and 32 points" }
      }
      const points: Array<{ label: string; value: number } | { label: string; key: string }> = []
      for (const pointRaw of input.points) {
        const point = object(pointRaw)
        if (!point) return { ok: false, error: "Chart point must be an object" }
        const label = string(point.label, "point.label", 48)
        if (!label.ok) return label
        if (point.key !== undefined) {
          const key = string(point.key, "point.key", 48)
          if (!key.ok) return key
          points.push({ label: label.value, key: key.value })
        } else {
          const current = finite(point.value, "point.value", -1e9, 1e9)
          if (!current.ok) return current
          points.push({ label: label.value, value: current.value })
        }
      }
      components.push({ type: "chart", title: title.value, kind: input.kind, points })
      continue
    }
    if (input.type === "table") {
      const title = optionalString(input.title, "table.title", 120)
      if (!title.ok) return title
      if (!Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > 8) {
        return { ok: false, error: "Tables need between 1 and 8 columns" }
      }
      const columns: string[] = []
      for (const column of input.columns) {
        const label = string(column, "table.column", 80)
        if (!label.ok) return label
        columns.push(label.value)
      }
      if (!Array.isArray(input.rows) || input.rows.length > 32)
        return { ok: false, error: "Tables support up to 32 rows" }
      const rows: Array<Array<string | number>> = []
      for (const row of input.rows) {
        if (!Array.isArray(row) || row.length !== columns.length)
          return { ok: false, error: "Every table row must match the column count" }
        const cells: Array<string | number> = []
        for (const cell of row) {
          if (typeof cell === "number" && Number.isFinite(cell)) cells.push(cell)
          else if (typeof cell === "string" && cell.length <= 240) cells.push(cell)
          else return { ok: false, error: "Table cells must be short strings or finite numbers" }
        }
        rows.push(cells)
      }
      components.push({ type: "table", ...(title.value ? { title: title.value } : {}), columns, rows })
      continue
    }
    if (input.type === "simulation") {
      const title = string(input.title, "simulation.title", 120)
      const description = optionalString(input.description, "simulation.description", 400)
      if (!title.ok) return title
      if (!description.ok) return description
      if (!Array.isArray(input.controls) || input.controls.length < 1 || input.controls.length > 8) {
        return { ok: false, error: "Simulations need between 1 and 8 controls" }
      }
      if (!Array.isArray(input.outputs) || input.outputs.length < 1 || input.outputs.length > 8) {
        return { ok: false, error: "Simulations need between 1 and 8 outputs" }
      }
      const controls: ChatUIControl[] = []
      for (const rawControl of input.controls) {
        const control = parseChatUIControl(rawControl)
        if (!control.ok) return control
        controls.push(control.value)
      }
      if (new Set(controls.map((control) => control.id)).size !== controls.length) {
        return { ok: false, error: "Simulation control IDs must be unique" }
      }
      const outputs: Array<{ label: string; expression: NumericExpression; unit?: string; precision?: number }> = []
      for (const rawOutput of input.outputs) {
        const output = object(rawOutput)
        if (!output) return { ok: false, error: "Simulation output must be an object" }
        const label = string(output.label, "output.label", 100)
        const expression = parseNumericExpression(output.expression)
        const unit = optionalString(output.unit, "output.unit", 16)
        if (!label.ok) return label
        if (!expression.ok) return expression
        if (!unit.ok) return unit
        const controlIDs = new Set(controls.map((control) => control.id))
        const unknownInput = numericExpressionInputs(expression.value).find((name) => !controlIDs.has(name))
        if (unknownInput) return { ok: false, error: `Simulation output references unknown control: ${unknownInput}` }
        let precision = 2
        if (output.precision !== undefined) {
          const parsedPrecision = finite(output.precision, "output.precision", 0, 6)
          if (!parsedPrecision.ok) return parsedPrecision
          precision = parsedPrecision.value
        }
        outputs.push({
          label: label.value,
          expression: expression.value,
          ...(unit.value ? { unit: unit.value } : {}),
          precision,
        })
      }
      components.push({
        type: "simulation",
        title: title.value,
        ...(description.value ? { description: description.value } : {}),
        controls,
        outputs,
      })
      continue
    }
    return { ok: false, error: `Unsupported UI component type: ${String(input.type)}` }
  }
  return { ok: true, value: components }
}

function findGroupWithoutManualLayout(components: ChatUIComponent[]): string | undefined {
  for (const component of components) {
    if (component.type === "group") {
      if (!component.layout) return component.id
      const nested = findGroupWithoutManualLayout(component.components)
      if (nested) return nested
    }
    if (component.type === "conditional") {
      const nested = findGroupWithoutManualLayout(component.components)
      if (nested) return nested
    }
    if (component.type === "tabs") {
      for (const tab of component.tabs) {
        const nested = findGroupWithoutManualLayout(tab.components)
        if (nested) return nested
      }
    }
  }
  return undefined
}

export function parseChatUISpec(value: unknown, id: string): Parsed<ChatUISpec> {
  const input = object(value)
  if (!input) return { ok: false, error: "UI spec must be an object" }
  const title = string(input.title, "title", 120)
  const description = optionalString(input.description, "description", 400)
  if (!title.ok) return title
  if (!description.ok) return description
  const components = parseChatUIComponents(input.components)
  if (!components.ok) return components
  const state = parseChatUIState(input.state, components.value)
  if (!state.ok) return state
  const layoutMode =
    input.layoutMode === undefined || input.layoutMode === "auto"
      ? "auto"
      : input.layoutMode === "hybrid" || input.layoutMode === "manual"
        ? input.layoutMode
        : undefined
  if (!layoutMode) return { ok: false, error: "layoutMode must be auto, hybrid, or manual" }
  const layout =
    input.layout === "grid" ? "grid" : input.layout === "stack" ? "stack" : input.layout === undefined ? undefined : null
  if (layout === null) return { ok: false, error: "Layout must be stack or grid" }
  if (layoutMode === "manual" && !layout) return { ok: false, error: "Manual layout mode requires an explicit root layout" }
  if (layoutMode === "manual") {
    const missingGroup = findGroupWithoutManualLayout(components.value)
    if (missingGroup) return { ok: false, error: `Manual layout mode requires an explicit layout for group: ${missingGroup}` }
  }
  if (input.persistState !== undefined && typeof input.persistState !== "boolean") {
    return { ok: false, error: "persistState must be a boolean" }
  }
  return {
    ok: true,
    value: {
      id,
      version: 1,
      title: title.value,
      ...(description.value ? { description: description.value } : {}),
      layoutMode,
      ...(layout ? { layout } : {}),
      ...(input.persistState === true ? { persistState: true } : {}),
      ...(state.value ? { state: state.value } : {}),
      components: components.value,
    },
  }
}
