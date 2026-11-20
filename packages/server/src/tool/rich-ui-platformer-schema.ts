import type { JSONSchema7Definition } from "@ai-sdk/provider"

const number = (minimum: number, maximum: number): JSONSchema7Definition => ({
  type: "number",
  minimum,
  maximum,
})
const id = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$", maxLength: 48 } as const
const text = (maxLength: number): JSONSchema7Definition => ({ type: "string", minLength: 1, maxLength })
const object = (properties: Record<string, JSONSchema7Definition>, required: string[]): JSONSchema7Definition => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const rectangle = object(
  {
    id,
    x: number(0, 1400),
    y: number(0, 900),
    width: number(1, 1400),
    height: number(1, 900),
  },
  ["id", "x", "y", "width", "height"],
)
const point = object(
  {
    id,
    x: number(0, 1400),
    y: number(0, 900),
  },
  ["id", "x", "y"],
)

export const platformerRichUIComponentSchema: JSONSchema7Definition = object(
  {
    type: { const: "platformer" },
    title: text(120),
    description: text(400),
    theme: { enum: ["neon", "sky", "forest"] },
    width: number(320, 1400),
    height: number(240, 900),
    player: object(
      {
        x: number(0, 1400),
        y: number(0, 900),
        width: number(12, 64),
        height: number(16, 80),
      },
      ["x", "y", "width", "height"],
    ),
    platforms: { type: "array", minItems: 1, maxItems: 20, items: rectangle },
    hazards: { type: "array", maxItems: 12, items: rectangle },
    collectibles: { type: "array", maxItems: 20, items: point },
    checkpoints: { type: "array", maxItems: 5, items: point },
    goal: object(
      {
        x: number(0, 1400),
        y: number(0, 900),
        width: number(8, 1400),
        height: number(8, 900),
      },
      ["x", "y", "width", "height"],
    ),
    physics: object(
      {
        moveSpeed: number(1, 12),
        gravity: number(0.1, 2.5),
        jumpVelocity: number(5, 24),
        maxLives: { type: "integer", minimum: 1, maximum: 9 },
        doubleJump: { type: "boolean" },
        dash: { type: "boolean" },
      },
      [],
    ),
  },
  ["type", "title", "width", "height", "player", "platforms", "goal"],
)
