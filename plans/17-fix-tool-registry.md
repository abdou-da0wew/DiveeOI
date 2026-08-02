# Plan 17 — Fix `packages/server/src/tool/registry.ts` (1 error)

## Error

- `125,7` TS2345: Argument of type '(ctx: InstanceContext) => Effect<{ custom: Def<Decoder<unknown, never>, Metadata>[]; builtin: (Def<Struct<{ readonly format: ...}>, ...> | ... 20 more ... | Info<...>)[]; task: Def<...>; read: Def<...>; lazy: { ... }[]; ... }' is not assignable to parameter of type '(ctx: InstanceContext) => Effect<State, never, Scope>'.

## Context (already explored — lines ~100-140)

```ts
const state = yield* InstanceState.make<State>(
  Effect.fn("ToolRegistry.state")(function* (ctx) {
    const custom: Tool.Def[] = []
    function fromPlugin(id: string, def: ToolDefinition): Tool.Def { ... }   // ~line 110-125
    ...
```

The gen builds the state object: `{ custom, builtin, task, read, lazy, ... }`. `custom` is
explicitly annotated `Tool.Def[]` (line ~107) but the other fields (`builtin`, `task`, `read`,
`lazy`) are inferred as their SPECIFIC def types (a huge union incl. `Def<Struct<...>>`,
`Info<...>`), which is not assignable to `State`'s field types (`Tool.Def[]` / `Tool.Def`).

## Root cause

Missing explicit type annotations on the state object fields inside the gen. Inferred union of
concrete def types ≠ the erased `Tool.Def` alias used by `State`.

## Prescribed fix

1. Read lines 100-160 fully. Find the `State` type declaration (grep `export type State` /
   `type State =` in the file — likely `{ custom: Tool.Def[]; builtin: Tool.Def[]; task: Tool.Def; read: Tool.Def; lazy: Tool.Def[]; ... }`).
2. Annotate every field that builds a def array/object to the exact `State` field type:
   - `const builtin: Tool.Def[] = ...` (or `as Tool.Def[]` on the value)
   - `task: Tool.Def`, `read: Tool.Def`, `lazy: Tool.Def[]` — same treatment
   - any remaining fields in the returned object literal.
3. Prefer annotating the declarations (like the existing `const custom: Tool.Def[] = []`)
   over casting the final return. If a field is produced by a helper that returns a narrower
   type, annotate at the helper call site: `const task: Tool.Def = buildTask()`.
4. If `Tool.Def` isn't the right alias for every field (read `State` first), use whatever
   `State` declares — the goal is the returned object EXACTLY matching `State`.

## Verify

- Read the final gen return — every field is annotated or directly assignable to `State`.
- `grep -n "Tool.Def" src/tool/registry.ts` — annotations present on builtin/task/read/lazy.
- Do NOT run typecheck.
