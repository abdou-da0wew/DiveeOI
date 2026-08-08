import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

// Backward compatibility helper: read DIVEEOI_* first, fall back to OPENCODE_*
function readEnvWithFallback(diveeoiKey: string, opencodeKey: string): string | undefined {
  return process.env[diveeoiKey] ?? process.env[opencodeKey]
}

function truthyWithFallback(diveeoiKey: string, opencodeKey: string): boolean {
  const value = process.env[diveeoiKey] ?? process.env[opencodeKey]
  return value?.toLowerCase() === "true" || value === "1"
}

const copy = readEnvWithFallback("DIVEEOI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT", "OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
const fff = readEnvWithFallback("DIVEEOI_DISABLE_FFF", "OPENCODE_DISABLE_FFF")

function enabledByExperimental(diveeoiKey: string, opencodeKey: string) {
  const value = readEnvWithFallback(diveeoiKey, opencodeKey)
  return value === undefined
    ? truthyWithFallback("DIVEEOI_EXPERIMENTAL", "OPENCODE_EXPERIMENTAL")
    : truthy(value)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  // Primary env vars (DIVEEOI_*) with fallback to OPENCODE_* for backward compat
  OPENCODE_AUTO_HEAP_SNAPSHOT: truthyWithFallback("DIVEEOI_AUTO_HEAP_SNAPSHOT", "OPENCODE_AUTO_HEAP_SNAPSHOT"),
  OPENCODE_GIT_BASH_PATH: readEnvWithFallback("DIVEEOI_GIT_BASH_PATH", "OPENCODE_GIT_BASH_PATH"),
  OPENCODE_CONFIG: readEnvWithFallback("DIVEEOI_CONFIG", "OPENCODE_CONFIG"),
  OPENCODE_CONFIG_CONTENT: readEnvWithFallback("DIVEEOI_CONFIG_CONTENT", "OPENCODE_CONFIG_CONTENT"),
  OPENCODE_DISABLE_AUTOUPDATE: truthyWithFallback("DIVEEOI_DISABLE_AUTOUPDATE", "OPENCODE_DISABLE_AUTOUPDATE"),
  OPENCODE_ALWAYS_NOTIFY_UPDATE: truthyWithFallback("DIVEEOI_ALWAYS_NOTIFY_UPDATE", "OPENCODE_ALWAYS_NOTIFY_UPDATE"),
  OPENCODE_DISABLE_PRUNE: truthyWithFallback("DIVEEOI_DISABLE_PRUNE", "OPENCODE_DISABLE_PRUNE"),
  OPENCODE_DISABLE_TERMINAL_TITLE: truthyWithFallback("DIVEEOI_DISABLE_TERMINAL_TITLE", "OPENCODE_DISABLE_TERMINAL_TITLE"),
  OPENCODE_SHOW_TTFD: truthyWithFallback("DIVEEOI_SHOW_TTFD", "OPENCODE_SHOW_TTFD"),
  OPENCODE_DISABLE_AUTOCOMPACT: truthyWithFallback("DIVEEOI_DISABLE_AUTOCOMPACT", "OPENCODE_DISABLE_AUTOCOMPACT"),
  OPENCODE_DISABLE_MODELS_FETCH: truthyWithFallback("DIVEEOI_DISABLE_MODELS_FETCH", "OPENCODE_DISABLE_MODELS_FETCH"),
  OPENCODE_DISABLE_MOUSE: truthyWithFallback("DIVEEOI_DISABLE_MOUSE", "OPENCODE_DISABLE_MOUSE"),
  OPENCODE_FAKE_VCS: readEnvWithFallback("DIVEEOI_FAKE_VCS", "OPENCODE_FAKE_VCS"),
  OPENCODE_SERVER_PASSWORD: readEnvWithFallback("DIVEEOI_SERVER_PASSWORD", "OPENCODE_SERVER_PASSWORD"),
  OPENCODE_SERVER_USERNAME: readEnvWithFallback("DIVEEOI_SERVER_USERNAME", "OPENCODE_SERVER_USERNAME"),
  OPENCODE_DISABLE_FFF:
    fff === undefined ? process.platform === "win32" : truthyWithFallback("DIVEEOI_DISABLE_FFF", "OPENCODE_DISABLE_FFF"),

  // Experimental
  OPENCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean(readEnvWithFallback("DIVEEOI_EXPERIMENTAL_FILEWATCHER", "OPENCODE_EXPERIMENTAL_FILEWATCHER") ?? "").pipe(
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean(readEnvWithFallback("DIVEEOI_EXPERIMENTAL_DISABLE_FILEWATCHER", "OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER") ?? "").pipe(
    Config.withDefault(false),
  ),
  OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthyWithFallback("DIVEEOI_EXPERIMENTAL_DISABLE_COPY_ON_SELECT", "OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  OPENCODE_MODELS_URL: readEnvWithFallback("DIVEEOI_MODELS_URL", "OPENCODE_MODELS_URL"),
  OPENCODE_MODELS_PATH: readEnvWithFallback("DIVEEOI_MODELS_PATH", "OPENCODE_MODELS_PATH"),
  OPENCODE_DB: readEnvWithFallback("DIVEEOI_DB", "OPENCODE_DB"),

  OPENCODE_WORKSPACE_ID: readEnvWithFallback("DIVEEOI_WORKSPACE_ID", "OPENCODE_WORKSPACE_ID"),
  OPENCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("DIVEEOI_EXPERIMENTAL_WORKSPACES", "OPENCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get OPENCODE_DISABLE_PROJECT_CONFIG() {
    return truthyWithFallback("DIVEEOI_DISABLE_PROJECT_CONFIG", "OPENCODE_DISABLE_PROJECT_CONFIG")
  },
  get OPENCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("DIVEEOI_EXPERIMENTAL_REFERENCES", "OPENCODE_EXPERIMENTAL_REFERENCES")
  },
  get OPENCODE_TUI_CONFIG() {
    return readEnvWithFallback("DIVEEOI_TUI_CONFIG", "OPENCODE_TUI_CONFIG")
  },
  get OPENCODE_CONFIG_DIR() {
    return readEnvWithFallback("DIVEEOI_CONFIG_DIR", "OPENCODE_CONFIG_DIR")
  },
  get OPENCODE_PURE() {
    return truthyWithFallback("DIVEEOI_PURE", "OPENCODE_PURE")
  },
  get OPENCODE_PERMISSION() {
    return readEnvWithFallback("DIVEEOI_PERMISSION", "OPENCODE_PERMISSION")
  },
  get OPENCODE_PLUGIN_META_FILE() {
    return readEnvWithFallback("DIVEEOI_PLUGIN_META_FILE", "OPENCODE_PLUGIN_META_FILE")
  },
  get OPENCODE_CLIENT() {
    return readEnvWithFallback("DIVEEOI_CLIENT", "OPENCODE_CLIENT") ?? "cli"
  },
  experimentalDbExport: truthyWithFallback("DIVEEOI_EXPERIMENTAL_DB_EXPORT", "OPENCODE_EXPERIMENTAL_DB_EXPORT"),
}
