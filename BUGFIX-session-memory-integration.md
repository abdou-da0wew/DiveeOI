# Bug Report: `Service not found: @diveeoi/server/SessionMemoryIntegration`

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

## Files changed
- `packages/server/src/share/session.ts`
- `packages/server/src/session/prompt.ts`
- `packages/server/src/control-plane/workspace.ts`
- `BUGFIX-session-memory-integration.md` (this report)
