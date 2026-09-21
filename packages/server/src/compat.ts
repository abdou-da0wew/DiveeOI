import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parse as parseJsonc } from "jsonc-parser"

/**
 * Backward-compatibility switches, resolved once at module load.
 *
 * By default DiveeOI stays backward compatible with opencode: legacy config
 * directories (`~/.config/opencode/`), legacy config files, and `OPENCODE_*`
 * environment variables are still read. Compatibility can be turned off with
 * `compatibility.legacy_config: false` — but that key is only honored when it
 * appears in a main DiveeOI-branded config source (the `~/.config/diveeoi/`
 * directory, `~/.diveeagent/diveeoi.jsonc`, or an explicit `DIVEEOI_CONFIG`
 * file). A file inherited from opencode can never switch its own
 * compatibility off.
 */

const diveeBrandedCandidates = (): string[] => {
  const home = process.env.HOME || process.env.USERPROFILE || ""
  const files: string[] = []
  const diveeDir = path.join(home, ".config", "diveeoi")
  if (diveeDir && diveeDir !== path.sep && diveeDir !== ".") {
    files.push(
      path.join(diveeDir, "opencode.jsonc"),
      path.join(diveeDir, "opencode.json"),
      path.join(diveeDir, "config.json"),
      path.join(diveeDir, "diveeoi.jsonc"),
    )
  }
  files.push(path.join(home, ".diveeagent", "diveeoi.jsonc"))
  const explicit = process.env.DIVEEOI_CONFIG
  if (explicit) files.unshift(explicit)
  return files
}

const readLegacyConfigEnabled = (): boolean => {
  for (const file of diveeBrandedCandidates()) {
    try {
      if (!existsSync(file)) continue
      if (!file.endsWith(".json") && !file.endsWith(".jsonc")) continue
      const data = parseJsonc(readFileSync(file, "utf8"), undefined, { allowTrailingComma: true })
      if (!data || typeof data !== "object") continue
      const compatibility = (data as Record<string, unknown>)["compatibility"]
      if (!compatibility || typeof compatibility !== "object") continue
      const legacy = (compatibility as Record<string, unknown>)["legacy_config"]
      if (typeof legacy === "boolean") return legacy
    } catch {
      // unreadable or malformed file — fall through to the next candidate
    }
  }
  return true
}

export const legacyConfigEnabled: boolean = readLegacyConfigEnabled()

export * as Compat from "./compat"
