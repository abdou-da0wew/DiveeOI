import type { Expression, Scalar } from "../model/types"

export interface ExpressionContext {
  state: Record<string, Scalar>
  event?: { value?: Scalar; key?: string; targetId?: string; x?: number; y?: number }
}

function truthy(value: Scalar | undefined) {
  return value !== undefined && value !== null && value !== false && value !== 0 && value !== ""
}

function numeric(value: Scalar | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function evaluateExpression(expression: Expression, context: ExpressionContext): Scalar | undefined {
  switch (expression.op) {
    case "literal":
      return expression.value
    case "state":
      return context.state[expression.key]
    case "event":
      return context.event?.[expression.key]
    case "not":
      return !truthy(evaluateExpression(expression.value, context))
    case "and":
      return expression.items.every((item) => truthy(evaluateExpression(item, context)))
    case "or":
      return expression.items.some((item) => truthy(evaluateExpression(item, context)))
    case "contains": {
      const value = evaluateExpression(expression.value, context)
      const search = evaluateExpression(expression.search, context)
      if (typeof value === "string" && typeof search === "string") return value.includes(search)
      if (Array.isArray(value)) return value.includes(search)
      return false
    }
    case "min":
    case "max": {
      const values = expression.items.map((item) => numeric(evaluateExpression(item, context)))
      if (values.length === 0) return undefined
      return expression.op === "min" ? Math.min(...values) : Math.max(...values)
    }
    case "concat":
      return expression.items
        .map((item) => evaluateExpression(item, context))
        .map((value) => (value === undefined || value === null ? "" : String(value)))
        .join("")
    case "abs":
      return Math.abs(numeric(evaluateExpression(expression.value, context)))
    case "round":
      return Math.round(numeric(evaluateExpression(expression.value, context)))
    case "floor":
      return Math.floor(numeric(evaluateExpression(expression.value, context)))
    case "ceil":
      return Math.ceil(numeric(evaluateExpression(expression.value, context)))
    case "clamp": {
      const value = numeric(evaluateExpression(expression.value, context))
      const min = numeric(evaluateExpression(expression.min, context))
      const max = numeric(evaluateExpression(expression.max, context))
      return Math.min(Math.max(value, min), max)
    }
    case "random": {
      const min = numeric(evaluateExpression(expression.min, context))
      const max = numeric(evaluateExpression(expression.max, context))
      return min + Math.random() * (max - min)
    }
    case "if":
      return truthy(evaluateExpression(expression.cond, context))
        ? evaluateExpression(expression.trueValue, context)
        : evaluateExpression(expression.falseValue, context)
    default: {
      const left = evaluateExpression(expression.left, context)
      const right = evaluateExpression(expression.right, context)
      switch (expression.op) {
        case "eq":
          return left === right
        case "neq":
          return left !== right
        case "gt":
          return Number(left) > Number(right)
        case "gte":
          return Number(left) >= Number(right)
        case "lt":
          return Number(left) < Number(right)
        case "lte":
          return Number(left) <= Number(right)
        case "add":
          return numeric(left) + numeric(right)
        case "sub":
          return numeric(left) - numeric(right)
        case "mul":
          return numeric(left) * numeric(right)
        case "div":
          return numeric(right) === 0 ? 0 : numeric(left) / numeric(right)
        case "mod":
          return numeric(right) === 0 ? 0 : numeric(left) % numeric(right)
      }
    }
  }
}
