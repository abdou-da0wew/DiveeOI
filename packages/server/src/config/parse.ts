export * as ConfigParse from "./parse"

import { type ParseError as JsoncParseError, parse as parseJsoncImpl, printParseErrorCode } from "jsonc-parser"
import { Cause, Exit, Schema as EffectSchema, SchemaIssue } from "effect"
import type { DeepMutable } from "@diveeoi/db/schema"
import { InvalidError, JsonError } from "@diveeoi/db/v1/config/error"
import { ConfigRegistry } from "./registry"

export interface JsoncResult {
  data: unknown
  errors: JsoncParseError[]
  rawText: string
  filepath: string
}

export function jsonc(text: string, filepath: string): JsoncResult {
  const errors: JsoncParseError[] = []
  const data = parseJsoncImpl(text, errors, { allowTrailingComma: true })
  return { data, errors, rawText: text, filepath }
}

export function jsoncStrict(text: string, filepath: string): unknown {
  const { data, errors, rawText, filepath: fp } = jsonc(text, filepath)
  if (errors.length) {
    throwBuildError(errors, rawText, fp)
  }
  return data
}

export function schemaLenient<S extends EffectSchema.Decoder<unknown, never>>(
  schema: S,
  data: unknown,
  source: string,
): DeepMutable<S["Type"]> {
  const opts = { errors: "all", onExcessProperty: "ignore" as const, propertyOrder: "original" as const }
  const decoded = EffectSchema.decodeUnknownExit(schema)(data ?? {}, opts as any)
  if (Exit.isSuccess(decoded)) return decoded.value as DeepMutable<S["Type"]>
  return {} as DeepMutable<S["Type"]>
}

export function validateExtensions(data: unknown, source: string): string[] {
  const warnings: string[] = []
  if (!data || typeof data !== "object") return warnings
  const obj = data as Record<string, unknown>
  for (const [key, schema] of ConfigRegistry.entries()) {
    if (key in obj) {
      const decoded = EffectSchema.decodeUnknownExit(schema)(obj[key], { errors: "all" })
      if (Exit.isFailure(decoded)) {
        const error = Cause.squash(decoded.cause)
        warnings.push(`[${source}] config extension "${key}" validation error: ${String(error)}`)
      }
    }
  }
  return warnings
}

export function schema<S extends EffectSchema.Decoder<unknown, never>>(
  schema: S,
  data: unknown,
  source: string,
): DeepMutable<S["Type"]> {
  const extra = topLevelExtraKeys(schema, data)
  if (extra.length) {
    throw new InvalidError({
      path: source,
      issues: [
        {
          code: "unrecognized_keys",
          keys: extra,
          path: [],
          message: `Unrecognized key${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}`,
        },
      ],
    })
  }

  const decoded = EffectSchema.decodeUnknownExit(schema)(data, { errors: "all", propertyOrder: "original" })
  if (Exit.isSuccess(decoded)) return decoded.value as DeepMutable<S["Type"]>
  const error = Cause.squash(decoded.cause)

  throw new InvalidError(
    {
      path: source,
      issues: EffectSchema.isSchemaError(error)
        ? SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map((issue) => ({
            ...issue,
            message: issue.message,
            path: issue.path?.map(String) ?? [],
          }))
        : [{ message: String(error), path: [] }],
    },
    { cause: error },
  )
}

export function formatParseErrors(result: JsoncResult): string {
  const { errors, rawText, filepath } = result
  if (!errors.length) return ""
  const lines = rawText.split("\n")
  return errors
    .map((e) => {
      const beforeOffset = rawText.substring(0, e.offset).split("\n")
      const line = beforeOffset.length
      const column = beforeOffset[beforeOffset.length - 1].length + 1
      const problemLine = lines[line - 1]
      const err = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
      if (!problemLine) return `  [${filepath}] ${err}`
      return `  [${filepath}] ${err}\n    Line ${line}: ${problemLine}`
    })
    .join("\n")
}

function throwBuildError(errors: JsoncParseError[], text: string, filepath: string): never {
  const lines = text.split("\n")
  const issues = errors
    .map((e) => {
      const beforeOffset = text.substring(0, e.offset).split("\n")
      const line = beforeOffset.length
      const column = beforeOffset[beforeOffset.length - 1].length + 1
      const problemLine = lines[line - 1]
      const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
      if (!problemLine) return error
      return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
    })
    .join("\n")
  throw new JsonError({
    path: filepath,
    message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${issues}\n--- End ---`,
  })
}

function topLevelExtraKeys(schema: EffectSchema.Top, data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return []
  if (schema.ast._tag !== "Objects" || schema.ast.indexSignatures.length > 0) return []
  const known = new Set(schema.ast.propertySignatures.map((item) => String(item.name)))
  return Object.keys(data).filter((key) => !known.has(key))
}
