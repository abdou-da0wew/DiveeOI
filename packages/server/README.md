# @diveeoi/server

The only stateful service in DiveeOI. Owns the HTTP bootstrap, all 50+ Effect layers, the session/LLM loop, tools, MCP, permissions, plugins, git/worktree, snapshot diffs, and config resolution. Consumed only as a server; nothing else depends on it except `packages/app` via the HTTP API.

## Entry

`src/main.ts` (73) — CLI dispatch (`handleCLI`) → `Server.listen({ port: 4097, hostname: 0.0.0.0, cors })` → `DevMonitor.start()` + `checkCtx7Update` detached + **adaptive GC `ManagedRuntime(AdaptiveResource)`** (see [`docs/optimization.md`](../../docs/optimization.md): sleeps `gcIntervalMs` per live profile, emergency `Bun.gc(true)` when `rss > 1.5*rssTarget`, warns on `critical`; owns its own runtime so it outlives `AppLayer` disposal). Handles `0 -> 4096 fallback`, `+16 scan` on `EADDRINUSE`, mDNS (skipped on loopback), and `SIGINT/SIGTERM -> stop(true)`.

`src/server/server.ts` — `Default` lazy singleton (`HttpApiApp.webHandler` wrapped with `measureAsync` when profiler-enabled), `listenerLayer = HttpRouter.serve(createRoutes(opts)) + WebSocketTracker + serverLayer (Node http.createServer with closeAllConnections monkey-patch) + ConfigProvider.fromEnv()`, `startListener` via `Layer.buildWithMemoMap` + fresh `Scope`.

## Route tree

In `src/server/routes/instance/httpapi/server.ts`:

```ts
createRoutes(corsOptions) = mergeAll(rootApi, eventApi, ptyConnectApi, instanceApi, serverApi, doc, theme, memoryExtract, ui)
  .pipe(provide [errorLayer, compression, corsVaryFix, fence, cors(corsOptions), MoveSession, HttpServer, AdaptiveResource])
  .pipe(provide  LayerNode.buildLayer(app /* 55 nodes */))
  .pipe(provideMerge LayerNode.buildLayer(SessionMemoryIntegration.node)) // must be visible outside app
  .pipe(provideMerge LayerNode.buildLayer(ToolRegistry.node))
  .pipe(provide CorsConfig, Observability)
```

`Api` (v2) in `packages/api` is included as `serverRoutes` (`Api -> handler layer -> PluginPtyEnvironment + JwtAuth`). Auth is split into `authorizationLayer` (HttpApi) vs `authorizationRouterMiddleware` (raw router for `/doc` and `uiRoute`). Workspace plumbing is `workspaceRoutingLive + instanceContextLayer + schemaErrorLayer`.

## Session lifecycle

- `src/session/session.ts` (1164 lines) — `Session.Info` + `ProjectInfo` + CRUD + fork + `getUsage` (Decimal cost, Anthropic/Bedrock/Venice cache handling), backed by `session` + `project` tables + `EventV2`.
- `src/session/prompt.ts` (1778 lines) — `createUserMessage` (file/MCP/image materialization via `Read` tool + LSP), token-window (`chars/4` + compaction guard), `generateTitle` (small model stream, stitched background), `handleSubtask` (`task` tool), `runLoop` while loop with `SessionProcessor`, `shellImpl` with `ChildProcess.spawn` streaming. **Hot fix:** loop-exit/compaction-stop previously `yield* memory.extractSessionMemory` blocking — now `Effect.forkDetach(... extract ...)` so first token is never stalled (see `docs/optimization.md`).
- `src/session/processor.ts` (1085 lines) — `ProcessorHandle { message, handleEvent(tool/text/reasoning/step) }`, doom-loop detection (3 identical tool inputs -> `permission.ask("doom_loop")`), dual-written V2 `SessionEvent.*`, `retry(SessionRetry.policy)`.
- `src/session/llm/*` — runtime selection gate (default `ai-sdk.ts streamText -> LLMEvent`, opt-in native via `native-runtime.ts -> LLMClient.stream`).
- `src/session/compaction.ts`, `summary.ts`, `overflow.ts`, `context-budget.ts`, `revert.ts`, `run-state.ts`, `memory.ts` — pruning, `isOverflow`, prompt `SystemPrompt`, instance recall.

## Tool registry

`src/tool/registry.ts` (521 lines) builds `State{custom, builtin, lazy, task, read}` per `InstanceState`. Built-ins: `shell/read/glob/grep/edit/write/task/webfetch/todo/websearch/db-export/question/invalid/truncate`; memory: 10 routes; lazy: `skill`, `apply_patch`, optional `lsp`/`plan_exit`; `custom` via `Glob.scanSync("{tool,tools}/*.{js,ts}")` `+ plugin.list()` with `EffectBridge` `ask` pinning and Zod->JSON Schema mapping. **Adaptive:** `Semaphore(maxToolConcurrency)` is created via `useAdaptiveTargets` so it tracks 1(critical)→8(comfortable) capped by `cpuCores`.

`src/tool/shell.ts` (690 lines) owns tree-sitter parsing (`bash` + `powershell` wasm), `Scan{dirs,patterns,always}` via `argPath`, permission via `external_directory + ShellID.ToolID`, `run(...)` streaming through `StreamLimiter + Truncate` with spill to file.

`src/dev/monitor.ts` (113): `DevMonitor.start()` is dev-only (`NODE_ENV==="development"`). Its own `ManagedRuntime(AdaptiveResourceDefaultLayer)` emits `DevMonitorSnapshot{ts,uptimeS,memory{rssMB,heapMB,externalMB,gcAvailable},adaptive{profile,profileChanged,rssTargetMB,heapTargetMB,gcIntervalMs,rssDeviationPct,heapDeviationPct}}` every 60s on `stderr`; `getSnapshot()` is what the panel reads.

## Other modules

- `src/config/config.ts` (706) — the full config hierarchy (see `docs/configuration.md`).
- `src/agent/agent.ts` (521) — built-ins `build/plan/general/explore/research/subthinker/code-reviewer/compaction/title/summary`, permission-derived from `Permission.fromConfig`, merged with user and capped to `Truncate.GLOB allow`.
- `src/mcp/index.ts` (939) — stdio + dual remote (`StreamableHTTP -> SSE`), OAuth with `McpOAuthCallback`, `ToolListChanged` watch + `McpCatalog.convertTool`.
- `src/permission/index.ts` (234) — `evaluate` last-wins, `Deferred` pending map with `Asked/Replied` events, `always/once/reject(with CorrectedError)` semantics.
- `src/server/auth.ts`, `src/server/shared/ui.ts`, `src/project/*`, `src/plugin/*`, `src/lsp/*`, `src/effect/*`.

## Run

```bash
bun --cwd packages/server run dev          # --conditions=browser ./src/main.ts
bun --cwd packages/server run dev:watch    # --watch variant
bun --cwd packages/server run typecheck    # systemd-run --user --scope -p MemoryMax=1.3G tsgo --noEmit
bun --cwd packages/server run test         # bun test --timeout 30000 --only-failures
bun --cwd packages/server run build        # bun run script/build.ts
```

## Conventions

See `packages/server/AGENTS.md` for the `export * as Foo from "./foo"` self-reexport pattern, `InstanceState` vs `makeRuntime`, `EffectBridge`, and `Scope` cleanup guidance. New `Tool.define` must be yielded inside the `ToolRegistry.layer` and listed in both `builtin` and `ToolRegistry.node` dependencies.
