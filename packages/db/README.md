# @diveeoi/db

Lower layer: persistence, provider glue, session engine, tool primitives, FS/PTY abstractions. The single dependency that `server`, `api`, `app` (types), and `memory` share.

## Database

- `src/database/database.ts` (76) — `EffectDrizzleSqlite.makeWithDefaults()` + `PRAGMA journal_mode=WAL / synchronous NORMAL / busy_timeout 5000 / cache_size=-MB*1000 / mmap_size=MB*2*1024*1024 / foreign_keys ON`, applied via `makeAdaptiveLayer` driven by `AdaptiveResourceService`. `path()` chooses `Flag.OPENCODE_DB` else `Global.Path.data/opencode.db` (channel-suffixed when `InstallationChannel` not in `latest|beta|prod`), `withDbQueryTimeout` applies `dbQueryTimeoutMs`.

- `src/database/schema.gen.ts` / `src/database/migration/*` — generated schema; 35+ migrations (e.g. `familiar_lady_ursula`). See `docs/architecture.md#database` for the table list.

- `src/database/sqlite.bun.ts` vs `sqlite.node.ts` via `#sqlite` conditional import — the same `SqlClient` is satisfied against Bun's `bun:sqlite` or `better-sqlite3`. Adding sqlite code requires both implementations.

## Session engine

- `src/session/schema.ts:SessionV2.Info { id(parentID,projectID,agent model Ref,cost,tokens,time,title,location,subpath) }` with branded `ses_*` IDs.
- `src/session/runner/{index,model,llm,to-llm-message,publish-llm-event}` and `src/session/execution/local.ts` — the local runner that lowers session history to provider messages, manages `LLMEvent` publishing, and coordinates runs.
- `src/session/{store,projector,run-coordinator,compaction,todo,event,schema,input,history,message,id,message-updater,prompt,context-epoch,error,logging,sql}` — the store/projector split behind the v2 API; `MessageV2.filterCompactedEffect` and `toModelMessagesEffect` are the two seams the server borrows.
- Event system `src/event/*` drives event-sourcing (`event_sequence` + `event` tables).

## Tools

Canonical 18 tool impls in `src/tool/`: `bash, edit, glob, grep, read, write, webfetch, websearch, skill, todowrite, apply-patch, question, builtins, registry, tools, tool` plus `read-filesystem`. Each is an Effect that yields a `Tool.Def`. The public barrel is `src/public/index.ts: Agent, Model, OpenCode, Session, Tool, Location, Prompt, AbsolutePath`.

## Config / Project / Plugin

- `src/config/*` — `agent, provider, command, compaction, watcher, formatter, LSP, markdown, MCP, plugin, reference, tool_output, attachments, experimental` Schemas. These are `ConfigV1.Info` branches consumed by `server/src/config/config.ts`.
- `src/project/{schema, sql, directories, copy, copy-strategies}` + `src/control-plane/move-session` — project discovery by `ConfigPaths`, copy strategies, move-session helper.

## Abstractions

- `#fff -> fff.bun.ts / fff.node.ts` — filesystem walker (parcel `fff-bun`) with `normalizePath` helpers.
- `#pty -> pty.bun.ts / pty.node.ts` — pseudo-terminal (`lydell/node-pty` + `bun-pty`).
- `#sqlite` — above.
- `src/effect/layer-node.ts` — the `make/group/buildLayer` app-graph primitive (see `docs/architecture.md#effect-layer-graph`).
- `src/effect/{runtime,memo-map,service-use,keyed-mutex,layer-node-platform}` — `makeRuntime` dedup, `memoMap` shared by `server`, `serviceUse` shortcut, `PtyEnvironment` from `layer-node-platform`.
- `src/observability/{logging,otlp,shared}` — OTel + Effect logging bridge.
- `src/adaptive/{detect,profiles,service,hooks,index}` — **core perf subsystem** (the fork's largest change). See [`docs/optimization.md`](../../docs/optimization.md): cross-platform `detect` (`/proc/meminfo`/`sysctl`+`vm_stat`/`os.freemem`), 4 `profiles` with 13 `AdaptiveTargets` (rss/heap/gc/tool/LLM/SSE/WS/pty/cache/sqlite/timeouts across 700→250 MB), `service` `Ref` + 90s jittered updater with 0.3 interpolation, `hooks` (`useAdaptiveTargets`/`makeAdaptiveLayer`) used by `Database` PRAGMA, PTY `Cache`, SSE/WS queues, tool `Semaphore`, LLM `Stream.buffer`. The `FINDINGS_AUDIT.md H1-H4` defects are guarded against here.

## Test

```bash
bun --cwd packages/db run typecheck   # systemd-run wrapper
bun --cwd packages/db run test --only-failures
bun --cwd packages/db run db          # drizzle-kit
```

## Import rule

Inside effectified code prefer `FileSystem.FileSystem` over raw `fs/promises`, `ChildProcessSpawner` over raw spawn, `HttpClient.HttpClient` over `fetch` — the wrappers carry `Clock, FileSystem, Path` where needed without leaking.
