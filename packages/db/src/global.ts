import path from "path"
import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer, Logger } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"
import { LayerNode } from "./effect/layer-node"
import { fileLogger, runID } from "./observability/logging"

const app = "diveeoi"
const legacyApp = "opencode"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)
const tmp = path.join(os.tmpdir(), app)

// Legacy paths for backward compatibility
const legacyData = path.join(xdgData!, legacyApp)
const legacyCache = path.join(xdgCache!, legacyApp)
const legacyConfig = path.join(xdgConfig!, legacyApp)
const legacyState = path.join(xdgState!, legacyApp)

const paths = {
  get home() {
    return process.env.OPENCODE_TEST_HOME ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
  // Legacy paths (read-only for migration)
  legacyData,
  legacyConfig,
  legacyCache,
  legacyState,
}

export const Path = paths

Flock.setGlobal({ state })

// Migration function: copies opencode data to diveeoi on first run
// Uses Effect Logger (not console.*) since this is module-load code
const migrationLogFile = path.join(legacyData, "migration.log")
const migrationLogger = Logger.make((options) =>
  fs.appendFile(migrationLogFile, options.message + "\n").catch(() => {})
)

async function migrateFromOpencode(): Promise<void> {
  // Check if migration is disabled via env var
  if (process.env.DIVEEOI_DISABLE_MIGRATION === "1" || process.env.DIVEEOI_DISABLE_MIGRATION === "true") {
    return
  }

  const log = (msg: string) => {
    const timestamp = new Date().toISOString()
    const entry = `[${timestamp}] [run=${runID}] ${msg}\n`
    fs.appendFile(migrationLogFile, entry).catch(() => {})
  }

  try {
    // Migrate database if old exists and new doesn't
    const legacyDb = path.join(legacyData, "opencode.db")
    const newDb = path.join(data, "diveeoi.db")
    
    const legacyDbExists = await fs.access(legacyDb).then(() => true).catch(() => false)
    const newDbExists = await fs.access(newDb).then(() => true).catch(() => false)
    
    if (legacyDbExists && !newDbExists) {
      await fs.mkdir(data, { recursive: true })
      await fs.copyFile(legacyDb, newDb)
      log(`[DiveeOI] Migrated database from ${legacyDb} to ${newDb}`)
    }

    // Migrate config directory if old exists and new doesn't
    const legacyConfigDir = legacyConfig
    const newConfigDir = config
    
    const legacyConfigExists = await fs.access(legacyConfigDir).then(() => true).catch(() => false)
    const newConfigExists = await fs.access(newConfigDir).then(() => true).catch(() => false)
    
    if (legacyConfigExists && !newConfigExists) {
      await fs.mkdir(newConfigDir, { recursive: true })
      // Copy all files from legacy config
      const files = await fs.readdir(legacyConfigDir)
      for (const file of files) {
        await fs.copyFile(
          path.join(legacyConfigDir, file),
          path.join(newConfigDir, file)
        )
      }
      log(`[DiveeOI] Migrated config from ${legacyConfigDir} to ${newConfigDir}`)
    }
  } catch (err) {
    log(`[DiveeOI] Migration failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Run migration at module load (before layer creation)
await migrateFromOpencode()

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.tmp, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
  fs.mkdir(Path.repos, { recursive: true }),
])

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.OPENCODE_CONFIG_DIR ?? Path.config,
    state: Path.state,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const defaultLayer = layer
export const node = LayerNode.make(layer, [])

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"
