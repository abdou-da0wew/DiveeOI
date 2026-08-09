# Project Lessons

## CORS: Tailscale / private network origins blocked

**Problem**: Browser requests from external machines (even on the same Tailscale/LAN) failed with CORS errors. The `isAllowedCorsOrigin()` function in `packages/api/src/cors.ts` only allowed `localhost` and `127.0.0.1`, which meant any browser accessing the frontend from a non-loopback address would have its API requests blocked.

The Tailscale IPs were `100.x.x.x` (CGNAT range `100.64.0.0/10`), and LAN IPs like `192.168.x.x` were also blocked.

**Fix**: Added `isPrivateOrigin()` check in `cors.ts` that allows:
- `10.x.x.x` (RFC 1918)
- `172.16-31.x.x` (RFC 1918)
- `192.168.x.x` (RFC 1918)
- `100.64-127.x.x` (CGNAT / Tailscale)

Also added `CORS` env var to the server's `main.ts` for custom origins, and documented everything in `.env.example`.

## Dev workflow: running both frontend and backend

**Setup**: Use `bun run dev:both` from the project root. It uses `concurrently` to run:
- Server with `--watch` (nodemon-like auto-reload on file changes)
- Vite dev server (HMR)

Install `concurrently` was added as a root devDependency.

## `git checkout --` glob expansion silently reverts ALL tracked files

**Problem**: Running `git checkout -- bun.lock packages/server/src/tool/shell.ts` in a shell with glob expansion caused zsh to expand the glob BEFORE git saw it. The result was `git checkout --` executing against ALL tracked files matching the glob pattern, reverting ALL source edits (ctx7, context-mode, TOON, config changes, everything).

**Root cause**: `git checkout` does NOT use `--` as a stopword for glob expansion — the SHELL expands the glob before git receives the arguments. A glob like `bun.lock packages/server/src/tool/*.ts` matches many files.

**Fix**: 
- Use explicit paths with `git checkout -- bun.lock` (single file, no glob)
- Or use `git restore bun.lock` (safer, no glob expansion risk)
- Or use `git checkout HEAD -- bun.lock` (explicit reference)
- NEVER use a glob pattern with `git checkout --`
- Prefer `git restore <file>` over `git checkout -- <file>` for reverting specific files

**Detection**: After running git checkout with a glob, run `git diff --stat` immediately. If more files changed than expected, you caught a glob expansion.

## `"latest"` version tag in package.json pollutes bun.lock

**Problem**: Using `"@upstash/context7-tools-ai-sdk": "latest"` in package.json causes `bun install` to resolve the newest version AND all its transitive dependencies. This pulled incompatible Effect v4 transitive deps that differed from the project's pinned beta.74 versions, breaking the Effect service composition chain at runtime (`InstanceRef not provided` at `instance-state.ts:16`).

**Fix**: Always pin npm dependencies to a specific semver range (e.g., `"^1.0.0"`) instead of `"latest"`. This ensures `bun.lock` stability.

**Detection**: If a new dependency causes a runtime crash in Effect service composition, suspect `bun.lock` corruption from transitive dependency conflicts. Check `grep effect bun.lock | head -20` for version mismatches.

## ocreadb MCP Server at packages/opencode-mcp

**Setup**: A Go binary at `packages/opencode-mcp/ocreadb` exposes 4 MCP tools (`get_current_session`, `list_sessions`, `show_session`, `search`) that query ALL opencode SQLite DBs (`opencode*.db` in `~/.local/share/opencode/`) and merge/deduplicate results. Results tagged with `db_name`.

**Registration**: Registered in `~/.config/opencode/opencode.jsonc` under `mcp.ocreadb`. Note: V1 config format (no `servers` wrapper).

**Rebuild**: After Go code changes: `CGO_ENABLED=1 go build -ldflags="-s -w" -o ocreadb .` in `packages/opencode-mcp/`. Restart the agent to pick up the new binary.

**DB discovery**: Auto-discovers all `opencode*.db` files in `~/.local/share/opencode/`. Override dir with `OPENCODE_DATA_DIR` env var.

**show_session pagination**: Uses simple integer page-based pagination (first → newest). Params: `page` (1-based int, default 1) and `limit` (default 20, max 100). Response: `pagination.page`, `pagination.total_pages`, `pagination.has_next`, `pagination.has_prev`. Agent just increments `page` to go forward. Over-range pages clamp to last page. Removed: base64 `cursor` encoding/decoding, `has_more`, `next_cursor`, `prev_cursor` fields.

**list_sessions pagination**: Also supports `page` (1-based) as a simpler alternative to `offset`.

**Dependencies**: Uses `github.com/mark3labs/mcp-go` for MCP server and `github.com/mattn/go-sqlite3` (CGO) for SQLite.

## `@types/*` resolution walks up from the consumer's node_modules, not the type-checker's

**Problem**: TypeScript failed with `TS7016: Could not find a declaration file for module 'mime-types'` when typechecking `packages/api`. But `packages/server` used the same import without issues.

**Root cause**: The file `packages/db/src/fs-util.ts` imports `mime-types`. TypeScript resolves `mime-types` from `packages/db/node_modules/mime-types/` (the package that declares it as a direct dependency). The `@types` resolution walks UP from the file's location (`packages/db/src/fs-util.ts`) → checks `packages/db/node_modules/@types/` first. It never reaches `packages/api/node_modules/@types/` because DB is a sibling package, not a child.

**Fix**: Added `"@types/mime-types": "3.0.1"` to `packages/db/package.json` devDependencies (the package that directly depends on `mime-types`), not `packages/api/package.json`.

**Detection**: When `tsc --traceResolution | grep <module>` shows TypeScript resolving the JS module from a different package's node_modules than the one being typechecked, add `@types/*` to THAT package, not the typechecker's package.

**Lesson**: Always follow the dependency chain. The `@types/*` package belongs in the package that DEPENDS on the JS module, not the package that runs `tsc`.

## Prefs sync extension: GlobalPrefSync replaces SettingsPrefSync

**Problem**: `SettingsPrefSync` was only mounted inside `dialog-settings-v2.tsx` — the settings dialog. It only synced `settings.v3` and ONLY while the settings dialog was open. Model preferences (visibility, favorites, recent models) and permission auto-accept rules were persisted locally via `persisted()` but never synced to the server.

**Fix**: Replaced `SettingsPrefSync` with `GlobalPrefSync` (`packages/app/src/components/global-pref-sync.tsx`) mounted at the app root inside `ServerScopedShell` (line 234 of `app.tsx`). It syncs three stores:
- **Settings (`settings.v3`)** — global scope, UI/layout/appearance settings
- **Models (`model`)** — global scope, model visibility, favorites, recent models, variant preferences
- **Permissions (`permission`)** — server-scoped (uses `serverSDK().scope`), auto-accept rules per directory/session

**Context store encapsulation**: Models and permission contexts (`createSimpleContext`) kept their raw `[store, setStore]` private. To enable syncing, added `get value() { return store }` (read-only store getter) and exposed `setStore` directly. This follows the same pattern as the settings context which already exposed `current` and `setStore`.

**Sync pattern** (reused from original SettingsPrefSync):
- On server connect: `GET /api/prefs/:scope` → merge server data into local store (server wins)
- On local change: debounced 500ms `PUT /api/prefs/:scope` → push full serialized state
- `syncingFromServer` flag prevents echo loops during initial fetch

**Key decision**: Permission data is synced per-server (`serverSDK().scope` as the prefs API scope) because auto-accept rules are directory-specific and directories belong to a specific server. Settings and models are global prefs (shared across all servers).

**Files changed**:
- `packages/app/src/context/models.tsx` — added `value` getter + `setStore` to return
- `packages/app/src/context/permission.tsx` — added `value` getter + `setStore` to return
- `packages/app/src/components/global-pref-sync.tsx` — NEW: sync component
- `packages/app/src/app.tsx` — import + mount GlobalPrefSync in ServerScopedShell
- `packages/app/src/components/settings-v2/dialog-settings-v2.tsx` — removed old SettingsPrefSync import + usage
- `packages/app/src/components/settings-pref-sync.tsx` — DELETED (orphaned)

---

## @diveeoi/memory Package Lessons (2026-07-31)

### Effect v4 Beta.74 API Changes
| Old API | New API | Notes |
|---------|---------|-------|
| `Effect.catchAll` | `Effect.catch` | Single-arg: error → Effect |
| `Effect.forkDaemon` | `Effect.forkScoped` | Returns `Effect<void, never, Scope>` |
| `Effect.forEach(..., { batchSize })` | `Effect.forEach(..., { concurrency })` | No `batchSize` option |
| `PartitionedSemaphore.make(n)` | `yield* PartitionedSemaphore.make({ permits: n })` | Returns `Effect<PartitionedSemaphore, never, never>` |
| `Schema.isMaxLength(n)` | `Schema.check(Schema.isMaxLength(n))` | Inline check; standalone `maxLength` doesn't exist |
| `Schema.isMaxSize(n)` | Custom check `(arr) => arr.length <= n` | `isMaxSize` returns `Filter<{size}>`, not `Check` |
| `Schema.optional` | `Schema.OptionFromNullOr` | `optional` returns `Option<T>`, not `T \| undefined` |
| `Schema.optionFromNullable` | `Schema.OptionFromNullOr` | Renamed in beta.74 |

### Drizzle Adapter with Effect-SQLite
- **Raw SQL with `?` placeholders silently drops params** — `params: []` in `EffectDrizzleQueryError`. Must use `sql` template literals: `sql`SELECT * FROM t WHERE id = ${id}``
- **`db.transaction` expects callback `() => Effect`** — passing bare Effect causes `TypeError: transaction is not a function` at `session.ts:199` (`transaction(tx)` call)
- **`Database.Service` yields `{ db }`** — must destructure: `const { db } = yield* Database.Service`
- **`db.get<T>()` supports generic** — `db.get<{ count: number }>(sql`...`)` for typed results
- **`db.run/get/all/values`** — wrap with `mapDbError(effect)` to convert `EffectDrizzleQueryError` → `MemoryError`

### Schema Brand Types
- Branded types: `type MemoryNodeID = string & Brand<"MemoryNodeID">` (via `Schema.String.pipe(Schema.brand("..."))`)
- To cast: `value as MemoryNodeID` (per existing pattern in `recall.ts:32`)
- `SessionID`, `AbsolutePath` from `@diveeoi/db/schema` work the same way

### LLM Client (Extractor)
```typescript
const request = LLM.request({
  system: EXTRACTION_SYSTEM_PROMPT,
  prompt,
  generation: { temperature: 0.1, maxTokens: 2000 }
})
const response = yield* llmClient.generate(request).pipe(
  Effect.timeoutOrElse({ duration: "30 seconds", orElse: () => Effect.fail(new Error("LLM timeout")) }),
  Effect.mapError((err) => new MemoryError(err))
)
const parsed = JSON.parse(response.text)  // NOT response.content
```

### TypeScript Config for Memory Package
```json
{
  "extends": "@tsconfig/bun/tsconfig.json",
  "compilerOptions": {
    "lib": ["ESNext"],
    "types": ["bun"],
    "noUncheckedIndexedAccess": false,
    "verbatimModuleSyntax": true
  }
}
```
- `verbatimModuleSyntax: true` (from base) → `import type` strictly enforced (TS1361)
- Must add `"types": ["bun"]` explicitly — local empty `@types` dir blocks root `@types` auto-inclusion

### Test Script Fix
- Was: `"test": "bun test --only-failures"` (runs zero tests when all pass)
- Fixed: `"test": "bun test"`

### Memory Layer Composition
```typescript
// LayerNode graph in src/index.ts
MemoryLayer = LayerNode.buildLayer(LayerNode.group([memory, session, recall, consolidation, extractor]))
```
- `Layer.mergeAll` in beta.74 provides NO cross-member deps — use `LayerNode` groups
- `Layer.provide` is **single-arg** in beta.74: `Layer.provide(A, B)` fails → use `Layer.provide(Layer.mergeAll(A, B))`

### Error Channel Alignment Pattern
```typescript
// Interface declares MemoryError
readonly recall: (options: RecallOptions) => Effect.Effect<RecallResult, MemoryError>

// Implementation yields indexer (MemoryError)
const recall = (options) => graph.recall(options)  // graph.recall returns MemoryError
```

### ForEach Options
```typescript
// Old (beta.74 doesn't support)
Effect.forEach(items, fn, { concurrency: 10, batchSize: 50 })

// New
Effect.forEach(items, fn, { concurrency: 10 })
// Manual batching if needed:
for (const chunk of items.chunk(50)) {
  yield* Effect.all(chunk.map(fn))
}
```

### PartitionedSemaphore
```typescript
// Creates Effect, must yield
const sessionLocks = yield* PartitionedSemaphore.make<string>({ permits: 1 })

// Usage: withPermit(sem, key)(effect)
yield* PartitionedSemaphore.withPermit(sessionLocks, sessionId)(Effect.gen(...))
```

### SessionID / MemoryNodeID Brand Casting
```typescript
// Pattern from recall.ts:32
sessionId as SessionID
linkId.target as MemoryNodeID
```

### AbsolutePath Import
```typescript
import { AbsolutePath } from "@diveeoi/db/schema"
// Usage
path: filePath as AbsolutePath
```

---

## Memory Package - Common TypeScript Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `TS2300: Duplicate identifier 'MemoryConfig'` | Imported from both `./schema` and `./config` | Remove from type import, keep value import from `./config` |
| `TS1361: Cannot be used as value because imported using 'import type'` | Class/Service used at runtime but in `import type` | Move to value import |
| `TS2322: string not assignable to SessionID` | Raw string passed where branded type expected | Cast: `sessionId as SessionID` |
| `TS2345: Check<readonly string[]> expected, got Filter<{size}>` | `Schema.isMaxSize(n)` returns wrong type | Use inline check: `Schema.check((arr) => arr.length <= n)` |
| `TS2488: Type 'never' must have [Symbol.iterator]` | `catchAll` handler returned wrong shape | Switch to `Effect.catch` |
| `TS2339: Property 'catchAll' does not exist` | `Effect.catchAll` removed in beta.74 | Use `Effect.catch` |
| `TS2339: Property 'forkDaemon' does not exist` | `Effect.forkDaemon` removed | Use `Effect.forkScoped` |
| `TS2353: 'batchSize' does not exist in forEach options` | `batchSize` removed in beta.74 | Remove, use `concurrency` only |
| `Effect<unknown, unknown, unknown>` not assignable | `Effect.gen` with untyped `catch`/`mapError` | Add explicit types or use `Effect.mapError` |

---

## Verification Commands
```bash
cd packages/memory
bun run typecheck    # tsgo --noEmit — must be clean
bun test             # must pass
```
## LayerNode graph gotchas (packages/server/src/session)

- `Layer.provide(...)` takes a LAYER, not a node. Passing a node var (e.g. `Layer.provide(skillMentionsNode)`) is a TS2769 no-overload error. Use `Layer.provide(SomeModule.layer)`.
- A `LayerNode.make` deps tuple entry typed `never` provides NOTHING to the missing-deps check. Two ways a node becomes `never`:
  - `LayerNode.make(layer as never, [...])` — casting the implementation hides its output service; the tuple then reports the service as "Missing dependencies".
  - `export const node = LayerNode.make(...) as never` — hides the node entirely.
  Fix: remove the casts; if the layer's RIn is a genuine service (e.g. `FileSystem`), provide it via a real node (`filesystem` from `@diveeoi/db/effect/layer-node-platform`) rather than casting.
- `Layer.effect` absorbs `Scope.Scope` from `InstanceState.make` usage — the node deps error names only the real services (e.g. `FileSystem`), never `Scope.Scope`.

## LayerNode.group with intra-group deps: services may not surface to outer context (2026-08-03)

**Problem**: After fixing `Service not found: @diveeoi/memory/MemoryService`, the server crashed with `Service not found: @diveeoi/server/SessionMemoryIntegration` at the final layer resolution stage. The service was available during init (memory tools successfully yielded `SessionMemoryIntegration.Service`) but not after the layer was fully built.

**Root cause**: `LayerNode.buildLayer(group)` uses `Layer.mergeAll(...)` to combine all members. When a `make` node depends on another group member (SessionMemoryIntegration depends on Memory), the inner `Layer.provide(impl, deps)` layer is correctly built but `Layer.mergeAll` doesn't always propagate the inner provided service to the outer scope.

The fix pattern: explicit `Layer.provideMerge(LayerNode.buildLayer(missingNode))` after the group build.

**Location**: `packages/server/src/server/routes/instance/httpapi/server.ts`, createRoutes function, line 291.

**Fix (lines 291-295)**:
```typescript
).pipe(
  Layer.provide([errorLayer, ...]),
  Layer.provide(LayerNode.buildLayer(app)),
  Layer.provideMerge(LayerNode.buildLayer(SessionMemoryIntegration.node)),  // <-- explicit
  Layer.provide(Layer.succeed(CorsConfig)(corsOptions)),
  Layer.provide(Observability.layer),
)
```

## ToolRegistry memory tools: eager service resolution at boot time

**Discovery**: `Tool.define(id, Effect.gen(function* () { const svc = yield* ... }))` resolves its yield* during the ToolRegistry layer's build phase — NOT per-tool call. This means:
- Memory tools require `MemoryService` and `SessionMemoryIntegration.Service` at boot time, not per call
- Missing services are only diagnosed at server start (not at tool execution)
- All tool deps must be available in the ToolRegistry layer before running server

**Fix stack for DiveeOI + memory integration boot**:
1. `ToolRegistry.node` deps: add `Memory.node` and `SessionMemoryIntegration.node` (packages/server/src/tool/registry.ts)
2. `MemoryLayer` exports: include GraphService and MemoryConfig in the group (packages/memory/src/index.ts)
3. `SessionMemoryIntegration.node` deps: must be `[Memory.node]`, NOT empty (packages/server/src/session/memory.ts)
4. `createRoutes()` pipe: add `Layer.provideMerge(LayerNode.buildLayer(SessionMemoryIntegration.node))` after app group (packages/server/src/server/routes/instance/httpapi/server.ts)

## SessionMemoryIntegration.Live with pipe(Layer.provide) breaks external Layer.provide

**Problem**: `SessionMemoryIntegrationLive` is `Layer.effect(Service, makeSessionMemoryIntegration).pipe(Layer.provide(MemoryConfig.defaultLayer))`. Using it directly in `Layer.provide(X.pipe( Layer.provide())` causes `TypeError: that.build undefined` in Effect v4 beta.74.

**Fix**: Don't use `.pipe()`-wrapped layers in external `Layer.provide()`. Use `LayerNode.buildLayer(node)` instead.

## `Layer.provide(["array"])` must use `Layer.provideMerge` for multi-layer to level deep

**Pattern**: `Layer.provide[arrayLayers])` wraps layers flat. But if a `Layer.provideMerge` appears, Effect treats it differently for type inference.

## Memory package: cannot use effect/Logger.Logger (not in package scope)

**Problem**: `import { Logger } from "effect"` in `packages/server|memory` was `undefined` at import time. The `Logger.Logger` wasn't provided by the local memory's dependency chain.

**Workaround**: For debugging effect layer init order, use `console.log` with explicit init order markers.

## The app group (LayerNode.group) has 55+ nodes

Current group nodes in `createRoutes`:
- 250: Memory.node
- 251: SessionMemoryIntegration.node
- 252: ToolRegistry.node

Architecture decision: any node whose service must be available at the outer context (not just internally to tool init) should be added as an explicit `Layer.provideMerge` after the group build.

## Colab CI false positive: default-branch clone validates the wrong code (Aug 2026)

**Symptom**: colab build "succeeds" and starts cleanly, but the same code fails locally with `Service not found: @diveeoi/server/SessionMemoryIntegration`.

**Root cause**: the colab clone checked out the repo default branch (`main`) and `git pull` kept updating `main`. `main` has NO memory HTTP wiring at all — no memory-extract route, no memory nodes in the app group, no `ToolRegistry.defaultLayer`. The colab test never exercised memory services, so it could not catch the dev regression. Binary version strings exposed it: colab `0.0.0-main-202608091042` vs local `0.0.0-dev-202608091353`.

**Fix**: always `git fetch origin && git checkout <explicit-branch> && git pull origin <explicit-branch>` on colab before building; verify the produced binary's version string matches the expected branch (`0.0.0-dev-...` for dev). Also `git diff main dev` on the composition file to see exactly what differs.

## `Layer.provideMerge(x)` one-arg form is the curried pipe stage — only valid in a `.pipe(...)` chain

Effect v4 beta.74 `Layer.provideMerge` is dual: one-arg `<RIn, E, ROut>(that) => (self) => Layer` (curried, for `.pipe`). Putting `Layer.provideMerge(x)` as an ITEM inside `Layer.mergeAll([...])` passes a function where a Layer is expected — latent type error that `bun build` silently ignores. The proven fix pattern (e214588, d1c4622, 8c5a3e0) is exactly:

```ts
Layer.mergeAll(routes..., uiRoute).pipe(
  Layer.provide([...base layers...]),
  Layer.provide(LayerNode.buildLayer(app)),
  Layer.provideMerge(LayerNode.buildLayer(SessionMemoryIntegration.node)),
  Layer.provide(ToolRegistry.defaultLayer),
  ...
)
```

## `Layer.provide(Node)` is wrong — `LayerNode.make` returns a Node, not a Layer

`LayerNode.make(impl, deps)` returns `{ kind, implementation, dependencies }` — NOT a Layer. Feeding it to `Layer.provide(...)` is a silent type violation (bun build doesn't typecheck). Always `LayerNode.buildLayer(node)` first. Found in `handlers/memory.ts` as `Layer.provide(MemoryScheduler.node)`; fixed in 8c5a3e0.

## Memory scheduler must be provisioned exactly once

`MemorySchedulerLive` (memory-scheduler.ts:180) calls `scheduler.start()` at BUILD time (background fiber). Duplicate provisioning = duplicate scheduler loops. Keep memory nodes OUT of the app group (main-era shape: group has domain nodes only); provision `SessionMemoryIntegration` via the boundary provideMerge and `MemoryScheduler` via the handler's own `LayerNode.buildLayer(MemoryScheduler.node)`. The shared memoMap dedupes service tags, but the build-time side effect makes one-instance discipline mandatory.
