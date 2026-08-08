# Subagent Findings Audit — DiveeOI

Date: 2026-08-08
Status legend: VERIFIED (confirmed against source) / RESOLVED (already fixed) / OPEN (needs fix)

All line numbers verified against current `dev` HEAD (d1c4627).

## H1 — Duplicate `memoryExtractRoute` import (VERIFIED, compile-breaking)

- File: `packages/server/src/server/routes/instance/httpapi/server.ts`
- Line 99: `import { memoryExtractRoute } from "./handlers/memory"`
- Line 116: `import { memoryExtractRoute } from "./handlers/memory"` (second copy sits between middleware imports; the `import { Memory } from "@diveeoi/memory"` at 115 was probably pasted with it)
- Two identical imports of the same binding = TS2300 duplicate identifier. The file cannot typecheck as-is.
- Fix: delete the second import (line 115-116 block), keep the first.
- Verifier: `grep -n 'memoryExtractRoute' server.ts` should return exactly 2 hits (import + usage in `createRoutes` mergeAll).

## H2 — Memory tools init-orphan: extract tools initialized but never registered (VERIFIED)

- File: `packages/server/src/tool/registry.ts`
- Line 124-125: `memoryExtract` / `memoryExtractStatus` are pulled from `MemoryTools`
- Lines 239-248: processed through `Tool.init(...)` (extract, "extract-status" entries)
- Builtin tool list at ~265-273: contains retrieve/create/update/delete/link/consolidate/stats/toggle — does NOT include `memory.extract` or `memory["extract-status"]`
- Therefore every server boot runs a `Tool.init` allocation (`Layer.succeed` + schema compile) for two tool defs that are never exposed. Dead work, no functionality.
- Note: memory extraction IS reachable via the HTTP route `memoryExtractRoute` (from the same `./handlers/memory` module), so removal is safe.
- Fix: delete the two init entries (both the fetch at 124-125 and the `extract:`/`"extract-status":` keys in the `Effect.all` object) — OR register them in `builtin` if agent-facing extract tools are wanted. Removal is the zero-behavior-change option; registration adds two tools to the model calls.
- Verifier: `MemoryExtractTool`/`MemoryExtractStatusTool` then referenced only from `tool/memory/index.ts` re-exports.

## H3 — Profiler writer: cold-start ENOENT + `process.exit(0)` in signal handler (VERIFIED)

- File: `packages/profiler/src/writer.ts`
- Line 39: `fd = openSync(outputPath, "a")` — if `.divee/` directory does not exist (fresh clone / new machine / removed folder), `start()` throws ENOENT and the whole embedder crashes.
- Fix: `mkdirSync(dirname(outputPath), { recursive: true })` before `openSync` (only runs once per `start()`, not per line written — zero impact on the hot path).
- Line 50: `process.exit(0)` inside the SIGINT/SIGTERM `onSignal` handler. This force-exits the process even if other code (e.g. an embedded server) has active handles. The `exit` listener (lines 57-66) already drains safely on natural exit. `process.exit(0)` bypasses it.
- Fix: drop `process.exit(0)` from `onSignal`; keep `onFlushTick(); drain()` in the try. When only profiler timers keep the loop alive they are `unref()`'d, so standalone mode still exits naturally with full flush via the `exit` listener.
- Unchanged: `parseMs`/`parseNum` already guard NaN/negatives with fallbacks; timers are already `unref()`'d.

## H4 — publish-llm-event: `Effect.die*` sites abort persist pipeline (VERIFIED)

- File: `packages/db/src/session/runner/publish-llm-event.ts`
- 21 `Effect.die`/`Effect.dieSync` call sites (lines 82, 92, 99, 105, 141, 160, 182, 184-185, 216, 276, 278-279, 298-299, 319, 321, 324, 358+).
- `die` raises an uncontrolled defect: the fiber dies without a typed error path, so callers (session runner) cannot degrade gracefully and the error is not serializable through the event bus.
- Fix direction: keep `die` for true invariants ("state machine impossible"), convert to `Effect.fail(new XxxError(...))` for recoverable conditions (missing message row, invalid payload, publish failure) — the caller then sees a typed failure it can log/retry instead of a poisoned fiber.
- Subagent instructions: read the full file, classify each `die` site as invariant vs recoverable, convert only recoverable ones, keep the file compiling against the existing error types imported in the file; no behavioral change to the happy path.

## H5 — Theme route auth (RESOLVED, no action)

- File: `packages/server/src/server/routes/instance/httpapi/server.ts` + `handlers/themes.ts`
- `themeRoute` is mounted inside `createRoutes()` `Layer.mergeAll(...)` and the whole merged router is wrapped with `authorizationRouterMiddleware` (`authOnlyRouterLayer`, provided at lines 192/204). The route is therefore behind the same auth as the rest of the instance API. Earlier audit claim no longer holds.
- No change needed.

## H6 — ToolRegistry memory layers (RESOLVED in current dev, no action)

- File: `packages/server/src/tool/registry.ts`
- The `node` (LayerNode.make at ~line 514) deps list contains 22 providers, including `MemoryManager.node` (via `Memory.node`) and `MemoryService.node` equivalent; `defaultLayer` provides `Memory.defaultLayer` chain. Earlier "missing memory layers" claim is fixed.
- The only live registry defect is H2 (orphan extract init).

## H7 — Session-engine minors (from earlier server pass)

- Status: NOT independently re-verified in this pass. Listed from the earlier subagent-server audit; scope limited by search-timeout. Next step is a read-only re-audit of `packages/server/src/session-engine/` + `packages/db/src/session/runner/` for the specific claims (retry policy on DB write, double JSON parse in message hydration, event ordering) before touching anything.

## Fix order

1. H1 (trivial, unblocks typecheck of server.ts)
2. H3 (trivial, removes wasted boot allocation)
3. H2 (writer robustness, no hot-path change)
4. H4 (requires care; per-call-site classification)
5. H7 (re-audit first; only coded after verification)

## Guardrail

User requirement: any edit or fix must NOT decrease the speed, effectiveness, or functionality of the tool. Every change above preserves the hot path; the only removed allocations are provably dead (H3) and the only behavior change is a graceful (vs force) process exit (H2). H4 conversions must preserve the success path byte-for-byte in behavior.