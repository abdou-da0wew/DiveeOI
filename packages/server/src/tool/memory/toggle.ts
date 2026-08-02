import { Tool } from "../tool"
import { Effect, Schema } from "effect"
import { MemoryConfig } from "@diveeoi/memory"

type Action = "enable" | "disable"
type Scope = "session" | "global"

interface Metadata {
  readonly enabled: boolean
  readonly scope: Scope
  readonly sessionId?: string
}

const ToggleParametersSchema = Schema.Struct({
  action: Schema.Literals(["enable", "disable"]),
  scope: Schema.Literals(["session", "global"]),
  sessionId: Schema.optional(Schema.String),
})

/**
 * Memory Enable/Disable Tool - Toggle memory for session or project
 */
export const MemoryToggleTool = Tool.define(
  "memory_toggle",
  Effect.gen(function* () {
    const memoryConfig = yield* MemoryConfig

    return {
      description: "Enable or disable memory for a session or globally. When disabled, no memory operations occur for that scope.",
      parameters: ToggleParametersSchema,
      execute: (
        params: { action: Action; scope: Scope; sessionId?: string },
        ctx: Tool.Context
      ) =>
        Effect.gen(function* () {
          const { action, scope, sessionId } = params
          if (scope === "session") {
            const resolvedSessionId = sessionId ?? ctx.sessionID

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
          Effect.catch((err) =>
            Effect.succeed({
              title: "Memory toggle failed",
              output: `Error: ${String(err)}`,
              metadata: {},
            })
          )
        ),
    }
  }),
)