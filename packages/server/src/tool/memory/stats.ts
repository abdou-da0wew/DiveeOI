import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { MemoryService } from "@diveeoi/memory"
import { GraphService } from "@diveeoi/memory"
import { MemoryError } from "@diveeoi/memory/schema"

interface Parameters {
  sessionId?: string
  includeHubs?: boolean
  includeOrphans?: boolean
  includeClusters?: boolean
  hubLimit?: number
}

interface Metadata {
  readonly totalNodes: number
  readonly totalLinks: number
  readonly totalSessions: number
}

/**
 * Memory Stats Tool - Show memory graph statistics
 */
export const MemoryStatsTool = Tool.define<typeof StatsParametersSchema, Metadata, MemoryService | GraphService>({
  id: "memory_stats",
  description: "Show statistics about the memory graph including node/edge counts, hubs, orphans, and clusters.",
  parameters: StatsParametersSchema,
  execute: ({ sessionId, includeHubs, includeOrphans, includeClusters, hubLimit }, ctx) =>
    Effect.gen(function* () {
      const memory = yield* MemoryService
      const graph = yield* GraphService

      const stats = yield* memory.getStats()

      const result: any = {
        totalNodes: stats.nodes,
        totalLinks: stats.links,
        totalSessions: stats.sessions,
      }

      if (includeHubs) {
        const hubs = yield* graph.getHubs(hubLimit ?? 10)
        result.hubs = hubs.map(n => ({ id: n.id, title: n.title, type: n.type }))
      }

      if (includeOrphans) {
        const orphans = yield* graph.getOrphans(20)
        result.orphans = orphans.map(n => ({ id: n.id, title: n.title, type: n.type }))
      }

      if (includeClusters) {
        const clusters = yield* graph.getClusters(3)
        result.clusters = clusters.map(c => ({
          size: c.length,
          types: [...new Set(c.map(n => n.type))],
        }))
      }

      return {
        title: "Memory Statistics",
        output: JSON.stringify(result, null, 2),
        metadata: { totalNodes: stats.nodes, totalLinks: stats.links, totalSessions: stats.sessions },
      }
    }).pipe(
      Effect.catchAll((err) =>
        Effect.fail(new MemoryError(`Memory stats failed: ${err}`))
      )
    ),
})

const StatsParametersSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  includeHubs: Schema.optional(Schema.Boolean),
  includeOrphans: Schema.optional(Schema.Boolean),
  includeClusters: Schema.optional(Schema.Boolean),
  hubLimit: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 50 })))),
})