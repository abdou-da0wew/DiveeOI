import { Database } from "bun"
import { readFileSync, existsSync, unlinkSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"

declare const OPENCODE_VERSION: string | undefined
declare const OPENCODE_CHANNEL: string | undefined

const version = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
const channel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"

const c = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
}

function printVersion() {
  console.log(`DiveeOI ${c.bold(version)}`)
  console.log(`  ${c.dim("channel:")}  ${c.cyan(channel)}`)
  if (typeof process !== "undefined") {
    const { arch, platform } = process
    console.log(`  ${c.dim("platform:")} ${c.yellow(`${platform}/${arch}`)}`)
    console.log(`  ${c.dim("runtime:")}  ${c.yellow(`bun v${Bun.version}`)}`)
  }
}

function printHelp() {
  console.log(`${c.bold("DiveeOI")} ${c.dim(version)}`)
  console.log()
  console.log(`  ${c.cyan("USAGE")}`)
  console.log()
  console.log(`    ${c.bold("diveeoi")} ${c.dim("[command] [options]")}`)
  console.log()
  console.log(`  ${c.cyan("COMMANDS")}`)
  console.log()
  console.log(`    ${c.green("version")}, ${c.green("-v")}, ${c.green("--version")}`)
  console.log(`      Print version and exit`)
  console.log()
  console.log(`    ${c.green("help")}, ${c.green("-h")}, ${c.green("--help")}`)
  console.log(`      Show this help`)
  console.log()
  console.log(`    ${c.green("mcp")} ${c.dim("list")}`)
  console.log(`      List configured MCP servers from config file`)
  console.log()
  console.log(`    ${c.green("mcp")} ${c.dim("validate")}`)
  console.log(`      Validate MCP server configurations`)
  console.log()
  console.log(`    ${c.green("config")} ${c.dim("path")}`)
  console.log(`      Show config file location`)
  console.log()
  console.log(`    ${c.green("config")} ${c.dim("validate")}`)
  console.log(`      Validate config file syntax`)
  console.log()
  console.log(`    ${c.green("config")} ${c.dim("reset")}`)
  console.log(`      Remove config file (factory reset)`)
  console.log()
  console.log(`    ${c.green("db")} ${c.dim("path")}`)
  console.log(`      Show database file location`)
  console.log()
  console.log(`    ${c.green("db")} ${c.dim("entries")}`)
  console.log(`      Count rows across all tables`)
  console.log()
  console.log(`    ${c.green("db")} ${c.dim("reset")}`)
  console.log(`      Delete the database file`)
  console.log()
  console.log(`  ${c.cyan("OPTIONS")}`)
  console.log()
  console.log(`    ${c.dim("(no options)")}`)
  console.log(`      Start the server (default)`)
  console.log()
}

function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  const envPath = process.env.DIVEEOI_CONFIG
  if (envPath) return envPath
  const candidates = [
    join(xdg, "diveeoi", "opencode.json"),
    join(xdg, "diveeoi", "config.json"),
    join(xdg, "diveeoi", "diveeoi.json"),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return candidates[0]
}

function dbPath(): string {
  const envPath = process.env.DIVEEOI_DB
  if (envPath) {
    if (envPath === ":memory:") return envPath
    if (envPath.startsWith("/")) return envPath
    const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
    return join(xdgData, "diveeoi", envPath)
  }
  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(xdgData, "diveeoi", "diveeoi.db")
}

function readConfig(): Record<string, any> | null {
  const p = configPath()
  try {
    const raw = readFileSync(p, "utf-8").trim()
    if (!raw) return null
    return JSON.parse(raw) as Record<string, any>
  } catch {
    return null
  }
}

function printMCPTable(servers: Record<string, any>) {
  const names = Object.keys(servers)
  if (names.length === 0) {
    console.log(`  ${c.yellow("No MCP servers configured.")}`)
    return
  }

  const nameW = Math.max(...names.map((n) => n.length), 4)
  const sep = `  ${c.dim("+-" + "-".repeat(nameW) + "-+-----------+--------+")}`
  console.log(sep)
  console.log(`  ${c.dim("|")} ${c.bold("Name".padEnd(nameW))} ${c.dim("|")} ${c.bold("Type".padEnd(9))} ${c.dim("|")} ${c.bold("Status".padEnd(6))} ${c.dim("|")}`)
  console.log(sep)
  for (const name of names) {
    const s = servers[name]
    const type = s.type === "local" ? c.green("local") : c.blue("remote")
    const disabled = s.disabled === true || s.enabled === false
    const status = disabled ? c.yellow("disabled") : c.green("active")
    console.log(`  ${c.dim("|")} ${name.padEnd(nameW)} ${c.dim("|")} ${type.padEnd(9)} ${c.dim("|")} ${status.padEnd(6)} ${c.dim("|")}`)
  }
  console.log(sep)
}

function validateMCP(servers: Record<string, any>): boolean {
  let valid = true
  const names = Object.keys(servers)
  if (names.length === 0) {
    console.log(`  ${c.yellow("No MCP servers to validate.")}`)
    return true
  }
  for (const name of names) {
    const s = servers[name]
    const issues: string[] = []
    if (!s.type) {
      issues.push("missing 'type' field")
    } else if (s.type !== "local" && s.type !== "remote") {
      issues.push(`invalid type '${s.type}' (must be 'local' or 'remote')`)
    }
    if (s.type === "local") {
      if (!s.command || !Array.isArray(s.command) || s.command.length === 0) {
        issues.push("missing or invalid 'command' (must be a non-empty array)")
      }
      if (s.disabled !== undefined && typeof s.disabled !== "boolean") {
        issues.push("'disabled' must be a boolean")
      }
    }
    if (s.type === "remote") {
      if (!s.url || typeof s.url !== "string") {
        issues.push("missing or invalid 'url'")
      }
      try { s.url && new URL(s.url) } catch { issues.push("'url' is not a valid URL") }
    }
    if (issues.length > 0) {
      console.log(`  ${c.red("✗")} ${c.bold(name)}`)
      for (const issue of issues) {
        console.log(`    ${c.dim("•")} ${c.yellow(issue)}`)
      }
      valid = false
    } else {
      console.log(`  ${c.green("✓")} ${c.bold(name)}`)
    }
  }
  return valid
}

async function handleMCP(sub: string[]) {
  const cmd = sub[0] || "list"
  const conf = readConfig()
  const mcpServers = conf?.mcp || conf?.MCP || {}
  if (typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    console.log(`  ${c.yellow("No MCP configuration found in config file.")}`)
    return
  }

  if (sub.includes("--json") || sub.includes("-j")) {
    console.log(JSON.stringify(mcpServers, null, 2))
    return
  }

  switch (cmd) {
    case "list":
      console.log(`${c.bold("MCP Servers")} ${c.dim(`(${Object.keys(mcpServers).length} configured)`)}`)
      console.log()
      printMCPTable(mcpServers)
      break
    case "validate":
      console.log(`${c.bold("Validating MCP configurations...")}`)
      console.log()
      const ok = validateMCP(mcpServers)
      console.log()
      console.log(ok ? `  ${c.green("All configurations valid.")}` : `  ${c.red("Some configurations have issues.")}`)
      break
    default:
      console.error(`  ${c.red(`Unknown mcp subcommand: ${cmd}`)}`)
      console.log(`  ${c.dim("Available: list, validate")}`)
  }
}

async function handleConfig(sub: string[]) {
  const cmd = sub[0] || "path"

  switch (cmd) {
    case "path":
      console.log(`${c.bold("Config file path")}`)
      console.log(`  ${configPath()}`)
      break
    case "validate":
      console.log(`${c.bold("Validating config file...")}`)
      const p = configPath()
      if (!existsSync(p)) {
        console.log(`  ${c.yellow("No config file found at:")}`)
        console.log(`  ${p}`)
        break
      }
      try {
        const raw = readFileSync(p, "utf-8")
        JSON.parse(raw)
        console.log(`  ${c.green("✓")} Valid JSON at ${p}`)
      } catch (e: any) {
        console.log(`  ${c.red("✗")} Invalid config: ${e.message}`)
      }
      break
    case "reset":
      const target = configPath()
      if (!existsSync(target)) {
        console.log(`  ${c.yellow("No config file to reset.")}`)
        break
      }
      const backup = target + ".bak"
      try {
        const data = readFileSync(target)
        const dirName = dirname(target)
        if (!existsSync(dirName)) return
        unlinkSync(target)
        console.log(`  ${c.green("✓")} Removed ${target}`)
        console.log(`  ${c.dim("Backup saved to:")} ${backup}`)
      } catch (e: any) {
        console.log(`  ${c.red("✗")} Failed: ${e.message}`)
      }
      break
    default:
      console.error(`  ${c.red(`Unknown config subcommand: ${cmd}`)}`)
      console.log(`  ${c.dim("Available: path, validate, reset")}`)
  }
}

async function handleDB(sub: string[]) {
  const cmd = sub[0] || "path"
  const db_file = dbPath()

  switch (cmd) {
    case "path":
      console.log(`${c.bold("Database file path")}`)
      console.log(`  ${db_file === ":memory:" ? c.yellow(":memory:") : db_file}`)
      console.log(`  ${c.dim("exists:")}  ${existsSync(db_file) ? c.green("yes") : c.yellow("no")}`)
      break

    case "entries": {
      console.log(`${c.bold("Database entries")}  ${c.dim(db_file)}`)
      console.log()
      if (!existsSync(db_file)) {
        console.log(`  ${c.yellow("Database file does not exist.")}`)
        break
      }
      try {
        const db = new Database(db_file)
        const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
        if (tables.length === 0) {
          console.log(`  ${c.yellow("No tables found.")}`)
          break
        }
        const nameW = Math.max(...tables.map((t) => t.name.length), 5)
        const sep = `  ${c.dim("+-" + "-".repeat(nameW) + "-+----------+")}`
        console.log(sep)
        console.log(`  ${c.dim("|")} ${c.bold("Table".padEnd(nameW))} ${c.dim("|")} ${c.bold("Rows".padEnd(8))} ${c.dim("|")}`)
        console.log(sep)
        let total = 0
        for (const t of tables) {
          const row = db.query(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get() as { cnt: number }
          const cnt = row?.cnt ?? 0
          total += cnt
          console.log(`  ${c.dim("|")} ${t.name.padEnd(nameW)} ${c.dim("|")} ${String(cnt).padStart(8)} ${c.dim("|")}`)
        }
        console.log(sep)
        console.log(`  ${c.dim("|")} ${c.bold("TOTAL".padEnd(nameW))} ${c.dim("|")} ${c.bold(String(total).padStart(8))} ${c.dim("|")}`)
        console.log(sep)
        db.close()
      } catch (e: any) {
        console.log(`  ${c.red("✗")} DB error: ${e.message}`)
      }
      break
    }

    case "reset":
      if (!existsSync(db_file)) {
        console.log(`  ${c.yellow("No database file to reset.")}`)
        break
      }
      try {
        unlinkSync(db_file)
        console.log(`  ${c.green("✓")} Database reset: ${db_file}`)
        const wal = db_file + "-wal"
        const shm = db_file + "-shm"
        if (existsSync(wal)) unlinkSync(wal)
        if (existsSync(shm)) unlinkSync(shm)
      } catch (e: any) {
        console.log(`  ${c.red("✗")} Failed: ${e.message}`)
      }
      break

    default:
      console.error(`  ${c.red(`Unknown db subcommand: ${cmd}`)}`)
      console.log(`  ${c.dim("Available: path, entries, reset")}`)
  }
}

export async function handleCLI(rawArgs: string[]): Promise<boolean> {
  const args = rawArgs.filter((a) => a !== "--use-system-ca" && !a.startsWith("--user-agent=") && a !== "--")
  if (args.length === 0) return false

  const cmd = args[0]

  switch (cmd) {
    case "-v":
    case "--version":
    case "version":
      printVersion()
      return true

    case "-h":
    case "--help":
    case "help":
      printHelp()
      return true

    case "mcp":
      await handleMCP(args.slice(1))
      return true

    case "config":
      await handleConfig(args.slice(1))
      return true

    case "db":
      await handleDB(args.slice(1))
      return true

    default:
      console.error(`${c.red("Unknown command:")} ${c.bold(cmd)}`)
      console.log(`  ${c.dim("Run 'diveeoi help' for available commands.")}`)
      return true
  }
}
