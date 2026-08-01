import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { MemoryNodeID, LinkType } from "@diveeoi/memory/schema"
import { MemoryError, NodeNotFoundError } from "@diveeoi/memory/schema"

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

/**
 * Memory Link Tool - Add/remove typed links between memory nodes
 */
export const MemoryLinkTool = Tool.define<typeof LinkParametersSchema, Metadata, MemoryService>({
  id: "memory_link",
  description: "Add or remove links between memory nodes. Validates link types, prevents cycles for hierarchical links, and enforces semantic consistency.",
  parameters: LinkParametersSchema,
  execute: ({ action, sourceId, targetId, type, confirm }, ctx) =>
    Effect.gen(function* () {
      const memory = yield* MemoryService

      if (sourceId === targetId) {
        return {
          title: "Invalid link",
          output: JSON.stringify({
            error: "SELF_REFERENCE",
            message: "Cannot link a node to itself",
          }, null, 2),
        }
      }

      const [source, target] = yield* Effect.all([
        memory.getNode(sourceId),
        memory.getNode(targetId),
      ])

      if (!source) return yield* Effect.fail(new NodeNotFoundError(sourceId))
      if (!target) return yield* Effect.fail(new NodeNotFoundError(targetId))

      const linkType = type ?? "references"

      if (action === "add") {
        if (["supersedes"].includes(linkType)) {
          const path = yield* memory.recall({
            seedNodes: [targetId],
            maxDepth: 10,
            types: [],
          })
          const createsCycle = path.nodes.some(n => n.id === sourceId)
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
        }
      }
    }).pipe(
      Effect.catchAll((err) =>
        Effect.fail(new MemoryError(`Memory link failed: ${err}`))
      )
    ),
})

const LinkParametersSchema = Schema.Struct({
  action: Schema.Literals(["add", "remove"]),
  sourceId: MemoryNodeID,
  targetId: MemoryNodeID,
  type: Schema.optional(LinkType),
  confirm: Schema.optional(Schema.Boolean),
})