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
    directory?: string
    source?: "user" | "agent"
    creatorAgent?: string
    autoGenerate?: boolean
    agent?: string
    bigPrompt?: string
    smallPrompt?: string
    smallModel?: { providerID: string; modelID: string }
    schedule?: string
    hooks?: ReadonlyArray<{
      trigger: "on_complete" | "on_fail" | "on_timeout" | "on_output_match"
      action: "run_command" | "notify" | "webhook" | "create_task"
      payload?: string
      pattern?: string
    }>
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
      agent?: string
      bigPrompt?: string
      smallPrompt?: string
      smallProviderID?: string
      smallModelID?: string
      schedule?: string
      eventHooks?: ReadonlyArray<{
        trigger: "on_complete" | "on_fail" | "on_timeout" | "on_output_match"
        action: "run_command" | "notify" | "webhook" | "create_task"
        payload?: string
        pattern?: string
      }>
    },
  ) => Effect.Effect<TaskInfo>
  /** Run a task now. */
  readonly run: (id: string) => Effect.Effect<void, unknown>
  /** Let the generator agent build the task. */
  readonly generate: (id: string) => Effect.Effect<void, unknown>
  /** The hook audit trail of a task. */
  readonly events: (id: string) => Effect.Effect<ReadonlyArray<{
    id: number
    trigger: string
    action: string
    payload?: string
    status?: string
    result?: string
    firedAt: number
  }>>
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
          directory: body.directory,
          source: body.source,
          creatorAgent: body.creatorAgent,
          autoGenerate: body.autoGenerate,
          agent: body.agent,
          bigPrompt: body.bigPrompt,
          smallPrompt: body.smallPrompt,
          smallModel: body.smallModel,
          schedule: body.schedule,
          hooks: body.hooks ? [...body.hooks] : undefined,
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
    )
    .handle("task.run", (req) =>
      Effect.gen(function* () {
        const svc = yield* TaskService
        const info = yield* svc.get(req.params.id)
        if (!info) return yield* Effect.fail(new TaskNotFoundError({ id: req.params.id }))
        // A failing task records its own error; the endpoint only reports that
        // the run was started.
        yield* svc.run(req.params.id).pipe(
          Effect.catchCause((cause) => Effect.logWarning("task run failed", { id: req.params.id, cause })),
        )
        return { ok: true as const }
      }),
    )
    .handle("task.generate", (req) =>
      Effect.gen(function* () {
        const svc = yield* TaskService
        const info = yield* svc.get(req.params.id)
        if (!info) return yield* Effect.fail(new TaskNotFoundError({ id: req.params.id }))
        yield* svc.generate(req.params.id).pipe(
          Effect.catchCause((cause) => Effect.logWarning("task generation failed", { id: req.params.id, cause })),
        )
        return { ok: true as const }
      }),
    )
    .handle("task.events", (req) =>
      Effect.gen(function* () {
        const svc = yield* TaskService
        const data = yield* svc.events(req.params.id)
        return { data: [...data] }
      }),
    ),
)
