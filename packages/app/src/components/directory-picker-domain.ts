const TRASH_DIR_NAMES = new Set([
  // System trash
  ".Trash", "$trash", "Trash",
  // Package manager caches
  "node_modules", ".npm", ".yarn",
  // Language/framework caches
  "__pycache__", ".pytest_cache", ".mypy_cache",
  ".cache", ".cargo", ".rustup",
  ".gradle", ".m2", ".ivy2",
  // Build artifacts
  "target", "dist", "build", ".next", ".turbo", ".output",
  "out", ".svelte-kit", "dist-newstyle",
  // Temp files
  ".tmp", "tmp", ".temp", "temp",
  // OS artifacts
  ".DS_Store", "Thumbs.db",
  // Version control
  ".svn", ".hg",
  // IDE/editor deep caches (NOT .vscode itself — that holds settings)
  ".history",
  // Junk
  "node_modules", "bower_components",
])

export function isIgnoredDirectory(name: string): boolean {
  return TRASH_DIR_NAMES.has(name)
}

export function treeEntries(parent: string, nodes: ReadonlyArray<{ name: string; type: "file" | "directory" }>) {
  const prefix = parent.replace(/^\/+|\/+$/g, "")
  return nodes
    .filter((node) => !(node.type === "directory" && isIgnoredDirectory(node.name)))
    .map((node) => {
      const path = prefix ? `${prefix}/${node.name}` : node.name
      return node.type === "directory" ? path + "/" : path
    })
}

export function pickerTreeEntries(
  parent: string,
  nodes: ReadonlyArray<{ name: string; type: "file" | "directory" }>,
  mode: "directory" | "file",
) {
  return treeEntries(parent, mode === "directory" ? nodes.filter((node) => node.type === "directory") : nodes)
}

export function pickerSearchEntries<T extends { name: string; type: "file" | "directory" }>(
  nodes: readonly T[],
  mode: "directory" | "file",
) {
  return (mode === "directory" ? nodes.filter((node) => node.type === "directory") : [...nodes])
    .filter((node) => !(node.type === "directory" && isIgnoredDirectory(node.name)))
}

export function pickerMode(mode: "directory" | "file", base?: string) {
  if (mode === "file") {
    return {
      includeFiles: true,
      action: "file" as const,
      entries(parent: string, nodes: ReadonlyArray<{ name: string; type: "file" | "directory" }>) {
        return treeEntries(parent, nodes)
      },
      navigation(path: string) {
        return treePathWithin(base, path) ? path : undefined
      },
      result(root: string, selected: string) {
        return selected || undefined
      },
      selection(root: string, path: string) {
        if (!treePathWithin(base, root)) return
        return selectedTreePath(root, path, "file", base)
      },
    }
  }
  return {
    includeFiles: false,
    action: "directory" as const,
    entries(parent: string, nodes: ReadonlyArray<{ name: string; type: "file" | "directory" }>) {
      return treeEntries(
        parent,
        nodes.filter((node) => node.type === "directory"),
      )
    },
    navigation(path: string) {
      return path
    },
    result(root: string, selected: string, valid = true) {
      if (!valid) return
      return selected || (root ? nativePickerPath(root) : undefined)
    },
    selection(root: string, path: string) {
      return selectedTreePath(root, path, "directory")
    },
  }
}

export function pickerFileSearchQuery(root: string, input: string, home: string) {
  const value = input
    .replace(/\\/g, "/")
    .replace(/^~(?=\/|$)/, home)
    .replace(/\/+$/, "")
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "")
  if (value === base) return ""
  if (value.startsWith(base + "/")) return value.slice(base.length + 1)
  return value
}

export function pickerAbsoluteInput(input: string, home: string, current: string) {
  const value = normalizePickerDrive(input).replace(/^~(?=\/|$)/, normalizePickerDrive(home))
  const absolute = pickerRoot(value) ? value : joinPickerPath(current, value)
  return canonicalPickerPath(absolute)
}

export function treePathWithin(base: string | undefined, path: string) {
  return pickerRelativePath(base, path) !== undefined
}

export function canonicalPickerPath(path: string) {
  const value = normalizePickerDrive(path)
  const root = pickerRoot(value)
  const parts = value.slice(root.length).split("/")
  const resolved = parts.reduce<string[]>((output, part) => {
    if (!part || part === ".") return output
    if (part === "..") {
      output.pop()
      return output
    }
    output.push(part)
    return output
  }, [])
  return joinPickerPath(root, resolved.join("/"))
}

export function pickerRelativePath(base: string | undefined, path: string) {
  if (!base) return
  const rootPath = canonicalPickerPath(base)
  const targetPath = canonicalPickerPath(path)
  const insensitive = /^[A-Za-z]:\//.test(rootPath) || rootPath.startsWith("//")
  const root = insensitive ? rootPath.toLowerCase() : rootPath
  const target = insensitive ? targetPath.toLowerCase() : targetPath
  if (target === root) return ""
  const prefix = root.endsWith("/") ? root : root + "/"
  if (!target.startsWith(prefix)) return
  return targetPath.slice(prefix.length)
}

export function currentPickerSuggestions<T>(result: { query: string; items: readonly T[] } | undefined, query: string) {
  if (result?.query !== query) return []
  return result.items
}

export function preloadTreeDirectories(
  parent: string,
  nodes: ReadonlyArray<{ name: string; type: "file" | "directory" }>,
) {
  return treeEntries(
    parent,
    nodes.filter((node) => node.type === "directory"),
  )
}

export function advanceTreePreload(advanced: Set<string>, path: string) {
  if (advanced.has(path)) return false
  advanced.add(path)
  return true
}

export function activeTreeNavigation(request: number, current: number) {
  return request === current
}

export function nextTreeScrollTop(current: number, delta: number, scrollHeight: number, clientHeight: number) {
  return Math.min(Math.max(0, scrollHeight - clientHeight), Math.max(0, current + delta))
}

export function nextSuggestionIndex(current: number, delta: -1 | 1, count: number) {
  if (count === 0) return -1
  return (current + delta + count) % count
}

export function absoluteTreePath(root: string, path: string) {
  const base = trimPickerPath(root)
  const relative = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (!relative) return base || "/"
  if (!base || base === "/") return "/" + relative
  if (base.endsWith("/")) return base + relative
  return `${base}/${relative}`
}

export function selectedTreePath(root: string, path: string, mode: "directory" | "file", base?: string) {
  const directory = path.endsWith("/")
  if (mode === "file") {
    if (directory) return
    if (!base) return path
    const absolute = absoluteTreePath(root, path)
    return pickerRelativePath(base, absolute)
  }
  return directory ? nativePickerPath(absoluteTreePath(root, path)) : undefined
}

export function nativePickerPath(path: string) {
  const value = trimPickerPath(path)
  if (/^[A-Za-z]:\//.test(value) || value.startsWith("//")) return value.replaceAll("/", "\\")
  return value
}
import { getFilename } from "@diveeoi/db/util/path"
import fuzzysort from "fuzzysort"
import { ServerSDK } from "@/context/server-sdk"

export function cleanPickerInput(value: string) {
  const first = (value ?? "").split(/\r?\n/)[0] ?? ""
  return first.replace(/[\u0000-\u001F\u007F]/g, "").trim()
}

export function normalizePickerPath(input: string) {
  const value = input.replaceAll("\\", "/")
  if (value.startsWith("//") && !value.startsWith("///")) return "//" + value.slice(2).replace(/\/+/g, "/")
  return value.replace(/\/+/g, "/")
}

export function normalizePickerDrive(input: string) {
  const value = normalizePickerPath(input)
  if (/^[A-Za-z]:$/.test(value)) return value + "/"
  return value
}

export function trimPickerPath(input: string) {
  const value = normalizePickerDrive(input)
  if (value === "/" || value === "//" || /^[A-Za-z]:\/$/.test(value)) return value
  return value.replace(/\/+$/, "")
}

export function joinPickerPath(base: string | undefined, relative: string) {
  const root = trimPickerPath(base ?? "")
  const path = trimPickerPath(relative).replace(/^\/+/, "")
  if (!root) return path
  if (!path) return root
  if (root.endsWith("/")) return root + path
  return root + "/" + path
}

export function pickerRoot(input: string) {
  const value = normalizePickerDrive(input)
  if (value.startsWith("//")) {
    const [server, share] = value.slice(2).split("/")
    if (server && share) return `//${server}/${share}`
    return "//"
  }
  if (value.startsWith("/")) return "/"
  if (/^[A-Za-z]:\//.test(value)) return value.slice(0, 3)
  return ""
}

export function pickerParent(input: string) {
  const value = trimPickerPath(input)
  const root = pickerRoot(value)
  if (value === root) return value
  if (value === "/" || value === "//" || /^[A-Za-z]:\/$/.test(value)) return value
  const index = value.lastIndexOf("/")
  if (index < root.length) return root
  if (index <= 0) return "/"
  if (index === 2 && /^[A-Za-z]:/.test(value)) return value.slice(0, 3)
  return value.slice(0, index)
}

function pickerTilde(absolute: string, home: string) {
  const path = trimPickerPath(absolute)
  if (!home) return ""
  const root = trimPickerPath(home)
  if (/^[A-Za-z]:\//.test(root)) return ""
  if (path === root) return "~"
  if (path.startsWith(root + "/")) return "~" + path.slice(root.length)
  return ""
}

export function displayPickerPath(path: string, input: string, home: string) {
  const value = trimPickerPath(path)
  if (/^[A-Za-z]:\//.test(trimPickerPath(home)) || /^[A-Za-z]:\//.test(value)) return value.replaceAll("/", "\\")
  const tilde = pickerTilde(path, home)
  return tilde || value
}

/** Full path with tilde shorthand — no truncation. Use for tooltips. */
export function fullPickerPath(path: string, home: string): string {
  return fullPickerPathFrom(path, trimPickerPath(path), home)
}

function fullPickerPathFrom(path: string, value: string, home: string): string {
  if (/^[A-Za-z]:\//.test(trimPickerPath(home)) || /^[A-Za-z]:\//.test(value)) return value.replaceAll("/", "\\")
  const tilde = pickerTilde(path, home)
  return tilde || value
}

/** Bidirectional truncation: shorten path on both sides like macOS Finder. */
export function truncatePath(text: string, maxLength: number): string {
  if (text.length <= maxLength || maxLength < 6) return text
  const ellipsis = "..."
  const sideChars = Math.floor((maxLength - ellipsis.length) / 2)
  if (sideChars < 1) return text.slice(0, maxLength)
  const start = text.slice(0, sideChars)
  const end = text.slice(text.length - sideChars)
  return `${start}${ellipsis}${end}`
}

/**
 * Estimate max chars from container width (px) and font size (px).
 * Rough: average char is ~0.6em wide.
 */
export function estimatePathMaxChars(containerWidthPx: number, fontSizePx: number): number {
  const avgCharWidth = fontSizePx * 0.6
  return Math.max(10, Math.floor(containerWidthPx / avgCharWidth))
}

export interface ClassifiedProject {
  worktree: string
  name: string
  type: "project" | "sandbox" | "other"
  language?: string
}

const PROJECT_INDICATORS: Record<string, string> = {
  "package.json": "node",
  "Cargo.toml": "rust",
  "go.mod": "go",
  "pom.xml": "java",
  "build.gradle": "java",
  "Gemfile": "ruby",
  "requirements.txt": "python",
  "setup.py": "python",
  "pyproject.toml": "python",
  "pubspec.yaml": "dart",
  "composer.json": "php",
  "Cargo.lock": "rust",
  "yarn.lock": "node",
  "pnpm-lock.yaml": "node",
  "bun.lockb": "node",
  "Gemfile.lock": "ruby",
  "mix.exs": "elixir",
}

// ---------------------------------------------------------------------------
// Classification cache (localStorage + TTL)
// ---------------------------------------------------------------------------
const CLASSIFICATION_CACHE_KEY = "opencode.classification.cache"
const CLASSIFICATION_CACHE_TTL_MS = 5 * 60 * 1000 // 5 min default
const CLASSIFICATION_CACHE_MAX_ENTRIES = 20

interface ClassifyCacheEntry {
  homeDir: string
  results: ClassifiedProject[]
  dirListingHashes: Record<string, string> // path -> hash of file listing
  timestamp: number
}

function readClassifyCache(): Map<string, ClassifyCacheEntry> {
  try {
    const raw = localStorage.getItem(CLASSIFICATION_CACHE_KEY)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw) as Record<string, ClassifyCacheEntry>
    const entries = Object.entries(parsed)
    // Prune expired
    const now = Date.now()
    const valid = entries.filter(([, e]) => now - e.timestamp < CLASSIFICATION_CACHE_TTL_MS)
    return new Map(valid as [string, ClassifyCacheEntry][])
  } catch {
    return new Map()
  }
}

function writeClassifyCache(cache: Map<string, ClassifyCacheEntry>): void {
  try {
    // Keep only the most recent N entries
    const entries = Array.from(cache.entries())
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, CLASSIFICATION_CACHE_MAX_ENTRIES)
    const obj: Record<string, ClassifyCacheEntry> = {}
    for (const [key, val] of entries) obj[key] = val
    localStorage.setItem(CLASSIFICATION_CACHE_KEY, JSON.stringify(obj))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function listingHash(nodes: Array<{ name: string; type: string }>): string {
  let h = 0
  for (const n of nodes) {
    h = ((h << 5) - h + n.name.length) | 0
    h = ((h << 5) - h + n.type.length) | 0
  }
  return h.toString(36)
}

/** Check if any tracked directories changed since cache was built. */
async function listingChanged(
  client: ClassifyClient,
  cacheEntry: ClassifyCacheEntry,
): Promise<boolean> {
  for (const [dir, oldHash] of Object.entries(cacheEntry.dirListingHashes)) {
    try {
      const nodes = await client.file.list({ directory: dir, path: "" }).then((r) => r.data ?? [])
      if (listingHash(nodes) !== oldHash) return true
    } catch {
      return true // if we can't check, assume stale
    }
  }
  return false
}

interface ClassifyClient {
  file: {
    list: (args: { directory: string; path: string }) => Promise<{
      data?: Array<{ name: string; type: string; absolute?: string }>
    }>
  }
}

export async function classifyOpenProjects(
  client: ClassifyClient,
  homeDir: string,
  existingProjects?: string[],
  force?: boolean,
): Promise<ClassifiedProject[]> {
  if (!homeDir) return []

  // Check cache
  if (!force) {
    const cache = readClassifyCache()
    const cached = cache.get(homeDir)
    if (cached && Date.now() - cached.timestamp < CLASSIFICATION_CACHE_TTL_MS) {
      const stale = await listingChanged(client, cached)
      if (!stale) return cached.results
    }
  }

  // Full classification walk
  const existing = new Set((existingProjects ?? []).map((p) => trimPickerPath(p)))
  const results = new Map<string, ClassifiedProject>()
  const seen = new Set<string>()
  const dirHashes: Record<string, string> = {}

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth >= 3 || results.size >= 50) return

    const key = trimPickerPath(dir)
    if (seen.has(key) || existing.has(key)) return
    seen.add(key)

    const nodes: Array<{ name: string; type: string; absolute?: string }> = await client.file
      .list({ directory: key, path: "" })
      .then((r) => r.data ?? [])
      .catch(() => [])

    dirHashes[key] = listingHash(nodes)

    const subdirs: string[] = []
    let detectedLang: string | undefined

    for (const node of nodes) {
      if (node.type === "directory") {
        if (node.name === ".git" && !detectedLang) {
          detectedLang = "project"
        }
        if (!isIgnoredDirectory(node.name)) {
          subdirs.push(node.absolute ? trimPickerPath(node.absolute) : joinPickerPath(key, node.name))
        }
        continue
      }
      const lang = PROJECT_INDICATORS[node.name]
      if (lang && lang !== "project") {
        detectedLang = lang
      }
    }

    if (detectedLang) {
      results.set(key, {
        worktree: key,
        name: getFilename(key),
        type: "project",
        language: detectedLang !== "project" ? detectedLang : undefined,
      })
    }

    if (!detectedLang || depth < 1) {
      await Promise.all(subdirs.map((sub) => walk(sub, depth + 1)))
    }
  }

  await walk(homeDir, 0)

  const classified = Array.from(results.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 50)

  // Write cache
  const cache = readClassifyCache()
  cache.set(homeDir, {
    homeDir,
    results: classified,
    dirListingHashes: dirHashes,
    timestamp: Date.now(),
  })
  writeClassifyCache(cache)

  return classified
}

/** Force-invalidate the classification cache for a homeDir. */
export function invalidateClassifyCache(homeDir?: string): void {
  if (homeDir) {
    const cache = readClassifyCache()
    cache.delete(homeDir)
    writeClassifyCache(cache)
  } else {
    localStorage.removeItem(CLASSIFICATION_CACHE_KEY)
  }
}

export function createDirectorySearch(args: { sdk: ServerSDK; base: () => string | undefined; home: () => string }) {
  const cache = new Map<string, Promise<Array<{ name: string; absolute: string }>>>()
  let current = 0

  const scoped = (value: string) => {
    const base = args.base()
    if (!base) return
    const raw = normalizePickerDrive(value)
    if (!raw) return { directory: trimPickerPath(base), path: "" }
    const home = args.home()
    if (raw === "~") return { directory: trimPickerPath(home || base), path: "" }
    if (raw.startsWith("~/")) return { directory: trimPickerPath(home || base), path: raw.slice(2) }
    const root = pickerRoot(raw)
    if (root) return { directory: trimPickerPath(root), path: raw.slice(root.length) }
    return { directory: trimPickerPath(base), path: raw }
  }

  const directories = async (directory: string) => {
    const key = trimPickerPath(directory)
    const existing = cache.get(key)
    if (existing) return existing
    const request = args.sdk.client.file
      .list({ directory: key, path: "" })
      .then((result) => result.data ?? [])
      .catch(() => [])
      .then((nodes) =>
        nodes
          .filter((node) => node.type === "directory" && !isIgnoredDirectory(node.name))
          .map((node) => ({ name: node.name, absolute: trimPickerPath(normalizePickerDrive(node.absolute)) })),
      )
    cache.set(key, request)
    return request
  }

  const match = async (directory: string, query: string, limit: number) => {
    const items = await directories(directory)
    if (!query) return items.slice(0, limit).map((item) => item.absolute)
    return fuzzysort.go(query, items, { key: "name", limit }).map((item) => item.obj.absolute)
  }

  return async (filter: string) => {
    const token = ++current
    const active = () => token === current
    const value = cleanPickerInput(filter)
    const input = scoped(value)
    if (!input) return [] as string[]
    const raw = normalizePickerDrive(value)
    const pathInput = raw.startsWith("~") || !!pickerRoot(raw) || raw.includes("/")
    const query = normalizePickerDrive(input.path)
    if (!pathInput) {
      const results = await args.sdk.client.find
        .files({ directory: input.directory, query, type: "directory", limit: 50 })
        .then((result) => result.data ?? [])
        .catch(() => [])
      if (!active()) return []
      return results.map((path) => joinPickerPath(input.directory, path)).slice(0, 50)
    }
    const segments = query.replace(/^\/+/, "").split("/")
    const head = segments.slice(0, -1).filter((part) => part && part !== ".")
    const tail = segments.at(-1) ?? ""
    let paths = [input.directory]
    for (const part of head) {
      if (!active()) return []
      if (part === "..") {
        paths = paths.map(pickerParent)
        continue
      }
      paths = Array.from(new Set((await Promise.all(paths.map((path) => match(path, part, 4)))).flat())).slice(0, 12)
      if (!active() || paths.length === 0) return []
    }
    const matches = Array.from(new Set((await Promise.all(paths.map((path) => match(path, tail, 50)))).flat()))
    if (!active()) return []
    const base = raw.startsWith("~") ? trimPickerPath(input.directory) : ""
    if (raw.endsWith("/") || !tail) return Array.from(new Set([base, ...matches].filter(Boolean))).slice(0, 50)
    const target = matches.find((path) => getFilename(path).toLowerCase() === tail.toLowerCase())
    if (!target) return matches.slice(0, 50)
    const children = await match(target, "", 30)
    if (!active()) return []
    return Array.from(new Set([base, ...matches, ...children].filter(Boolean))).slice(0, 50)
  }
}
