// Branded type definitions for memory system
import { Schema } from "effect"
import { AbsolutePath } from "@diveeoi/db/schema"

export type MemoryType =
  | "preference"
  | "decision"
  | "pattern"
  | "entity"
  | "error"
  | "fact"
  | "constraint"
  | "session"

export type LinkType =
  | "references"
  | "see_also"
  | "contradicts"
  | "supersedes"

export type MemoryNodeID = string & { readonly _MemoryNodeID: unique symbol }
export type SessionID = string & { readonly _SessionID: unique symbol }

export const MemoryNodeID = Schema.String.pipe(Schema.brand("MemoryNodeID"))
export const SessionID = Schema.String.pipe(Schema.brand("SessionID"))

export type MemoryNode = {
  id: MemoryNodeID
  type: MemoryType
  title: string
  content: string
  tags: string[]
  sessionId: SessionID
  created: number
  updated: number
  confidence: number
  path: AbsolutePath
}

export type MemoryLink = {
  sourceId: MemoryNodeID
  targetId: MemoryNodeID
  type: LinkType
  created: number
}

export type SessionMemory = {
  sessionId: SessionID
  rootNodeId: MemoryNodeID
  nodeIds: MemoryNodeID[]
  loadedAt: number
}