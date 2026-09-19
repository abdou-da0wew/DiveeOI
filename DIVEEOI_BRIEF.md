# DiveeOI Brief — The Super Detailed Explanation

> Fork of [OpenCode](https://github.com/anomalyco/opencode) that keeps only the web UI + server. No TUI.

---

## 1. One Sentence

DiveeOI is a **self-hosted AI development web app**. You point it at a project directory, chat with an LLM agent in your browser, and the agent reads/writes your files, runs your shell, and streams results back — all persisted in local SQLite.

## 2. Why It Exists

OpenCode originally shipped a terminal UI (TUI) alongside the web pieces, built on `OpenTUI`. The TUI imposed a separate rendering and keying surface, own config subtree (`tui*`), and the `src/cli` glue. DiveeOI keeps the useful half — **the web SPA + the Effect HTTP server + SQLite** — and removes the TUI so:

- the code is smaller and simpler to reason about,
- the provider/runtime layers can evolve without a diverging TUI contract,
- deployments are a single web listener (no special TTY host).

The diff is deletions: `src/plugin/tui`, `src/config/tui*`, `src/cli`, tui tests, `tui-` references; everything else is preserved and extended (memory graph, adaptive resources, ctx7).

## 3. For Whom

- **You, the solo developer who runs your model locally or via any OpenAI-compatible endpoint** and wants your agents to **act on your checkout** without giving a third-party site your repo.
- **Small teams who self-host one DiveeOI per workspace** and share config via `.well-known/opencode` rather than a cloud control plane.
- **Researchers who extend tools or MCP servers** — the tool/MCP/skill seams are deliberately small and explicit, so adding a custom tool is a local file under `tools/*.ts` or a config `plugin`.

Non-goals: multi-tenant hosting, cloud sync of `opencode.db`, chat SaaS. DiveeOI is intentionally a **single-node app**.

## 4. Mental Model in 30 Seconds

```
browser (SolidJS)  <-- SSE/WebSocket + fetch -->  Bun HTTP server (Effect)
                                            |-> SessionPrompt
                                            |-> SessionProcessor
                                            |-> LLM (AI SDK default / native opt-in)
                                            |-> ToolRegistry (17 + MCP tools)
                                            |-> Permission (ask/allow/deny)
                                            |-> Config (hierarchical merge)
                                            |-> SQLite via Drizzle + Effect adapter
                                            `-> MCP clients (stdio + remote + OAuth)
```

A session is **event-sourced** (`event` table) and **durably stored** (`session`, `session_message`, `message`, `part`). Prompting writes a `User` message + `parts`, then the server loops:

```
while not stopped:
  build system + instructions + modelMessages from DB
  resolve tools (agent permission -> ToolRegistry)
  LLM.stream(streamInput)    // default: ai.streamText, opt-in: LLMClient.stream
  handleEvent(stream events) // text/reasoning/tool-input/call/result, step-finish
  if tool-calls pending -> dispatch locally (permission-gated) and loop
  if compaction needed   -> compact context window
  if content-filter      -> surface error
  else                   -> done
```

Tokens and cost are computed from the provider's `Usage` plus cached-token accounting for Anthropic/Bedrock.

## 5. How to Think About Each Package

| Package | In one line | What it owns |
|---------|-------------|--------------|
| `server` | the only stateful service | HTTP bootstrap, 50+ Effect layers, session lifecycle, MCP, permissions, plugins, git/worktree, snapshot diffs, config resolution |
| `db` | persistence + provider glue + session runner | Drizzle schema + 35+ migrations, SQLite dual driver, session store/projector/coordinator, 20+ AI SDK adapters, 18 tool impls, `LayerNode`, `InstanceState`, FS/pty abstractions |
| `api` | typed HTTP surface | 21 `HttpApi` groups + handlers + CORS + auth middleware + cursor pagination + OpenAPI |
| `app` | browser shell | SolidJS routing, 40+ `createSimpleContext` providers, connection gate, per-server shell, draft/new-session split, `GlobalPrefSync` |
| `ui` | component library | 197 presentational components + 81 `v2` redesign peers, `ThemeProvider` with 40 themes, pierre virtualized file viewer |
| `llm` | provider core | Schema model, `Protocol` + `Endpoint` + `Auth` + `Framing` decomposition, `Route` composition, provider facades, tool-runtime dispatcher |
| `memory` | knowledge graph | SQLite indexer + graph scorer (8-factor weighted) + LLM extractor + consolidation scheduler, per-session semaphore |
| `sdk` | client | v1 fetch helpers + v2 generated `hey-api` client from `/openapi.json` |
| `plugin` | extension | `ToolDefinition { args: Zod, description, execute(ctx)->{output,title,metadata,attachments} }` |
| `effect-drizzle-sqlite` | adapter | `EffectSQLiteSession` nesting via savepoints, plus Drizzle shims |
| `effect-sqlite-node` | adapter | Node `better-sqlite3`-style `SqlClient` for effect |
| `http-recorder` | test | ordered cassette per scenario, binary body base64, `RECORD=1` guard |
| `profiler` | instrumentation | `AsyncLocalStorage` call-tree, gauges, sampling, `Snapshot` aggregates |
| `identity/script` | assets & build | logos/icons and `build.ts` (turbo wrapper) |

## 6. End-to-End Flow — A Real Prompt

Trace a user sending `Fix the CORS bug for Tailscale` into a project at `/home/you/repo`:

1. **UI capture** — `PromptInput` in `app/src/components/prompt-input` resolves attachments (dragged files, `@workspace/file` mentions) via `SessionPrompt.resolvePromptParts`. A `file://` part executes the `Read` tool against the chosen path; an MCP `resource://` calls `mcp.readResource`; an image is `image.normalize`d.
2. **Persistence** — `SessionPrompt.createUserMessage` writes `SessionV1.User { role:"user", agent:"build", model:{providerID,modelID,variant}, system?, format?, time }` plus `Part[]` (synthetic `Called the Read tool...` headers + real content) into SQLite via `Session.updateMessage/updatePart`.
3. **Side effects** — `sessions.touch` bumps `time_updated`, permissions for ad-hoc `tools: Record<string,bool>` are `setPermission`, `generateTitle` (small-model) fans out in a detached fiber if the title is still `New session - <ISO>`.
4. **Loop** — `SessionPrompt.loop -> SessionRunState.ensureRunning -> runLoop`:
   - loads `msgs = filterCompacted`, finds `latest()` `{user, assistant, finished, tasks}`, checks `hasToolCalls` excluding orphans.
   - applies `applyTokenWindow(msgs, usable tokens)` (chars/4, respects last compaction boundary).
   - pops either a `subtask` -> `handleSubtask` (spawns `task` tool) or a `compaction` -> `compaction.process`.
   - creates `Assistant` message, `processor.create({assistantMessage, sessionID, model})` captures an initial `Snapshot`, and resolves tools via `SessionTools.resolve`.
   - calls `handle.process({ user: lastUser, agent, system: sys.system+instructions, messages: modelMsgs, tools, model })`.
5. **LLM streaming** — inside `SessionProcessor`, `llm.stream(streamInput)` is either:
   - `ai-sdk.ts` path: `streamText({ model, messages, tools, system, params }).fullStream -> events -> handleEvent`
   - `native-runtime.ts` path: `LLM.request({ model: route.model, system, messages, tools, params }) -> LLMClient.stream -> frames -> same events`
   Events partition into `text-start/delta/end`, `reasoning-*`, `tool-input-start/delta/end`, `tool-call`, `tool-result/error`, `step-start/finish`, `finish`. `handleEvent` dual-writes V2 events when `experimentalEventSystem`, enforces `doom_loop` (3 identical tool inputs in a row -> `permission.ask("doom_loop")`), normalizes image parts, snapshots patches, and publishes `Session.Event.Error` on provider failures. Backpressure uses `Truncate` + `StreamLimiter` + temp file spill.
6. **Tool dispatch** — The session runner interprets `tool-call` events. Each tool's `execute(args, ctx)` receives `{ agent, sessionID, messageID, callID, abort signal, extra, ask, metadata }`, enforced through `Permission.ask`. `Shell`'s call is tree-sitter parsed, `Scan{dirs,patterns,always}` computed via `argPath`, permissioned via `external_directory + ShellID.ToolID`, and finally executed via `ChildProcessSpawner.spawn` with streaming `handle.all` decoding.
7. **Retry & compaction** — Any streaming failure goes through `SessionRetry.policy` (provider-specific, `max 3`, exponential backoff, `permission` aware). `step-finish` carries `Usage` and triggers `isOverflow` -> `needsCompaction`. After each turn `summary.summarize` and eventual `compaction.prune` are `forkIn(scope)`.
8. **Stop conditions** — The loop exits when the last assistant has `finish` not `tool-calls` and there are no pending tool parts, or `stop -> memory extract forkDetach`, or `content-filter -> error`, or `compact`.

All of the above uses `Effect.gen` spawning rather than callback hell, and all durable transitions are committed through SQLite so a mid-stream crash recovers as `interrupted: true` tool errors.

## 7. Layer Graph — The Single Page to Understand

The canonical graph lives in `packages/server/src/server/routes/instance/httpapi/server.ts:createRoutes` and `packages/db/src/effect/layer-node.ts`:

```
app = LayerNode.group([Database, FSUtil, Config, Session, SessionProcessor, LLM, Agent, Permission, ToolRegistry, MCP, LSP, Plugin, ...55 nodes])

createRoutes = Layer.mergeAll(rootApi, eventApi, ptyConnectApi, instanceApi, serverApi, doc, theme, memoryExtract, ui)
               .pipe(provide [errorLayer, compression, corsVaryFix, fence, cors(), MoveSession, HttpServer, AdaptiveResource])
               .pipe(provide  LayerNode.buildLayer(app))
               .pipe(provideMerge LayerNode.buildLayer(SessionMemoryIntegration.node))  // visible outside app
               .pipe(provideMerge LayerNode.buildLayer(ToolRegistry.node))            // eager tool defines need it
               .pipe(provide CorsConfig, Observability)

buildLayer(node): memo + cycle detection -> group ? mergeAll : Layer.provide(impl, deps)
```

The `provideMerge` after the group is the deliberate exception — `Layer.provide` inside a group is consumed by `mergeAll` and not visible outside; that seam is how `Memory` and `ToolRegistry` become available to both HTTP handlers and the per-instance runner without being duplicated.

## 8. Data Model

### SQLite ( `packages/db/src/database/schema.gen.ts` + server overlay )

- **Sessions**: `session` (legacy wide table) plus `session_message` / `message` / `part` (normalized). Indexes on `(session_id,time_created,id)`, `type/seq`, etc.
- **Event sourcing**: `event_sequence(aggregate_id, seq, owner_id)` plus `event(id, aggregate_id, seq, type, data text)`.
- **Memory**: `memory_nodes`, `memory_links`, `session_memories`, `memory_projects` (see §9).
- **Other**: `workspace`, `project`, `project_directory`, `account`, `control_account`, `credential`, `permission`, `todo`, `session_context_epoch`, `session_input`, `session_share`, `data_migration`.

Pragmas set on every open: `journal_mode WAL, synchronous NORMAL, busy_timeout 5000, cache_size -MB*1000, mmap_size MB*2*1024*1024, foreign_keys ON`.

### Memory Graph ( `packages/memory` )

- **Schema**: `MemoryNodeID / SessionID / ProjectID` branded; `MemoryType { preference decision pattern entity error fact constraint session }`; `LinkType { references see_also contradicts supersedes }`; `MemoryNode { id,type,title,content,tags[],sessionId,created,updated,confidence,path,projectId/root/fileExists? }`; `MemoryLink { sourceId,targetId,type,created }`.
- **Index**: `IndexerService` with `sql` templates and recursive CTE traversal (bidirectional depth 2, bounded), `Deferred<ready>` for non-blocking boot, `registerProject` via `hashProjectPath`.
- **Score**: 8-factor pure function `scoreNodePure(node, context{now, queryTags, currentSession, seedNodes}, depth, totalDegree)` — `0.25*recency + 0.20*linkDensity + 0.20*typeWeight + 0.10*confidence + 0.10*sessionBoost + 0.15*tagOverlap` (sum 1.0), `* (seed? 1.2:1.0)`, `- (1-exp(-depth*lambda))`, clamp `[0,1]`, where recency is `exp(-ln2*age/30d)` (true 30-day half-life), link density `min(degree/10,1)`, type weights `decision 1.0 -> session 0.4`, tag overlap `overlap/3`.
- **Traversal**: level-order BFS, parallel `getNode + getLinks + getBacklinks` per frontier node, dedup edges via `JSON.stringify([src,tgt,type])`. `recall` is `traverse(...).types/confidence/timeRange filter -> score-desc -> slice maxNodes -> retain only edges between top nodes`.

### Sessions as Types

`packages/db/src/session/schema.ts:SessionV2.Info { id, parentID, projectID, agent, model Ref, cost, tokens{input/output/reasoning/cache{read/write}}, time{created/updated/archived}, title, location, subpath }` and `packages/server/src/session/session.ts:Session.Info` extends it with `directory/path, slug, version, share, summary, permission, revert, metadata`.

`SessionProcessor` maintains `ProcessorContext { assistantMessage, sessionID, model, toolcalls Record<string, ToolCall{assistantMessageID?, partID, done Deferred}>, shouldBreak, snapshot, blocked, needsCompaction, currentText, reasoningMap }` across the turn. Everything that crosses the LLM boundary is a `SessionV1.ToolPart` (`pending->running->completed|error`), migrated to V2 `SessionEvent.*` via dual-write.

## 9. Config — What Can Be Tweaked

Order in `packages/server/src/config/config.ts:loadInstanceState` (last wins): well-known remote `.well-known/opencode` -> global `config.json / opencode.json(c)` -> `diveeagent/diveeoi.jsonc` -> `Flag.OPENCODE_CONFIG` explicit -> per-worktree `.opencode` discovery -> `ConfigPaths.directories` loop (ensures `.gitignore`, installs `npm` deps) -> `Flag.OPENCODE_CONFIG_CONTENT` -> active account org config -> `managed/managedConfigDir + macOS MDM` -> derived `mode->agent` + `Flag.OPENCODE_PERMISSION` + `tools->permission` + `username` fallback + `autoshare->share` + compaction flags.

Useful keys: `provider` (per-provider `apiKey` as `$ENV`), `model` (global default `provider/model`), `agent` (per-agent `model/prompt/permission` overrides), `mcp: Record<string, {type:"local"|"remote", command:[], cwd?, oauth?, headers?, timeout?}>`, `permission` (`Record<string, Action|Record<string,Action>>` with wildcards), `compaction {auto, prune}`, `experimental {openTelemetry, mcp_timeout, lsp_tool, plan_mode, continue_loop_on_deny }`, `snapshot`, `tool.burst {max_bytes_per_second, window_ms, strategy}`.

Substitution via `ConfigVariable.substitute` supports `${VAR:-default}` and `~/` expansion before lenient `ConfigV1.Info` decode. Global file is auto-created with `"$schema": "https://opencode.ai/config.json"` on first access.

## 10. Permissions and Safety

- Evaluate is last-wins: `evaluate(permission, pattern, ...rulesets) -> findLast-matching` with `Wildcard.match`; no match -> `ask`. Tool width (`edit vs write vs apply_patch`) is normalized to `edit` for the deny check.
- Default `Permission.fromConfig` grants `* allow`, `doom_loop ask`, `external_directory ask` (plus whitelisted `Truncate.GLOB`, skill/reference dirs), `question deny`, `read allow` except `*.env ask`.
- Agents narrow this differently: `explore/research` deny `*` then allow only search+read, `plan` allows only `.opencode/plans/*.md` edits, `general` denies `todowrite`, internal `compaction/title` deny `*`.
- `ask` materializes a `Deferred<void, RejectedError|CorrectedError>` and publishes `permission.asked`; the UI shows the patterns (`pattern` + `always` + `metadata {command,Directories}` for `external_directory`). `reply("reject")` can include `message -> CorrectedError(feedback)` and auto-rejects peers in the same session; `reply("always")` persists to `approved: Rule[]` and wakes peers that now evaluate to `allow`. On `InstanceState` disposal every pending is failed.

In the shell tool specifically (`packages/server/src/tool/shell.ts`, 690 lines), every command is tree-sitter parsed (bash + powershell wasm), `Scan` derived via `argPath(resolvePath(cygpath))` and `containsPath(worktree)` veto, then permission depends on both `ShellID.ToolID + patterns` and `external_directory + dirs`.

## 11. Frontend — How the UI Stays Consistent

`packages/app/src/entry.tsx` bootstraps `Platform ("web")`, `getLocale` (`navigator.languages` zh prefix else en), stored `DEFAULT_SERVER_URL_KEY ("diveeoi.settings.dat:defaultServerUrl")`, `Notification` permission + `visibilityState` guard, `getCurrentUrl` (`VITE_DIVEEOI_SERVER_HOST/PORT` in dev else `location.origin`), optional `Sentry.init`, and renders `PlatformProvider -> AppBaseProviders -> AppInterface` into `#root`.

`packages/app/src/app.tsx` provider nesting is intentionally split:

- `SharedProviders`: server-agnostic (`SettingsProvider + BodyDesignClass + CommandProvider + HighlightsProvider`) — stays mounted across all routes.
- `ServerScopedShell`: per-server (`PermissionProvider + LayoutProvider + NotificationProvider + ModelsProvider + GlobalPrefSync + Layout`) — remounts when the active server changes. `GlobalPrefSync` debounces (500ms) pushes/pulls `settings/models/permission` via `GET/PUT /api/prefs/:scope`, scoped to `serverSDK().scope` for permissions.

Routing (`@solidjs/router`):

- `GET /login`, `GET /register` — auth forms
- `/` -> `HomeRoute`
- `/:dir -> DirectoryLayout -> session/:id? (SessionRoute)` inside `SelectedServerLayout` (keyed on `state.active` from `ServerProvider` / `connection.ts:322 lines`)
- `/new-session?draftId=...` inside `DraftServerLayout` (keyed on draft's target server) -> `DraftRoute` via `TabsProvider` draft lookup -> `SDKProvider(directory) -> DirectoryDataProvider -> DraftProviders(NewSession)` (no `TerminalProvider` on draft)

`packages/app/src/context/server.tsx` (322 lines) is the source of truth for server identity: `StoredServer = string|HttpBase|Http`, `ServerConnection.Any = Http|Sidecar(Wsl)|Ssh`, `Key = string & brand` from `http.url` or `wsl:<distro>` or `ssh:<host>`, `migrateCanonicalLocalServerState`, `createServerProjects` (open/close/expand/collapse/move per `ServerScope`), `resolveServerList` dedup from `props` plus `stored` with `http.url` precedence, `ServerProvider` via `persisted("server","server.v3")`.

Persistence uses `@solid-primitives/storage` `persisted(Persist.global(...), Persist.scope(ServerScope...))` — so `projects` and `lastProject` are correctly scoped per logical server.

## 12. Theme System

`packages/ui/src/theme/context.tsx` (370 lines): `ThemeProvider` is a `createSimpleContext` over `themes: Record<string,DesktopTheme>` with `oc-2` inlined plus lazy `import.meta.glob("./themes/*.json")` (40 themes). State `themeId, colorScheme(system|light|dark), mode, previewThemeId/Scheme, loads Map`. `applyThemeCss(theme, id, mode)` resolves tokens (`resolveThemeVariant + themeToCss` + v2 `resolveThemeVariantV2`) and writes `style#oc-theme`:

```css
:root { color-scheme: light|dark; --text-mix-blend-mode: multiply|plus-lighter; <css tokens> <v2> }
```

plus `dataset.theme/colorScheme` and `meta[name=theme-color]`. `load(id)` deduplicates, cross-tab `storage` sync respects `oc-1 -> oc-2` migration, media query tracks `system`, preview commits/cancels transactionally, `registerTheme` is how desktop pushes `_opencode/themes` via `_ExternalThemeLoader`.

## 13. Observability

In `packages/profiler/src/core.ts` (366 lines): gated by `DIVEEOI_PROFILER=1`. `wrap(key,fn)` idempotently wraps via `Symbol.for`, tracking `AsyncLocalStorage<ScopeNode>` call tree, sampling via `count*sampleRate` floor compare, `measure/measureAsync/scope`, `gauge/gaugeDelta`, `processMem()` via `Bun.memoryUsage` fallback `process.memoryUsage`, `snapshot()` aggregates `functions/files/modules/classes` plus gauges. `packages/profiler/src/writer.ts` flushes NDJSON. `Server.Default.app.fetch` uses `measureAsync` when enabled.

OpenTelemetry is optional: `cfg.experimental.openTelemetry && provider.getTracer()` in `agent/generate`, `SessionPrompt` etc.

Adaptive resources (`packages/db/src/adaptive`): `gcIntervalMs/rssTargetMB/sqliteCacheMB/dbQueryTimeoutMs/maxToolConcurrency` from `AdaptiveResourceService`, driving `main.ts` GC fiber and `Database` `PRAGMA cache_size/mmap_size` + `withDbQueryTimeout`.

## 14. Performance — The Adaptive Stack That Makes DiveeOI Usable

DiveeOI's stalling, leaks, and unconstrained queues were fixed as a single system — not as scattered PRs. The full plan is `plans/Optimization_1.0/OPTIMIZATION_PLAN.md` (843 lines) and the deep reference for operators is `docs/optimization.md`.

**Root cause**: every `SessionPrompt.prompt` that appended a user message eventually did `yield* memory.extractSessionMemory(sessionID, msgs)` inline. One slow extractor LLM turn blocked the loop's next LLM turn by 1-5 minutes. The fix is one word: `Effect.forkDetach(extractSessionMemory(...).catch(logError))` at the two exit points `prompt.ts:1263` (loop break) and `1294` (compaction stop).

**Adaptive loop** (`packages/db/src/adaptive` — detect 114 + profiles 86 + service 68 + hooks 34): cross-platform detection (`/proc/meminfo` on Linux, `sysctl`+`vm_stat` on macOS, `os.freemem` on Windows), 4 profiles `comfortable(700/400/60s/8/200) -> balanced(500/300/30s/4/100) -> constrained(350/200/15s/2/50) -> critical(250/150/8s/1/25)` across 13 targets (`rss/heap/gcInterval/toolConcurrency/LLMStream/SSE/WS/ptyCap+TTL/cacheTTL/sqliteCache/requestTimeout/dbTimeout`), updated every 90s via `forkScoped Effect.forever` with 30% interpolation when the profile does not flip — no thundering herd.

**GC + emergency** (`main.ts:29-61`): owns a `ManagedRuntime(AdaptiveResourceDefaultLayer)` and `forever { sleep gcInterval; if rss>1.5*rssTarget -> Bun.gc(true) warn "Emergency GC"; if critical -> warn "degraded"; Bun.gc(true); }`. The 1.5x multiplier is the self-heal. `DevMonitor` mirrors it as `DevMonitorSnapshot{rssMB,heapMB,adaptive{profile,profileChanged,targets,deviation%}}` every 60s on `stderr`.

**Every unbounded queue is now bounded by the live profile** via `useAdaptiveTargets` or `makeAdaptiveLayer`: PTY ticket cache `200-5000/15-120s`, WS tracker `100-1000`, SSE `100-1000`, LLM stream `25-200+throttle`, tool semaphore `1-8 capped cpuCores`, SQLite `cache_size 8-128 mmap*2`, storage `messages({limit,before,after})` + GZIP spill. Binary ceilings `scripts/build.ts --memory-limit=1200 --max-old-space-size=512` sit above adaptive but below OOM. `profiler` (`core 366 + writer 158`) streams `AsyncLocalStorage` call-tree + gauges as JSONL `scope_done/proc/states/snapshot` under `.divee/profiler.jsonl`.

Targets table and phase checklist live at `docs/optimization.md#success-targets`. Verifier defects (`FINDINGS_AUDIT.md H1-H4`) detail what must not regress (duplicate `memoryExtractRoute` import, dead `memory.extract` init, `writer.ts ENOENT/exit(0)`, `publish-llm-event.ts` 21 `die` sites).

## 15. Limitations and Sharp Edges

- `Unknown` error channel degrades `Layer.Services` to `unknown` when `Layer.suspend` / `Layer.unwrap` participates; the canonical workaround is explicit `as Layer.Layer<A,unknown>` at the composition site.
- `Layer.pipe(layerObject)` typechecks but throws at runtime; use `Layer.provideMerge(LayerNode.buildLayer(node))`.
- `Layer.provide(Node)` is a type violation — always `LayerNode.buildLayer(node)`.
- `config.updateGlobal` must use `jsonc-parser modify/applyEdits` to preserve comments; naive `JSON.stringify` rewrites comments away.
- `OPENCODE_CONFIG_CONTENT` and `$VAR` substitution happen before decode, so a key that needs to stay literal and not variable-expand must be escaped/quoted.
- Tool definitions resolve eagerly during layer build — a missing `LayerNode` dependency is only diagnosable at boot.

## 16. How to Extend It

- **Add a tool**: implement `Tool.define(id, Effect.gen(function* () { const deps = yield* ...; return { description, parameters, jsonSchema, execute(args,ctx){...} } }))` in `packages/server/src/tool/<name>.ts`, `yield* Tool.init(info)` in `registry.ts`, push to `builtin[]` and `node.dependencies`, add a `.txt` prompt fragment if the model should know about it, and wire any required `Instruction` system text.
- **Add a plugin file**: drop `tools/*.ts` under any project `.opencode` dir or list `{ spec, source, scope }` via `Config.plugin`; the registry `Glob.scanSync` discovers it automatically.
- **Add an MCP server**: a single `Config.mcp.<name> { type:"remote", url, oauth?{clientId,scope,redirectUri}, headers?, timeout? }` (or `type:"local"` with `command`) is sufficient; stdio vs remote probing is automatic, OAuth stores `pendingOAuthTransports` and the browser-open path `mcp auth` + callback fills tokens via `McpAuth`.
- **Add an agent**: add `cfg.agent.<name>` with `permission`, `prompt`, `model`, `steps`, `mode` (`primary|subagent|all`) — built-ins are just defaults that are merged with `Permission.merge(defaults, user, agentOverrides)` and then relaxed via `Truncate.GLOB allow`. Generate one via `agent.generate({ description })` which streams from `PROMPT_GENERATE`.
- **Add an API endpoint**: define a `HttpApiEndpoint` in `packages/api/src/groups`, implement its `handlers` via `HttpApiBuilder.group`, register the `Group` in `Api.add(...)` and the handler layer in `packages/server/src/server/routes/instance/httpapi/server.ts`. Put endpoint-contract middleware on the group; keep router middleware for raw fallbacks.

## 17. Reading Order

For the absolute minimum to be productive:

1. [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) — package map
2. This brief — §7 (layer graph) and §4 (prompt loop)
3. `packages/server/src/server/routes/instance/httpapi/server.ts` (the route tree + the `provideMerge` exception)
4. `packages/server/src/session/prompt.ts` (top half: message creation + token window) + `packages/server/src/session/processor.ts:handleEvent`
5. `packages/server/src/tool/registry.ts` + `packages/server/src/permission/index.ts` (why tools fail gracefully)
6. `packages/app/src/app.tsx` + `packages/app/src/context/server.tsx` (how the app stays on one logical server)

For a reviewer walking a change, add `packages/server/src/config/config.ts:loadInstanceState`, `packages/memory/src/graph.ts:scoreNodePure`, `packages/server/src/mcp/index.ts:connectRemote`, `packages/llm/src/route/protocol.ts`.

---

**TL;DR**: DiveeOI is the web half of OpenCode, rebuilt as a self-contained Effect-SQL web app. Everything of interest lives inside one Bun process and one SQLite file, with an LLM agent that loops over tools until it is done, asking you when it should. The docs in `docs/` and the per-package READMEs below are the operator's guide; this brief is the designer’s guide.
