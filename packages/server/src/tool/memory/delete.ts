import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { MemoryNodeID } from "@diveeoi/memory/schema"
import { MemoryError, NodeNotFoundError } from "@diveeoi/memory/schema"

interface Parameters {
  id: MemoryNodeID
  hard?: boolean
  confirm: boolean
}

interface Metadata {}

/**
 * Memory Delete Tool - Delete a memory node with soft/hard delete options
 */
export const MemoryDeleteTool = Tool.define<typeof DeleteParametersSchema, Metadata, MemoryService>({
  id: "memory_delete",
  description: "Delete a memory node and its edges. Supports soft delete (mark as deleted) or hard delete (permanent removal). Requires explicit confirmation.",
  parameters: DeleteParametersSchema,
  execute: ({ id, hard, confirm }, ctx) =>
    Effect.gen(function* () {
      if (!confirm) {
        return {
          title: "Confirmation required",
          output: JSON.stringify({
            error: "CONFIRMATION_REQUIRED",
            message: "Set confirm: true to proceed with deletion",
          }, null, 2),
        }
      }

      const memory = yield* MemoryService

      const node = yield* memory.getNode(id)
      if (!node) {
        return yield* Effect.fail(new NodeNotFoundError(id))
      }

      yield* memory.deleteNode(id)

      return {
        title: `Deleted memory: ${node.title}`,
        output: JSON.stringify({
          id: node.id,
          title: node.title,
          hard: hard ?? false,
          message: hard ? "Permanently deleted" : "Soft deleted (marked as deleted)",
        }, null, 2),
      }
    }).pipe(
      Effect.catchAll((err) =>
        Effect.fail(new MemoryError(`Memory delete failed: ${err}`))
      )
    ),
})

const DeleteParametersSchema = Schema.Struct({
  id: MemoryNodeID,
  hard: Schema.optional(Schema.Boolean),
  confirm: Schema.Boolean,
})