import type { ChatUIComponent, ChatUIStateValue, ParseResult } from "./chat-ui"
import { numericExpressionInputs } from "./chat-ui-simulation-parse"

type Parsed<T> = ParseResult<T>
type RecordValue = Record<string, unknown>

const object = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined

const identifier = (value: unknown, field: string): Parsed<string> => {
  if (typeof value !== "string" || !value.trim() || value.length > 48 || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
    return { ok: false, error: `${field} must be a valid identifier` }
  }
  return { ok: true, value }
}

function collectSpecialStateKeys(components: ChatUIComponent[]) {
  const largeStrings = new Set<string>()
  const uploadKeys = new Set<string>()
  const tabIDs = new Set<string>()
  const walk = (items: ChatUIComponent[]) => {
    for (const component of items) {
      if (component.type === "data-grid") largeStrings.add(component.key)
      if (component.type === "file-upload") uploadKeys.add(component.key)
      if (component.type === "tabs") {
        for (const tab of component.tabs) tabIDs.add(tab.id)
        component.tabs.forEach((tab) => walk(tab.components))
      }
      if (component.type === "group" || component.type === "conditional") walk(component.components)
    }
  }
  walk(components)
  return { largeStrings, uploadKeys, tabIDs }
}

export function parseChatUIState(
  value: unknown,
  components: ChatUIComponent[],
): Parsed<Array<{ key: string; value: ChatUIStateValue }> | undefined> {
  const state: Array<{ key: string; value: ChatUIStateValue }> = []
  const specialKeys = collectSpecialStateKeys(components)
  if (value !== undefined) {
    if (!Array.isArray(value) || value.length > 24) {
      return { ok: false, error: "UI state supports up to 24 declarations" }
    }
    for (const rawState of value) {
      const declaration = object(rawState)
      if (!declaration) return { ok: false, error: "State declarations must be objects" }
      const key = identifier(declaration.key, "state.key")
      if (!key.ok) return key
      const current = declaration.value
      if (
        !["string", "number", "boolean"].includes(typeof current) ||
        (typeof current === "number" && !Number.isFinite(current)) ||
        (typeof current === "string" &&
          current.length >
            (specialKeys.largeStrings.has(String(declaration.key))
              ? 48_000
              : specialKeys.uploadKeys.has(String(declaration.key))
                ? 1_200
                : 240))
      ) {
        return { ok: false, error: `State ${key.value} must be a short string, finite number, or boolean` }
      }
      if (state.some((item) => item.key === key.value)) return { ok: false, error: "UI state keys must be unique" }
      state.push({ key: key.value, value: current as ChatUIStateValue })
    }
  }

  const stateByKey = new Map(state.map((item) => [item.key, item.value]))
  const componentIDs = new Set<string>()
  const validateBindings = (items: ChatUIComponent[]): string | undefined => {
    for (const component of items) {
      const componentID = "id" in component ? component.id : undefined
      if (componentID) {
        if (componentIDs.has(componentID)) return `Component IDs must be unique: ${componentID}`
        componentIDs.add(componentID)
      }
      if (component.type === "field") {
        if (!stateByKey.has(component.key)) return `Component references undeclared state key: ${component.key}`
        const current = stateByKey.get(component.key)
        if (component.control === "toggle" && typeof current !== "boolean") {
          return `Toggle field ${component.id} needs boolean state`
        }
        if (component.control === "number" && typeof current !== "number") {
          return `Number field ${component.id} needs numeric state`
        }
        if ((component.control === "text" || component.control === "select") && typeof current !== "string") {
          return `Text field ${component.id} needs string state`
        }
        if (component.control === "select" && !component.options?.some((option) => option.value === current)) {
          return `Select field ${component.id} must include its initial state value`
        }
        if (component.control === "text" && typeof current === "string") {
          if (component.minLength !== undefined && current.length < component.minLength)
            return `Text field ${component.id} is below its minimum length`
          if (component.maxLength !== undefined && current.length > component.maxLength)
            return `Text field ${component.id} exceeds its maximum length`
          if (component.pattern) {
            try {
              if (current && !new RegExp(component.pattern).test(current))
                return `Text field ${component.id} does not match its pattern`
            } catch {
              return `Text field ${component.id} has an invalid pattern`
            }
          }
        }
        if (component.control === "number" && typeof current === "number") {
          if (component.min !== undefined && current < component.min)
            return `Number field ${component.id} is below its minimum`
          if (component.max !== undefined && current > component.max)
            return `Number field ${component.id} exceeds its maximum`
        }
      }
      if (component.type === "file-upload") {
        const current = stateByKey.get(component.key)
        if (typeof current !== "string") return `File upload ${component.id} needs string state`
        if (current.length > 1_200) return `File upload ${component.id} state is too large`
      }
      if (component.type === "data-grid") {
        const current = stateByKey.get(component.key)
        if (typeof current !== "string") return `Data grid ${component.id} needs string state`
        let rows: unknown
        try {
          rows = JSON.parse(current)
        } catch {
          return `Data grid ${component.id} state must contain JSON rows`
        }
        if (!Array.isArray(rows) || rows.length > component.maxRows)
          return `Data grid ${component.id} has invalid row state`
        for (const row of rows) {
          if (!Array.isArray(row) || row.length !== component.columns.length)
            return `Data grid ${component.id} rows must match the column count`
          for (let index = 0; index < row.length; index++) {
            const cell = row[index]
            const column = component.columns[index]!
            if (column.type === "text" && (typeof cell !== "string" || cell.length > 100))
              return `Data grid ${component.id} text cells are invalid`
            if (column.type === "number" && (typeof cell !== "number" || !Number.isFinite(cell)))
              return `Data grid ${component.id} number cells are invalid`
          }
        }
      }
      if (component.type === "chart") {
        for (const point of component.points) {
          if ("key" in point) {
            if (!stateByKey.has(point.key)) return `Chart references undeclared state key: ${point.key}`
            if (typeof stateByKey.get(point.key) !== "number") return `Chart data binding must reference numeric state: ${point.key}`
          }
        }
      }
      if (component.type === "state-value" && !stateByKey.has(component.key)) {
        return `Component references undeclared state key: ${component.key}`
      }
      if (component.type === "computed") {
        const missingInput = numericExpressionInputs(component.expression).find((key) => !stateByKey.has(key))
        if (missingInput) return `Computed value references undeclared state key: ${missingInput}`
        const nonNumericInput = numericExpressionInputs(component.expression).find(
          (key) => typeof stateByKey.get(key) !== "number",
        )
        if (nonNumericInput) return `Computed value requires numeric state: ${nonNumericInput}`
      }
      if (component.type === "conditional") {
        if (!stateByKey.has(component.key)) return `Conditional references undeclared state key: ${component.key}`
        if (typeof stateByKey.get(component.key) !== typeof component.equals) {
          return `Conditional comparison must match state type: ${component.key}`
        }
        const nested = validateBindings(component.components)
        if (nested) return nested
      }
      if (component.type === "button") {
        for (const action of component.actions) {
          if (action.type === "submit" || action.type === "refresh") continue
          if (!stateByKey.has(action.key)) return `Button action references undeclared state key: ${action.key}`
          const current = stateByKey.get(action.key)
          if (action.type === "set" && typeof action.value !== typeof current) {
            return `Set action must preserve the state type: ${action.key}`
          }
          if (action.type === "toggle" && typeof current !== "boolean") {
            return `Toggle action requires boolean state: ${action.key}`
          }
          if (action.type === "increment" && typeof current !== "number") {
            return `Increment action requires numeric state: ${action.key}`
          }
          if (action.type === "filter" && typeof action.value !== typeof current) {
            return `Filter action must preserve the state type: ${action.key}`
          }
          if (action.type === "navigate" && (typeof current !== "string" || !specialKeys.tabIDs.has(action.target))) {
            return `Navigate action must target a declared tab: ${action.target}`
          }
        }
      }
      if (component.type === "group") {
        const nested = validateBindings(component.components)
        if (nested) return nested
      }
      if (component.type === "tabs") {
        if (component.key) {
          const current = stateByKey.get(component.key)
          if (typeof current !== "string" || !component.tabs.some((tab) => tab.id === current)) {
            return `Tabs ${component.id} need string state set to one of their tab IDs`
          }
        }
        for (const tab of component.tabs) {
          const nested = validateBindings(tab.components)
          if (nested) return nested
        }
      }
    }
  }

  const bindingError = validateBindings(components)
  if (bindingError) return { ok: false, error: bindingError }
  return { ok: true, value: state.length ? state : undefined }
}
