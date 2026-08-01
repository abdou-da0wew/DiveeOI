import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { SessionMemoryIntegration } from "@/session/memory"
import { MemoryConfig } from "@diveeoi/memory"
import { MemoryError } from "@diveeoi/memory/schema"
import { Config } from "@/config/config"

type Action = "enable" | "disable"
type Scope = "session" | "global"

interface Parameters {
  action: "enable" | "disable"
  scope: "session" | "global"
  sessionId?: string
}

interface Metadata {
  readonly enabled: boolean
  readonly scope: Scope
  readonly sessionId?: string
}

/**
 * Memory Enable/Disable Tool - Toggle memory for session or project
 */
export const MemoryToggleTool = Tool.define<typeof ToggleParametersSchema, Metadata, Config.Service | MemoryConfig>({
  id: "memory_toggle",
  description: "Enable or disable memory for a session or globally. When disabled, no memory operations occur for that scope.",
  parameters: ToggleParametersSchema,
  execute: ({ action, scope, sessionId }, ctx) =>
    Effect.gen(function* () {
      const config = yield* Config.Service
      const memoryConfig = yield* MemoryConfig

      if (scope === "session") {
        const resolvedSessionId = sessionId ?? ctx.sessionID

        yield* config.set("memory", {
          ...config.memory,
          sessions: {
            ...config.memory?.sessions,
            [resolvedSessionId]: { enabled: action === "enable" },
          },
        })

        return {
          title: `Memory ${action}d for session`,
          output: JSON.stringify({
            sessionId: resolvedSessionId,
            enabled: action === "enable",
            scope: "session",
          }, null, 2),
          metadata: { enabled: action === "enable", scope: "session", sessionId: resolvedSessionId },
        }
      } else {
        yield* config.set("memory", {
          ...config.memory,
          enabled: action === "enable",
        })

        return {
          title: `Memory ${action}d globally`,
          output: JSON.stringify({
            enabled: action === "enable",
            scope: "global",
          }, null, 2),
          metadata: { enabled: action === "enable", scope: "global" },
        }
      }
    }).pipe(
      Effect.catchAll((err) =>
        Effect.fail(new MemoryError(`Memory toggle failed: ${err}`))
      )
    ),
})

const ToggleParametersSchema = Schema.Struct({
  action: Schema.Literals(["enable", "disable"]),
  scope: Schema.Literals(["session", "global"]),
  sessionId: Schema.optional(Schema.String),
})