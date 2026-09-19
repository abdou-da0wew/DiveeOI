import { LayerNode } from "@diveeoi/db/effect/layer-node"
import { Memory, SessionService, ExtractorService } from "@diveeoi/memory"
import { MemoryConfig } from "@diveeoi/memory"
import { SessionID } from "@diveeoi/memory/schema"
import { MemoryError } from "@diveeoi/memory/schema"
import { Config } from "@/config/config"
import { Features } from "@/features"
import { Database } from "@diveeoi/db/database/database"
import { Context, Effect, Layer } from "effect"

/**
 * Session Memory Integration Service
 * Handles automatic memory initialization/extraction for sessions
 * Wraps MemoryService methods for server session lifecycle
 */
export interface Interface {
  readonly initializeSessionMemory: (sessionId: string, title: string) => Effect.Effect<void, MemoryError>
  readonly extractSessionMemory: (sessionId: string, messages: MemoryMessage[]) => Effect.Effect<void, MemoryError>
  readonly loadSessionContext: (sessionId: string) => Effect.Effect<string, MemoryError>
}

export class Service extends Context.Service<Service, Interface>()("@diveeoi/server/SessionMemoryIntegration") {}

export interface MemoryMessage {
  readonly role: "user" | "assistant" | "system"
  readonly content: string
}

const makeSessionMemoryIntegration = Effect.gen(function* () {
  const memory = yield* Memory.MemoryService
  const sessionSvc = yield* SessionService
  const extractor = yield* ExtractorService
  const memConfig = yield* MemoryConfig

  const initializeSessionMemory: Interface["initializeSessionMemory"] = (sessionId, title) =>
    Effect.gen(function* () {
      if (!memConfig.session.autoLoadDepth || !memConfig.session.autoLoadMaxNodes) {
        return
      }
      yield* sessionSvc.initializeSession(sessionId, title)
    })

  const extractSessionMemory: Interface["extractSessionMemory"] = (sessionId, messages) =>
    Effect.gen(function* () {
      if (!memConfig.session.extractOnEnd) {
        return
      }

      const memMessages = messages
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content
        }))

      yield* extractor.extractFromSession(sessionId, memMessages, memConfig.memoryDir).pipe(
        Effect.catch((err) =>
          Effect.logError("Session memory extraction failed", { sessionId, error: err })
        )
      )
    })

  const loadSessionContext: Interface["loadSessionContext"] = (sessionId) =>
    Effect.gen(function* () {
      if (!memConfig.session.autoLoadDepth || !memConfig.session.autoLoadMaxNodes) {
        return ""
      }

      const result = yield* memory.loadSessionContext(
        sessionId,
        memConfig.session.autoLoadDepth,
        memConfig.session.autoLoadMaxNodes
      )

      if (result.nodes.length === 0) {
        return ""
      }

      const memorySections = result.nodes.map(node => {
        const tags = node.tags.length > 0 ? ` [${node.tags.join(", ")}]` : ""
        const type = node.type.toUpperCase()
        return `### ${type}${tags}: ${node.title}\n${node.content}`
      }).join("\n\n---\n\n")

      return `\n\n<memory-context>\n${memorySections}\n</memory-context>\n`
    })

  return { initializeSessionMemory, extractSessionMemory, loadSessionContext }
})

// When the memory feature is disabled the real implementation never builds:
// no MemoryService, no extractor, no MemoryConfig. Consumers keep compiling
// against the same Service type and get no-ops at runtime.
const disabledLayer = Layer.succeed(
  Service,
  Service.of({
    initializeSessionMemory: () => Effect.void,
    extractSessionMemory: () => Effect.void,
    loadSessionContext: () => Effect.succeed(""),
  }),
)

export const SessionMemoryIntegrationLive = Features.flags.memory
  ? Layer.effect(Service, makeSessionMemoryIntegration).pipe(
      Layer.provide(MemoryConfig.defaultLayer),
      Layer.provide(LayerNode.buildLayer(Memory.node)),
    )
  : disabledLayer

export const defaultLayer = SessionMemoryIntegrationLive

export const node = Features.flags.memory
  ? LayerNode.make(SessionMemoryIntegrationLive, [Memory.node])
  : LayerNode.make(disabledLayer, [])

export * as SessionMemoryIntegration from "./memory"