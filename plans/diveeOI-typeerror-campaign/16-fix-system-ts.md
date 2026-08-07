# Plan 16 — Fix `packages/server/src/session/system.ts` (5 errors)

## Errors

- `188,63` TS2345: `Argument of type '[]' is not assignable to parameter of type 'readonly [] & { readonly "Missing dependencies": FileSystem; }'`
- `194,17` TS2769: No overload matches this call.
- `195,17` TS2769: No overload matches this call.
- `196,17` TS2769: No overload matches this call.
- `199,43` TS2345: `Argument of type '[Node<Service, never>, Node<LocationServiceMap, never>, Node<Service, never>, never, Node<Service, never>, Node<...>, never]' is not assignable to parameter of type 'readonly [...] & { ...; }'`

## Context (already explored — lines 180-202)

```ts
const locationServiceMapNode = LayerNode.make(LocationServiceMap.layer, [])          // line 188
const contextBudgetNode = LayerNode.make(ContextBudget.layer, [])
const skillMentionsNode = LayerNode.make(SkillMentions.layer, [])

export const defaultLayer = layer.pipe(
  Layer.provide(Skill.defaultLayer),                                                 // 193
  Layer.provide(LocationServiceMap.layer),                                           // 194
  Layer.provide(Reminders.defaultLayer),                                             // 195
  Layer.provide(IdentityLoader.node),                                                // 196
  Layer.provide(contextBudgetNode),
  Layer.provide(skillMentionsNode),
)

export const node = LayerNode.make(layer, [                                           // 199
  Skill.node,
  locationServiceMapNode,
  Reminders.node,
  IdentityLoader.node as never,
  contextBudgetNode,
  skillMentionsNode,
  ...
```

The `LayerNode.make` dependency checker (`packages/db/src/effect/layer-node.ts`, `CheckDependencies`)
requires every service in `Implementation`'s `Layer.Services` to appear in the dependencies
tuple — the error literally names the missing one: `FileSystem`.

## Root cause

At least one of the layers (`LocationServiceMap.layer`, `Reminders.defaultLayer`,
`IdentityLoader.node`, or `layer` itself) requires `FileSystem` (the effect/FileSystem service)
in its R. The `[]` at 188 and the node tuple at 199 don't provide it.

## Prescribed fix

1. Read `packages/db/src/effect/layer-node.ts` (already known: `make(implementation, dependencies)`
   where dependencies must cover `Layer.Services<Implementation>`; the error's
   `"Missing dependencies"` key names exactly what's missing).
2. Determine which layer needs `FileSystem`:
   - Read `LocationServiceMap.layer` / `Reminders.defaultLayer` / `IdentityLoader.node`
     definitions (grep `export const layer` / `Layer.effect` in their source files) and check
     their R — look for `FileSystem` (from `effect` or `@effect/platform`) in their
     `Layer.Layer<A, E, R>` types.
3. Fix by adding a FileSystem-providing node to each failing `LayerNode.make`/`Layer.provide`:
   - Find how OTHER files in the repo provide `FileSystem` to a `LayerNode` (grep
     `LayerNode.make` across `packages/server/src` and `packages/db/src` and look for any
     call passing a FileSystem node — e.g. `NodeServices.layer`, `FileSystem.node`,
     `Layer.effect(FileSystem, ...)`, or `Layer.provideMerge(NodeServices.layer)`).
   - Match the repo's established pattern. If `@effect/platform-node` `NodeServices.layer` is
     used elsewhere, mirror it: e.g. create `const fileSystemNode = LayerNode.make(NodeServices.layer, [])`
     (or however the repo wraps platform layers — read an existing example first) and include
     it in both the 188 call and the 199 tuple, plus `Layer.provide(...)` additions at 194-196
     if those overloads demand it.
4. IMPORTANT — repo guidance (AGENTS.md): "`as never` casts at `LayerNode.make` call sites —
   needed because Effect v4 beta.74 propagates `unknown` as RIn when layers with opaque RIn are
   composed via `Layer.provide`/`Layer.provideMerge`." So:
   - The `as never` on `IdentityLoader.node` is an existing sanctioned suppression — keep it.
   - If the "Missing dependencies: FileSystem" check fails because a layer's RIn is opaque/
     `unknown` (not a genuine FileSystem requirement), the repo pattern is to cast the node in
     the tuple `as never` — mirror the existing usage.
   - If the layer GENUINELY requires `FileSystem` (its `Layer.Layer<A, E, RIn>` shows
     `FileSystem` in RIn), then provide a FileSystem node in the tuple instead of casting.
     Check `packages/server/AGENTS.md` for how other files provide FileSystem/platform layers
     (grep `LayerNode.make` across `packages/server/src` and `packages/db/src` for a working
     example before choosing).
5. Do NOT change the `system` method signature (lines 52-63) — the 1381 call-site fix lives in
   prompt.ts, not here.

## Verify

- `grep -n "LayerNode.make\|Layer.provide" src/session/system.ts` — every make/provide now
  supplies the missing FileSystem dependency (or mirrors a proven repo pattern).
- Do NOT run typecheck.
