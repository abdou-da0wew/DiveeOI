# Architecture

## What DiveeOI Is

A fork of [OpenCode](https://github.com/anomalyco/opencode) that ships **only the web UI + server**. The TUI/CLI subsystem was removed entirely. The result is a self-hosted web app where AI agents run inside your project directories: they read/write files, execute shell commands, call MCP tools, and stream results to a SolidJS SPA.

## Stack

| Layer | Tech |
|-------|------|
| Language | TypeScript 5.8 strict |
| Runtime | Bun 1.3.14 (preferred), Node 22 (fallback for SQLite bridge) |
| Monorepo | Bun workspaces + Turbo 2.8 |
| Server | Effect-TS 4.0.0-beta.74 — `HttpRouter`, `HttpApi`, `HttpServer`, `Layer`, `Context.Service`, `Stream`, `Scope`, `ScopedCache` |
| Frontend | SolidJS 1.9 + Vite 7.1 + Tailwind 4.1 + Kobalte + OpenTUI Solid |
| DB | SQLite + Drizzle ORM 1.0 RC2 + custom `effect-drizzle-sqlite` adapter + `effect-sqlite-node` bridge |
| LLM | Custom `@diveeoi/llm` (Schema-first) + Vercel AI SDK 6.0 as the default transport (native route is opt-in) |
| Testing | `bun test`, Playwright e2e |
| Lint/Format | oxlint / Prettier 3.6 |

## Repository Layout

```
DiveeOI/
  packages/
    server/                 # HTTP server + ALL business logic (50+ layers)
    db/                     # SQLite, session engine, AI provider adapters, tools, FS, PTY
    api/                    # Effect HttpApi definitions (21 groups)
    app/                    # SolidJS SPA
    ui/                     # Shared UI library (197+ components, theme, pierre viewer, v2)
    llm/                    # Schema-first LLM client (routes, protocols, transports, providers)
    sdk/                    # Typed HTTP client (v1 hand-written + v2 generated from OpenAPI)
    plugin/                 # Plugin SDK (tool definition helpers)
    memory/                 # Knowledge graph memory (indexer, graph, extractor, consolidation)
    effect-drizzle-sqlite/  # Effect SQL <-> Drizzle adapter (generic)
    effect-sqlite-node/     # Node SQLite driver for Effect SQL (generic)
    http-recorder/           # HTTP cassette recorder (test only)
    profiler/               # In-process profiler (AsyncLocalStorage call-tree)
    identity/               # Brand assets
    script/                 # Internal build scripts
  patches/                  # 9 patched deps (solid-js, effect, MCP SDK, etc.)
  docs/                     # This documentation
  PROJECT_GUIDE.md          # Exhaustive per-package directory listing
  turbo.json / bunfig.toml / tsconfig.json
```

## Dependency Graph

```
                  @diveeoi/server
                  business logic + bootstrap
                  ┌────────┬────────┬────────┐
                  │        │        │        │
            @diveeoi/api  @diveeoi/db  @diveeoi/sdk
            HttpApi       DB/engine  client
                  │        │  │
                  └────────┤  └──────────────┐
                           │                 │
                    @diveeoi/llm      @diveeoi/plugin
                    LLM route          plugin SDK
                                         │
                                   @diveeoi/sdk

@diveeoi/app -> @diveeoi/ui -> @diveeoi/db (types)
               -> @diveeoi/sdk
@diveeoi/memory -> @diveeoi/db + @diveeoi/llm + effect platform
```

Support: `effect-drizzle-sqlite` and `effect-sqlite-node` are consumed only by `db` (and tests).

## Server Bootstrap

Entry: `packages/server/src/main.ts` (73 lines).

```
handleCLI(argv) --if handled--> exit 0
PORT=4097 HOST=0.0.0.0 CORS split
Server.listen({ port, hostname, cors }) -> start once
  init-projectors (side-effect)
  Server.server.ts:listenEffect
    startWithPortFallback  (0 -> try 4096 then 0; else scan +16 on EADDRINUSE)
    listenerLayer = HttpRouter.serve(createRoutes(opts)) + WebSocketTracker + serverLayer + ConfigProvider.fromEnv()
    tcpAddress check -> makeURL -> setupMdns (bonjour, skipped on loopback) -> makeStop (cached close)
  log "listening on http://..."
  DevMonitor.start()
  fork checkCtx7Update background
  ManagedRuntime(AdaptiveResourceDefaultLayer) forever loop:
    getCurrentTargets() -> { gcIntervalMs, rssTargetMB }
    sleep(gcIntervalMs)
    if rss > 1.5 * rssTargetMB -> Bun.gc(true) + warn
    if profile === "critical" -> warn degraded
    Bun.gc(true) debug
  trap SIGINT/SIGTERM -> server.stop(true)
```

`packages/server/src/server/server.ts` owns the HTTP listener lifecycle:

- `Default` is a `lazy` singleton wrapping `HttpApiApp.webHandler()` with optional profiler `measureAsync` per route.
- `listenerLayer` composes `HttpRouter.serve(HttpApiApp.createRoutes(opts), { middleware: disposeMiddleware })` with `WebSocketTracker.layer`, a raw Node `http.createServer()` with a monkey-patched `close` for `closeAllConnections()`, and `ConfigProvider.fromEnv()` so each `listen()` call sees fresh env.
- `startListener` builds the layer with `Layer.buildWithMemoMap` into a fresh `Scope` and `HttpApiApp.context` (the memoMap shared by the app layer), extracts `HttpServer.HttpServer`, `ListenerServerService`, `WebSocketTracker.Service`.

## HTTP Route Tree

Built in `packages/server/src/server/routes/instance/httpapi/server.ts`:

```
cors()
authOnlyRouterLayer -> RootHttpApi      (control, control-plane, global handlers)
eventApiRoutes      -> EventApi         (SSE)
ptyConnectApiRoutes -> PtyConnectApi    (WebSocket upgrade)
instanceRoutes      -> InstanceHttpApi  (15 handler groups)
serverRoutes        -> Api (v2)         (21 groups)
docRoute            -> GET /doc -> OpenApi.fromApi(PublicApi) (lazy, cached)
themeRoute          -> rawThemeRoute
memoryExtractRoute  -> POST /api/session/:id/memory/extract
uiRoute             -> * /* -> serveUIEffect (SPA fallback)
      |
      + Layer.provide [errorLayer, compressionLayer, corsVaryFix, fenceLayer, cors(), MoveSession, HttpServer.layerServices, AdaptiveResource]
      + Layer.provide LayerNode.buildLayer(app)               // 55-node app group
      + Layer.provideMerge SessionMemoryIntegration.node       // outside group — must be visible
      + Layer.provideMerge ToolRegistry.node                  // outside group — visible to outer scope
      + Layer.provide CorsConfig + Observability
```

`Api` (`packages/api/src/api.ts`) is `HttpApi.make("server")` plus 21 groups. `routes.ts` provides the v2 `HttpApiBuilder` layer at a higher level. The per-request stack is `Node HTTP -> HttpRouter -> CORS -> Auth -> SchemaError -> workspaceRoutingLive + instanceContextLayer -> HttpApiBuilder dispatch -> handler`.

`webHandler` is `HttpRouter.toWebHandler(routes, { memoMap, middleware: disposeMiddleware(traceMiddleware(effect)) })`.

## Effect Layer Graph

`packages/db/src/effect/layer-node.ts` is the app-graph primitive.

- `make(implementation, dependencies)` returns a `Node<A,E>` with a `CheckDependencies` conditional type that surfaces `Missing dependencies` at the type level. Most calls suspend that check with `as never` because beta.74 widens `RIn` to `unknown`.
- `group(items)` merges peers via `Layer.mergeAll`.
- `buildLayer(node)` walks the graph, memoizes per node, detects cycles, and materializes `group -> Layer.mergeAll` vs `leaf -> Layer.provide(impl, deps)`.

The 55-node `app` group in `server.ts` includes `Database`, `Config`, `Session`, `SessionProcessor`, `LLM`, `Agent`, `Permission`, `ToolRegistry`, `MCP`, `LSP`, `Plugin`, `PtyTicket`, etc. `ToolRegistry.node` (521 lines) depends on `Session.node`, `Memory.node`, `SessionMemoryIntegration.node`, `Database.node`, and 15 other services; its tools are resolved lazily per instance via `InstanceState`.

Pitfall: a `make` node whose `deps` is invisible (typed `never`) passes the `CheckDependencies` gate silently and will fail at runtime with `Service not found`. The fix in `PROJECT_LESSONS.md` is to provide the missing `LayerNode` explicitly with `Layer.provideMerge(LayerNode.buildLayer(missing.node))` after the group.

## Request Flow (Chat)

```
Browser prompt -> POST /api/session/:id/prompt -> SessionPrompt.prompt
  revert.cleanup
  createUserMessage: agents.get or defaultInfo, currentModel, variant, File/MCP/Image materialization via Read tool + LSP, plugin chat.message, image.normalize
  sessions.touch, background generateTitle (small model stream), permissions -> setPermission
  loop(sessionID) -> SessionRunState.ensureRunning
    runLoop(sessionID) while true:
      status busy, msgs = filterCompacted, latest(), hasToolCalls, overflow check
      tasks pop -> subtask or compaction branch
      getModel, usable tokens window applyTokenWindow, sys + instructions + modelMessages
      processor.create({ assistantMessage, sessionID, model }) -> ProcessorHandle
      SessionTools.resolve(agent, session, model, handle, ...) -> tools (plugin + MCP + registry + truncate + IS_TOON hint)
      handle.process({ user, agent, system, messages(+MAX_STEPS if isLastStep), tools, model })
        SessionProcessor: LLM.stream(streamInput) where LLM = LLM.Service (llm.ts + ai-sdk.ts vs native-runtime.ts gate)
        stream events -> handleEvent (reasoning, tool-input-start/delta/end, tool-call/result/error, text-start/delta/end, step-start/finish, finish)
        dual-write V2 events if experimentalEventSystem, doom-loop permission ask, image normalize, snapshot patch
        .retry(SessionRetry.policy) .catch(halt) .ensuring(cleanup)
      result stop -> memory extract forkDetach, compact -> compaction.create, continue
    compaction.prune fork, return lastAssistant
```

LLM runtime selection lives in `packages/server/src/session/llm` and `packages/llm/src/route`:

- `llm.ts` is the only file that knows auth, config, model resolution, and runtime selection.
- `llm/ai-sdk.ts` adapts `streamText` fullStream into shared `LLMEvent`s (default path).
- `llm/native-request.ts` lowers session input into `LLM.request(...)`.
- `llm/native-runtime.ts` gates native route support and calls `LLMClient.stream` (opt-in `OPENCODE_EXPERIMENTAL_NATIVE_LLM`).

Both runtimes converge on the same `LLMEvent` stream consumed by `SessionProcessor.handleEvent`.

`packages/llm` decomposition: `Protocol` (body + stream state machine) + `Endpoint` (URL) + `Auth` (per-request signing) + `Framing` (SSE vs AWS event-stream) composed via `Route.make`. Provider facades (`OpenAI.configure`, `Azure.configure`, etc.) configure route fields then call `.model(id)`; model capability metadata stays outside the package.

## Session and Message Model

Persisted in SQLite (`packages/db/src/database/schema.gen.ts` + `packages/server/src/session/session.ts` schemas):

- `session` table (legacy + v2 mix): `id`, `project_id`, `workspace_id`, `parent_id`, `slug`, `directory`, `path`, `title`, `version`, `share_url`, summary fields, `metadata`, `cost`, token columns, `revert`, `permission`, `agent`, `model`, timestamps.
- `session_message` + `message` + `part` + `session_context_epoch` + `session_input` + `todo` + `event` (event sourcing) and indexes.

Runtime types (`Session.Info`, `SessionV1.User/Assistant`, `SessionV1.ToolPart`) live in `packages/server/src/session/session.ts` (1164 lines) and `packages/db/src/session/schema.ts`. `isDefaultTitle` matches `New session - <ISO>` / `Child session -`, `getForkedTitle` bumps `(fork #N)`.

Token windowing (`applyTokenWindow`) estimates tokens as `chars/4`, finds the last compaction summary, and trims from the oldest message without crossing the summary.

## Config Hierarchy

`packages/server/src/config/config.ts` (706 lines). Loading order (later wins):

1. `auth` well-known remote config: `url/.well-known/opencode` -> `remote_config` via `substituteWellKnownRemoteConfig`.
2. `Global.Path.config/config.json`, `opencode.json`, `opencode.jsonc` (global).
3. Extra `diveeagent/diveeoi.jsonc` paths (DiveeOI override).
4. `Flag.OPENCODE_CONFIG` explicit file.
5. Per-worktree `.opencode` discovered via `ConfigPaths.files/directories`.
6. `Flag.OPENCODE_CONFIG_DIR` files.
7. `Flag.OPENCODE_CONFIG_CONTENT` JSON.
8. Active account org config (`accountSvc.config`) -> `processed as global`.
9. `managed/managedConfigDir` + macOS MDM `.mobileconfig`.
10. `mode -> agent` expansion, `Flag.OPENCODE_PERMISSION` JSON, `tools -> permission` mapping, `username` fallback, `autoshare -> share`, flag disables for `autocompact/prune`.

`plugin_origins` tracks winning `spec + source + scope` and is deduplicated by `ConfigPlugin.deduplicatePluginOrigins`. `ConfigVariable.substitute` expands `$VAR`, `~/`, and virtual paths. Global config is cached via `cachedInvalidateWithTTL(Duration.infinity)` and can be `invalidate()`d by `updateGlobal`.

Per-directory state is stored in `InstanceState` (per-project `ScopedCache`); the file is watched and `ConfigMarkdown.files` resolves `@./path` includes for prompt parts.

## Database

`packages/db/src/database/database.ts` (76 lines):

```
EffectDrizzleSqlite.makeWithDefaults() -> makeDatabase
PRAGMA journal_mode=WAL synchronous=NORMAL busy_timeout=5000 cache_size=-MB*1000 mmap_size=*2 foreign_keys ON wal_checkpoint PASSIVE
DatabaseMigration.apply(db)
path() = Flag.OPENCODE_DB -> :memory:/absolute/join(Global.Path.data, ...) else channel-aware opencode.db vs opencode-{channel}.db
withDbQueryTimeout uses adaptive dbQueryTimeoutMs -> timeout -> "DB query timeout"
```

Schema is generated by Drizzle Kit into `schema.gen.ts`. Migrations live in `packages/db/src/database/migration/` (35+ files `familiar_lady_ursula`, etc.). The generic Effect adaptation lives in `packages/effect-drizzle-sqlite/src/effect-sqlite/session.ts`: `EffectSQLiteSession` bridges `SqlClient` to Drizzle, including nested savepoint transactions (`savepoint effect_sql_N`) with `uninterruptibleMask` and deferred-constraint commit/rollback handling.

Conditional imports (`#sqlite`, `#pty`, `#fff`) resolve to `*.bun.ts` vs `*.node.ts`.

## Memory System

`packages/memory` (schema 163, graph 465, indexer 510, memory 346):

- `MemoryIndexSchema` tables: `memory_nodes(id PK type title content session_id created updated confidence tags path + project_id/root/file_exists)`, `memory_links(source_id target_id PK link_type created)`, `session_memories(session_id PK root_node_id FK)`, `memory_projects(id PK root_path unique name memory_dir last_scanned is_active node_count)` plus 8 indexes.
- `IndexerService` (21 methods) uses `sql` templates (not `?` placeholders), `INSERT OR REPLACE` transactions, recursive CTEs for `getSessionNodes`/`getLinkedNodes` (depth 2 with bidirectional edges), `Deferred` `ready` for non-blocking init, `registerProject` with a path hash, `verifyFileExists` marking `file_exists`, orphan detection.
- `GraphService` scoring: `TYPE_WEIGHTS` decision 1.0 -> session 0.4, 30-day `exp(-LN2*age/halfLife)` recency 0.25, link density capped 10 at 0.20, type 0.20, confidence 0.10, session boost binary 0.10, tag overlap/3 at 0.15, `depthPenalty=1-exp(-depth*lambda)`, `seedMultiplier=1.2`, clamp `[0,1]`. Traversal is level-order BFS (parallel fetch per depth) for shortest-path depth, then `recall` filters by `types/minConfidence/timeRange`, sorts by score, trims to `maxNodes` and keeps edges whose endpoints are both in the top set. `getClusters` is BFS connected components.
- `MemoryService` (18 methods) forks or blocks `indexer.initialize` based on `features.nonBlockingInit`, guards session races with `PartitionedSemaphore(1)` per `sessionId`, materializes wikilinks + explicit links, non-blocking helpers `waitForIndexer/isIndexerReady`.

Layer composition: `SessionMemoryIntegration.node` -> `Session.node` + `Memory.node`; `ToolRegistry.node` includes `Memory.node`, `SessionMemoryIntegration.node`, `MemoryScheduler.node`; `createRoutes` adds `provideMerge` for both after the `app` group so they are visible to outer handlers. `MemorySchedulerLive` starts its background fiber at build time and must be provided exactly once.

## MCP

`packages/server/src/mcp/index.ts` (939 lines):

- 3 transports: `StdioClientTransport`, `StreamableHTTPClientTransport` (preferred), `SSEClientTransport` (fallback), each with `withTimeout` and `acquireUseRelease` ownership.
- Remote connect handles `mcp.oauth === false` bypass, `invalid URL` failed state, `UnauthorizedError` -> `needs_client_registration` vs `needs_auth` with toast events, storing `pendingOAuthTransports`.
- `create(key,mcp)` respects `enabled === false -> disabled`, fetches `McpCatalog.defs` if tools capability is advertised, handles interrupted failures.
- `watch` registers `onclose` cleanup, `LoggingMessage -> serverLog`, `ToolListChanged -> refetch defs -> ToolsChanged event`.
- `ToolRegistry` style: `McpCatalog.convertTool` sanitizes `clientName_toolName`, `collectFromConnected` fans out via `McpCatalog.fetch`.
- OAuth: `startAuth` picks `effectiveRedirectUri` (`redirectUri` else `callbackPort` else default), `McpOAuthCallback.ensureRunning`, random 32-byte state hex, `McpOAuthProvider` matching the MCP spec, capturing `onRedirect` URL, `UnauthorizedError` + `capturedUrl` -> pending, `authenticate` opens the URL (`open` npm) or falls back to direct connection, `finishAuth` calls `transport.finishAuth(code)`.

## Auth

`packages/api/src/cors.ts` (54 lines): allows `http://localhost:`, `http://127.0.0.1:`, `oc://renderer`, `tauri://localhost`, `*.opencode.ai`, private RFC1918 + CGNAT 100.64/10, or explicit `opts.cors`. `sameHost` compares `new URL(origin).host === host`.

Server auth is simply `ServerAuth.Config` with `username: opencode, password: Option<string>`. `authorizationLayer` vs `authorizationRouterMiddleware` split handles HttpApi vs raw router; `JwtAuth` is present for the v2 API.

## Permissions

`packages/server/src/permission/index.ts` (234 lines):

- Current rule is `evaluate(permission, pattern, ...rulesets)` -> last matching rule via `Wildcard.match`, else `ask`.
- `MCP` and `ToolRegistry` integrations use `external_directory` special handling (expand `~/,$HOME`), `read` denies `*.env` but allows `*.env.example`.
- `ask(input)` loops patterns; `deny` -> `DeniedError`, `allow` skips, else `ask` creates `PendingEntry{info, Deferred}`, publishes `permission.asked`, awaits deferred; finalizer fails all pending with `RejectedError` on dispose.
- `reply(input)` publishes `permission.replied`; `reject` can carry `CorrectedError` feedback and rejects siblings in the same session; `always` pushes `approved` allow-rules for each `info.always` and wakes siblings that now evaluate to `allow`; `once` does not.
- `fromConfig(permission)` expands object-valued `Record<string, Record<string,Action>>` and `~`/`$HOME`, `disabled` detects `allow: deny` at global `*`.

Built-in agents (`packages/server/src/agent/agent.ts`, 521 lines): `build` (primary, full), `plan` (no edit / task general deny, allow `.opencode/plans/*.md`), `general` (deny todowrite), `explore` (deny * then allow read/grep/glob/bash/webfetch/websearch + readonlyExternalDirectory), `research`, `subthinker`, `code-reviewer`, `compaction/title/summary` hidden. Merged: `defaults + Permission.fromConfig(cfg.permission) -> per-agent overrides + user rules -> Truncate.GLOB allow`. `generate` uses `PROMPT_GENERATE` via `generateObject` (or `streamObject` for openai oauth) with `existing.map(name)` dedup instruction.

## Tools

`packages/server/src/tool/registry.ts` (521 lines):

- 14 built-ins: `shell`, `read`, `glob`, `grep`, `edit`, `write`, `task`, `webfetch`, `todo`, `websearch`, `db-export`, `question`, `invalid`, `truncate`.
- 10 memory tools: `memory-retrieve/create/update/delete/link/consolidate/stats/toggle/extract/extractStatus`.
- Lazy tools: `skill`, `apply_patch`, `lsp` (if `experimentalLspTool`), `plan_exit` (if `experimentalPlanMode && cli`).
- `custom` scans `{tool,tools}/*.{js,ts}` via `Glob.scanSync`, imports as `file://` (Windows-safe), picks `ToolDefinition` shapes, `fromPlugin` converts Zod `args` -> `z.object` -> `z.toJSONSchema` with `zodMetadataRegistry` + legacy raw JSON-schema path, bridging `ask` through `EffectBridge` (pinned to directory/worktree).
- `Ctx7` tools injected from `getCtx7Defs()`.
- `state` lives in `InstanceState` with per-dir config; `all()` concatenates `builtin + lazy (cached) + custom`; `tools(model)` filters `websearch` via `webSearchEnabled(opencode|exa|parallel)`, mutates `edit/write vs apply_patch` based on `gpt-` model, applies `plugin trigger tool.definition`, injects task description for `task`.
- `Tool.define` handlers resolve eagerly during layer build (so `LayerNode` wiring failures surface at boot).

`packages/server/src/tool/shell.ts` (690 lines) owns the `shell` tool:

- Tree-sitter `bash` + `powershell` wasm (`web-tree-sitter`) parsed via `parser()` lazy, `parts/source/commands/unquote/home/envValue/auto/expand/provider/dynamic/prefix` helpers, `pathArgs` respecting PowerShell flags `FLAGS/SWITCHES`, `preview/tail` truncations.
- `cmd(shell,command,cwd,env)` uses `powershell -NonInteractive` vs `ChildProcess.make(command, [], { shell })`.
- `resolvePath` handles `cygpath -w` for win32 posix paths, `argPath` picks `expand` vs `home/unquote` then `provider`, `collect` builds `Scan{dirs,patterns,always}` checking `FILES/CMD_FILES`, calling `fs.isDir` and `containsPath`.
- `run(input, ctx)` builds `StreamLimiter` from `config.tool.burst`, `trunc.limits()`, buffers tail-limited output in `Chunk[]` bounded by `maxBytes*2`, streaming through `handle.all` decoded text with rate limiting and `trunc.write` to temp file on overflow, metadata streaming via `ctx.metadata`, timeout race (`exit/abort/timeout+100`), `shell_metadata` block, truncated notice.

## Frontend

`packages/app` — SolidJS SPA.

- Entry `packages/app/src/entry.tsx` (182 lines): `getLocale` via `navigator.languages` zh prefix else en, `DEFAULT_SERVER_URL_KEY diveeoi.settings.dat:defaultServerUrl` with localStorage getter/setter, `notify` gated by `Notification` permission + `visibilityState/hasFocus`, `getCurrentUrl` (`DEV ? VITE_DIVEEOI_SERVER_HOST:PORT : location.origin`), `getDefaultUrl` (stored else current), `authFromToken` from `?auth_token`, server `Http { url, username/password }`, `Platform` (web, version, openLink/back/forward/restart/notify/getDefaultServer), optional `Sentry.init` filtering `Breadcrumbs` and prod `GlobalHandlers`, render `PlatformProvider -> AppBaseProviders -> AppInterface` into `#root`.

- `packages/app/src/app.tsx` (500 lines): `SessionRoute` handles `newLayoutDesigns` draft autocreation, three scoped layouts (`SelectedServerLayout` keyed on globally selected server, `DraftServerLayout` keyed on draft's target server, `DraftRoute` via `DraftTab` lookup), `SharedProviders` (settings + newLayout font/class toggle + Command/Highlights), `ServerScopedShell` (`PermissionProvider+LayoutProvider+NotificationProvider+ModelsProvider+GlobalPrefSync+Layout`), per-server persistence via `ServerProvider` (see `context/server.tsx`). `ConnectionGate` loops `checkServerHealth(http)` with blocking 10s timeout then background, offers `ConnectionError` switcher for other servers (`ServerConnection.key`). Routes: `/login`, `/register`, `/` (Home), `/:dir -> DirectoryLayout -> session/:id? (SessionRoute)`, `/new-session (DraftRoute)`. `TabsProvider` manages draft+session tabs; `WslServersProvider` is present.

- State: `createSimpleContext` pattern (`get value`, `setStore`, `store`) reused for `models`, `permission`, `settings`; `GlobalPrefSync` (global store) merges server prefs (`serverSDK().scope`) with 500ms debounce, avoiding echo loops via `syncingFromServer`.

- Routing: `@solidjs/router` `Navigate` on `/new-session` fallback, `DirectoryLayout` resolves `InstanceState` per directory.

See `packages/app/FRONTEND-MAP.md` for the file-by-file map.

## UI and Theme

`packages/ui` (197+ `src/components`, 81 `src/v2`, `src/pierre` file viewer, `src/theme`):

- Components wrap Kobalte primitives (e.g. `button.tsx` wraps `@kobalte/core/button` with `data-component/variant/size` attributes and icon slot).
- V2 is a parallel redesign (`button-v2`, etc.); migration is opt-in via `settings.general.newLayoutDesigns()` toggling `BodyDesignClass`.
- Theme `packages/ui/src/theme/context.tsx` (370 lines): `ThemeProvider` holds `themes: Record<string,DesktopTheme>` (with `oc-2` from `oc-2.json`), per-theme variant CSS via `resolveThemeVariant/themeToCss` + `resolveThemeVariantV2/themeV2ToCss`, `applyThemeCss` writes `:root { color-scheme; --text-mix-blend-mode; css; v2 }` into `#oc-theme`, updates `dataset.theme/colorScheme` and `meta[name=theme-color]`. State: `themeId`, `colorScheme(system/light/dark)`, `mode`, `previewThemeId/Scheme`, `loads` dedup map via `import.meta.glob("./themes/*.json")`, `load(id)` promise, cross-tab `storage` listener, media query listener for `system`, `setTheme/colorScheme` with write-through to localStorage, preview/commit/cancel transaction, `registerTheme`, built-in `names` map of 40 themes.

`packages/ui/DESIGN.md` is stale by the fixture test; treat `context.tsx` as source of truth.

## Config Files

See `packages/server/src/config/config.ts` for the exact precedence list above. The on-disk shape is defined in `packages/db/src/v1/config/config.ts` (`ConfigV1.Info`): `provider`, `model`, `agent`, `mcp`, `lsp`, `plugin`, `permission`, `command`, `compaction`, etc. Variables are substituted by `ConfigVariable.substitute` (supports `${VAR:-default}` etc.) before lenient schema decoding.

## Adaptive Resources and Observability — The Optimization Core

This is DiveeOI's headline change: a **live, cross-platform adaptive system** that makes the server survive from a 4GB laptop to a 64GB workstation without tuning. Full spec in [`optimization.md`](optimization.md) and `plans/Optimization_1.0/OPTIMIZATION_PLAN.md`.

**Detection** (`packages/db/src/adaptive/detect.ts`, 114): `Linux /proc/meminfo (MemAvailable||MemFree)`, `macOS sysctl hw.memsize + vm_stat (free+inactive)*4096`, `Windows os.freemem`, always wrapped with a `fallback 4096/1024/ncpu` so the service never dies.

**Profiles** (`profiles.ts`, 86): `comfortable (4096 MB free & 0.5 ratio) / balanced (1024 & 0.2) / constrained (512 & 0.1) / critical`. Each drives 13 `AdaptiveTargets`:

| target | comfortable | balanced | constrained | critical |
|--------|-------------|----------|-------------|----------|
| rssTargetMB | 700 | 500 | 350 | 250 |
| heapTargetMB | 400 | 300 | 200 | 150 |
| gcIntervalMs | 60000 | 30000 | 15000 | 8000 |
| maxToolConcurrency (≤cpuCores) | 8 | 4 | 2 | 1 |
| maxLLMStreamBuffer | 200 | 100 | 50 | 25 |
| maxSSEQueueSize | 1000 | 500 | 200 | 100 |
| maxWSConnections | 1000 | 500 | 200 | 100 |
| ptyTicketCapacity/TTL | 5000/120s | 2000/60s | 500/30s | 200/15s |
| cacheTTLMs | 30m | 10m | 2m | 1m |
| sqliteCacheMB | 128 | 64 | 16 | 8 |

`computeTargets` caps `rss=min(mult, total*0.12)` and `heap=min(mult, total*0.07)`.
`interpolateTargets(current, next, 0.3)` smooths updates when the profile does not flip.

**Live service** (`service.ts`, 68): `AdaptiveResourceService { targets, profile, lastSystem: Refs + getCurrentTargets/Profile/subscribe }`. Seeds from `detectSystemResources` at startup, then a `forkScoped` `Effect.forever { sleep("90 seconds"); detect; fresh = compute; prev = Ref.get; target = (freshProfile===prev ? interpolate 0.3 : fresh); Ref.set + notify(subs) + logInfo("Adaptive targets updated") }`. Subscribers are an in-memory `Set`.

**GC + emergency path** (`packages/server/src/main.ts:29-61`): its own `ManagedRuntime(AdaptiveResourceDefaultLayer)` (not AppLayer) loops `sleep gcIntervalMs -> if rss > 1.5*rssTarget -> Bun.gc(true) + warn "Emergency GC" -> if profile critical -> warn "degraded" -> Bun.gc(true)+debug`. The `1.5x` guard is the self-heal.

**Seams** (`hooks.ts`, 34): `useAdaptiveTargets(f)` for ephemeral queues/streams, `makeAdaptiveLayer(makeLayer)` for long-lived caches/DB layers (self-provides `AdaptiveResourceDefaultLayer` so `RIn` stays clean).

**What it drives** (all bounded adaptively): PTY ticket `Cache capacity/TTL` via `makeAdaptiveLayer`, `websocket-tracker.ts:add` + `handlers/event.ts + global.ts` `Queue.bounded(maxSSEQueueSize)` via `useAdaptiveTargets`, `runner/llm.ts` `Stream.buffer(maxLLMStreamBuffer)`, `tool/registry.ts` `Semaphore(maxToolConcurrency)`, `database.ts` `PRAGMA cache_size/mmap_size`, `message-v2.ts + storage.ts` lazy pagination + transparent GZIP (>10KB) with zero deletion, `scripts/build.ts` binary ceilings `--memory-limit=1200 --max-old-space-size=512`, `profiler` sampling (`DIVEEOI_PROFILER=1`) and `dev/monitor.ts` `DevMonitorSnapshot { rssMB, heapMB, adaptive{profile,profileChanged,rssTargetMB,heapTargetMB,gcIntervalMs,rssDeviationPct,heapDeviationPct} }` every 60s.

The only user-visible stall — blocking `extractSessionMemory` at loop exit/compaction stop — was fixed by `Effect.forkDetach(... extract ...).catch(logError)` at `prompt.ts:1263/1294` (see `FINDINGS_AUDIT.md H2/H3`).

`sst-env.d.ts` exposes SST deployment env (`SST_STAGE`, `SST_APP`).

## Extensibility

- **Skills** (`packages/server/src/skill/discovery.ts`) discover `.opencode/skill(s)/` dirs and are listed via `Skill.Service`; `Discovery.node` participates in the agent defaults.
- **Plugins** via `packages/plugin`: a plugin exports `tool` map of `ToolDefinition { description, args(zod), execute(args, ctx{ask,directory,worktree}) }`. The registry imports them from either file-system `{tool,tools}/*.{js,ts}` or `Config.plugin` entries, converts args via `zodJsonSchema`/`legacyJsonSchema`, and provides them as `Tool.Def` with `EffectBridge` `ask` pinning.
- **Providers** via `@diveeoi/db/provider` and `packages/llm/providers/*`. A new OpenAI-compatible deployment is one `Route.make({ provider, protocol: OpenAIChat.protocol, endpoint: Endpoint.path(...), auth, framing: Framing.sse })` call.

## Removed Pieces

`AGENTS.md` warns that `@diveeoi/plugin/tui` exists but is dead code, and `src/plugin/tui`, `src/config/tui*`, `src/cli`, tui tests were deleted. Treat any remaining `tui-` references as historical.
