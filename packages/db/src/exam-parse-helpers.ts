import type { ParseResult } from "./chat-ui"

export type RecordValue = Record<string, unknown>
export type Parsed<T> = ParseResult<T>

export const object = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : undefined

export const string = (value: unknown, field: string, max = 600): Parsed<string> => {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    return { ok: false, error: `${field} must be a non-empty string of at most ${max} characters` }
  }
  return { ok: true, value: value.trim() }
}

export const finite = (value: unknown, field: string, min = -1e9, max = 1e9): Parsed<number> => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return { ok: false, error: `${field} must be a finite number between ${min} and ${max}` }
  }
  return { ok: true, value }
}

export const optionalString = (value: unknown, field: string, max = 240) => {
  if (value === undefined || value === null || value === "") return { ok: true as const, value: undefined }
  return string(value, field, max)
}

export const identifier = (value: unknown, field: string): Parsed<string> => {
  const result = string(value, field, 48)
  if (!result.ok) return result
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(result.value)
    ? result
    : { ok: false, error: `${field} must start with a letter and contain only letters, numbers, _ or -` }
}
