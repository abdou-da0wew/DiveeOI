import type { JSONSchema7 } from "@ai-sdk/provider"
import { richUIComponentDefinition } from "./rich-ui-component-schema"
import { idField, richUIExpressionDefinition } from "./rich-ui-shared-schema"

export const richUIComponentsSchema: JSONSchema7 = {
  type: "array",
  minItems: 1,
  maxItems: 24,
  items: { $ref: "#/definitions/ChatUIComponent" },
}

export const richUIParameters: JSONSchema7 = {
  type: "object",
  properties: {
    spec: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 120 },
        description: { type: "string", maxLength: 400 },
        layout: { enum: ["stack", "grid"] },
        persistState: { type: "boolean" },
        state: {
          type: "array",
          maxItems: 24,
          items: {
            type: "object",
            properties: { key: idField, value: { type: ["string", "number", "boolean"] } },
            required: ["key", "value"],
            additionalProperties: false,
          },
        },
        components: richUIComponentsSchema,
      },
      required: ["title", "components"],
      additionalProperties: false,
    },
  },
  required: ["spec"],
  additionalProperties: false,
  definitions: {
    Expression: richUIExpressionDefinition,
    ChatUIComponent: richUIComponentDefinition,
  },
}
