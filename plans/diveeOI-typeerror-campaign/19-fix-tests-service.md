# Plan 19 — Fix tests: system.test.ts (2) + test-layer-build.ts (3) + workspace.test.ts (1) + httpapi-exercise/index.ts (1)

Ownership: all FOUR files are yours. Touch nothing else.

## File 1: `packages/server/test/session/system.test.ts` — lines 70, 71
- `70,35` TS2339: Property 'skills' does not exist on type 'Interface'.
- `71,36` TS2339: Property 'skills' does not exist on type 'Interface'.

Root cause: the old `SystemPrompt.Interface` had a `skills` member; in beta.74 the interface
(`src/session/system.ts:52-63`) has ONLY `system`:
```
system: (
  model: Provider.Model,
  agent: Agent.Info,
  msgs: ReadonlyArray<{ info: { role: string }; parts?: ReadonlyArray<{ text?: string }> }>,
  sessionID: SessionID,
) => Effect.Effect<SystemAssembly, MemoryError | PlatformError, any>
```

Fix: read the test (lines ~40-90). Replace the old-style interface construction (with
`skills`) with the new shape, then assert against the `SystemAssembly` the test actually needs:
- If it only checks assembly output: call `iface.system(model, agent, msgs, sessionID)` and
  assert on the returned `SystemAssembly.system` (string) content.
- If it checks that the system prompt includes certain skills, assert that the assembled
  string contains the expected skill names instead of a `skills` member.
Keep the test's intent; adapt only the API surface.

## File 2: `packages/server/test/test-layer-build.ts` — lines 24, 26, 27
- `24,58` TS2339: Property 'either' does not exist on 'typeof Effect'.
- `26,7` + `27,30` TS18046: 'result' is of type 'unknown'.

Root cause: `Effect.either` was removed in beta.74. VERIFIED available alternatives:
- `Effect.exit` (Effect.d.ts:3303): `Effect.exit(effect)` → `Effect<Exit.Exit<A, E>, never, R>`
- `Effect.match` (Effect.d.ts:9390): `Effect.match(effect, { onFailure: (e) => ..., onSuccess: (a) => ... })`

Fix: read lines 15-40. If the test does:
```ts
const result = yield* Effect.either(build(...))
if (result._tag === "Left") throw result.left
expect(result.right).toEqual(...)
```
replace with `Effect.exit` + `Exit` guards:
```ts
const exit = yield* Effect.exit(build(...))
if (Exit.isSuccess(exit)) {
  expect(exit.value).toEqual(...)
} else {
  throw Exit.failureOption(exit)  // or assert on the failure branch
}
```
or with `Effect.match` collapsing to a discriminated result. Prefer the minimal change that
preserves the test's assertions.

## File 3: `packages/server/test/control-plane/workspace.test.ts` — line 135
- `135,5` TS2345: Argument of type 'Effect<void, unknown, unknown>' is not assignable to
  parameter of type 'Effect<void, unknown, never>'.

Root cause: `Effect.runPromise` in beta.74 (Effect.d.ts:16232) requires `R = never`:
`runPromise: <A, E>(effect: Effect<A, E>, options?) => Promise<A>`. The tested effect has
`R = unknown` — SOMETHING in the pipeline erases R. An `R = unknown` (not a named service)
means a yielded `Service.Tag`/`Context.Tag` whose type parameter is `unknown` — i.e. a tag
declared without its service type, so beta.74 infers `Service.Tag<unknown>`.

Fix:
1. Read lines ~80-140 (the effect passed to runPromise at 135) and trace every `yield*`
   service access inside it.
2. Find the tag/access that yields `unknown` — typically `yield* SomeService` where
   `SomeService` is a `Service.Tag` declared without a type argument, or a `Context.Tag`
   similarly. Annotate it with its real service type (grep the service class/interface it
   wraps; mirror how sibling tests/control-plane files declare and use the same tag).
3. If instead R=unknown comes from a `Layer.provide(...)`/`Layer.effect(...)` misuse, fix the
   layer to have the concrete service type.
4. Sanity: sibling passing tests in `test/control-plane/` that call `Effect.runPromise` show
   the expected pattern — diff against them.

## File 4: `packages/server/test/server/httpapi-exercise/index.ts` — line 1683
- `1683,19` TS2345: Argument of type 'Effect<undefined, Error | ServeError, unknown>' is not
  assignable to parameter of type 'Effect<undefined, Error | ServeError, never>'.

Root cause: same class — `Effect.runPromise` (or `runSync`) at 1683 requires R=never but the
app effect has R=unknown. E is concrete (`Error | ServeError`), so the R=unknown again points
to a yielded `Service.Tag`/`Context.Tag` with an unknown type parameter somewhere in the
pipeline (lines ~1600-1683), OR a `Layer` that widened.

Fix:
1. Read lines ~1600-1690. Trace the effect passed at 1683 and find the R=unknown producer.
2. Same treatment as File 3: annotate the offending tag with its service type, or provide the
   concrete layer. If the app builds via `HttpServer.serve(...).pipe(Effect.provide(...))`,
   check the provided layers cover everything the middleware yields — and that no tag is
   unannotated.
3. Mirror how the OTHER example files in `test/server/` (that compile cleanly) declare their
   services and run the server.

## Verify (all four files)
- No remaining `.either`, no `.skills` on Interface, no curried-arg misuse of runPromise.
- Re-read each edited region against the errors above.
- Do NOT run typecheck.
