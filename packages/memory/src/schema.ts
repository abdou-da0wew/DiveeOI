import { Schema, Option } from "effect"
import { AbsolutePath, optionalOmitUndefined, withStatics } from "@diveeoi/db/schema"

// Branded types - follow codebase pattern: schema const + inferred type
export const MemoryNodeID = Schema.String.pipe(Schema.brand("MemoryNodeID"))
export type MemoryNodeID = Schema.Schema.Type<typeof MemoryNodeID>

export const SessionID = Schema.String.pipe(Schema.brand("SessionID"))
export type SessionID = Schema.Schema.Type<typeof SessionID>

// Memory node types - use Literals for union
export const MemoryType = Schema.Literals([
  "preference", "decision", "pattern", "entity", "error", "fact", "constraint", "session"
])
export type MemoryType = Schema.Schema.Type<typeof MemoryType>

// Link types between nodes
export const LinkType = Schema.Literals([
  "references", "see_also", "contradicts", "supersedes"
])
export type LinkType = Schema.Schema.Type<typeof LinkType>

// Memory Node - the core entity
export class MemoryNode extends Schema.Class<MemoryNode>("MemoryNode")({
  id: MemoryNodeID,
  type: MemoryType,
  title: Schema.String,
  content: Schema.String,
  tags: Schema.Array(Schema.String),
  sessionId: SessionID,
  created: Schema.Number,
  updated: Schema.Number,
  confidence: Schema.Number,
  path: AbsolutePath
}) {}

// Memory Link - edge in the graph
export class MemoryLink extends Schema.Class<MemoryLink>("MemoryLink")({
  sourceId: MemoryNodeID,
  targetId: MemoryNodeID,
  type: LinkType,
  created: Schema.Number
}) {}

// Session memory binding
export class SessionMemory extends Schema.Class<SessionMemory>("SessionMemory")({
  sessionId: SessionID,
  rootNodeId: MemoryNodeID,
  nodeIds: Schema.Array(MemoryNodeID),
  loadedAt: Schema.Number
}) {}

// Input for creating a new node
export class CreateNodeInput extends Schema.Class<CreateNodeInput>("CreateNodeInput")({
  type: MemoryType,
  title: Schema.String,
  content: Schema.String,
  tags: Schema.Array(Schema.String),
  sessionId: SessionID,
  confidence: optionalOmitUndefined(Schema.Number),
  links: optionalOmitUndefined(Schema.Array(Schema.Struct({
    targetId: MemoryNodeID,
    type: optionalOmitUndefined(LinkType)
  })))
}) {}

// Input for updating a node
export class PatchNode extends Schema.Class<PatchNode>("PatchNode")({
  title: optionalOmitUndefined(Schema.String),
  content: optionalOmitUndefined(Schema.String),
  tags: optionalOmitUndefined(Schema.Array(Schema.String)),
  confidence: optionalOmitUndefined(Schema.Number),
  updated: optionalOmitUndefined(Schema.Number)
}) {}

// Recall options for graph traversal
export class RecallOptions extends Schema.Class<RecallOptions>("RecallOptions")({
  seedNodes: Schema.Array(MemoryNodeID),
  maxDepth: Schema.Int,
  maxNodes: Schema.Int,
  types: optionalOmitUndefined(Schema.Array(MemoryType)),
  minConfidence: optionalOmitUndefined(Schema.Number),
  timeRange: optionalOmitUndefined(Schema.Struct({
    from: Schema.Number,
    to: Schema.Number
  })),
  queryTags: optionalOmitUndefined(Schema.Array(Schema.String)),
  currentSession: optionalOmitUndefined(SessionID)
}) {}

// Recall result with scored nodes
export class RecallResult extends Schema.Class<RecallResult>("RecallResult")({
  nodes: Schema.Array(MemoryNode),
  edges: Schema.Array(MemoryLink),
  scores: Schema.Record(Schema.String, Schema.Number)
}) {}

// Extracted memory from session
export class ExtractedMemory extends Schema.Class<ExtractedMemory>("ExtractedMemory")({
  type: MemoryType,
  title: Schema.String,
  content: Schema.String,
  tags: Schema.Array(Schema.String),
  confidence: Schema.Number,
  links: Schema.Array(Schema.Struct({
    targetId: MemoryNodeID,
    type: optionalOmitUndefined(LinkType)
  }))
}) {}

// Consolidation input
export class ConsolidationInput extends Schema.Class<ConsolidationInput>("ConsolidationInput")({
  sessionId: SessionID,
  nodeIds: Schema.Array(MemoryNodeID),
  relatedNodes: Schema.Array(MemoryNode)
}) {}

// Consolidation result
export class ConsolidationResult extends Schema.Class<ConsolidationResult>("ConsolidationResult")({
  merged: Schema.Array(MemoryNodeID),
  created: Schema.Array(MemoryNode),
  updated: Schema.Array(MemoryNode),
  linksAdded: Schema.Array(MemoryLink)
}) {}

// Error types
export class MemoryError extends Error {
  readonly _tag = "MemoryError"
  constructor(override readonly cause: unknown) {
    super(String(cause))
  }
}

export class NodeNotFoundError extends Error {
  readonly _tag = "NodeNotFoundError"
  constructor(readonly nodeId: string) {
    super(`Node not found: ${nodeId}`)
  }
}

export class SessionMemoryError extends Error {
  readonly _tag = "SessionMemoryError"
  constructor(readonly sessionId: string, override readonly cause: unknown) {
    super(`Session memory error: ${sessionId} - ${String(cause)}`)
  }
}

// Export all types and schemas
export * as MemorySchema from "./schema"

// Re-export config
export { MemoryConfig, defaultMemoryConfig } from "./config"