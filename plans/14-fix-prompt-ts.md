# Plan 14 — Fix `packages/server/src/session/prompt.ts` (24 errors)

THIS FILE IS YOURS ALONE. Do not touch any other file. (The 1381 fix is call-site-only; if you
believe system.ts must change, DO NOT edit system.ts — use the call-site mapping below.)

## Error groups

### Group A — lines 233-256 (8 errors) — user-message branch inside an Effect.gen
- `233,25` TS2488 never-iterator + `233,57` TS2339 `catchAll` missing
- `237,26` TS2488 · `238,30` TS2488 · `239,18` TS2339 `catchAll`
- `243,25` TS2488 + `243,83` TS2339: `Property 'modelID' does not exist on type '{ id: string & Brand<"ModelV2.ID">; providerID: string & Brand<"ProviderV2.ID">; variant?: string | undefined; }'`
- `244,20` TS2339 `catchAll` · `248,22` TS2339 `catchAll` · `253,27` TS2488
- `256,11` TS2739: literal `{ id: ..., role: "user" }` missing required fields `time, agent, model, sessionID, ...`

Root cause: `Effect.catchAll` was REMOVED in beta.74 → the gen's inference collapses to `never`
(causing the TS2488 cascades). The model type was renamed: `modelID` → `id` (a
`string & Brand<"ModelV2.ID">`). The message literal must be built against the v2 Message type.

Fix:
1. Every `.pipe(Effect.catchAll(...))` in this region → `.pipe(Effect.catch(...))`.
   Pattern proven in the clean memory tools:
   ```ts
   x.pipe(Effect.catch((err) => Effect.logError("op.name", { ... })))
   ```
   If a handler previously returned a concrete value (e.g. `Effect.void` or an error), keep the
   same body — `Effect.catch` returns the handler's effect.
2. `243,83`: `input.model.modelID` → `input.model.id`.
3. `256`: read the region and find the v2 Message type the literal must satisfy (search
   `db/src/v1/session.ts` and `db/session/message.ts` for the schema whose type has
   `role: "user"` + `time: { created: number }` + `model: { providerID; modelID; variant? }`).
   Construct the FULL literal with every required field, mapping:
   - `model.modelID` ← `input.model.id` (the renamed field)
   - `model.providerID` ← `input.model.providerID`
   - `agent` ← the agent id/name available in scope
   - `sessionID` ← `input.sessionID`
   - `time: { created: ... }` ← `Date.now()` or a `DateTime` util already used in the file
   - plus the remaining required fields (read the type to enumerate them; likely `parts`,
     `parentID`, `version`, `deleted`, etc.)
   Match how OTHER message constructions in the file already build this type (search the file
   for `time: { created:` and for `Message` schema usages).

### Group B — lines 271-284 (4 errors)
- `271,18` TS2339: `catchAllCause` missing (TS suggests `catchCause`)
- `271,33` TS7006 `cause` implicit any
- `283,15` + `284,16` TS7006 `line` implicit any

Root cause: same catch-API removal; `catchAllCause` is gone.

Fix:
1. `Effect.catchAllCause(...)` → `Effect.catchCause(...)` (the handler receives a `Cause` —
   keep the handler body; `cause` will be implicitly typed once the API is correct).
2. Read lines 265-290. The `line` implicit-any params at 283/284 are inside a loop whose
   iterable type collapsed while `catchAllCause` was unresolved. After the catchCause fix,
   re-verify the loop source is properly typed; if it is still untyped (e.g. iterating an
   `unknown`), type the source explicitly (read the surrounding code to find what `lines`
   should be — likely a `string[]` from `.split("\n")` or a file read).

### Group C — line 1159 (1 error)
- `1159,11` TS2719: `const prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error> = Effect.fn("SessionPrompt.prompt")(function* (input: PromptInput) {...})` — "Two different types with this name exist, but they are unrelated."

Root cause: the explicit const annotation conflicts with the signature `Effect.fn` now infers in
beta.74. The known-good pattern in this repo is `processor.ts:961`:
```ts
const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) { ... })
```
(no const annotation) — that compiles clean.

Fix:
1. Remove the explicit function-type annotation: `const prompt = Effect.fn("SessionPrompt.prompt")(function* (input: PromptInput) { ... })`.
2. Check the call site at line ~174: `prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die))` — the `Prompt` interface (line ~130) declares `prompt: (input: PromptInput) => Effect.Effect<SessionV1.WithParts, Image.Error>`. If removing the annotation makes the interface check fail on `R` (the gen must have `R = never` since all yielded services come from InstanceState/context), ensure the gen does not yield anything with R. If it does, keep the annotation but match the exact inferred type — read what the gen yields and mirror processor.ts patterns.
3. If the interface still mismatches, check how the OTHER service implementations in this file satisfy it (read the `Session` service layer ~line 160-190).

### Group D — line 1177 (1 error)
- `1177,20` TS2339 `catchAll` — in the title-generation fork (`Effect.fork`/`forkScoped` region ~1170-1190).

Fix: `Effect.catchAll(() => Effect.void)` → `Effect.catch(() => Effect.void)` (or `Effect.catch(...)` with the existing body).

### Group E — lines 1255-1256, 1283-1284 (6 errors)
- `1255,20` TS2488 · `1256,22` TS2339 `catchAll` · `1256,32` TS7006 `err` implicit any
- `1283,22` TS2488 · `1284,24` TS2339 `catchAll` · `1284,34` TS7006 `err` implicit any

Root cause: `memory.extractSessionMemory(...)` / `memory.upsert...` pipelines use `Effect.catchAll`.

Fix: read lines 1245-1295. Convert both `.pipe(Effect.catchAll((err) => ...))` → `.pipe(Effect.catch((err) => ...))`. Keep the handler bodies (they log and continue — likely `Effect.logError` or `Effect.void`). `err` becomes properly typed. If the handler body was `Effect.logError("msg", err)` keep it; if it was `Effect.logError("msg")` keep it.

### Group F — line 1381 (1 error)
- `1381,40` TS2345: `Argument of type 'WithParts[]' is not assignable to parameter of type 'readonly { info: { role: string; }; parts?: readonly { text?: string | undefined; }[] | undefined; }[]'`

Root cause: `sys.system(model, agent, msgs, sessionID)` — `msgs` is `SessionV1.WithParts[]`
(`WithParts = { info: Info; parts: Part[] }`, see `db/src/v1/session.ts:499`) and the
`SystemPrompt.Interface.system` signature (system.ts:57) expects the loose structural type.
A part variant is structurally incompatible (likely a `text?: string | null` variant) —
read `db/src/v1/session.ts` lines ~400-510 (`Part`, `User`, `Assistant`, `Info`, `WithParts`)
to identify it, but DO NOT edit db or system.ts.

Fix (call-site only, guaranteed to satisfy the loose type):
```ts
const legacyMsgs = msgs.map((m) => ({
  info: { role: m.info.role },
  parts: m.parts.map((p) => ({ text: "text" in p ? p.text : undefined })),
}))
```
then pass `legacyMsgs` to `sys.system(...)`. If `m.info.role` itself fails (branded), cast:
`role: String(m.info.role)`. Adjust variable naming to the file's style. Do NOT touch system.ts.

## General rules

- Read every region before editing. Full edits only — no placeholders, no `any` casts unless
  the surrounding code already uses them, no comments unless the file style has them.
- Match existing patterns in this file and the clean memory tools (`src/tool/memory/*.ts`
  uses `Effect.catch` — read one for the exact shape).
- Do NOT run typecheck — no tsc, no tsgo, no `bunx tsc`. Verify by reading.
- After editing, grep your changed regions for leftover `catchAll`/`catchAllCause`/`modelID`.

## Return format

Report: per error group — what you changed, at which lines, and any type you read that
explained a mismatch (e.g. the Part variant that breaks 1381). Note anything you were unsure
about.
