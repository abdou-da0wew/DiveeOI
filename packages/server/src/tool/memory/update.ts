import { Tool } from "../tool"
import { Effect, Schema, Option } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { MemoryNodeID } from "@diveeoi/memory/schema"
import { NodeNotFoundError } from "@diveeoi/memory/schema"

interface Parameters {
  id: MemoryNodeID
  title?: string
  content?: string
  tags?: string[]
  confidence?: number
  expectedVersion?: number
}

interface Metadata {
  readonly versionConflict?: boolean
  readonly currentVersion?: number
  readonly expectedVersion?: number
}

const UpdateParametersSchema = Schema.Struct({
  id: MemoryNodeID,
  title: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(100)))),
  content: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(8))
  )),
  confidence: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })))),
  expectedVersion: Schema.optional(Schema.Number),
})

/**
 * Memory Update Tool - Update an existing memory node with optimistic locking
 */
export const MemoryUpdateTool = Tool.define(
  "memory_update",
  Effect.gen(function* () {
    const memory = yield* MemoryService

    return {
      description: "Update an existing memory node. Supports partial updates of content, tags, confidence. Uses optimistic locking via version check.",
      parameters: UpdateParametersSchema,
      execute: (
        params: { id: MemoryNodeID; title?: string; content?: string; tags?: string[]; confidence?: number; expectedVersion?: number },
        ctx: Tool.Context
      ) =>
        Effect.gen(function* () {
          const { id, title, content, tags, confidence, expectedVersion } = params
          const currentOption = yield* memory.getNode(id)
          if (Option.isNone(currentOption)) {
            return yield* Effect.fail(new NodeNotFoundError({ nodeId: id }))
          }
          const current = currentOption.value

          if (expectedVersion !== undefined && current.updated !== expectedVersion) {
            return {
              title: "Version conflict",
              output: JSON.stringify({
                error: "VERSION_CONFLICT",
                message: "Node was modified by another operation",
                currentVersion: current.updated,
                expectedVersion,
              }, null, 2),
              metadata: { versionConflict: true, currentVersion: current.updated, expectedVersion },
            }
          }

          const patch: any = {}
          if (title !== undefined) patch.title = title
          if (content !== undefined) patch.content = content
          if (tags !== undefined) patch.tags = tags
          if (confidence !== undefined) patch.confidence = confidence

          if (Object.keys(patch).length === 0) {
            return {
              title: "No changes",
              output: JSON.stringify({ message: "No fields provided to update" }, null, 2),
              metadata: {},
            }
          }

          const updated = yield* memory.updateNode(id, patch)

          return {
            title: `Updated memory: ${updated.title}`,
            output: JSON.stringify(updated, null, 2),
            metadata: {},
          }
        }).pipe(
          Effect.catch((err) =>
            Effect.succeed({
              title: "Memory update failed",
              output: `Error: ${String(err)}`,
              metadata: {},
            })
          )
        ),
    }
  }),
)