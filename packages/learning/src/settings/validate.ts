// packages/learning/src/settings/validate.ts
//
// Server-side range/enum/type validation of a settings payload, driven by the same JSON schema the
// UI form is generated from (x-min / x-max / enum). The client also checks, but the API must not
// trust it: a gate threshold of 9 would silently refuse every question.

import { TargetedLearningSchema } from "./index"
import { toJSONSchema } from "./json-schema"

type Json = Record<string, any>

let cached: Json | null = null
const schema = (): Json => (cached ??= toJSONSchema(TargetedLearningSchema as never) as Json)

/** Returns a list of human-readable problems; empty = valid. Unknown keys are ignored (the schema decoder owns those). */
export const validateSettingsPayload = (payload: unknown): string[] => {
  const problems: string[] = []
  const props: Json = schema().properties ?? {}
  const checkLeaf = (path: string, def: Json, value: unknown) => {
    if (value === undefined) return
    if (Array.isArray(def.enum) && !def.enum.includes(value)) problems.push(`${path}: must be one of ${def.enum.join(", ")}`)
    else if (def.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) problems.push(`${path}: must be a number`)
      else {
        if (def["x-min"] !== undefined && value < def["x-min"]) problems.push(`${path}: must be at least ${def["x-min"]}`)
        if (def["x-max"] !== undefined && value > def["x-max"]) problems.push(`${path}: must be at most ${def["x-max"]}`)
      }
    } else if (def.type === "boolean" && typeof value !== "boolean") problems.push(`${path}: must be true or false`)
    else if (def.type === "string" && typeof value !== "string") problems.push(`${path}: must be text`)
  }
  for (const [key, value] of Object.entries((payload ?? {}) as Json)) {
    const def: Json | undefined = props[key]
    if (!def) continue
    if (def.type === "object" && def.properties && value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Json)) if (def.properties[k]) checkLeaf(`${key}.${k}`, def.properties[k], v)
    } else checkLeaf(key, def, value)
  }
  return problems
}
