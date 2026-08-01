import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { MemoryNodeID, MemoryType, LinkType } from "@diveeoi/memory/schema"
import { MemoryError, NodeNotFoundError } from "@diveeoi/memory/schema"
import { SessionMemoryIntegration } from "@/session/memory"
import { Config } from "@/config/config"
import { MemoryConfig } from "@diveeoi/memory"

interface Parameters {
  type: MemoryType
  title: string
  content: string
  tags: string[]
  sessionId?: string
  confidence?: number
  links?: Array<{ targetId: string; type?: LinkType }>
  deduplicate?: boolean
}

interface Metadata {
  readonly duplicate?: boolean
  readonly existing?: Array<{ id: string; title: string; tags: string[] }>
}

/**
 * Memory Create Tool - Create a new memory node with automatic deduplication
 */
export const MemoryCreateTool = Tool.define<typeof CreateParametersSchema, Metadata, MemoryService | SessionMemoryIntegration | Config>({
  id: "memory_create",
  description: "Create a new memory node. Automatically checks for similar existing memories to prevent duplicates. Links can reference existing nodes by ID or title.",
  parameters: CreateParametersSchema,
  execute: ({ type, title, content, tags, sessionId, confidence, links, deduplicate }, ctx) =>
    Effect.gen(function* () {
      const memory = yield* MemoryService
      const sessionMemory = yield* SessionMemoryIntegration
      const config = yield* Config.Service

      const resolvedSessionId = sessionId ?? ctx.sessionID

      if (deduplicate !== false) {
        const existing = yield* memory.search(title, 5)
        const similar = existing.filter(n =>
          n.type === type &&
          n.tags.some(t => tags.includes(t)) &&
          n.sessionId === resolvedSessionId
        )
        if (similar.length > 0) {
          return {
            title: "Duplicate memory found",
            output: JSON.stringify({
              duplicate: true,
              existing: similar.map(n => ({ id: n.id, title: n.title, tags: n.tags })),
              suggestion: "Set deduplicate: false to create anyway",
            }, null, 2),
            metadata: { duplicate: true, existing: similar },
          }
        }
      }

      const node = yield* memory.createNode({
        type,
        title,
        content,
        tags,
        sessionId: resolvedSessionId as any,
        confidence: confidence ?? 0.8,
        links: links?.map(l => ({
          targetId: l.targetId as MemoryNodeID,
          type: l.type ?? "references",
        })),
      })

      return {
        title: `Created memory: ${node.title}`,
        output: JSON.stringify({ id: node.id, ...node }, null, 2),
      }
    }).pipe(
      Effect.catchAll((err) =>
        Effect.fail(new MemoryError(`Memory create failed: ${err}`))
      )
    ),
})

const CreateParametersSchema = Schema.Struct({
  type: MemoryType,
  title: Schema.String.pipe(Schema.check(Schema.isMaxLength(100))),
  content: Schema.String,
  tags: Schema.Array(Schema.String).pipe(Schema.check(arr => arr.length >= 1 && arr.length <= 8)),
  sessionId: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })))),
  links: Schema.optional(Schema.Array(Schema.Struct({
    targetId: Schema.String,
    type: Schema.optional(LinkType),
  })).pipe(Schema.check(arr => arr.length <= 10))),
  deduplicate: Schema.optional(Schema.Boolean),
})