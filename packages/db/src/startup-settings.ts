import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { Global } from "./global"

/**
 * Startup performance policy.
 *
 * Resolved exactly once, at module load — before any Effect layer is built.
 * LayerMap idle time-to-live and instance cache capacities are construction-time
 * options, so the `performance` settings they derive from can only be applied by
 * restarting the server. The app's Features settings page saves the config and
 * restarts, which is the same flow the `features` flags use.
 *
 * Sources, lowest to highest priority:
 *   1. Built-in defaults (memory-friendly: idle projects are released early).
 *   2. The `performance` object in the global config files, read in the same
 *      order as the Config service (legacy dir → main dir → diveeagent).
 *   3. `DIVEEOI_KEEP_PROJECTS_WARM` — `1`/`true` force on, `0`/`false` force off.
 */

type JsonObject = Record<string, unknown>

const readJson = (file: string): JsonObject | undefined => {
  try {
    if (!existsSync(file)) return undefined
    const data = parseJsonc(readFileSync(file, "utf8"), undefined, { allowTrailingComma: true })
    return data && typeof data === "object" ? (data as JsonObject) : undefined
  } catch {
    // Unreadable or malformed config must never block boot.
    return undefined
  }
}

const configFile = (dir: string, file: string) => path.join(dir, file)

const mainDir = () => Global.Path.config
const legacyDir = () => Global.Path.legacyConfig

const diveeAgentFiles = () => [
  path.join(Global.Path.home, ".diveeagent", "diveeoi.jsonc"),
  configFile(mainDir().replace("diveeoi", "diveeagent"), "diveeoi.jsonc"),
]

const mainFiles = () => [
  configFile(mainDir(), "config.json"),
  configFile(mainDir(), "diveeoi.json"),
  configFile(mainDir(), "diveeoi.jsonc"),
  configFile(mainDir(), "opencode.json"),
  configFile(mainDir(), "opencode.jsonc"),
]

/** `compatibility.legacy_config` from the diveeoi-named files; defaults to on. */
const legacyConfigEnabled = (): boolean => {
  let result = true
  for (const file of [configFile(mainDir(), "diveeoi.json"), configFile(mainDir(), "diveeoi.jsonc")]) {
    const data = readJson(file)
    const compatibility = data?.["compatibility"]
    if (!compatibility || typeof compatibility !== "object") continue
    const value = (compatibility as JsonObject)["legacy_config"]
    if (value === true || value === false) result = value
  }
  return result
}

const orderedFiles = (): string[] => {
  const files: string[] = []
  if (legacyConfigEnabled()) {
    for (const file of ["config.json", "opencode.json", "opencode.jsonc"]) {
      files.push(configFile(legacyDir(), file))
    }
  }
  files.push(...mainFiles())
  files.push(...diveeAgentFiles())
  // An explicitly named config file outranks every discovered one.
  const explicit = process.env.DIVEEOI_CONFIG ?? process.env.OPENCODE_CONFIG
  if (explicit) files.push(explicit)
  return files
}

const parseBoolean = (value: unknown): boolean | undefined => {
  if (value === true || value === false) return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["1", "true", "on", "yes"].includes(normalized)) return true
    if (["0", "false", "off", "no"].includes(normalized)) return false
  }
  return undefined
}

const readConfigValue = (): boolean | undefined => {
  // Later files win, matching the Config service's merge order.
  let result: boolean | undefined
  for (const file of orderedFiles()) {
    const performance = readJson(file)?.["performance"]
    if (!performance || typeof performance !== "object") continue
    const value = parseBoolean((performance as JsonObject)["keep_projects_warm"])
    if (value !== undefined) result = value
  }
  return result
}

const readEnvValue = (): boolean | undefined =>
  parseBoolean(process.env.DIVEEOI_KEEP_PROJECTS_WARM ?? process.env.OPENCODE_KEEP_PROJECTS_WARM)

const keepProjectsWarm = readEnvValue() ?? readConfigValue() ?? false

/** Whether idle project service graphs are kept warm (longer TTLs, larger caches). */
export const warm = keepProjectsWarm

/** Idle lifetime for a per-location service graph before LayerMap releases it. */
export const locationIdleTimeToLive = keepProjectsWarm ? "60 minutes" : "10 minutes"

/** Per-directory InstanceState entries kept per service. */
export const instanceStateCapacity = keepProjectsWarm ? 100 : 16

/** Idle lifetime (ms) before InstanceStore reaps a project instance. */
export const instanceIdleMs = keepProjectsWarm ? 60 * 60_000 : 15 * 60_000

/** Maximum project instances retained by InstanceStore. */
export const instanceMax = keepProjectsWarm ? 24 : 12

export * as StartupSettings from "./startup-settings"
