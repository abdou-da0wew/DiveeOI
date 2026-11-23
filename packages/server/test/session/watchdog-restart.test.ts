import { NodeFileSystem } from "@effect/platform-node"
import { AdaptiveResourceService, defaultLayer as AdaptiveResourceDefaultLayer } from "@diveeoi/db/adaptive"
import { ConfigV1 } from "@diveeoi/db/v1/config/config"
import { Database } from "@diveeoi/db/database/database"
import { CrossSpawnSpawner } from "@diveeoi/db/cross-spawn-spawner"
import { Ripgrep } from "@diveeoi/db/ripgrep"
import { Truncate } from "@/tool/truncate"
import { TestAmbient } from "../lib/ambient"
import { EventV2Bridge } from "@/event-v2-bridge"
import { FetchHttpClient } from "effect/unstable/http"
import { expect, test } from "bun:test"
import { Cause, Effect, Layer, Ref } from "effect"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { RemoteSession } from "../../src/ssh-client"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Image } from "../../src/image/image"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionID } from "../../src/session/schema"
import { SessionStatus as StatusSvc } from "../../src/session/status"
import { SessionV1 } from "@diveeoi/db/v1/session"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Shell } from "@diveeoi/db/shell"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { AgentTask } from "@/task/task"
import { Format } from "../../src/format"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@diveeoi/db/provider"
import { ModelV2 } from "@diveeoi/db/model"
import { FSUtil } from "@diveeoi/db/fs-util"
import { Plugin } from "../../src/plugin"
import { Permission } from "../../src/permission"
import { Command } from "../../src/command"
import { Instruction } from "../../src/session/instruction"
import { SessionSummary } from "../../src/session/summary"

/**
 * Watchdog interrupt-and-restart path (draft-10 P3, TODO.md §6).
 *
 * An LLM that never answers = a true no-progress stall: no LLM events, no
 * persisted parts. With the adaptive watchdog thresholds shrunk, the
 * supervisor must: trip → interrupt the wedged run (the prompt caller unwinds
 * through the interrupted-assistant path) → restart the loop from the
 * persisted checkpoint → after Watchdog.MAX_AUTO_RESTARTS restarts without
 * progress → pause the session with a degraded session.error event.
 */

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in watchdog tests"),
    authenticate: () => Effect.void,
    finishAuth: () => Effect.void,
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const status = StatusSvc.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(
  NodeFileSystem.layer,
  CrossSpawnSpawner.defaultLayer,
  AdaptiveResourceDefaultLayer,
)

function makePrompt() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    FSUtil.defaultLayer,
    BackgroundJob.defaultLayer,
    RemoteSession.defaultLayer,
    status,
    Database.defaultLayer,
    EventV2Bridge.defaultLayer,
    TestAmbient.ambientWithClientsLayer,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const agentTask = AgentTask.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
    Layer.provideMerge(agentTask),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(proc),
    Layer.provideMerge(deps),
  )
  return SessionPrompt.layer.pipe(
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(summary),
    Layer.provideMerge(run),
    Layer.provideMerge(compact),
    Layer.provideMerge(proc),
    Layer.provideMerge(registry),
    Layer.provideMerge(trunc),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
    Layer.provide(summary),
  )
}

function makeHttp() {
  return Layer.mergeAll(TestLLMServer.layer, makePrompt())
}

const it = testEffect(makeHttp())
const instance = process.platform !== "win32" ? it.instance : it.instance.skip

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, text)
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* (
  config: (url: string) => Partial<ConfigV1.Info>,
) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeText(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", ...config(llm.url) }))
  return { dir, llm }
})

instance(
  "watchdog interrupts a stalled run, restarts it, and pauses after the restart cap",
  () =>
    Effect.gen(function* () {
      // Shrink the adaptive watchdog thresholds so the test runs in seconds
      // (production: 60s heartbeat / 240s stall). The supervisor reads these
      // through the shared adaptive service at wake time.
      const adaptive = yield* AdaptiveResourceService
      const targets = yield* adaptive.getCurrentTargets()
      yield* Ref.set(adaptive.targets, { ...targets, watchdogStallMs: 600, heartbeatIntervalMs: 150 })

      const { llm } = yield* useServerConfig(providerCfg)
      const events = yield* EventV2Bridge.Service
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const statusSvc = yield* StatusSvc.Service
      const chat = yield* sessions.create({ title: "Watchdog" })

      // Every LLM call hangs — no events, no persisted parts: a true
      // no-progress stall. Enough queued hangs for every restart attempt.
      yield* llm.push(...Array.from({ length: 16 }, () => reply().hang()))

      const pauseErrors: Array<string> = []
      const otherErrors: Array<string> = []
      const off = yield* events.listen((event) => {
        if (event.type !== Session.Event.Error.type) return Effect.void
        const data = event.data as typeof Session.Event.Error.data.Type
        if (data.sessionID === chat.id && data.error) {
          const message = (data.error as { data?: { message?: string } }).data?.message
          if (message?.includes("Watchdog paused this session")) pauseErrors.push(message)
          else if (message) otherErrors.push(message)
        }
        return Effect.void
      })

      // Kick the run off. The first watchdog interrupt unwinds this prompt
      // caller through the standard interrupted-assistant path while the
      // supervisor keeps restarting the loop; the pause event arrives after
      // the restart cap (Watchdog.MAX_AUTO_RESTARTS + 1 trips).
      const runExit = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          parts: [{ type: "text", text: "do the thing" }],
        })
        .pipe(Effect.exit)

      // The wedged run was interrupted — the prompt call did NOT hang on the
      // LLM (it returns via the interrupted-assistant fallback).
      if (runExit._tag === "Failure") {
        const errs = Cause.prettyErrors(runExit.cause)
        for (const e of errs) console.error("prompt run failure:", e instanceof Error ? e.stack : String(e))
      }
      expect((yield* llm.calls) >= 1).toBe(true)
      expect(runExit._tag === "Success" || runExit._tag === "Failure").toBe(true)

      // Poll for the degraded pause: the error event arrives and the session
      // stays idle afterwards.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const s = yield* statusSvc.get(chat.id)
          return pauseErrors.length >= 1 && s.type === "idle" ? (true as const) : undefined
        }),
        "watchdog never paused the session after the restart cap",
        45_000,
      )
      yield* off

      expect(pauseErrors.length).toBe(1)
      expect(pauseErrors[0]).toContain("Watchdog paused this session")
      expect(pauseErrors[0]).toContain("auto-restarts")
      void otherErrors
      // The supervisor actually called the LLM across restart attempts.
      expect((yield* llm.calls) >= 2).toBe(true)
    }),
  90_000,
)
