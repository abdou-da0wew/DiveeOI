import type { Expression, InteractionAction, Scalar, SceneInteraction } from "../model/types"

type JsonValue = Scalar | JsonValue[] | { [key: string]: JsonValue }

class ScriptLiteralParser {
  private index = 0

  constructor(private readonly source: string) {}

  parse(): JsonValue {
    const value = this.value(0)
    this.space()
    if (this.index !== this.source.length) this.fail("unexpected trailing JavaScript")
    return value
  }

  private fail(message: string): never {
    throw new Error(`CoenxScript error at character ${this.index}: ${message}`)
  }

  private space() {
    while (this.index < this.source.length) {
      if (/\s/.test(this.source[this.index])) {
        this.index++
        continue
      }
      if (this.source.startsWith("//", this.index)) {
        const end = this.source.indexOf("\n", this.index + 2)
        this.index = end < 0 ? this.source.length : end + 1
        continue
      }
      if (this.source.startsWith("/*", this.index)) {
        const end = this.source.indexOf("*/", this.index + 2)
        if (end < 0) this.fail("unterminated comment")
        this.index = end + 2
        continue
      }
      break
    }
  }

  private value(depth: number): JsonValue {
    if (depth > 24) this.fail("data nesting exceeds 24 levels")
    this.space()
    const char = this.source[this.index]
    if (char === "{") return this.object(depth + 1)
    if (char === "[") return this.array(depth + 1)
    if (char === '"' || char === "'") return this.string()
    const number = this.source.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    if (number) {
      this.index += number[0].length
      const parsed = Number(number[0])
      if (!Number.isFinite(parsed)) this.fail("number must be finite")
      return parsed
    }
    const identifier = this.source.slice(this.index).match(/^[A-Za-z_$][\w$]*/)
    if (identifier) {
      this.index += identifier[0].length
      if (identifier[0] === "true") return true
      if (identifier[0] === "false") return false
      if (identifier[0] === "null") return null
      this.fail(`identifier ${identifier[0]} is not allowed in declarative scripts`)
    }
    this.fail("expected a literal, object or array")
  }

  private string(): string {
    const quote = this.source[this.index++]
    let output = ""
    while (this.index < this.source.length) {
      const char = this.source[this.index++]
      if (char === quote) return output
      if (char === "\\") {
        const escaped = this.source[this.index++]
        const simple: Record<string, string> = {
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          f: "\f",
          "\\": "\\",
          '"': '"',
          "'": "'",
        }
        if (escaped in simple) output += simple[escaped]
        else if (escaped === "u") {
          const hex = this.source.slice(this.index, this.index + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("invalid Unicode escape")
          output += String.fromCharCode(Number.parseInt(hex, 16))
          this.index += 4
        } else this.fail("unsupported string escape")
      } else {
        if (char === "\n" || char === "\r") this.fail("strings cannot contain raw newlines")
        output += char
      }
      if (output.length > 20_000) this.fail("string exceeds the 20,000 character limit")
    }
    this.fail("unterminated string")
  }

  private object(depth: number): { [key: string]: JsonValue } {
    this.index++
    const result: Record<string, JsonValue> = {}
    this.space()
    while (this.source[this.index] !== "}") {
      const char = this.source[this.index]
      let key: string
      if (char === '"' || char === "'") key = this.string()
      else {
        const name = this.source.slice(this.index).match(/^[A-Za-z_$][\w$]*/)
        if (!name) this.fail("object keys must be identifiers or quoted strings")
        key = name[0]
        this.index += key.length
      }
      if (["__proto__", "prototype", "constructor"].includes(key)) this.fail(`unsafe key ${key}`)
      if (Object.hasOwn(result, key)) this.fail(`duplicate key ${key}`)
      this.space()
      if (this.source[this.index++] !== ":") this.fail("expected ':' after object key")
      result[key] = this.value(depth)
      this.space()
      if (this.source[this.index] === "}") break
      if (this.source[this.index++] !== ",") this.fail("expected ',' between object properties")
      this.space()
      if (this.source[this.index] === "}") break
    }
    if (this.source[this.index++] !== "}") this.fail("unterminated object")
    return result
  }

  private array(depth: number): JsonValue[] {
    this.index++
    const result: JsonValue[] = []
    this.space()
    while (this.source[this.index] !== "]") {
      result.push(this.value(depth))
      if (result.length > 2_000) this.fail("array exceeds the 2,000 item limit")
      this.space()
      if (this.source[this.index] === "]") break
      if (this.source[this.index++] !== ",") this.fail("expected ',' between array items")
      this.space()
      if (this.source[this.index] === "]") break
    }
    if (this.source[this.index++] !== "]") this.fail("unterminated array")
    return result
  }
}

function object(value: JsonValue | undefined, label: string): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`CoenxScript: ${label} must be an object`)
  return value
}

function string(value: JsonValue | undefined, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`CoenxScript: ${label} must be a non-empty string`)
  return value
}

function list(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`CoenxScript: ${label} must be an array`)
  return value
}

export interface CmlScript {
  state: Record<string, Scalar>
  interactions: Array<SceneInteraction & { sceneId?: string }>
}

function scalar(value: JsonValue | undefined, label: string): Scalar {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("CoenxScript: " + label + " must be finite")
    return value
  }
  throw new Error("CoenxScript: " + label + " must be a scalar")
}

function expression(value: JsonValue, depth = 0): Expression {
  if (depth > 16) throw new Error("CoenxScript: expression exceeds 16 levels")
  const item = object(value, "expression")
  const op = string(item.op, "expression.op")
  if (op === "literal") return { op, value: scalar(item.value, "expression.value") }
  if (op === "state") return { op, key: string(item.key, "expression.key") }
  if (op === "event") {
    const key = string(item.key, "expression.key")
    if (key !== "value" && key !== "key" && key !== "targetId")
      throw new Error("CoenxScript: unsupported event expression key")
    return { op, key }
  }
  if (op === "not") return { op, value: expression(item.value, depth + 1) }
  if (op === "and" || op === "or") {
    const items = list(item.items, "expression.items")
    if (!items.length || items.length > 24) throw new Error("CoenxScript: logical expression must have 1–24 operands")
    return { op, items: items.map((child) => expression(child, depth + 1)) }
  }
  if (op === "contains") {
    return { op, value: expression(item.value, depth + 1), search: expression(item.search, depth + 1) }
  }
  if (["eq", "neq", "gt", "gte", "lt", "lte"].includes(op)) {
    return {
      op: op as "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
      left: expression(item.left, depth + 1),
      right: expression(item.right, depth + 1),
    }
  }
  throw new Error("CoenxScript: unsupported expression operator " + op)
}

function action(value: JsonValue, index: number): InteractionAction {
  const item = object(value, "actions[" + index + "]")
  const type = string(item.type, "actions[" + index + "].type")
  if (type === "set") {
    const next = item.value
    const parsed =
      next && typeof next === "object" && !Array.isArray(next) ? expression(next) : scalar(next, "set.value")
    return { type, key: string(item.key, "set.key"), value: parsed }
  }
  if (type === "increment") {
    if (typeof item.amount !== "number" || !Number.isFinite(item.amount)) {
      throw new Error("CoenxScript: increment.amount must be finite")
    }
    return { type, key: string(item.key, "increment.key"), amount: item.amount }
  }
  if (type === "goto") return { type, sceneId: string(item.sceneId, "goto.sceneId") }
  if (type === "show" || type === "hide") return { type, targetId: string(item.targetId, type + ".targetId") }
  if (type === "feedback") {
    const tone = item.tone
    if (tone !== undefined && tone !== "neutral" && tone !== "success" && tone !== "error") {
      throw new Error("CoenxScript: invalid feedback tone")
    }
    return { type, text: string(item.text, "feedback.text"), ...(tone ? { tone } : {}) }
  }
  if (type === "playAudio") return { type, trackId: string(item.trackId, "playAudio.trackId") }
  if (type === "emit") {
    const payload = item.payload
    return {
      type,
      event: string(item.event, "emit.event"),
      ...(payload === undefined ? {} : { payload: scalar(payload, "emit.payload") }),
    }
  }
  throw new Error("CoenxScript: unsupported action type " + type)
}

export function parseCoenxScript(source: string): CmlScript {
  if (source.length > 512_000) throw new Error("CoenxScript exceeds the 512 KB limit")
  const trimmed = source
    .trim()
    .replace(/^export\s+default\s+/, "")
    .replace(/^module\.exports\s*=\s*/, "")
    .replace(/;\s*$/, "")
  const parsed = object(new ScriptLiteralParser(trimmed).parse(), "default export")
  const stateObject = object(parsed.state ?? {}, "state")
  const state: Record<string, Scalar> = {}
  for (const [key, value] of Object.entries(stateObject)) state[key] = scalar(value, "state." + key)
  if (Object.keys(state).length > 128) throw new Error("CoenxScript: state has more than 128 values")

  const events = list(parsed.events ?? [], "events")
  if (events.length > 500) throw new Error("CoenxScript: too many events")
  const interactions = events.map((raw, index) => {
    const event = object(raw, "events[" + index + "]")
    const on = string(event.on, "events[" + index + "].on")
    const target = typeof event.target === "string" ? event.target.replace(/^#/, "") : ""
    let trigger: SceneInteraction["trigger"]
    if (on === "key") trigger = { type: "key", key: string(event.key, "event.key") }
    else if (on === "timer") {
      if (typeof event.frame !== "number" || !Number.isInteger(event.frame) || event.frame < 0) {
        throw new Error("CoenxScript: timer.frame must be a non-negative integer")
      }
      trigger = { type: "timer", frame: event.frame }
    } else if (on === "click" || on === "submit" || on === "change") {
      trigger = { type: on, targetId: target || string(event.target, "event.target") }
    } else {
      throw new Error("CoenxScript: unsupported event type " + on)
    }

    const rawActions = list(event.actions, "event.actions")
    if (!rawActions.length || rawActions.length > 24) throw new Error("CoenxScript: event must have 1–24 actions")
    const actions = rawActions.map((item, actionIndex) => action(item, actionIndex))
    return {
      id: typeof event.id === "string" ? event.id : "event-" + (index + 1),
      ...(typeof event.scene === "string" ? { sceneId: event.scene.replace(/^#/, "") } : {}),
      trigger,
      ...(event.when ? { when: expression(event.when) } : {}),
      actions,
    }
  })
  return { state, interactions }
}
