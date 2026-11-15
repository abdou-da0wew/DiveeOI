import type { JSONSchema7Definition } from "@ai-sdk/provider"

const string = (maxLength: number): JSONSchema7Definition => ({ type: "string", minLength: 1, maxLength })
const number = (minimum: number, maximum: number): JSONSchema7Definition => ({ type: "number", minimum, maximum })
const identifier: JSONSchema7Definition = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]*$", maxLength: 48 }
const object = (properties: Record<string, JSONSchema7Definition>, required: string[]): JSONSchema7Definition => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

export const advancedRichUIComponentSchemas: JSONSchema7Definition[] = [
  object(
    {
      type: { const: "workflow" },
      title: string(120),
      nodes: {
        type: "array",
        minItems: 2,
        maxItems: 12,
        items: object(
          { id: identifier, label: string(80), kind: { enum: ["trigger", "process", "condition", "output"] } },
          ["id", "label", "kind"],
        ),
      },
    },
    ["type", "title", "nodes"],
  ),
  object(
    {
      type: { const: "desktop" },
      title: string(120),
      apps: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: object({ id: identifier, name: string(48), icon: string(32), content: string(800) }, [
          "id",
          "name",
          "icon",
          "content",
        ]),
      },
    },
    ["type", "title", "apps"],
  ),
  object(
    {
      type: { const: "database" },
      title: string(120),
      columns: { type: "array", minItems: 1, maxItems: 8, items: string(48) },
      rows: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        items: { type: "array", items: { type: ["string", "number"] } },
      },
    },
    ["type", "title", "columns", "rows"],
  ),
  object(
    {
      type: { const: "api" },
      title: string(120),
      methods: { type: "array", minItems: 1, maxItems: 5, items: { enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] } },
      endpoint: string(300),
      sampleStatus: { type: "integer", minimum: 100, maximum: 599 },
      sampleResponse: string(1600),
    },
    ["type", "title", "methods", "endpoint", "sampleStatus", "sampleResponse"],
  ),
  object(
    {
      type: { const: "scene" },
      title: string(120),
      shape: { enum: ["cube", "sphere", "pyramid"] },
      rotation: number(0, 360),
      description: string(300),
    },
    ["type", "title", "shape", "rotation"],
  ),
  object(
    {
      type: { const: "wizard" },
      title: string(120),
      steps: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: object(
          { title: string(100), description: string(300), fieldLabel: string(80), placeholder: string(100) },
          ["title", "description", "fieldLabel"],
        ),
      },
    },
    ["type", "title", "steps"],
  ),
  object(
    {
      type: { const: "monitor" },
      title: string(120),
      metrics: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: object({ label: string(80), value: number(-1e9, 1e9), unit: string(16) }, ["label", "value"]),
      },
    },
    ["type", "title", "metrics"],
  ),
  object(
    {
      type: { const: "circuit" },
      title: string(120),
      voltage: number(0, 1000),
      resistance: number(0.1, 1e6),
    },
    ["type", "title", "voltage", "resistance"],
  ),
  object(
    {
      type: { const: "map" },
      title: string(120),
      center: object({ latitude: number(-90, 90), longitude: number(-180, 180) }, ["latitude", "longitude"]),
      zoom: { type: "integer", minimum: 1, maximum: 18 },
      markers: {
        type: "array",
        minItems: 1,
        maxItems: 24,
        items: object(
          {
            id: identifier,
            label: string(80),
            latitude: number(-90, 90),
            longitude: number(-180, 180),
            description: string(240),
          },
          ["id", "label", "latitude", "longitude"],
        ),
      },
    },
    ["type", "title", "center", "zoom", "markers"],
  ),
  object(
    {
      type: { const: "data-grid" },
      id: identifier,
      title: string(120),
      key: identifier,
      editable: { type: "boolean" },
      maxRows: { type: "integer", minimum: 1, maximum: 50 },
      columns: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: object({ id: identifier, label: string(64), type: { enum: ["text", "number"] } }, [
          "id",
          "label",
          "type",
        ]),
      },
      rows: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: { type: "array", minItems: 1, maxItems: 8, items: { type: ["string", "number"] } },
      },
    },
    ["type", "id", "title", "key", "columns", "rows"],
  ),
  object(
    {
      type: { const: "media" },
      title: string(120),
      items: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: object(
          {
            type: { enum: ["image", "video", "audio"] },
            url: { type: "string", format: "uri", maxLength: 1200 },
            alt: string(180),
            caption: string(240),
          },
          ["type", "url"],
        ),
      },
    },
    ["type", "title", "items"],
  ),
]
