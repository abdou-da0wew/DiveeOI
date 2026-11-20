import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider"
import { advancedRichUIComponentSchemas } from "./rich-ui-advanced-schema"
import { compositionRichUIComponentSchemas } from "./rich-ui-composition-schema"
import { learningRichUIComponentSchemas, quizRichUIComponentSchema } from "./rich-ui-learning-schema"
import { platformerRichUIComponentSchema } from "./rich-ui-platformer-schema"
import { expression, idField, numberField, stringField } from "./rich-ui-shared-schema"

const componentVariants: JSONSchema7Definition[] = [
  ...advancedRichUIComponentSchemas,
  ...learningRichUIComponentSchemas,
  platformerRichUIComponentSchema,
  {
    type: "object",
    properties: { type: { const: "heading" }, text: stringField, level: { enum: [2, 3] } },
    required: ["type", "text"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: { type: { const: "text" }, content: stringField },
    required: ["type", "content"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      type: { const: "metric" },
      label: stringField,
      value: { type: ["string", "number"] },
      unit: stringField,
      tone: { enum: ["default", "positive", "warning"] },
    },
    required: ["type", "label", "value"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      type: { const: "callout" },
      title: stringField,
      content: stringField,
      tone: { enum: ["info", "success", "warning"] },
    },
    required: ["type", "title", "content", "tone"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      type: { const: "progress" },
      label: stringField,
      value: numberField,
      max: numberField,
      unit: stringField,
    },
    required: ["type", "label", "value", "max"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      type: { const: "chart" },
      title: stringField,
      kind: { enum: ["bar", "line"] },
      points: {
        type: "array",
        minItems: 2,
        maxItems: 32,
        items: {
          type: "object",
          properties: { label: stringField, value: numberField, key: idField },
          required: ["label"],
          anyOf: [{ required: ["value"] }, { required: ["key"] }],
          additionalProperties: false,
        },
      },
    },
    required: ["type", "title", "kind", "points"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      type: { const: "table" },
      title: stringField,
      columns: { type: "array", minItems: 1, maxItems: 8, items: stringField },
      rows: { type: "array", maxItems: 32, items: { type: "array", items: { type: ["string", "number"] } } },
    },
    required: ["type", "columns", "rows"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      type: { const: "simulation" },
      title: stringField,
      description: stringField,
      controls: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          anyOf: [
            {
              type: "object",
              properties: {
                type: { const: "slider" },
                id: idField,
                label: stringField,
                min: numberField,
                max: numberField,
                step: numberField,
                value: numberField,
                unit: stringField,
              },
              required: ["type", "id", "label", "min", "max", "step", "value"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "toggle" },
                id: idField,
                label: stringField,
                value: { type: "boolean" },
              },
              required: ["type", "id", "label", "value"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "select" },
                id: idField,
                label: stringField,
                value: stringField,
                options: {
                  type: "array",
                  minItems: 2,
                  maxItems: 8,
                  items: {
                    type: "object",
                    properties: { label: stringField, value: stringField },
                    required: ["label", "value"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["type", "id", "label", "value", "options"],
              additionalProperties: false,
            },
          ],
        },
      },
      outputs: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            label: stringField,
            expression,
            unit: stringField,
            precision: { type: "integer", minimum: 0, maximum: 6 },
          },
          required: ["label", "expression"],
          additionalProperties: false,
        },
      },
    },
    required: ["type", "title", "controls", "outputs"],
    additionalProperties: false,
  },
  ...compositionRichUIComponentSchemas,
]

export const richUIComponentDefinition: JSONSchema7 = { anyOf: [...componentVariants, quizRichUIComponentSchema] }

// Graded exams reuse the same component renderer, but must never embed a
// self-grading quiz whose correctOptionIds would be visible to the client.
export const richUIExamComponentDefinition: JSONSchema7 = { anyOf: componentVariants }
