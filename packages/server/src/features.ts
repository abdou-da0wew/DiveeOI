import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parse as parseJsonc } from "jsonc-parser"

/**
 * Startup feature flags.
 *
 * Resolved exactly once, at module load — before any Effect layer is built.
 * Disabled features swap their real implementation for a stub layer at their
 * own `defaultLayer`/`node` exports, so the subsystem's machinery (clients,
 * fibers, caches, tool registrations, routes) is never constructed at all.
 *
 * Sources, lowest to highest priority:
 *   1. Built-in defaults (everything enabled).
 *   2. The `features` object in the global config files (same candidate list
 *      as the Config service reads — `opencode.jsonc`, `opencode.json`,
 *      `config.json`, plus `~/.diveeagent/diveeoi.jsonc`). Per-project config
 *      is deliberately not consulted: layers are process-global, so feature
 *      gating must be decided before any instance state exists.
 *   3. `DIVEEOI_DISABLE_FEATURES` / `OPENCODE_DISABLE_FEATURES` — comma-
 *      separated feature names to force off.
 */

export interface FeatureFlags {
  /** Session memory: extraction, scheduler, memory tools, memory routes. */
  readonly memory: boolean
  /** MCP: client connections, MCP-backed prompts/resources/tools. */
  readonly mcp: boolean
  /** LSP: language server clients and diagnostics. */
  readonly lsp: boolean
  /** Startup profiler instrumentation. */
  readonly profiler: boolean
}

const DEFAULTS: FeatureFlags = {
  memory: true,
  mcp: true,
  lsp: true,
  profiler: true,
}

const KNOWN: ReadonlyArray<keyof FeatureFlags> = ["memory", "mcp", "lsp", "profiler"]

const globalConfigCandidates = (): string[] => {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  const configDirs = [
    path.join(home, ".config", "opencode"),
    path.join(home, ".diveeagent"),
  ]
  const files: string[] = []
  for (const dir of configDirs) {
    if (!dir || dir === path.sep || dir === ".") continue
    files.push(
      path.join(dir, "opencode.jsonc"),
      path.join(dir, "opencode.json"),
      path.join(dir, "config.json"),
      path.join(dir, "diveeoi.jsonc"),
    )
  }
  const explicit = process.env.DIVEEOI_CONFIG ?? process.env.OPENCODE_CONFIG
  if (explicit) files.unshift(explicit)
  return files
}

const readConfigFeatures = (): Partial<FeatureFlags> => {
  for (const file of globalConfigCandidates()) {
    try {
      if (!existsSync(file)) continue
      if (!file.endsWith(".json") && !file.endsWith(".jsonc")) continue
      const text = readFileSync(file, "utf8")
      const data = parseJsonc(text, undefined, { allowTrailingComma: true })
      if (!data || typeof data !== "object") continue
      const features = (data as Record<string, unknown>)["features"]
      if (!features || typeof features !== "object") continue
      const out: Record<string, boolean> = {}
      for (const name of KNOWN) {
        const value = (features as Record<string, unknown>)[name]
        if (typeof value === "boolean") out[name] = value
      }
      return out as Partial<FeatureFlags>
    } catch {
      // unreadable or malformed file — fall through to the next candidate
    }
  }
  return {}
}

const readEnvDisabled = (): ReadonlyArray<keyof FeatureFlags> => {
  const raw = process.env.DIVEEOI_DISABLE_FEATURES ?? process.env.OPENCODE_DISABLE_FEATURES
  if (!raw) return []
  return raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is keyof FeatureFlags => (KNOWN as string[]).includes(name))
}

const resolve = (): FeatureFlags => {
  const flags = { ...DEFAULTS }
  const fromConfig = readConfigFeatures()
  for (const name of KNOWN) {
    if (name in fromConfig) flags[name] = fromConfig[name]!
  }
  for (const name of readEnvDisabled()) {
    flags[name] = false
  }
  return Object.freeze(flags)
}

export const flags: FeatureFlags = resolve()

export const enabled = (name: keyof FeatureFlags): boolean => flags[name]

export * as Features from "./features"
