import { Tool } from "../tool"
import { MemoryScheduler } from "@/session/memory-scheduler"
import { SessionID } from "@/session/schema"
import { Effect, Option } from "effect"

export const MemoryExtractTool = Tool.define(
  "memory-extract",
  Effect.gen(function* () {
    const scheduler = yield* MemoryScheduler.Service
    const sessionId = yield* SessionID

    return {
      description: "Extract memories from the current session (or all sessions) using AI",
      parameters: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "Session ID to extract from (optional, defaults to current session)"
          },
          all: {
            type: "boolean",
            description: "Extract from all recent sessions instead of just current"
          }
        }
      },
      execute: ({ sessionId: targetSessionId, all }) =>
        Effect.gen(function* () {
          if (all) {
            yield* scheduler.extractNow()
            return "Memory extraction completed for all recent sessions"
          } else {
            const sid = targetSessionId ?? sessionId
            yield* scheduler.extractNow(sid)
            return `Memory extraction completed for session ${sid}`
          }
        })
    }
  })
)

export const MemoryExtractStatusTool = Tool.define(
  "memory-extract-status",
  Effect.gen(function* () {
    const scheduler = yield* MemoryScheduler.Service

    return {
      description: "Check when the next automatic memory extraction will run",
      parameters: { type: "object", properties: {} },
      execute: () =>
        Effect.gen(function* () {
          const nextRun = yield* scheduler.getNextRun()
          if (Option.isNone(nextRun)) {
            return "Memory scheduler is not running"
          }
          return `Next automatic extraction: ${nextRun.value.toString()}`
        })
    }
  })
)

export const MemoryTools = [MemoryExtractTool, MemoryExtractStatusTool]