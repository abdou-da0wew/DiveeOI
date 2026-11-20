import { readFile, readdir } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { expandRemotePath, sshConfigFile, sshKnownHostsFile } from "./remote-paths"
import type { DiscoveredSSHHost, SSHIdentity } from "./remote-types"

const execFileAsync = promisify(execFile)

async function readConfigTree(filename: string, depth = 0, visited = new Set<string>()): Promise<string[]> {
  if (depth > 5) return []
  const resolved = path.resolve(filename)
  if (visited.has(resolved)) return []
  visited.add(resolved)

  let source: string
  try {
    source = await readFile(resolved, "utf8")
  } catch {
    return []
  }

  const lines: string[] = []
  for (const line of source.split(/\r?\n/)) {
    const include = line.trim().match(/^Include\s+(.+)$/i)
    if (!include) {
      lines.push(line)
      continue
    }

    const tokens = include[1].match(/"[^"]+"|'[^']+'|\S+/g) ?? []
    for (const token of tokens) {
      const pattern = expandRemotePath(token.replace(/^["']|["']$/g, ""))
      const directory = path.dirname(pattern)
      const basename = path.basename(pattern)
      try {
        const files = await readdir(directory)
        const regex = new RegExp("^" + basename.split("*").map(escapeRegExp).join(".*") + "$")
        for (const filename of files.filter((item) => regex.test(item)).sort()) {
          lines.push(...(await readConfigTree(path.join(directory, filename), depth + 1, visited)))
        }
      } catch {
        // Missing optional Include targets are ignored.
      }
    }
  }
  return lines
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&")
}

function parseSSHConfig(source: string): DiscoveredSSHHost[] {
  const hosts: DiscoveredSSHHost[] = []
  const globalOptions = new Map<string, string>()
  let aliases: string[] = []
  let options = new Map<string, string>()
  let inMatchBlock = false

  const flush = () => {
    if (inMatchBlock) return
    for (const alias of aliases) {
      if (/[*?!]/.test(alias) || alias.startsWith("!")) continue
      const host = normalizeHost(options.get("hostname") || alias)
      const port = Number.parseInt(options.get("port") || "22", 10)
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue
      hosts.push({
        id: "config:" + alias.toLowerCase(),
        name: alias,
        host,
        port,
        user: options.get("user") || process.env.USER || "",
        ...(options.get("identityfile") ? { identityFile: expandRemotePath(options.get("identityfile")!) } : {}),
        ...(options.get("proxyjump") ? { proxyJump: options.get("proxyjump") } : {}),
        sources: ["ssh_config"],
      })
    }
  }

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    if (!line) continue
    const match = line.match(/^([^\s=]+)\s*(?:=\s*|\s+)(.+)$/)
    if (!match) continue

    const key = match[1].toLowerCase()
    const value = match[2].trim().replace(/^["']|["']$/g, "")
    if (key === "match") {
      flush()
      aliases = []
      options = new Map(globalOptions)
      inMatchBlock = true
      continue
    }
    if (key === "host") {
      flush()
      aliases = value.split(/\s+/).filter(Boolean)
      options = new Map(globalOptions)
      inMatchBlock = false
      continue
    }
    if (inMatchBlock) continue

    if (aliases.length) {
      if (!options.has(key)) options.set(key, value)
    } else if (!globalOptions.has(key)) {
      globalOptions.set(key, value)
    }
  }
  flush()
  return hosts
}

function parseKnownHosts(source: string): DiscoveredSSHHost[] {
  const hosts: DiscoveredSSHHost[] = []
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue

    const parts = line.split(/\s+/)
    const hostIndex = parts[0].startsWith("@") ? 1 : 0
    const hostList = parts[hostIndex]
    if (!hostList || !parts[hostIndex + 1] || hostList.startsWith("|")) continue

    for (const entry of hostList.split(",")) {
      if (entry.startsWith("|") || entry.startsWith("!") || entry.includes("*")) continue
      const address = entry.match(/^\[(.+)]:(\d+)$/)
      const host = normalizeHost(address?.[1] ?? entry)
      const port = address ? Number(address[2]) : 22
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue
      hosts.push({
        id: "known:" + host.toLowerCase() + ":" + port,
        name: host,
        host,
        port,
        user: process.env.USER ?? "",
        sources: ["known_hosts"],
      })
    }
  }
  return hosts
}

function normalizeHost(value: string) {
  return value.trim().replace(/^\[|\]$/g, "")
}

function mergeHosts(input: DiscoveredSSHHost[]) {
  const merged = new Map<string, DiscoveredSSHHost>()
  for (const host of input) {
    const key = host.host.toLowerCase() + ":" + host.port + ":" + host.user.toLowerCase()
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, host)
      continue
    }
    merged.set(key, {
      ...previous,
      name: previous.sources.includes("ssh_config") ? previous.name : host.name,
      identityFile: previous.identityFile ?? host.identityFile,
      proxyJump: previous.proxyJump ?? host.proxyJump,
      sources: [...new Set([...previous.sources, ...host.sources])],
    })
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function listAgentIdentities(): Promise<SSHIdentity[]> {
  if (!process.env.SSH_AUTH_SOCK) return []
  try {
    const { stdout } = await execFileAsync("ssh-add", ["-L"], {
      timeout: 2500,
      maxBuffer: 256 * 1024,
    })
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length >= 2)
      .filter((parts) => parts[0].startsWith("ssh-") || parts[0].startsWith("ecdsa-"))
      .map((parts) => ({
        type: parts[0],
        comment: parts.slice(2).join(" ") || "SSH agent identity",
        source: "agent" as const,
      }))
  } catch {
    return []
  }
}

export async function discoverSSHHosts() {
  const [config, knownHosts, identities] = await Promise.all([
    readConfigTree(sshConfigFile()),
    readFile(sshKnownHostsFile(), "utf8").catch(() => ""),
    listAgentIdentities(),
  ])

  return {
    hosts: mergeHosts([...parseSSHConfig(config.join("\n")), ...parseKnownHosts(knownHosts)]),
    identities,
    sources: {
      sshConfig: sshConfigFile(),
      knownHosts: sshKnownHostsFile(),
      agentAvailable: Boolean(process.env.SSH_AUTH_SOCK),
    },
  }
}
