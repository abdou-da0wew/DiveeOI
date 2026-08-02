import { Tool } from "../tool"
import { Effect, Schema, Option } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { MemoryNodeID } from "@diveeoi/memory/schema"
import { NodeNotFoundError } from "@diveeoi/memory/schema"

interface Parameters {
  id: MemoryNodeID
  hard?: boolean
  confirm: boolean
}

interface Metadata {}

const DeleteParametersSchema = Schema.Struct({
  id: MemoryNodeID,
  hard: Schema.optional(Schema.Boolean),
  confirm: Schema.Boolean,
})

/**
 * Memory Delete Tool - Delete a memory node with soft/hard delete options
 */
export const MemoryDeleteTool = Tool.define(
  "memory_delete",
  Effect.gen(function* () {
    const memory = yield* MemoryService

    return {
      description: "Delete a memory node and its edges. Supports soft delete (mark as deleted) or hard delete (permanent removal). Requires explicit confirmation.",
      parameters: DeleteParametersSchema,
      execute: (
        params: { id: MemoryNodeID; hard?: boolean; confirm: boolean },
        ctx: Tool.Context
      ) =>
        Effect.gen(function* () {
          const { id, hard, confirm } = params
          if (!confirm) {
            return {
              title: "Confirmation required",
              output: JSON.stringify({
                error: "CONFIRMATION_REQUIRED",
                message: "Set confirm: true to proceed with deletion",
              }, null, 2),
              metadata: {},
            }
          }

          const nodeOption = yield* memory.getNode(id)
          if (Option.isNone(nodeOption)) {
            return yield* Effect.fail(new NodeNotFoundError({ nodeId: id }))
          }
          const node = nodeOption.value

          yield* memory.deleteNode(id)

          return {
            title: `Deleted memory: ${node.title}`,
            output: JSON.stringify({
              id: node.id,
              title: node.title,
              hard: hard ?? false,
              message: hard ? "Permanently deleted" : "Soft deleted (marked as deleted)",
            }, null, 2),
            metadata: {},
          }
        }).pipe(
          Effect.catch((err) =>
            Effect.succeed({
              title: "Memory delete failed",
              output: `Error: ${String(err)}`,
              metadata: {},
            })
          )
        ),
    }
  }),
)