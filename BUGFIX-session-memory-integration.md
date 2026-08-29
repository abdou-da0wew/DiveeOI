# Bug Report: `Service not found: @diveeoi/server/SessionMemoryIntegration`

## Update: verified root cause (this section supersedes the original diagnosis below)

The `as never` fixes below are real bugs and were kept, but **they were not
why the server crashed**. Proven by actually running the TS source directly
(`bun run --conditions=browser ./src/main.ts`) with instrumentation, then
confirming with an isolated minimal repro of the exact Layer shape.

**The real bug:** in a `layer.pipe(Layer.provide(A), Layer.provide(B))` chain,
`B` does **not** see what `A` supplied. Each `Layer.provide()` in a pipe
builds its dependency in isolation — a later step doesn't inherit context
from an earlier sibling step, only the final accumulated layer does.
Confirmed with a minimal reproduction (`Layer.provide(xLive)` immediately
followed by `Layer.provide(depB)` where `depB` internally needs `X`): `depB`'s
construction starts, then dies with `Service not found: X`, `depB` never
receiving `xLive`. Identical shape to the real crash.

Two real instances of this:

1. **`session/memory-scheduler.ts`**: `export const defaultLayer = MemorySchedulerLive`
   was a bare alias — `MemorySchedulerLive` internally needs
   `SessionMemoryIntegration.Service` and `Session.Service` but only had
   `MemoryConfig` wired via its own `.pipe(Layer.provide(MemoryConfig.defaultLayer))`.
   Anything composing `MemoryScheduler.defaultLayer` as a sibling `.provide()`
   step next to `SessionMemoryIntegration.defaultLayer` (as `tool/registry.ts`'s
   `defaultLayer` does) hit exactly this trap.
   ```diff
   - export const defaultLayer = MemorySchedulerLive
   + export const defaultLayer = MemorySchedulerLive.pipe(
   +   Layer.provide(SessionMemoryIntegration.defaultLayer),
   +   Layer.provide(Session.defaultLayer),
   + )
   ```

2. **`session/memory.ts`**: `SessionMemoryIntegrationLive` internally needs
   `Memory.MemoryService`, `SessionService`, and `ExtractorService` (all from
   `@diveeoi/memory`), but only had `MemoryConfig` wired. `@diveeoi/memory`
   doesn't export a combined `defaultLayer`, so this uses `LayerNode.buildLayer(Memory.node)` instead.
   ```diff
     export const SessionMemoryIntegrationLive = Layer.effect(
       Service,
       makeSessionMemoryIntegration
   -  ).pipe(Layer.provide(MemoryConfig.defaultLayer))
   +  ).pipe(
   +    Layer.provide(MemoryConfig.defaultLayer),
   +    Layer.provide(LayerNode.buildLayer(Memory.node)),
   +  )
   ```

**Verified:** ran the real server past this exact failure twice (once per
fix); `SessionMemoryIntegration`/`MemoryService` no longer appear as missing.
Startup now proceeds to a **separate, pre-existing, unrelated** failure:
`Service not found: @opencode/v2/Ripgrep` (`packages/db/src/ripgrep.ts`).
`Ripgrep.node`/`Ripgrep.defaultLayer` are themselves correctly wired, so this
looks like the same "sibling `.provide()`" class of bug living somewhere else
in the graph — not investigated further, out of scope of the memory crash
this report covers. Worth a fresh, separate debugging pass.

**Lesson for this codebase:** `X.defaultLayer` must always be *self-sufficient*
(wire every service `X`'s own construction needs via its own `.pipe(Layer.provide(...))`),
never a bare alias to the raw implementation — because whatever composes it
later, sibling `Layer.provide()` calls will not rescue it.

---

## Original report (background/context, first two fixes still valid but were not sufficient by themselves)

## Symptom

Server binary crashed immediately on startup:

```
error: Service not found: @diveeoi/server/SessionMemoryIntegration
```

A second, unrelated symptom was also observed:

```
error: Failed to start server. Is port 4097 in use?
```

## Root cause

The project composes its Effect `Layer` graph with a custom helper, `LayerNode`
(`packages/db/src/effect/layer-node.ts`). Every subsystem exports a `node` via
`LayerNode.make(implementationLayer, [...dependencyNodes])`. `LayerNode.make`
has a compile-time check (`CheckDependencies`) that fails the build if
`implementationLayer` needs a service that isn't listed in `dependencyNodes`.

Three files bypassed that check with `layer as never`, which makes
`CheckDependencies` a no-op (a `never` implementation type trivially satisfies
any constraint). This let each file compile cleanly while silently omitting a
real dependency. At runtime, `LayerNode.buildLayer` builds each node as
`Layer.provide(implementation, dependencies)`, and `Layer.provide` only
exposes the target's own output — so a service missing from `dependencies` is
genuinely absent from context when the implementation effect runs, regardless
of what any outer or sibling layer provides elsewhere in the graph. There's no
"it happens to work anyway via ambient context" fallback here.

Likely origin: `SessionMemoryIntegration.Service` (the server's own wrapper,
tag `@diveeoi/server/SessionMemoryIntegration`) is easy to confuse with
`Memory.node` (`@diveeoi/memory`'s underlying package graph). Two of the three
files added `Memory.node` — thinking it covered the local `memory` variable —
without realizing `SessionMemoryIntegration.node` is a separate node.

## Issues found and fixed

### 1. `src/share/session.ts` — confirmed crash cause
`layer`'s top-level `Effect.gen` does `yield* SessionMemoryIntegration.Service`
unconditionally to build `SessionShare.Service` (used inside `createWithMemory`).
This runs **eagerly at layer-build time**, i.e. at server boot as part of the
big `app` graph in `httpapi/server.ts` — guaranteed to fail every boot.

```diff
- export const node = LayerNode.make(layer as never, [Config.node, Session.node, ShareNext.node, RuntimeFlags.node, Memory.node])
+ export const node = LayerNode.make(layer, [
+   Config.node, Session.node, ShareNext.node, RuntimeFlags.node, Memory.node,
+   SessionMemoryIntegration.node,
+ ])
```
Also added `Layer.provide(SessionMemoryIntegration.defaultLayer)` to `defaultLayer`.

### 2. `src/session/prompt.ts` — latent bug, same pattern
`yield* SessionMemoryIntegration.Service` at line 1218 is inside `runLoop`,
a closure only evaluated per-invocation (not at boot), so this one likely
wasn't the direct crash — but it's the identical missing-dependency defect,
and would misbehave the moment `runLoop` runs outside a context that happens
to carry `SessionMemoryIntegration` ambiently (e.g. a background job, CLI
path, or test).

```diff
- export const node = LayerNode.make(layer as never, [
+ export const node = LayerNode.make(layer, [
+   SessionMemoryIntegration.node,
    SessionStatus.node,
    ...
```
Also added `Layer.provide(SessionMemoryIntegration.defaultLayer)` to `defaultLayer`.

### 3. `src/control-plane/workspace.ts` — same pattern, different service
Not related to memory. `yield* InstanceStore.Service` (line 288, inside a
nested closure) was missing from `node`'s dependencies, also masked by
`layer as never`.

```diff
- export const node = LayerNode.make(layer as never, [
+ export const node = LayerNode.make(layer, [
    Auth.node, Session.node, SessionPrompt.node, httpClient, EventV2Bridge.node,
    Vcs.node, RuntimeFlags.node, FSUtil.node, Database.node,
+   InstanceStore.node,
  ])
```
Also added `Layer.provide(InstanceStore.defaultLayer)` to `defaultLayer`.

**Verified clean:** grepped every remaining `LayerNode.make(... as never|any)` and
every remaining `SessionMemoryIntegration` consumer — no other instances of
this pattern left in `packages/server/src`.

## Secondary issue: `EADDRINUSE` on port 4097 (not a code bug)

`src/main.ts:12`: `const port = parseInt(process.env.PORT || "4097", 10)`.
In one of the terminal attempts, `VITE_DIVEEOI_SERVER_PORT=3097 PORT=3097` was
typed on its own line with no command after it — in bash that only sets local
shell variables, it does **not** export them to child processes. The next
`diveeoi` invocation therefore ran with no `PORT` in its environment and fell
back to the hardcoded default `4097`, colliding with whatever already held
that port. Fix on the shell side: use `export PORT=3097` (as was correctly
done in the later attempt) or prefix every invocation with `PORT=3097 diveeoi`.
No code change needed here.

## Verification

Not run in this environment (no `bun` available in the sandbox used for this
fix, and a full workspace install was out of scope). Please confirm on your
machine:
```
bun run typecheck   # packages/server — confirms CheckDependencies now passes honestly
bun run dev          # or the compiled binary — confirms the server boots past this point
```

## Files changed (root-cause fix)
- `packages/server/src/session/memory-scheduler.ts` (**actual root cause, fix 1**)
- `packages/server/src/session/memory.ts` (**actual root cause, fix 2**)

---

## Batch pass: every remaining error, same-pattern audit

Full `tsgo --noEmit` scoped to `src/` (needed 4GB swap added to the sandbox;
`tsgo` OOM-kills around ~3.5GB on this codebase's type-closure size). 21
errors found. Fixed 12; the remaining 9 are pre-existing, unrelated
subsystems, documented below rather than guessed at.

### Fixed — memory feature, all real bugs

1. **`session/prompt.ts`** — the earlier `SessionMemoryIntegration.defaultLayer`
   fix pushed a `.pipe()` chain from 20 to 21 `Layer.provide(...)` arguments
   (Effect's `.pipe()` overloads cap at 20). Folded the new arg into the
   file's own existing merged group instead of adding a 21st top-level arg.
2. **`MemoryScheduler.Service` → `MemoryScheduler.MemorySchedulerService`**
   (`handlers/memory.ts`, `tool/memory/extract.ts`, 3 call sites) — the tag
   is exported as `MemorySchedulerService`, not `Service`; `.Service` was
   `undefined` at runtime.
3. **`handlers/memory.ts`** — `scheduler.extractNow` called without `()`
   (it's a function, not a plain Effect); `request.url.pathname` doesn't
   exist (`request.url` is a plain string in this Effect Platform version) —
   switched to `yield* HttpRouter.params` to read the route's own `:sessionID`
   param, matching this codebase's convention elsewhere instead of
   re-parsing the URL.
4. **`session/memory-scheduler.ts`** — `.filter(part => part.type === "text" && ...)`
   doesn't narrow the array element type in TS (needs an explicit type
   guard); `DateTime.Utc` has no `.year`/`.month`/`.day` directly, needed
   `DateTime.toPartsUtc()`.
5. **`tool/memory/extract.ts`** — rewritten to match the sibling
   `tool/memory/retrieve.ts`/`consolidate.ts` pattern: `Tool.define`'s
   `parameters` must be an Effect `Schema.Struct`, not a raw JSON-schema
   object; session ID must come from `ctx.sessionID` (the per-call tool
   context), not `yield* SessionID` (a schema/brand type, not an injectable
   tag — this would have thrown "not iterable" the first time the tool ran).
   Also closed `MemoryConfig` via `Effect.provide` so `execute`'s return
   type matches `Tool`'s `Effect<ExecuteResult>` (no leftover R) contract.

### Fixed — same defaultLayer-isolation bug class, found by running the real server further

Same root cause as the original report: `X.pipe(Layer.provide(A), Layer.provide(B))`
— **each `Layer.provide()` dependency is built in total isolation from every
sibling `Layer.provide()` in the same chain.** This means `X.defaultLayer`
must be self-sufficient on its own; nothing "sees" anything a sibling step
supplied.

6. **`tool/registry.ts`**: `ToolRegistry.defaultLayer` didn't include
   `Ripgrep.defaultLayer` (grep/glob tools need `Ripgrep.Service`), even
   though `.node` already correctly listed `Ripgrep.node`. This was the
   `Service not found: @opencode/v2/Ripgrep` crash from the previous report
   update — confirmed fixed by actually running the server past it.
7. **`session/system.ts`**: `SystemPrompt.defaultLayer` used the *raw*
   `IdentityLoader.layer`/`SkillMentions.layer` (both need the platform
   `FileSystem` tag, unprovided) instead of the wrapped, self-sufficient
   versions used by `.node`; also missing `SessionMemoryIntegration.defaultLayer`
   entirely (present in `.node`, absent from `.defaultLayer`).

Verified end-to-end by removing the `as never` cast on `effect/app-runtime.ts`'s
`ManagedRuntime.make(AppLayer, ...)` (a 49-layer `Layer.mergeAll` — the
same bug class again, at the top level) and rerunning typecheck + the real
server, iterating until the crash sequence (`SessionMemoryIntegration` →
`Ripgrep` → clean boot) fully resolved. **Confirmed: `bun run ./src/main.ts`
now logs `DiveeOI server listening on http://0.0.0.0:4097` and stays up.**

`AppLayer as never` still has **two remaining, narrower gaps** —
`Workspace.defaultLayer` and `Worktree.appLayer` each leak one unnamed
service (traced `Workspace`'s partway to a generic `runInWorkspace<A,E,R>`
helper, not fully pinned down). Restored the `as never` cast rather than
leave the file in a newly-broken uncasted state. **Confirmed these do not
affect actual startup** — the server boots and listens fine with the cast
removed too, so whatever's leaking is only reachable on some path not
exercised by boot. Left for a follow-up pass since diminishing returns kicked
in; not urgent.

### Found, deliberately not touched — unrelated, pre-existing, out of scope

- **`permission/index.ts`** (2 errors) — a `.info` field resolving to the
  wrong type (`Interface` instead of `PermissionV1.Request`) in the
  permission-approval flow. Security-adjacent, needs real understanding of
  intent, didn't want to guess.
- **`server/routes/instance/httpapi/{handlers/memory.ts,server.ts}`** —
  `"Need to .combine(middleware) that satisfy the missing request dependencies"`.
  Traced to `authorizationRouterMiddleware`, which is explicitly commented
  `"Auth disabled — always pass through"` in `middleware/authorization.ts`.
  The stub's shape doesn't satisfy `HttpRouter.middleware()`'s type-level
  contract. Fixing the type properly means touching real auth wiring —
  security-sensitive, deliberately disabled by someone on purpose, not
  something to reshape on a guess.
- **`middleware/proxy.ts`** — websocket proxy leaks an `AdaptiveResourceService`
  requirement it shouldn't have. Unrelated subsystem, didn't dig in.
- **`session/llm/native-runtime.ts`** (5 errors) — `AbortSignal`/`Stream`
  typing mismatches in LLM response streaming. High-risk to touch without
  understanding the streaming design; this is live-request code, not
  boot-time. Didn't touch it.

None of these 9 block server startup (confirmed).

## Files changed (batch pass)
- `packages/server/src/server/routes/instance/httpapi/handlers/memory.ts`
- `packages/server/src/session/memory-scheduler.ts`
- `packages/server/src/session/prompt.ts`
- `packages/server/src/session/system.ts`
- `packages/server/src/tool/memory/extract.ts`
- `packages/server/src/tool/registry.ts`
- `BUGFIX-session-memory-integration.md` (this report)
