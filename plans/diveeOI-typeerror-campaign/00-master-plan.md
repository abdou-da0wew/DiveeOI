# DiveeOI Type-Error Campaign — Master Plan

Phase: PLANNING COMPLETE — ready to dispatch subagents.

## Goal

Eliminate all 56 remaining TypeScript errors in the DiveeOI monorepo (baseline captured at
`/tmp/opencode/server-errors.txt` from `cd packages/server && bunx tsc --noEmit`). Memory tools
(`src/tool/memory/*`) are already clean and are NOT part of this campaign.

## Phase Rules (user-mandated workflow)

1. Subagents NEVER run typecheck — no `tsc`, no `tsgo`, no `bunx tsc`. They fix by reading code
   and matching known-good patterns.
2. Only the orchestrator (Gelo-4) runs `bunx tsc --noEmit` — once after ALL subagents finish.
3. Diff the new output against the 56-error baseline. Replan and re-dispatch subagents for any
   error left OR newly introduced. Loop until zero errors.
4. One subagent owns each file — no two subagents touch the same file (prevents merge conflicts).
5. All fixes follow existing repo patterns; full edits, no placeholders; no AI-sloppy commit
   conventions (no commits are made in this phase anyway).

## Error Baseline (56 errors, 14 files)

### Production code (43 errors)

| # | File | Lines | Error code | Root cause | Fix |
|---|------|-------|-----------|------------|-----|
| 1 | `packages/db/src/tool/glob.ts` | 132, 135 | TS2504 | `proc.stdout` is `ReadableStream<Uint8Array>` — TS lib lacks `[Symbol.asyncIterator]` | Cast `proc.stdout as AsyncIterable<Uint8Array>` or use `.getReader()` loop |
| 2 | `src/cli/index.ts` | 1 | TS2305 | `"bun"` module no longer exports `Database` | `import { Database } from "bun:sqlite"` (verified: bun-types@1.3.13 `sqlite.d.ts:117` `export class Database`) |
| 3 | `src/config/registry.ts` | 5, 7, 11, 15 | TS2694 | `Schema.All` removed in Effect beta.74 | Replace with `Schema.Top` (the documented existential "any schema" type — `Schema.d.ts:187`, interface at :507) |
| 4 | `src/mcp/index.ts` | 466 | TS2464 | Computed property key not `string \| number \| symbol` | Read `context-mode.ts` + lines 455-470; align code to actual `resolveContextModeMCP` return (`Record<string, {type,command,enabled}> \| undefined`); merge via `Object.entries` or `String(...)` key |
| 5 | `src/session/prompt.ts` | 24 errors (see plan 14) | mixed | `Effect.catchAll`/`catchAllCause` removed; `modelID` renamed; Message v2 shape; TS2719 annotation; `WithParts[]` vs structural type | See `plans/14-fix-prompt-ts.md` |
| 6 | `src/session/session.ts` | 381, 385, 431, 432, 432 | TS2552/TS2833/TS7006 | Missing `Global` and `Provider` imports; implicit-any cascade | Restore `import { Provider } from "@/provider/provider"` and the `Global` import used by `snapshot/index.ts`/`config.ts`; 431/432 resolve once `input.model` is typed |
| 7 | `src/session/system.ts` | 188, 194, 195, 196, 199 | TS2345/TS2769 | `LayerNode.make`/`Layer.provide` missing `FileSystem` dependency; `[]` fails `CheckDependencies` | See plan 16 |
| 8 | `src/tool/registry.ts` | 125 | TS2345 | `InstanceState.make<State>` gen returns inferred def types not matching `State` | Annotate `builtin`/`task`/`read`/`lazy` as `Tool.Def[]`/`Tool.Def` (see plan 17) |

### Test code (13 errors)

| # | File | Lines | Error code | Root cause | Fix |
|---|------|-------|-----------|------------|-----|
| 9 | `test/session/schema-decoding.test.ts` | 46, 77, 96, 135, 149 | TS2769 | `Schema.decodeUnknownSync` signature changed in beta.74 | Check `decodeUnknownSync` in Schema.d.ts; adapt helper at line 30 |
| 10 | `test/session/session-schema.test.ts` | 28 | TS1360 | Test fixture missing required Session fields | Complete fixture against the Session schema |
| 11 | `test/session/system.test.ts` | 70, 71 | TS2339 | `Interface` has no `skills` member | Update test to current `SystemPrompt.Interface` (only `system`) |
| 12 | `test/test-layer-build.ts` | 24, 26, 27 | TS2339/TS18046 | `Effect.either` removed in beta.74 | Replace with `Effect.match({onFailure,onSuccess})` or `Effect.exit` + `Exit.isSuccess` |
| 13 | `test/control-plane/workspace.test.ts` | 135 | TS2345 | `Effect.runPromise` in beta.74 requires `R=never`; effect R=unknown | Provide missing services / add `Effect.scoped` to satisfy R |
| 14 | `test/server/httpapi-exercise/index.ts` | 1683 | TS2345 | Same as 13 | Same |

## Subagent Dispatch Matrix (10 agents, disjoint files)

| Agent | Cluster | Plan file | Files |
|-------|---------|-----------|-------|
| S1 | db-glob | `plans/10-fix-db-glob.md` | `packages/db/src/tool/glob.ts` |
| S2 | cli | `plans/11-fix-cli-index.md` | `src/cli/index.ts` |
| S3 | config-registry | `plans/12-fix-config-registry.md` | `src/config/registry.ts` |
| S4 | mcp | `plans/13-fix-mcp-index.md` | `src/mcp/index.ts` |
| S5 | prompt-ts | `plans/14-fix-prompt-ts.md` | `src/session/prompt.ts` |
| S6 | session-ts | `plans/15-fix-session-ts.md` | `src/session/session.ts` |
| S7 | system-ts | `plans/16-fix-system-ts.md` | `src/session/system.ts` |
| S8 | tool-registry | `plans/17-fix-tool-registry.md` | `src/tool/registry.ts` |
| S9 | tests-schema | `plans/18-fix-tests-schema.md` | `test/session/schema-decoding.test.ts`, `test/session/session-schema.test.ts` |
| S10 | tests-service | `plans/19-fix-tests-service.md` | `test/session/system.test.ts`, `test/test-layer-build.ts`, `test/control-plane/workspace.test.ts`, `test/server/httpapi-exercise/index.ts` |

## Verification Loop

1. All 10 subagents finish → I run `cd packages/server && bunx tsc --noEmit 2>&1 | grep "error TS"`.
2. Diff against baseline. For each error: already fixed / still broken (replan) / newly introduced (replan).
3. Re-dispatch targeted subagents for leftovers. Repeat until clean.
4. Record final state in `KNOWN_ISSUES.md` / `PROJECT_LESSONS.md` if non-obvious discoveries are made.

## Known-Good Reference Patterns (beta.74)

- `Effect.catch` (NOT `catchAll`): `x.pipe(Effect.catch((err) => Effect.logError("op", {...})))` — proven in clean memory tools.
- `Effect.fn` without const annotation: `processor.ts:961` `Effect.fn("SessionProcessor.process")(function* (input: X) {...})` — compiles clean.
- `Schema.Top` replaces `Schema.All` as the existential schema type.
- `Database` only from `"bun:sqlite"`.
- Layer node deps: `LayerNode.make(layer, [depNode, ...])` — every service in layer's R must appear in the tuple; `CheckDependencies` errors tell you exactly what's missing (use the error text: `{ readonly "Missing dependencies": X }`).
- `IdentityLoader.node as never` — existing precedent for suppressing a known-mismatched node.
- Effect `runPromise` calls in beta.74 require fully-provided effects (R=never); wrap with `Effect.scoped`/provide services, or build via `Layer.build(layer).pipe(Effect.scoped)`.

## Environment

- Repo: `/home/aboood/Documents/Projects/DiveeOI`
- Server package: `packages/server` (extends `@tsconfig/bun`, `"types": []`, `moduleResolution: "bundler"`, `noUncheckedIndexedAccess: false`)
- Effect: `effect@4.0.0-beta.74` at `node_modules/.bun/effect@4.0.0-beta.74/node_modules/effect/dist/`
- bun-types: `1.3.13` at `node_modules/.bun/bun-types@1.3.13/node_modules/bun-types/`
- Baseline: `/tmp/opencode/server-errors.txt`
