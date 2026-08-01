import { Effect, Layer, Context, Option, Schema, Array as Arr } from "effect"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import * as crypto from "node:crypto"
import type { MemoryNode, MemoryNodeID, MemoryType, CreateNodeInput, PatchNode } from "./schema"
import { MemoryError, NodeNotFoundError, SessionID } from "./schema"
import { AbsolutePath } from "@diveeoi/db/schema"
import { IndexerService } from "./indexer"
import { MemoryConfig } from "./config"

// Wikilink pattern: [[target]] or [[target|display]]
const WIKILINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

// Valid node ID format: mem_<timestamp>_<random>
const NODE_ID_REGEX = /^mem_[a-z0-9_]+$/

export interface ParsedNode {
  frontmatter: Record<string, unknown>
  content: string
  wikilinks: Array<{ target: string; display?: string; fullMatch: string }>
}

/**
 * Parse a markdown file with YAML frontmatter and extract wikilinks
 */
export const parseMarkdownNode = (content: string): ParsedNode => {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    const wikilinks: ParsedNode["wikilinks"] = []
    let wikilinkMatch: RegExpExecArray | null
    while ((wikilinkMatch = WIKILINK_REGEX.exec(content)) !== null) {
      wikilinks.push({ target: wikilinkMatch[1], display: wikilinkMatch[2], fullMatch: wikilinkMatch[0] })
    }
    return { frontmatter: {}, content: content.trim(), wikilinks }
  }

  const [, frontmatterStr, body] = match
  const frontmatter = parseYaml(frontmatterStr) as Record<string, unknown>

  const wikilinks: ParsedNode["wikilinks"] = []
  let wikilinkMatch: RegExpExecArray | null
  while ((wikilinkMatch = WIKILINK_REGEX.exec(body)) !== null) {
    wikilinks.push({ target: wikilinkMatch[1], display: wikilinkMatch[2], fullMatch: wikilinkMatch[0] })
  }

  return { frontmatter, content: body.trim(), wikilinks }
}

/**
 * Serialize a MemoryNode to markdown with frontmatter
 */
export const serializeNode = (node: MemoryNode): string => {
  const frontmatter = {
    id: node.id,
    type: node.type,
    title: node.title,
    tags: node.tags,
    sessionId: node.sessionId,
    created: node.created,
    updated: node.updated,
    confidence: node.confidence
  }

  const yaml = stringifyYaml(frontmatter, { indent: 2 })

  return `---\n${yaml}---\n\n${node.content}\n`
}

/**
 * Generate a unique memory node ID using crypto.randomUUID
 */
export const generateNodeId = (): MemoryNodeID => {
  const uuid = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `mem_${Date.now().toString(36)}_${uuid}` as MemoryNodeID
}

/**
 * Resolve node path from ID with path traversal protection
 */
export const resolveNodePath = (memoryDir: string, nodeId: MemoryNodeID): Effect.Effect<string, MemoryError> =>
  Effect.gen(function* () {
    // Validate nodeId format to prevent path traversal
    if (!NODE_ID_REGEX.test(nodeId)) {
      return yield* Effect.fail(new MemoryError({ cause: `Invalid node ID format: ${nodeId}` }))
    }

    const nodesDir = path.join(memoryDir, "nodes")
    const filePath = path.join(nodesDir, `${nodeId}.md`)

    // Ensure resolved path is within nodesDir (no path traversal)
    const resolved = path.resolve(filePath)
    const allowed = path.resolve(nodesDir)
    if (!resolved.startsWith(allowed)) {
      return yield* Effect.fail(new MemoryError({ cause: `Path traversal attempt: ${nodeId}` }))
    }

    return resolved
  })

/**
 * Create node file and parent directories
 */
export const createNodeFile = (memoryDir: string, node: MemoryNode): Effect.Effect<void, MemoryError> =>
  Effect.gen(function* () {
    const filePath = yield* resolveNodePath(memoryDir, node.id)
    const dir = path.dirname(filePath)

    yield* Effect.tryPromise({
      try: () => fs.mkdir(dir, { recursive: true }),
      catch: (cause) => new MemoryError({ cause })
    })

    const content = serializeNode(node)
    yield* Effect.tryPromise({
      try: () => fs.writeFile(filePath, content, "utf-8"),
      catch: (cause) => new MemoryError({ cause })
    })
  })

/**
 * Read node file and parse with size limit
 */
export const readNodeFile = (memoryDir: string, nodeId: MemoryNodeID): Effect.Effect<MemoryNode, MemoryError | NodeNotFoundError> =>
  Effect.gen(function* () {
    const filePath = yield* resolveNodePath(memoryDir, nodeId)

    // Check file size before reading (max 1MB)
    const stat = yield* Effect.tryPromise({
      try: () => fs.stat(filePath),
      catch: (cause) => {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
          return new NodeNotFoundError(nodeId)
        }
        return new MemoryError({ cause })
      }
    })

    const MAX_FILE_SIZE = 1024 * 1024 // 1MB
    if (stat.size > MAX_FILE_SIZE) {
      return yield* Effect.fail(new MemoryError({ cause: `File too large: ${stat.size} bytes (max ${MAX_FILE_SIZE})` }))
    }

    const content = yield* Effect.tryPromise({
      try: () => fs.readFile(filePath, "utf-8"),
      catch: (cause) => new MemoryError({ cause })
    })

    const parsed = parseMarkdownNode(content)

    const node: MemoryNode = {
      id: parsed.frontmatter.id as MemoryNodeID,
      type: parsed.frontmatter.type as MemoryType,
      title: parsed.frontmatter.title as string,
      content: parsed.content,
      tags: (parsed.frontmatter.tags as string[]) || [],
      sessionId: parsed.frontmatter.sessionId as SessionID,
      created: parsed.frontmatter.created as number,
      updated: parsed.frontmatter.updated as number,
      confidence: parsed.frontmatter.confidence as number,
path: filePath as AbsolutePath
    }

    return node
  })

/**
 * Update node file
 */
export const updateNodeFile = (memoryDir: string, node: MemoryNode): Effect.Effect<void, MemoryError> =>
  Effect.gen(function* () {
    const filePath = yield* resolveNodePath(memoryDir, node.id)
    const content = serializeNode(node)

    yield* Effect.tryPromise({
      try: () => fs.writeFile(filePath, content, "utf-8"),
      catch: (cause) => new MemoryError({ cause })
    })
  })

/**
 * Delete node file
 */
export const deleteNodeFile = (memoryDir: string, nodeId: MemoryNodeID): Effect.Effect<void, MemoryError> =>
  Effect.gen(function* () {
    const filePath = yield* resolveNodePath(memoryDir, nodeId)

    yield* Effect.tryPromise({
      try: () => fs.unlink(filePath),
      catch: (cause) => new MemoryError(cause)
    }).pipe(Effect.catch((err) => {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return Effect.void
      }
      return Effect.fail(err)
    }))
  })

/**
 * List all node files
 */
export const listNodeFiles = (memoryDir: string): Effect.Effect<MemoryNodeID[], MemoryError> =>
  Effect.gen(function* () {
    const nodesDir = path.join(memoryDir, "nodes")

    const files = yield* Effect.tryPromise({
      try: () => fs.readdir(nodesDir),
      catch: (cause) => new MemoryError(cause)
    }).pipe(Effect.catch((err) => {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        return Effect.succeed([] as MemoryNodeID[])
      }
      return Effect.fail(err)
    }))

    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3) as MemoryNodeID)
  })

/**
 * Extract wikilinks from content
 */
export const extractWikilinks = (content: string): Array<{ target: string; display?: string }> => {
  const links: Array<{ target: string; display?: string }> = []
  let match: RegExpExecArray | null
  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    links.push({ target: match[1], display: match[2] })
  }
  return links
}

/**
 * Create a node from input
 */
export const createNodeFromInput = (input: CreateNodeInput, memoryDir: string): Effect.Effect<MemoryNode, MemoryError> =>
  Effect.gen(function* () {
    const now = Date.now()
    const id = generateNodeId()

    const node: MemoryNode = {
      id,
      type: input.type,
      title: input.title,
      content: input.content,
      tags: input.tags,
      sessionId: input.sessionId,
      created: now,
      updated: now,
      confidence: input.confidence ?? 1.0,
      path: "" as AbsolutePath // Will be set by createNodeFile
    }

    const filePath = yield* resolveNodePath(memoryDir, id)
    const nodeWithPath: MemoryNode = { ...node, path: filePath as AbsolutePath }

    yield* createNodeFile(memoryDir, nodeWithPath)
    return nodeWithPath
  })

/**
 * Node Service Interface
 */
export interface NodeService {
  readonly create: (input: CreateNodeInput) => Effect.Effect<MemoryNode, MemoryError>
  readonly get: (id: MemoryNodeID) => Effect.Effect<Option.Option<MemoryNode>, MemoryError>
  readonly update: (id: MemoryNodeID, patch: PatchNode) => Effect.Effect<MemoryNode, MemoryError | NodeNotFoundError>
  readonly delete: (id: MemoryNodeID) => Effect.Effect<void, MemoryError>
  readonly list: () => Effect.Effect<MemoryNodeID[], MemoryError>
  readonly readFile: (id: MemoryNodeID) => Effect.Effect<MemoryNode, MemoryError | NodeNotFoundError>
  readonly writeFile: (node: MemoryNode) => Effect.Effect<void, MemoryError>
}

/**
 * Node Service Implementation
 */
export const NodeService = Context.Service<NodeService, NodeService>()("@diveeoi/memory/NodeService")

export const NodeLive = Layer.effect(
  NodeService,
  Effect.gen(function* () {
    const config = yield* MemoryConfig
    const indexer = yield* IndexerService
    const memoryDir = config.memoryDir

    const create = (input: CreateNodeInput) => createNodeFromInput(input, memoryDir)

    const get = (id: MemoryNodeID) =>
      readNodeFile(memoryDir, id).pipe(Effect.option)

    const update = (id: MemoryNodeID, patch: PatchNode) =>
      Effect.gen(function* () {
        const node = yield* readNodeFile(memoryDir, id)
        const updated: MemoryNode = {
          ...node,
          ...patch,
          updated: patch.updated ?? Date.now()
        }
        yield* updateNodeFile(memoryDir, updated)
        yield* indexer.upsertNode(updated)
        return updated
      })

    const del = (id: MemoryNodeID) => deleteNodeFile(memoryDir, id)

    const list = () => listNodeFiles(memoryDir)

    const readFile = (id: MemoryNodeID) => readNodeFile(memoryDir, id)

    const writeFile = (node: MemoryNode) => updateNodeFile(memoryDir, node)

    return { create, get, update, delete: del, list, readFile, writeFile }
  })
)

export * as Node from "./node"