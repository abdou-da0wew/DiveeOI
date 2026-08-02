import { Schema as EffectSchema } from "effect"

export * as ConfigRegistry from "./registry"

const configSchemas = new Map<string, EffectSchema.Any>()

export function register(key: string, schema: EffectSchema.Any): void {
  configSchemas.set(key, schema)
}

export function get(key: string): EffectSchema.Any | undefined {
  return configSchemas.get(key)
}

export function entries(): Iterable<[string, EffectSchema.Any]> {
  return configSchemas.entries()
}

export function has(key: string): boolean {
  return configSchemas.has(key)
}
