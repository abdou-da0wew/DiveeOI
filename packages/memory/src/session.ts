import { Effect, Layer, Context, Option, Schema } from "effect"
import type { MemoryNode, MemoryNodeID, MemoryError, SessionID, SessionMemory } from "./schema"
import { MemoryConfig } from "./config"
import { MemoryService } from "./memory"

/**
 * Session memory integration - handles loading/saving session context
 */
export interface SessionService {
  readonly initializeSession: (sessionId: string, title: string) => Effect.Effect<SessionMemory, MemoryError>
  readonly loadSessionContext: (sessionId: string) => Effect.Effect<SessionMemory, MemoryError>
  readonly saveSessionContext: (sessionId: string) => Effect.Effect<void, MemoryError>
  readonly injectMemoryIntoPrompt: (sessionId: string, basePrompt: string) => Effect.Effect<string, MemoryError>
  readonly extractOnSessionEnd: (sessionId: string, messages: MemoryMessage[]) => Effect.Effect<void, MemoryError>
}

export const SessionService = Context.Service<SessionService, SessionService>()("@diveeoi/memory/SessionService")

// Message type — need to match extractor.ts
export interface MemoryMessage {
  readonly role: "user" | "assistant" | "system"
  readonly content: string
}

const makeSessionService = Effect.gen(function* () {
  const memory = yield* MemoryService
  const config = yield* MemoryConfig

  const initializeSession = (sessionId: string, title: string): Effect.Effect<SessionMemory, MemoryError> =>
    Effect.gen(function* () {
      // Check if session already has memory
      const existing = yield* memory.getSessionMemory(sessionId).pipe(
        Effect.map(Option.some),
        Effect.catch(() => Effect.succeed(Option.none<SessionMemory>()))
      )
      
      if (Option.isSome(existing)) return existing.value
      
      // Create new session root and wrap in session memory
      yield* memory.createSessionRoot(sessionId, title)
      return yield* memory.getSessionMemory(sessionId)
    })

  const loadSessionContext = (sessionId: string): Effect.Effect<SessionMemory, MemoryError> =>
    memory.getSessionMemory(sessionId)

  const saveSessionContext = (sessionId: string): Effect.Effect<void, MemoryError> =>
    Effect.void

  const injectMemoryIntoPrompt = (sessionId: string, basePrompt: string): Effect.Effect<string, MemoryError> =>
    Effect.gen(function* () {
      const sessionMemory = yield* memory.getSessionMemory(sessionId)
      
      if (!sessionMemory || sessionMemory.nodeIds.length === 0) {
        return basePrompt
      }

      // Load full context with recall
      const recallResult = yield* memory.recall({
        seedNodes: [sessionMemory.rootNodeId],
        maxDepth: config.session.autoLoadDepth,
        maxNodes: config.session.autoLoadMaxNodes,
        currentSession: sessionId as SessionID
      })

      if (recallResult.nodes.length === 0) {
        return basePrompt
      }

      // Format memories for injection
      const memorySections = recallResult.nodes.map(node => {
        const tags = node.tags.length > 0 ? ` [${node.tags.join(", ")}]` : ""
        const type = node.type.toUpperCase()
        return `### ${type}${tags}: ${node.title}\n${node.content}`
      }).join("\n\n---\n\n")

      const memoryBlock = `\n\n<memory-context>\n${memorySections}\n</memory-context>\n`

      // Inject after system prompt, before user messages
      const injectionPoint = basePrompt.indexOf("\n\nUser:")
      if (injectionPoint >= 0) {
        return basePrompt.slice(0, injectionPoint) + memoryBlock + basePrompt.slice(injectionPoint)
      }

      return basePrompt + memoryBlock
    })

  const extractOnSessionEnd = (sessionId: string, messages: any[]): Effect.Effect<void, MemoryError> =>
    Effect.gen(function* () {
      if (!config.session.extractOnEnd) return
      
      // Fire and forget extraction
      yield* memory.extractFromSession(sessionId, messages).pipe(
        Effect.catch((err) => Effect.logError("Session extraction failed", { error: err }))
      )
    })

  return {
    initializeSession,
    loadSessionContext,
    saveSessionContext,
    injectMemoryIntoPrompt,
    extractOnSessionEnd
  }
})

export const SessionLive = Layer.effect(
  SessionService,
  makeSessionService
)

export * as Session from "./session"