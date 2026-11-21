import type { Expression, Scalar } from "../model/types"

export interface ExpressionContext {
  state: Record<string, Scalar>
  event?: { value?: Scalar; key?: string; targetId?: string }
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
      return !evaluateExpression(expression.value, context)
    case "and":
      return expression.items.every((item) => Boolean(evaluateExpression(item, context)))
    case "or":
      return expression.items.some((item) => Boolean(evaluateExpression(item, context)))
    case "contains": {
      const value = evaluateExpression(expression.value, context)
      const search = evaluateExpression(expression.search, context)
      if (typeof value === "string" && typeof search === "string") return value.includes(search)
      if (Array.isArray(value)) return value.includes(search)
      return false
    }
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
      }
    }
  }
}
