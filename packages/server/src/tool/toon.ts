import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider"

const INDENT = "  "

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSchemaObject(value: JSONSchema7Definition): value is JSONSchema7 {
  return isRecord(value)
}

function formatType(def: JSONSchema7): string {
  const { type, anyOf, oneOf, enum: enumValues, const: constVal } = def

  if (anyOf) {
    const withoutNull = anyOf.filter((item): item is JSONSchema7 =>
      isSchemaObject(item) && (
        (item.enum !== undefined && item.enum.length === 1 && item.enum[0] === null) === false
      ),
    )
    if (withoutNull.length === 1) {
      return `${formatType(withoutNull[0])}?`
    }
    return withoutNull.map((item: JSONSchema7) => formatType(item)).join(" | ")
  }

  if (oneOf) {
    return oneOf.filter((item): item is JSONSchema7 => isSchemaObject(item))
      .map((item: JSONSchema7) => formatType(item))
      .join(" | ")
  }

  if (enumValues) {
    return enumValues.map((v) => String(v)).join(" | ")
  }

  if (constVal !== undefined) {
    return String(constVal)
  }

  if (type === "array") {
    const items = def.items
    if (items) {
      if (Array.isArray(items)) {
        const itemTypes = items.filter((i): i is JSONSchema7 => isSchemaObject(i))
        return `(${itemTypes.map((i) => formatType(i)).join(", ")})[]`
      }
      if (isSchemaObject(items)) {
        return `${formatType(items)}[]`
      }
    }
    return "any[]"
  }

  if (type === "object") {
    return "object"
  }

  if (type === "string") return "string"
  if (type === "integer") return "integer"
  if (type === "number") return "number"
  if (type === "boolean") return "boolean"

  return "any"
}

function isNullable(def: JSONSchema7): boolean {
  if (!def.anyOf) return false
  return def.anyOf.some((item) => isSchemaObject(item) && item.enum?.[0] === null)
}

function indentLines(text: string, depth: number): string {
  const pad = INDENT.repeat(depth)
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n")
}

function formatDescription(desc: string | undefined, depth: number): string {
  if (!desc || desc.length === 0) return ""
  const trimmed = desc.trim()
  if (!trimmed.includes("\n") && trimmed.length <= 80) {
    return `  "${trimmed}"`
  }
  return `\n${indentLines(trimmed, depth + 1)}`
}

function schemaToTOON(
  def: JSONSchema7,
  depth: number,
  required: Set<string>,
): string {
  if (def.type === "object" && def.properties) {
    const entries = Object.entries(def.properties)
      .filter(([, prop]) => isSchemaObject(prop))

    const lines: string[] = []
    for (const [name, prop] of entries) {
      if (!isSchemaObject(prop)) continue

      const isReq = required.has(name)
      const type = formatType(prop)
      const desc = formatDescription(prop.description, depth)

      const optionalMarker = isReq ? "" : "?"
      const typePart = `${type}${optionalMarker}`
      lines.push(`${name}: ${typePart}${desc}`)
    }
    return lines.join("\n")
  }

  return def.description ?? ""
}

export function toonToolSchema(toolId: string, description: string, schema: JSONSchema7): string {
  const required = new Set<string>(
    Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : [],
  )

  const params = schemaToTOON(schema, 1, required)
  const lines: string[] = []

  lines.push(`Tool: ${toolId}`)
  if (description) {
    const short = description.trim().split("\n")[0] ?? ""
    lines.push(`${INDENT}Desc: ${short}`)
  }
  if (params) {
    lines.push(`${INDENT}Params:`)
    lines.push(indentLines(params, 2))
  }

  return lines.join("\n")
}

export function toonToolResult(title: string, output: string, attachmentsCount?: number): string {
  const lines: string[] = []
  if (title) lines.push(`Title: ${title}`)
  if (output) {
    lines.push(`Output:`)
    lines.push(indentLines(`| ${output.split("\n").join("\n" + "| ")}`, 1))
  }
  if (attachmentsCount && attachmentsCount > 0) {
    lines.push(`Attachments: (${attachmentsCount})`)
  }
  return lines.join("\n")
}

export function stripSchemaDescriptions(schema: JSONSchema7): JSONSchema7 {
  if (!schema.properties) return schema

  const stripped = { ...schema, properties: {} as Record<string, JSONSchema7Definition> }

  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!isSchemaObject(prop)) {
      stripped.properties[key] = prop
      continue
    }
    const { description, ...rest } = prop
    stripped.properties[key] = rest
  }

  return stripped
}

export * as TOON from "./toon"
