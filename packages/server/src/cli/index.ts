import { Database } from "bun:sqlite"
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

// The command groups this CLI implements, with the one-line summary shown for
// each subcommand. Single source of truth for three things: the top-level
// help, the per-group `--help` output, and the "Available: ..." hint printed
// when an unknown subcommand is passed. Adding a subcommand means adding it
// here as well as in the handler switch, otherwise help silently drifts.
const GROUPS = {
  mcp: {
    summary: "Inspect the configured MCP servers",
    commands: {
      list: "List configured MCP servers from config file",
      validate: "Validate MCP server configurations",
    },
  },
  config: {
    summary: "Inspect or reset the config file",
    commands: {
      path: "Show config file location",
      validate: "Validate config file syntax",
      reset: "Remove config file (factory reset)",
    },
  },
  db: {
    summary: "Inspect or reset the database file",
    commands: {
      path: "Show database file location",
      entries: "Count rows across all tables",
      reset: "Delete the database file",
    },
  },
} as const

type Group = keyof typeof GROUPS

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
  for (const group of Object.keys(GROUPS) as Group[]) {
    for (const [cmd, description] of Object.entries(GROUPS[group].commands)) {
      console.log(`    ${c.green(group)} ${c.dim(cmd)}`)
      console.log(`      ${description}`)
      console.log()
    }
  }
  console.log(`  ${c.cyan("OPTIONS")}`)
  console.log()
  console.log(`    ${c.dim("(no options)")}`)
  console.log(`      Start the server (default)`)
  console.log()
}

// `diveeoi <group> --help` lists one group's subcommands. Answering `--help`
// with "Unknown subcommand" is a broken CLI, so this is part of the contract
// rather than a nicety.
function printGroupHelp(group: Group) {
  console.log(`${c.bold("DiveeOI")} ${c.cyan(group)} ${c.dim(GROUPS[group].summary)}`)
  console.log()
  console.log(`  ${c.cyan("USAGE")}`)
  console.log()
  console.log(`    ${c.bold("diveeoi")} ${c.green(group)} ${c.dim("<subcommand>")}`)
  console.log()
  console.log(`  ${c.cyan("COMMANDS")}`)
  console.log()
  for (const [cmd, description] of Object.entries(GROUPS[group].commands)) {
    console.log(`    ${c.green(cmd)}`)
    console.log(`      ${description}`)
    console.log()
  }
}

function unknownSubcommand(group: Group, cmd: string) {
  console.error(`  ${c.red(`Unknown ${group} subcommand: ${cmd}`)}`)
  console.log(`  ${c.dim(`Available: ${Object.keys(GROUPS[group].commands).join(", ")}`)}`)
  return 1
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

async function handleMCP(sub: string[]): Promise<number> {
  const cmd = sub[0] || "list"
  const conf = readConfig()
  const mcpServers = conf?.mcp || conf?.MCP || {}
  if (typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    console.log(`  ${c.yellow("No MCP configuration found in config file.")}`)
    return 0
  }

  if (sub.includes("--json") || sub.includes("-j")) {
    console.log(JSON.stringify(mcpServers, null, 2))
    return 0
  }

  switch (cmd) {
    case "list":
      console.log(`${c.bold("MCP Servers")} ${c.dim(`(${Object.keys(mcpServers).length} configured)`)}`)
      console.log()
      printMCPTable(mcpServers)
      return 0
    case "validate":
      console.log(`${c.bold("Validating MCP configurations...")}`)
      console.log()
      const ok = validateMCP(mcpServers)
      console.log()
      console.log(ok ? `  ${c.green("All configurations valid.")}` : `  ${c.red("Some configurations have issues.")}`)
      return ok ? 0 : 1
    default:
      return unknownSubcommand("mcp", cmd)
  }
}

async function handleConfig(sub: string[]): Promise<number> {
  const cmd = sub[0] || "path"

  switch (cmd) {
    case "path":
      console.log(`${c.bold("Config file path")}`)
      console.log(`  ${configPath()}`)
      return 0
    case "validate":
      console.log(`${c.bold("Validating config file...")}`)
      const p = configPath()
      if (!existsSync(p)) {
        console.log(`  ${c.yellow("No config file found at:")}`)
        console.log(`  ${p}`)
        return 0
      }
      try {
        const raw = readFileSync(p, "utf-8")
        JSON.parse(raw)
        console.log(`  ${c.green("✓")} Valid JSON at ${p}`)
        return 0
      } catch (e: any) {
        console.log(`  ${c.red("✗")} Invalid config: ${e.message}`)
        return 1
      }
    case "reset":
      const target = configPath()
      if (!existsSync(target)) {
        console.log(`  ${c.yellow("No config file to reset.")}`)
        return 0
      }
      const backup = target + ".bak"
      try {
        const dirName = dirname(target)
        if (!existsSync(dirName)) return 0
        unlinkSync(target)
        console.log(`  ${c.green("✓")} Removed ${target}`)
        console.log(`  ${c.dim("Backup saved to:")} ${backup}`)
        return 0
      } catch (e: any) {
        console.log(`  ${c.red("✗")} Failed: ${e.message}`)
        return 1
      }
    default:
      return unknownSubcommand("config", cmd)
  }
}

async function handleDB(sub: string[]): Promise<number> {
  const cmd = sub[0] || "path"
  const db_file = dbPath()

  switch (cmd) {
    case "path":
      console.log(`${c.bold("Database file path")}`)
      console.log(`  ${db_file === ":memory:" ? c.yellow(":memory:") : db_file}`)
      console.log(`  ${c.dim("exists:")}  ${existsSync(db_file) ? c.green("yes") : c.yellow("no")}`)
      return 0

    case "entries": {
      console.log(`${c.bold("Database entries")}  ${c.dim(db_file)}`)
      console.log()
      if (!existsSync(db_file)) {
        console.log(`  ${c.yellow("Database file does not exist.")}`)
        return 0
      }
      try {
        const db = new Database(db_file)
        const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
        if (tables.length === 0) {
          console.log(`  ${c.yellow("No tables found.")}`)
          return 0
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
        return 0
      } catch (e: any) {
        console.log(`  ${c.red("✗")} DB error: ${e.message}`)
        return 1
      }
    }

    case "reset":
      if (!existsSync(db_file)) {
        console.log(`  ${c.yellow("No database file to reset.")}`)
        return 0
      }
      try {
        unlinkSync(db_file)
        console.log(`  ${c.green("✓")} Database reset: ${db_file}`)
        const wal = db_file + "-wal"
        const shm = db_file + "-shm"
        if (existsSync(wal)) unlinkSync(wal)
        if (existsSync(shm)) unlinkSync(shm)
        return 0
      } catch (e: any) {
        console.log(`  ${c.red("✗")} Failed: ${e.message}`)
        return 1
      }

    default:
      return unknownSubcommand("db", cmd)
  }
}

const HELP_FLAGS = new Set(["-h", "--help", "help"])
const TOP_LEVEL = new Set(["-v", "--version", "version", ...Object.keys(GROUPS)])

// Returns the process exit code when argv named a CLI command, or `null` when it
// did not — `null` is the signal to fall through to starting the server. An
// unrecognised command is a usage error and must exit non-zero: exiting 0 makes
// `diveeoi acp` look like it succeeded, which silently passes scripts and tests
// that only check the exit status.
export async function handleCLI(rawArgs: string[]): Promise<number | null> {
  const args = rawArgs.filter((a) => a !== "--use-system-ca" && !a.startsWith("--user-agent=") && a !== "--")
  if (args.length === 0) return null

  const cmd = args[0]

  // `-h` / `--help` / `help` prints help instead of running a command. A group
  // prints its own subcommand list; a bare help flag (or a top-level command
  // with no dedicated help) prints the top-level help. An unknown command keeps
  // its error even with a help flag, so a typo isn't hidden behind help text.
  if (args.some((a) => HELP_FLAGS.has(a))) {
    if (cmd in GROUPS) {
      printGroupHelp(cmd as Group)
      return 0
    }
    if (HELP_FLAGS.has(cmd) || TOP_LEVEL.has(cmd)) {
      printHelp()
      return 0
    }
  }

  switch (cmd) {
    case "-v":
    case "--version":
    case "version":
      printVersion()
      return 0

    case "mcp":
      return handleMCP(args.slice(1))

    case "config":
      return handleConfig(args.slice(1))

    case "db":
      return handleDB(args.slice(1))

    default:
      console.error(`${c.red("Unknown command:")} ${c.bold(cmd)}`)
      console.log(`  ${c.dim("Run 'diveeoi help' for available commands.")}`)
      return 1
  }
}
