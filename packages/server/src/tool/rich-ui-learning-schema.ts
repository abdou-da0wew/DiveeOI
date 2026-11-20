import type { JSONSchema7Definition } from "@ai-sdk/provider"

const text = (maxLength: number): JSONSchema7Definition => ({ type: "string", minLength: 1, maxLength })
const id = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$", maxLength: 48 } as const
const object = (properties: Record<string, JSONSchema7Definition>, required: string[]): JSONSchema7Definition => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const dividerSchema = object(
  {
    type: { const: "divider" },
    label: text(80),
    style: { enum: ["solid", "dashed"] },
  },
  ["type"],
)

export const quizRichUIComponentSchema: JSONSchema7Definition = object(
  {
    type: { const: "quiz" },
    title: text(120),
    description: text(400),
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: object(
        {
          id,
          prompt: text(420),
          selection: { enum: ["single", "multiple"] },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: object({ id, label: text(180) }, ["id", "label"]),
          },
          correctOptionIds: { type: "array", minItems: 1, maxItems: 6, items: id },
          explanation: text(600),
        },
        ["id", "prompt", "options", "correctOptionIds"],
      ),
    },
  },
  ["type", "title", "questions"],
)

const diagramSchema = object(
  {
    type: { const: "diagram" },
    title: text(120),
    description: text(400),
    direction: { enum: ["left-right", "top-down"] },
    nodes: {
      type: "array",
      minItems: 2,
      maxItems: 12,
      items: object(
        {
          id,
          label: text(72),
          detail: text(360),
          kind: { enum: ["start", "process", "decision", "output"] },
        },
        ["id", "label"],
      ),
    },
    edges: {
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: object(
        { from: id, to: id, label: text(48) },
        ["from", "to"],
      ),
    },
  },
  ["type", "title", "nodes", "edges"],
)

export const learningRichUIComponentSchemas: JSONSchema7Definition[] = [dividerSchema, diagramSchema]
