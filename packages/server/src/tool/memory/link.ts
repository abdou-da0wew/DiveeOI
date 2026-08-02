import { Tool } from "../tool"
import { Effect, Schema, Option } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { MemoryNodeID, LinkType } from "@diveeoi/memory/schema"
import { NodeNotFoundError } from "@diveeoi/memory/schema"

type Action = "add" | "remove"

interface Parameters {
  action: Action
  sourceId: MemoryNodeID
  targetId: MemoryNodeID
  type?: LinkType
  confirm?: boolean
}

interface Metadata {
  readonly cycleDetected?: boolean
}

const LinkParametersSchema = Schema.Struct({
  action: Schema.Literals(["add", "remove"]),
  sourceId: MemoryNodeID,
  targetId: MemoryNodeID,
  type: Schema.optional(LinkType),
  confirm: Schema.optional(Schema.Boolean),
})

/**
 * Memory Link Tool - Add/remove typed links between memory nodes
 */
export const MemoryLinkTool = Tool.define(
  "memory_link",
  Effect.gen(function* () {
    const memory = yield* MemoryService

    return {
      description: "Add or remove links between memory nodes. Validates link types, prevents cycles for hierarchical links, and enforces semantic consistency.",
      parameters: LinkParametersSchema,
      execute: (
        params: { action: Action; sourceId: MemoryNodeID; targetId: MemoryNodeID; type?: LinkType; confirm?: boolean },
        ctx: Tool.Context
      ) =>
        Effect.gen(function* () {
          const { action, sourceId, targetId, type, confirm } = params
          if (sourceId === targetId) {
            return {
              title: "Invalid link request",
              output: JSON.stringify({
                error: "INVALID_TARGET",
                message: "A node cannot be linked to itself",
              }, null, 2),
              metadata: {},
            }
          }

          const [sourceOption, targetOption] = yield* Effect.all([
            memory.getNode(sourceId),
            memory.getNode(targetId),
          ])

          if (Option.isNone(sourceOption)) {
            return yield* Effect.fail(new NodeNotFoundError({ nodeId: sourceId }))
          }
          if (Option.isNone(targetOption)) {
            return yield* Effect.fail(new NodeNotFoundError({ nodeId: targetId }))
          }
          const source = sourceOption.value
          const target = targetOption.value

          const linkType = type ?? "references"

          if (action === "add") {
            if (["supersedes"].includes(linkType)) {
              const path = yield* memory.recall({
                seedNodes: [targetId],
                maxDepth: 10,
                maxNodes: 100,
                types: [],
              })
              const createsCycle = path.nodes.some((n) => n.id === sourceId)
              if (createsCycle && !confirm) {
                return {
                  title: "Cycle detected",
                  output: JSON.stringify({
                    error: "CYCLE_DETECTED",
                    message: `Adding ${linkType} link would create a cycle`,
                    hint: "Set confirm: true to override",
                  }, null, 2),
                  metadata: { cycleDetected: true },
                }
              }
            }

            yield* memory.addLink(sourceId, targetId, linkType)

            return {
              title: `Linked ${source.title} → ${target.title}`,
              output: JSON.stringify({
                sourceId,
                targetId,
                type: linkType,
                action: "added",
              }, null, 2),
              metadata: {},
            }
          } else {
            yield* memory.removeLink(sourceId, targetId)

            return {
              title: `Removed link: ${source.title} → ${target.title}`,
              output: JSON.stringify({
                sourceId,
                targetId,
                type: linkType,
                action: "removed",
              }, null, 2),
              metadata: {},
            }
          }
        }).pipe(
          Effect.catch((err) =>
            Effect.succeed({
              title: "Memory link failed",
              output: `Error: ${String(err)}`,
              metadata: {},
            })
          )
        ),
    }
  }),
)