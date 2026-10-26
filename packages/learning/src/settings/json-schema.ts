// packages/learning/src/settings/json-schema.ts
//
// AST → JSON Schema converter for the Targeted Learning settings schema.
//
// Why hand-rolled: Effect v4-beta's `Schema.toStandardJSONSchemaV1` does not
// expose a plain `toJsonSchema()` in this version (verified in-session), and
// the settings UI form generator only needs a subset: Struct, Union (literals
// + optional-Undefined), primitives, arrays, and record-of-string. Walking
// the AST directly is ~120 lines, has zero deps, and lets us copy our custom
// `@diveeoi/learning/*` annotations through as `x-*` keys — which is the
// whole point (the UI reads them to render labels, groups, applies-modes,
// and danger confirmations).
//
// Never throws: unknown AST tags degrade to `{"type": "object"}` with a
// `x-unknown-tag` marker so the UI can skip them gracefully.

import { Schema } from "effect"

export const TL_ANNOTATION_PREFIX = "@diveeoi/learning/"

type Ast = {
  _tag: string
  annotations?: Record<string, unknown>
  propertySignatures?: { name: string | symbol; type: Ast }[]
  indexSignatures?: { type: Ast }[]
  types?: Ast[]
  literal?: unknown
}

const copyAnnotations = (ast: Ast, out: Record<string, unknown>): void => {
  const ann = ast.annotations ?? {}
  if (typeof ann["title"] === "string") out.title = ann["title"]
  if (typeof ann["description"] === "string") out.description = ann["description"]
  if (typeof ann["identifier"] === "string") out["$id"] = ann["identifier"]
  for (const [k, v] of Object.entries(ann)) {
    if (k.startsWith(TL_ANNOTATION_PREFIX)) {
      out[`x-${k.slice(TL_ANNOTATION_PREFIX.length)}`] = v
    }
  }
}

const convertUnion = (ast: Ast): Record<string, unknown> => {
  const members = ast.types ?? []
  // Optional field: Union of [T, Undefined] — unwrap to T.
  const nonUndefined = members.filter((m) => m._tag !== "Undefined")
  if (nonUndefined.length === 0) return { type: "object" }
  if (nonUndefined.length === 1) {
    const inner = convertNode(nonUndefined[0]!)
    copyAnnotations(ast, inner)
    return inner
  }
  // Literal union → enum. All literals in our schema are strings.
  const literals = nonUndefined.filter((m) => m._tag === "Literal")
  if (literals.length === nonUndefined.length) {
    const out: Record<string, unknown> = { type: "string", enum: literals.map((m) => m.literal) }
    copyAnnotations(ast, out)
    return out
  }
  // Mixed union → anyOf
  const out: Record<string, unknown> = { anyOf: nonUndefined.map(convertNode) }
  copyAnnotations(ast, out)
  return out
}

const convertNode = (ast: Ast): Record<string, unknown> => {
  switch (ast._tag) {
    case "Objects": {
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const prop of ast.propertySignatures ?? []) {
        const name = String(prop.name)
        properties[name] = convertNode(prop.type)
        // A field is required if its type is NOT a union containing Undefined
        // and has no explicit optional marker.
        const t = prop.type
        const isOptional =
          (t._tag === "Union" && (t.types ?? []).some((m) => m._tag === "Undefined")) ||
          (t.annotations as Record<string, unknown> | undefined)?.["schema/optional"] !== undefined
        if (!isOptional) required.push(name)
      }
      // Index signatures (Schema.Record) → additionalProperties
      let additionalProperties: unknown = undefined
      const indexSig = (ast.indexSignatures ?? [])[0]
      if (indexSig) {
        additionalProperties = convertNode(indexSig.type)
      }
      const out: Record<string, unknown> = { type: "object", properties }
      if (required.length > 0) out.required = required
      if (additionalProperties !== undefined) out.additionalProperties = additionalProperties
      copyAnnotations(ast, out)
      return out
    }
    case "Union":
      return convertUnion(ast)
    case "String":
      return withAnns({ type: "string" }, ast)
    case "Number":
      return withAnns({ type: "number" }, ast)
    case "Boolean":
      return withAnns({ type: "boolean" }, ast)
    case "Literal":
      return withAnns({ const: ast.literal, type: typeof ast.literal === "number" ? "number" : "string" }, ast)
    case "Arrays": {
      // Array element type is in ast.element? Check both common shapes.
      const element = (ast as unknown as { element?: Ast }).element
      const out: Record<string, unknown> = element
        ? { type: "array", items: convertNode(element) }
        : { type: "array" }
      copyAnnotations(ast, out)
      return out
    }
    case "Undefined":
      return { type: "null" }
    default:
      // Unknown/unsupported node — degrade gracefully.
      return { type: "object", "x-unknown-tag": ast._tag }
  }
}

const withAnns = (out: Record<string, unknown>, ast: Ast): Record<string, unknown> => {
  copyAnnotations(ast, out)
  return out
}

/**
 * Convert an Effect Schema (v4-beta) to a JSON-Schema-compatible descriptor.
 * Copies `@diveeoi/learning/*` annotations through as `x-*` keys.
 */
export const toJSONSchema = (schema: Schema.Top): Record<string, unknown> => {
  return convertNode(schema.ast as unknown as Ast)
}
