import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { AgentTask } from "@/task/task"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import DESCRIPTION from "./logs.txt"

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({
    description: "The task id, e.g. \"task_01M4YVP5F4JYVYHG8038VSXXZP\".",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "How many messages to show, oldest first. Defaults to 20.",
  }),
})

type Metadata = {
  id: string
  messages: number
}

export const TaskLogsTool = Tool.define<typeof Parameters, Metadata, AgentTask.Service | Session.Service>(
  "task_logs",
  Effect.gen(function* () {
    const tasks = yield* AgentTask.Service
    const sessions = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const task = yield* tasks.get(params.id)
          if (!task) {
            return {
              title: "Task not found",
              output: `No task with id "${params.id}". Use task_list to see the tasks.`,
              metadata: { id: params.id, messages: 0 },
            }
          }

          const messages = yield* sessions
            .messages({
              sessionID: task.sessionID as SessionID,
              limit: params.limit ?? 20,
            })
            .pipe(Effect.catch(() => Effect.succeed([])))

          if (messages.length === 0) {
            return {
              title: `No output for ${task.id}`,
              output: `The task "${task.prompt}" has not produced any output yet.`,
              metadata: { id: task.id, messages: 0 },
            }
          }

          const lines = messages.flatMap((message) => {
            const role = message.info.role
            return message.parts.flatMap((part) => {
              if (part.type !== "text") return []
              const text = part.text.trim()
              if (!text) return []
              return [`[${role}] ${text}`]
            })
          })

          return {
            title: `${task.id}: ${lines.length} message${lines.length === 1 ? "" : "s"}`,
            output: lines.join("\n\n") || "The task ran but produced no text output.",
            metadata: { id: task.id, messages: lines.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
