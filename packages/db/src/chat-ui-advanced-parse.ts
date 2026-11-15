import type { ChatUIAdvancedComponent, ParseResult } from "./chat-ui"
import { parseAdvancedChatUIExtra } from "./chat-ui-advanced-extra-parse"

type Parsed<T> = ParseResult<T>
type RecordValue = Record<string, unknown>

const object = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined

function text(value: unknown, field: string, max: number): Parsed<string> {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    return { ok: false, error: `${field} must be a non-empty string of at most ${max} characters` }
  }
  return { ok: true, value: value.trim() }
}

function number(value: unknown, field: string, min: number, max: number): Parsed<number> {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return { ok: false, error: `${field} must be a finite number between ${min} and ${max}` }
  }
  return { ok: true, value }
}

function identifier(value: unknown, field: string): Parsed<string> {
  const parsed = text(value, field, 48)
  if (!parsed.ok) return parsed
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(parsed.value)
    ? parsed
    : { ok: false, error: `${field} must be a valid identifier` }
}

function list(value: unknown, field: string, min: number, max: number): Parsed<unknown[]> {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    return { ok: false, error: `${field} must contain between ${min} and ${max} items` }
  }
  return { ok: true, value }
}

export function parseAdvancedChatUIComponent(input: RecordValue): Parsed<ChatUIAdvancedComponent> | undefined {
  if (input.type === "workflow") {
    const title = text(input.title, "workflow.title", 120)
    const raw = list(input.nodes, "workflow.nodes", 2, 12)
    if (!title.ok) return title
    if (!raw.ok) return raw
    const nodes: Extract<ChatUIAdvancedComponent, { type: "workflow" }>["nodes"] = []
    for (const item of raw.value) {
      const node = object(item)
      if (!node) return { ok: false, error: "Workflow nodes must be objects" }
      const id = identifier(node.id, "node.id")
      const label = text(node.label, "node.label", 80)
      if (!id.ok) return id
      if (!label.ok) return label
      if (!["trigger", "process", "condition", "output"].includes(String(node.kind))) {
        return { ok: false, error: "Workflow node kind is invalid" }
      }
      nodes.push({ id: id.value, label: label.value, kind: node.kind as (typeof nodes)[number]["kind"] })
    }
    if (new Set(nodes.map((node) => node.id)).size !== nodes.length)
      return { ok: false, error: "Workflow node IDs must be unique" }
    return { ok: true, value: { type: "workflow", title: title.value, nodes } }
  }

  if (input.type === "desktop") {
    const title = text(input.title, "desktop.title", 120)
    const raw = list(input.apps, "desktop.apps", 2, 8)
    if (!title.ok) return title
    if (!raw.ok) return raw
    const apps: Extract<ChatUIAdvancedComponent, { type: "desktop" }>["apps"] = []
    for (const item of raw.value) {
      const app = object(item)
      if (!app) return { ok: false, error: "Desktop apps must be objects" }
      const id = identifier(app.id, "app.id")
      const name = text(app.name, "app.name", 48)
      const icon = text(app.icon, "app.icon", 32)
      const content = text(app.content, "app.content", 800)
      if (!id.ok) return id
      if (!name.ok) return name
      if (!icon.ok) return icon
      if (!content.ok) return content
      apps.push({ id: id.value, name: name.value, icon: icon.value, content: content.value })
    }
    if (new Set(apps.map((app) => app.id)).size !== apps.length)
      return { ok: false, error: "Desktop app IDs must be unique" }
    return { ok: true, value: { type: "desktop", title: title.value, apps } }
  }

  if (input.type === "database") {
    const title = text(input.title, "database.title", 120)
    const rawColumns = list(input.columns, "database.columns", 1, 8)
    const rawRows = list(input.rows, "database.rows", 1, 32)
    if (!title.ok) return title
    if (!rawColumns.ok) return rawColumns
    if (!rawRows.ok) return rawRows
    const columns: string[] = []
    for (const item of rawColumns.value) {
      const column = text(item, "database.column", 48)
      if (!column.ok) return column
      columns.push(column.value)
    }
    const rows: Array<Array<string | number>> = []
    for (const item of rawRows.value) {
      if (!Array.isArray(item) || item.length !== columns.length)
        return { ok: false, error: "Database rows must match the column count" }
      const row: Array<string | number> = []
      for (const cell of item) {
        if (typeof cell === "string" && cell.length <= 180) row.push(cell)
        else if (typeof cell === "number" && Number.isFinite(cell)) row.push(cell)
        else return { ok: false, error: "Database cells must be short strings or finite numbers" }
      }
      rows.push(row)
    }
    return { ok: true, value: { type: "database", title: title.value, columns, rows } }
  }

  if (input.type === "api") {
    const title = text(input.title, "api.title", 120)
    const endpoint = text(input.endpoint, "api.endpoint", 300)
    const status = number(input.sampleStatus, "api.sampleStatus", 100, 599)
    const response = text(input.sampleResponse, "api.sampleResponse", 1600)
    const rawMethods = list(input.methods, "api.methods", 1, 5)
    if (!title.ok) return title
    if (!endpoint.ok) return endpoint
    if (!status.ok) return status
    if (!Number.isInteger(status.value)) return { ok: false, error: "api.sampleStatus must be an integer" }
    if (!response.ok) return response
    if (!rawMethods.ok) return rawMethods
    const methods: Array<"GET" | "POST" | "PUT" | "PATCH" | "DELETE"> = []
    for (const method of rawMethods.value) {
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(method)))
        return { ok: false, error: "API method is unsupported" }
      methods.push(method as (typeof methods)[number])
    }
    return {
      ok: true,
      value: {
        type: "api",
        title: title.value,
        methods,
        endpoint: endpoint.value,
        sampleStatus: status.value,
        sampleResponse: response.value,
      },
    }
  }

  if (input.type === "scene") {
    const title = text(input.title, "scene.title", 120)
    const description = input.description === undefined ? undefined : text(input.description, "scene.description", 300)
    const rotation = number(input.rotation, "scene.rotation", 0, 360)
    if (!title.ok) return title
    if (!rotation.ok) return rotation
    if (description && !description.ok) return description
    if (!["cube", "sphere", "pyramid"].includes(String(input.shape)))
      return { ok: false, error: "Scene shape is unsupported" }
    return {
      ok: true,
      value: {
        type: "scene",
        title: title.value,
        shape: input.shape as "cube" | "sphere" | "pyramid",
        rotation: rotation.value,
        ...(description?.ok && description.value ? { description: description.value } : {}),
      },
    }
  }

  if (input.type === "wizard") {
    const title = text(input.title, "wizard.title", 120)
    const raw = list(input.steps, "wizard.steps", 2, 8)
    if (!title.ok) return title
    if (!raw.ok) return raw
    const steps: Extract<ChatUIAdvancedComponent, { type: "wizard" }>["steps"] = []
    for (const item of raw.value) {
      const step = object(item)
      if (!step) return { ok: false, error: "Wizard steps must be objects" }
      const stepTitle = text(step.title, "step.title", 100)
      const description = text(step.description, "step.description", 300)
      const fieldLabel = text(step.fieldLabel, "step.fieldLabel", 80)
      const placeholder = step.placeholder === undefined ? undefined : text(step.placeholder, "step.placeholder", 100)
      if (!stepTitle.ok) return stepTitle
      if (!description.ok) return description
      if (!fieldLabel.ok) return fieldLabel
      if (placeholder && !placeholder.ok) return placeholder
      steps.push({
        title: stepTitle.value,
        description: description.value,
        fieldLabel: fieldLabel.value,
        ...(placeholder?.ok ? { placeholder: placeholder.value } : {}),
      })
    }
    return { ok: true, value: { type: "wizard", title: title.value, steps } }
  }

  if (input.type === "monitor") {
    const title = text(input.title, "monitor.title", 120)
    const raw = list(input.metrics, "monitor.metrics", 1, 6)
    if (!title.ok) return title
    if (!raw.ok) return raw
    const metrics: Extract<ChatUIAdvancedComponent, { type: "monitor" }>["metrics"] = []
    for (const item of raw.value) {
      const metric = object(item)
      if (!metric) return { ok: false, error: "Monitor metrics must be objects" }
      const label = text(metric.label, "metric.label", 80)
      const value = number(metric.value, "metric.value", -1e9, 1e9)
      const unit = metric.unit === undefined ? undefined : text(metric.unit, "metric.unit", 16)
      if (!label.ok) return label
      if (!value.ok) return value
      if (unit && !unit.ok) return unit
      metrics.push({ label: label.value, value: value.value, ...(unit?.ok ? { unit: unit.value } : {}) })
    }
    return { ok: true, value: { type: "monitor", title: title.value, metrics } }
  }

  if (input.type === "circuit") {
    const title = text(input.title, "circuit.title", 120)
    const voltage = number(input.voltage, "circuit.voltage", 0, 1000)
    const resistance = number(input.resistance, "circuit.resistance", 0.1, 1e6)
    if (!title.ok) return title
    if (!voltage.ok) return voltage
    if (!resistance.ok) return resistance
    return {
      ok: true,
      value: { type: "circuit", title: title.value, voltage: voltage.value, resistance: resistance.value },
    }
  }

  return parseAdvancedChatUIExtra(input)
}
