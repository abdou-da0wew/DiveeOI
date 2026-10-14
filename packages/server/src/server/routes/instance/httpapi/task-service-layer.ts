// packages/server/src/server/routes/instance/httpapi/task-service-layer.ts
// Bridge between the api-package TaskService tag and the server's
// AgentTask.Service. The api handler imports TaskService from
// @diveeoi/api/handlers/task; the server provides a concrete implementation
// here that delegates to AgentTask.Service (which lives in @diveeoi/server/task).

import { Effect, Layer } from "effect"
import { TaskService } from "@diveeoi/api/handlers/task"
import { AgentTask } from "@/task/task"

/**
 * Provides the api-package TaskService tag by delegating to the server-side
 * AgentTask.Service. Mounted in server.ts alongside the other v2 handler
 * layers.
 */
export const taskServiceLayer = Layer.effect(
  TaskService,
  Effect.gen(function* () {
    const svc = yield* AgentTask.Service
    return TaskService.of({
      create: (input) =>
        svc.create({
          prompt: input.prompt,
          model: input.model,
          autoRun: input.autoRun,
          subagentTypes: input.subagentTypes ? [...input.subagentTypes] : undefined,
          parentSessionID: input.parentSessionID,
        }),
      list: () => svc.list({}).pipe(Effect.map((r) => [...r])),
      get: (id) => svc.get(id),
      update: (id, patch) =>
        svc.update(id, {
          prompt: patch.prompt,
          modelID: patch.modelID,
          providerID: patch.providerID,
          subagentTypes: patch.subagentTypes ? [...patch.subagentTypes] : undefined,
        }),
      cancel: (id) => svc.cancel(id),
      pause: (id) => svc.pause(id),
      resume: (id) => svc.resume(id),
    })
  }),
).pipe(Layer.provide(AgentTask.defaultLayer))
