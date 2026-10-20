import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { AgentTask } from "@/task/task"
import DESCRIPTION from "./control.txt"

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({
    description: "The task id, e.g. \"task_01M4YVP5F4JYVYHG8038VSXXZP\".",
  }),
  action: Schema.Literals(["run_now", "pause", "resume", "stop"]).annotate({
    description: "What to do with the task.",
  }),
})

type Metadata = {
  id: string
  action: string
  status: string
}

export const TaskControlTool = Tool.define<typeof Parameters, Metadata, AgentTask.Service>(
  "task_control",
  Effect.gen(function* () {
    const tasks = yield* AgentTask.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "task",
            patterns: [params.id, params.action],
            always: ["*"],
            metadata: {},
          })

          const task = yield* tasks.get(params.id)
          if (!task) {
            return {
              title: "Task not found",
              output: `No task with id "${params.id}". Use task_list to see the tasks.`,
              metadata: { id: params.id, action: params.action, status: "not_found" },
            }
          }

          switch (params.action) {
            case "run_now": {
              // Queueing is what the runner picks up, so the task runs on the next
              // runner tick — the same path a scheduled run takes.
              yield* tasks.setStatus(params.id, "queued")
              break
            }
            case "pause":
              yield* tasks.pause(params.id)
              break
            case "resume":
              yield* tasks.resume(params.id)
              break
            case "stop":
              yield* tasks.cancel(params.id)
              break
          }

          const refreshed = yield* tasks.get(params.id)
          return {
            title: `Task ${params.id}: ${params.action}`,
            output: `Task ${params.id} (${task.prompt.slice(0, 60)}): ${params.action} -> ${refreshed?.status ?? "unknown"}`,
            metadata: { id: params.id, action: params.action, status: refreshed?.status ?? "unknown" },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
