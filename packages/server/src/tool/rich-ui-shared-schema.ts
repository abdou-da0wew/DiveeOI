import type { JSONSchema7 } from "@ai-sdk/provider"

export const expression: JSONSchema7 = { $ref: "#/definitions/Expression" }
export const stringField: JSONSchema7 = { type: "string" }
export const numberField: JSONSchema7 = { type: "number" }
export const idField: JSONSchema7 = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$" }

export const richUIExpressionDefinition: JSONSchema7 = {
  anyOf: [
    {
      type: "object",
      properties: { op: { const: "literal" }, value: numberField },
      required: ["op", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { op: { const: "input" }, name: idField },
      required: ["op", "name"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { op: { enum: ["neg", "abs", "sqrt"] }, value: expression },
      required: ["op", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        op: { enum: ["add", "sub", "mul", "div", "pow", "min", "max"] },
        left: expression,
        right: expression,
      },
      required: ["op", "left", "right"],
      additionalProperties: false,
    },
  ],
}
