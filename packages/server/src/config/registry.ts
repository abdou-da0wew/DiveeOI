import { Schema as EffectSchema } from "effect"

export * as ConfigRegistry from "./registry"

const configSchemas = new Map<string, EffectSchema.Schema.All>()

export function register(key: string, schema: EffectSchema.Schema.All): void {
  configSchemas.set(key, schema)
}

export function get(key: string): EffectSchema.Schema.All | undefined {
  return configSchemas.get(key)
}

export function entries(): Iterable<[string, EffectSchema.Schema.All]> {
  return configSchemas.entries()
}

export function has(key: string): boolean {
  return configSchemas.has(key)
}
