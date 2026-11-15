import type { NumericExpression } from "@diveeoi/db/chat-ui"

export type RichUINumericValues = Record<string, number | boolean | string>

export function evaluateNumericExpression(
  expression: NumericExpression,
  values: RichUINumericValues,
  depth = 0,
): number {
  if (depth > 8) return 0
  if (expression.op === "literal") return expression.value
  if (expression.op === "input") {
    const value = values[expression.name]
    return typeof value === "number" ? value : typeof value === "boolean" ? Number(value) : Number(value) || 0
  }
  if (expression.op === "neg") return -evaluateNumericExpression(expression.value, values, depth + 1)
  if (expression.op === "abs") return Math.abs(evaluateNumericExpression(expression.value, values, depth + 1))
  if (expression.op === "sqrt")
    return Math.sqrt(Math.max(0, evaluateNumericExpression(expression.value, values, depth + 1)))
  if (!("left" in expression) || !("right" in expression)) return 0

  const left = evaluateNumericExpression(expression.left, values, depth + 1)
  const right = evaluateNumericExpression(expression.right, values, depth + 1)
  switch (expression.op) {
    case "add":
      return left + right
    case "sub":
      return left - right
    case "mul":
      return left * right
    case "div":
      return right === 0 ? 0 : left / right
    case "pow":
      return Math.pow(left, Math.max(-12, Math.min(12, right)))
    case "min":
      return Math.min(left, right)
    case "max":
      return Math.max(left, right)
  }
}

export function formatRichUINumber(value: number, precision: number) {
  if (!Number.isFinite(value)) return "0"
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: precision, minimumFractionDigits: 0 }).format(value)
}
