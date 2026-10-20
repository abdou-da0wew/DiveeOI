import { Effect, Schema } from "effect"
import * as Tool from "../tool"
import { AgentTask } from "@/task/task"
import DESCRIPTION from "./list.txt"

export const Parameters = Schema.Struct({
  status: Schema.optional(
    Schema.Literals(["queued", "running", "paused", "awaiting_permission", "done", "failed", "cancelled", "interrupted"]),
  ).annotate({
    description: "Only show tasks in this state. Omit for all tasks.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "How many tasks to show, newest first. Defaults to 20.",
  }),
})

type Metadata = {
  count: number
}

export const TaskListTool = Tool.define<typeof Parameters, Metadata, AgentTask.Service>(
  "task_list",
  Effect.gen(function* () {
    const tasks = yield* AgentTask.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const all = yield* tasks.list(params.status ? { status: [params.status] } : {})
          const limit = params.limit ?? 20
          const rows = all.slice(0, Math.max(1, limit))

          if (rows.length === 0) {
            return {
              title: "No tasks",
              output: "No tasks found.",
              metadata: { count: 0 },
            }
          }

          const lines = rows.map((task) => {
            const parts = [
              `${task.id}  ${task.status}`,
              `"${task.prompt.slice(0, 60)}"`,
              task.schedule ? `schedule=${task.schedule}` : "schedule=none",
              `runs=${task.runCount ?? 0}`,
            ]
            if (task.lastRunAt) parts.push(`last=${new Date(task.lastRunAt).toISOString()}`)
            if (task.nextRunAt) parts.push(`next=${new Date(task.nextRunAt).toISOString()}`)
            if (task.source) parts.push(`by=${task.source}${task.creatorAgent ? `/${task.creatorAgent}` : ""}`)
            return parts.join("  ")
          })

          return {
            title: `${rows.length} task${rows.length === 1 ? "" : "s"}`,
            output: lines.join("\n"),
            metadata: { count: rows.length },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
