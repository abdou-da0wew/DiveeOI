# Development

## Scripts

Root (`package.json` workspaces `packages/*`):

```bash
bun install                          # install with bun.lock exact=true
bun run dev         # server — bun --cwd packages/server dev  (main.ts, port 4097)
bun run dev:watch   # server --watch --conditions=browser
bun run dev:web     # app — bun --cwd packages/app dev (Vite HMR)
bun run dev:both    # server:watch + app together via concurrently (cyan/green, prefixColors)
bun run build       # bun scripts/build.ts -> turbo: sdk -> app -> server
bun run build:nobin # same without binary emit
bun run typecheck   # bun turbo typecheck
bun run lint        # oxlint
bun run clean       # rm -rf packages/*/dist packages/*/.turbo
```

Per package (selected):

```bash
# server
bun --cwd packages/server run typecheck  # systemd-run --user --scope MemoryMax=1.3G tsgo --noEmit
bun --cwd packages/server run test       # bun test --timeout 30000 --only-failures
bun --cwd packages/server run test:httpapi  # script/httpapi-exercise.ts --mode coverage/auth/effect
bun --cwd packages/server run dev        # bun run --conditions=browser ./src/main.ts
bun --cwd packages/server run build      # bun run script/build.ts
# app
bun --cwd packages/app run dev           # vite
bun --cwd packages/app run typecheck     # systemd-run tsgo -b (build)
bun --cwd packages/app run test          # bun test --preload ./happydom.ts  + virtualizer browser conditions
bun --cwd packages/app run test:e2e      # playwright test
# db
bun --cwd packages/db run typecheck      # systemd-run tsgo --noEmit
bun --cwd packages/db run db             # drizzle-kit
# memory / llm / others
bun --cwd packages/memory run typecheck  # tsgo --noEmit
bun --cwd packages/memory run test       # bun test
```

## Workspace Details

- `bunfig.toml`:
  ```toml
  [install] exact = true
  ```
- Root `catalog` pins shared deps: `effect 4.0.0-beta.74`, `drizzle-orm 1.0.0-rc.2`, `ai 6.0.168`, `solid-js 1.9.10`, etc. Use `catalog:` in package deps rather than repeating versions. Never use `latest` — it pulls transient effect `beta.*` mismatches that break `Layer.Services` composition (`InstanceRef not provided`).
- `patches/` contains 9 patches applied via `patchedDependencies` in root `package.json`. After changing a patched dep, run `bun install` and verify `bun patch` if needed.
- `turbo.json`: `app#build` depends on `sdk#build`; `server#build` depends on `app#build`.

## Typecheck

Uses `tsgo` (Effect's TS fork, via `typescript: @typescript/native-preview`). The `systemd-run --user --scope -p MemoryMax=1.8G` wrappers in `server/db/api` exist to cap memory on dev machines; remove them inside containers. Never run a monorepo-wide `tsgo` from the IDE without the wrapper — it OOMs.

Typical fix order for type errors:

1. missing `@types/*` — add it to the package that **owns the JS dep**, not the package that runs `tsc` (`@types/mime-types` belongs to `db`, not `api`; traced via `tsc --traceResolution`).
2. `Context.Service<Self,Interface>` structural conflict — widen `Body<A,E,any>` or use double cast `as unknown as Layer<...,unknown>`.
3. `unknown` degraded `Layer.Services` alongside `Layer.suspend` -> cast `as Layer.Layer<never,never,unknown>` before `Layer.provide`.

## Tests

- Preferred runner: `testEffect(...)` from `packages/server/test/lib/effect.ts` (shares memoMap + resets profiler).
- Pure unit tests: `bun test` (see `packages/memory`, `packages/server` suites).
- HTTP record/replay: `packages/http-recorder` (only `devDependency`). Default is replay; `RECORD=1 bun test` re-records a single file. Use `RECORDED_PROVIDER`, `RECORDED_PREFIX`, `RECORDED_TAGS`, `RECORDED_TEST` filters to target one scenario. Do not blanket re-record.
- App: `bunx playwright install chromium; bun run test:e2e:local`. `PLAYWRIGHT_SERVER_HOST/PORT`, `PLAYWRIGHT_PORT`, `PLAYWRIGHT_BASE_URL` override defaults.
- Memory package: `bun --cwd packages/memory test` must stay green after graph changes; the 8-factor score is pinned by fixture expectations.

## Conventions

### Module Shape

No `export namespace`. Every module exposes flat top-level exports and a self-reexport:

```ts
// packages/server/src/foo/foo.ts
export interface Interface { ... }
export class Service extends Context.Service<Service,Interface>()("@diveeoi/Foo") {}
export const layer = Layer.effect(Service, ...)
export const node  = LayerNode.make(layer, [...deps])
export * as Foo from "./foo"
```

Consumers: `import { Foo } from "@/foo/foo"; yield* Foo.Service`.

No barrel `index.ts` in multi-sibling directories — each file is its own module.

### Effect

- `Effect.gen(function* (){ yield* ... })` and `Effect.fn("Domain.method")` for traces; `Effect.fnUntraced` for hot paths where Span is noise.
- `Effect.callback` for callback APIs, `Effect.void` for void returns.
- `DateTime.nowAsDate` over manual `Clock.currentTimeMillis`.
- `makeRuntime` (from `db/effect/runtime`) for deduped runtimes; `InstanceState` + `ScopedCache` for per-directory state (automatic disposal, `addFinalizer` for process teardown, `forkScoped` for stream consumers). Do not fork inside `InstanceState.make` for work that other methods need immediately.
- Prefer injected services (`FileSystem.FileSystem`, `ChildProcessSpawner`, `HttpClient`) over raw `fs/promises` inside effectified code.
- `Effect.cached` when concurrent callers should share one in-flight computation.

### Errors and Logging

- Use `Schema.TaggedErrorClass` for typed errors; map expected domain errors at the handler boundary to `HttpApi` `Schema.ErrorClass` contracts. Do not throw raw `HttpApiError.*` with SDK-visible messages.
- Structured logs: `Effect.logInfo("event", { id, action })` rather than string templating. Include `sessionID`, `messageID`, `tool.name`, `callID` on tool spans.

### Config and Secrets

- Never hardcode paths, limits, ports, or keys. They flow through `ConfigV1` / env. If a literal appears in 3+ places, extract it.

### CORS / Auth

- CORS is server-side only (`packages/api/src/cors.ts`). Health check (`/api/health`) and `WebSocket` upgrade share the same `CorsConfig` reference.
- Auth is password-only (`ServerAuth.Config` with `Option<string>`). `authorizationLayer` is middleware; `ServerAuth.Config.defaultLayer` means disabled.

## Gotchas (from `PROJECT_LESSONS.md`)

- `git checkout -- <glob>` expands in zsh before git sees it. Use `git restore <file>` for single files and always `git diff --stat` after.
- `Layer.provide(Node)` is not a layer. Use `LayerNode.buildLayer(node)`.
- `Layer.pipe(layerObject)` typechecks but throws `args[0] is not a function` — wrap with `Layer.provideMerge(...)`.
- The adaptive `emergencyRssMultiplier` is `1.5x` in `main.ts`; the per-profile `rssTargetMB` comes from `AdaptiveResourceService`.

## Useful Entry Points

- `packages/server/src/server/routes/instance/httpapi/server.ts` — the route tree to modify when adding an HttpApi group.
- `packages/server/src/tool/registry.ts` — where a new `Tool.define` must be yielded and included in `builtin` + `node` deps.
- `packages/server/src/config/config.ts:loadInstanceState` — precedence order for any config change.
- `packages/memory/src/graph.ts:scoreNodePure` — pure function, reusable from tests.
- `packages/app/src/app.tsx:AppInterface` — provider tree; prefer extending a scoped shell (`ServerScopedShell`) over modifying `SharedProviders` when a provider is per-server.

## Troubleshooting

- **Typecheck OOM** → use `systemd-run --user --scope -p MemoryMax=1.8G` wrapper or raise it inside a container.
- **Bun SQLite `better_sqlite` missing** → `bun install` must run with the workspace `patchedDependencies`; do not run `npm install` alone.
- **MCP remote always `failed`** → check `mcp.timeout` and `oauth.clientId`; `needs_client_registration` requires a pre-registered id, `needs_auth` requires `opencode mcp auth <name>`.
- **Theme not loading** → `localStorage["opencode-theme-id"]` migrated from `oc-1 -> oc-2`; clear it and `opencode-theme-css-*` keys.
- **`Service not found` at boot** → the requested `Tool` expects a layer not present in its registry's `LayerNode` closure; add it to `ToolRegistry.node` and to the `createRoutes` `provideMerge` if the service must also be directly available to HTTP handlers.
