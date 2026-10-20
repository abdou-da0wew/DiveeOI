// packages/server/src/server/routes/instance/httpapi/task-service-layer.ts
// Bridge between the api-package TaskService tag and the server-side
// AgentTask.Service. The api handler imports TaskService from
// @diveeoi/api/handlers/task; the server provides a concrete implementation
// here that delegates to AgentTask.Service (which lives in @diveeoi/server/task)
// and to the task runner (which is what actually executes a task).

import { Effect, Layer } from "effect"
import { TaskService } from "@diveeoi/api/handlers/task"
import { AgentTask } from "@/task/task"
import { TaskRunner } from "@/task/runner"
import { TaskGenerator } from "@/task/generator"
import { Session } from "@/session/session"

export const taskServiceLayer = Layer.effect(
  TaskService,
  Effect.gen(function* () {
    const svc = yield* AgentTask.Service
    const runner = yield* TaskRunner.Service
    const generator = yield* TaskGenerator.Service
    // The task service asks for the session service when it creates a task.
    const sessions = yield* Session.Service
    return TaskService.of({
      create: (input) =>
        svc
          .create({
          prompt: input.prompt,
          model: input.model,
          autoRun: input.autoRun,
          subagentTypes: input.subagentTypes ? [...input.subagentTypes] : undefined,
          parentSessionID: input.parentSessionID,
          directory: input.directory,
          source: input.source,
          creatorAgent: input.creatorAgent,
          autoGenerate: input.autoGenerate,
          agent: input.agent,
          bigPrompt: input.bigPrompt,
          smallPrompt: input.smallPrompt,
          smallModel: input.smallModel,
          schedule: input.schedule,
            hooks: input.hooks ? [...input.hooks] : undefined,
          })
          .pipe(
            // The generator agent expands the request into a complete task and
            // then stops; the task's own agent runs it at the chosen schedule.
            Effect.tap((info) =>
              input.autoGenerate
                ? generator.generate(info.id).pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning("task generation failed", { id: info.id, cause }),
                    ),
                  )
                : Effect.void,
            ),
          )
          .pipe(Effect.provideService(Session.Service, sessions)),
      list: () => svc.list({}).pipe(Effect.map((r) => [...r])),
      get: (id) => svc.get(id),
      update: (id, patch) =>
        svc.update(id, {
          prompt: patch.prompt,
          modelID: patch.modelID,
          providerID: patch.providerID,
          subagentTypes: patch.subagentTypes ? [...patch.subagentTypes] : undefined,
          agent: patch.agent,
          bigPrompt: patch.bigPrompt,
          smallPrompt: patch.smallPrompt,
          smallProviderID: patch.smallProviderID,
          smallModelID: patch.smallModelID,
          schedule: patch.schedule,
          eventHooks: patch.eventHooks ? JSON.stringify(patch.eventHooks) : undefined,
        }),
      cancel: (id) => svc.cancel(id),
      pause: (id) => svc.pause(id),
      resume: (id) => svc.resume(id),
      run: (id) => runner.run(id),
      generate: (id) => generator.generate(id),
      events: (id) =>
        svc.events(id).pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              id: row.id,
              trigger: row.trigger,
              action: row.action,
              payload: row.payload ?? undefined,
              status: row.status ?? undefined,
              result: row.result ?? undefined,
              firedAt: row.firedAt,
            })),
          ),
        ),
    })
  }),
)
