# Fix: InstanceRef Startup Capture + Tracer Integration

## Problem Analysis

### Root Cause
`SessionPrompt` layer at `prompt.ts:169` captured `InstanceState.context` at **layer construction time** (server startup). At that point, no HTTP request has arrived, so `InstanceRef` is not in context. `InstanceState.context` returns a fallback with `project.id: "startup"` (cast `as any`). This stale fallback was then force-injected into every `runLoop()` call via `Effect.provideService(InstanceRef, instanceCtx)` at line 1443, **overriding** the per-request `InstanceRef` from middleware.

### Fallback Consequence Chain
```
InstanceRef absent → InstanceState.context returns { project: { id: "startup" } }
  → Project.ID.make("startup") succeeds silently (branded string, no validation)
  → Location.Info built with fake project ID + process.cwd() as directory
  → EventV2Bridge publishes events with fake location
  → ALL 7 consumer sites drop events (directory mismatch)
  → Sessions stored under projectID = "startup" (data corruption)
  → Filesystem dirs at <data>/worktree/startup/ (stale accumulation)
  → API responses return wrong project data
```

### Subagent Verification
All 15 code paths reaching `runLoop()` already have `InstanceRef` in context via:
- **HTTP middleware** (11 paths): `InstanceContextMiddleware.provideService(InstanceRef, ctx)`
- **Internal nesting** (3 paths): `EffectBridge` captures and re-provides InstanceRef
- **Tests** (1 path): test fixture `withTmpdirInstance`

Conclusion: The `provideService(InstanceRef, ...)` was **never needed** for any real code path. It was actively harmful.

---

## Plan

### Phase 1 — Lazy InstanceRef Fallback (Replaces the broken capture)

**Current code** (after the initial remove):
- `loop()` calls `runLoop(sessionID)` without any InstanceRef override
- `runLoop()` internally calls `InstanceState.context` which reads InstanceRef from context and falls back if absent

**What the "pro" fix adds back:**
A **lazy, per-call InstanceRef checker** that preserves the author's original safety intent without the startup-timing bug:

```
Before (buggy):
  capture at startup → stale fallback → always override → BUG

After (pro):
  check at call time → use middleware's InstanceRef if present
                       → only provide fallback if absent
                       → NEVER override the middleware one
```

Implementation: Add a helper `ensureInstanceRef` inside the `SessionPrompt.make` closure that:
1. Reads `InstanceRef` from context
2. If non-undefined (middleware provided it) → run effect as-is
3. If undefined (no middleware, e.g. future non-HTTP path) → capture `InstanceState.context` at call time and provide it

This is fundamentally different from the original because:
- **Timing**: captured at call time, not startup → InstanceRef might be present
- **Override**: only provides when absent, never replaces middleware's InstanceRef
- **Freshness**: each call gets a fresh snapshot, not a stale one

```typescript
const ensureInstanceRef = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const ref = yield* InstanceRef
    if (ref) return yield* effect
    return yield* effect.pipe(Effect.provideService(InstanceRef, yield* InstanceState.context))
  })
```

### Phase 2 — `loop()` uses ensureInstanceRef

```typescript
const loop = Effect.fn("SessionPrompt.loop")(function* (input: LoopInput) {
  return yield* state.ensureRunning(
    input.sessionID,
    lastAssistant(input.sessionID),
    ensureInstanceRef(runLoop(input.sessionID)),
  )
})
```

`command()` and `shell()` don't need this wrapper because they either:
- Don't reach `runLoop()` directly (shell → shellImpl)
- Already go through loop → ensureInstanceRef (command → prompt → loop)

### Phase 3 — Tracer Integration (already done)

Replaced hand-written `Effect.logInfo/Error/Warning` calls with structured `Tracer.info/error/warn` calls that auto-inject `traceId`. Changes in: `prompt.ts`, `llm.ts`, `processor.ts`.

### Phase 4 — HTTP Trace Middleware (already done)

`lifecycle.ts`: `traceMiddleware` generates per-request `traceId`, logs `http.request.start/end` with timing.
`server.ts`: composes `traceMiddleware` with `disposeMiddleware` at router level.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| `ensureInstanceRef` fallback still uses `InstanceState.context` which returns "startup" for truly non-HTTP paths | MEDIUM — events dropped, session data corrupted | ALL current non-HTTP paths already have InstanceRef via EffectBridge. This is purely a safety net for unknown future paths. |
| The `as any` cast in `InstanceState.context` fallback hides type errors | HIGH — masks the root issue | Separate fix in `InstanceState.context` to produce a valid sentinel instead of invalid cast. Not in scope here. |
| EventV2Bridge silently drops events with invalid location | MEDIUM — debugging nightmare | Should log warning when location is invalid. Not in scope here. |

---

## Files Changed

| File | Change |
|---|---|
| `packages/server/src/session/prompt.ts` | Remove startup capture; add `ensureInstanceRef` helper; replace Effect.log* with Tracer |
| `packages/server/src/effect/tracer.ts` | **NEW** — TraceId reference + log helpers |
| `packages/server/src/server/routes/instance/httpapi/lifecycle.ts` | Add `traceMiddleware` |
| `packages/server/src/server/routes/instance/httpapi/server.ts` | Compose traceMiddleware |
| `packages/server/src/session/llm.ts` | Replace Effect.log* with Tracer |
| `packages/server/src/session/processor.ts` | Replace Effect.log* with Tracer |
