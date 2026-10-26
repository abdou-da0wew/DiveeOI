// packages/learning/test/json-schema.test.ts
//
// Tests for the AST → JSON Schema converter (added after live smoke testing
// found that Effect v4-beta's toStandardJSONSchemaV1 doesn't expose a plain
// toJsonSchema()).

import { expect, test, describe } from "bun:test"
import { Schema } from "effect"
import { toJSONSchema, TL_ANNOTATION_PREFIX } from "../src/settings/json-schema"
import { Info } from "../src/settings/schema"

describe("settings JSON Schema converter", () => {
  test("converts the full settings schema without throwing", () => {
    const out = toJSONSchema(Info)
    expect(out.type).toBe("object")
    expect((out.properties as Record<string, unknown>).enabled).toBeDefined()
    expect((out.properties as Record<string, unknown>).embedding).toBeDefined()
  })

  test("copies @diveeoi/learning annotations through as x-* keys", () => {
    const out = toJSONSchema(Info) as { properties: Record<string, Record<string, unknown>> }
    const enabled = out.properties.enabled!
    expect(enabled["x-label"]).toBeDefined()
    expect(enabled["x-group"]).toBe("setup")
    expect(enabled["x-applies"]).toBe("live")
  })

  test("literal unions become string enums", () => {
    const out = toJSONSchema(Info) as { properties: Record<string, any> }
    const dtype = out.properties.embedding.properties.dtype
    expect(dtype.type).toBe("string")
    expect(dtype.enum).toEqual(["int8", "q4f16", "fp16", "fp32"])
    expect(dtype["x-danger"]).toBe(true) // dtype is a danger field
  })

  test("optional fields are not required", () => {
    const out = toJSONSchema(Info) as { required?: string[] }
    // Every field in Info is optional
    expect(out.required).toBeUndefined()
  })

  test("nested structs recurse", () => {
    const out = toJSONSchema(Info) as { properties: Record<string, any> }
    const emb = out.properties.embedding
    expect(emb.type).toBe("object")
    expect(Object.keys(emb.properties)).toContain("dtype")
    expect(Object.keys(emb.properties)).toContain("maxLength")
  })

  test("record fields get additionalProperties", () => {
    const out = toJSONSchema(Info) as { properties: Record<string, any> }
    const gate = out.properties.gate
    const refusal = gate.properties.refusalMessages
    expect(refusal.type).toBe("object")
    expect(refusal.additionalProperties).toBeDefined()
  })

  test("handles primitive schemas", () => {
    expect(toJSONSchema(Schema.String)).toEqual({ type: "string" })
    expect(toJSONSchema(Schema.Number)).toEqual({ type: "number" })
    expect(toJSONSchema(Schema.Boolean)).toEqual({ type: "boolean" })
  })

  test("handles literal schemas", () => {
    const out = toJSONSchema(Schema.Literals(["a", "b"]))
    expect(out).toEqual({ type: "string", enum: ["a", "b"] })
  })

  test("degrades unknown AST tags gracefully (never throws)", () => {
    // A declaration (declaration constructor) is not in our converter's
    // supported set — it must not throw.
    const weird = Schema.Any.annotate({ identifier: "weird" })
    const out = toJSONSchema(weird)
    expect(out).toBeDefined()
  })

  test("annotation prefix constant", () => {
    expect(TL_ANNOTATION_PREFIX).toBe("@diveeoi/learning/")
  })
})
