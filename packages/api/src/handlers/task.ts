import { Context, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import type { TaskInfo } from "../groups/task"
import { TaskNotFoundError } from "../groups/task"

/**
 * The TaskService tag — the server package provides a concrete
 * implementation backed by AgentTask.Service (which lives in
 * @diveeoi/server). The api package only needs the interface shape so it
 * can type the handler without importing server-only deps.
 */
export interface TaskServiceShape {
  readonly create: (input: {
    prompt: string
    model?: { providerID: string; modelID: string }
    autoRun?: boolean
    subagentTypes?: ReadonlyArray<string>
    parentSessionID?: string
  }) => Effect.Effect<TaskInfo>
  readonly list: () => Effect.Effect<ReadonlyArray<TaskInfo>>
  readonly get: (id: string) => Effect.Effect<TaskInfo | undefined>
  readonly update: (
    id: string,
    patch: {
      prompt?: string
      modelID?: string
      providerID?: string
      subagentTypes?: ReadonlyArray<string>
    },
  ) => Effect.Effect<TaskInfo>
  readonly cancel: (id: string) => Effect.Effect<void>
  readonly pause: (id: string) => Effect.Effect<void>
  readonly resume: (id: string) => Effect.Effect<void>
}

export class TaskService extends Context.Service<TaskService, TaskServiceShape>()("@diveeoi/TaskService") {}

export const TaskHandler = HttpApiBuilder.group(Api, "server.task", (handlers) =>
  handlers
    .handle("task.create", (req) =>
      Effect.gen(function* () {
        const svc = yield* TaskService
        const body = req.payload
        const info = yield* svc.create({
          prompt: body.prompt,
          model: body.model,
          autoRun: body.autoRun,
          subagentTypes: body.subagentTypes,
          parentSessionID: body.parentSessionID,
        })
        return { data: info }
      }),
    )
    .handle("task.list", () =>
      Effect.gen(function* () {
        const svc = yield* TaskService
        const data = yield* svc.list()
        return { data: [...data] }
      }),
    )
    .handle("task.get", (req) =>
      Effect.gen(function* () {
        const svc = yield* TaskService
        const info = yield* svc.get(req.params.id)
        if (!info) {
          return yield* Effect.fail(new TaskNotFoundError({ id: req.params.id }))
        }
        return { data: info }
      }),
    )
    .handle("task.update", (req) =>
      Effect.gen(function* () {
        const svc = yield* TaskService
        const info = yield* svc.update(req.params.id, req.payload)
        return { data: info }
      }),
    )
    .handle("task.cancel", (req) =>
      Effect.gen(function* () {
        const svc = yield* TaskService
        yield* svc.cancel(req.params.id)
        return { ok: true as const }
      }),
    )
    .handle("task.pause", (req) =>
      Effect.gen(function* () {
        const svc = yield* TaskService
        yield* svc.pause(req.params.id)
        return { ok: true as const }
      }),
    )
    .handle("task.resume", (req) =>
      Effect.gen(function* () {
        const svc = yield* TaskService
        yield* svc.resume(req.params.id)
        return { ok: true as const }
      }),
    ),
)
