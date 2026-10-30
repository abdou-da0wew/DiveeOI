# Memory Server Integration — Status and Validation

Last reviewed: 2026-10-30.

This replaces the original proposed integration checklist. Server integration is present in source, but current runtime verification is incomplete. The workspace-wide test/typecheck/build caveat is recorded in `CONTEXT.md`.

## Implemented in source

- **Layer composition:** `packages/server/src/app-services.ts` provides the memory integration and scheduler nodes; `packages/server/src/session/memory.ts` wraps the package services and supplies a disabled no-op layer when the memory feature is off.
- **Session context:** `packages/server/src/session/system.ts` passes the latest user message and active worktree into recall. `packages/memory/src/memory.ts` combines session-graph candidates with text-matched memories scoped to the active project root, then ranks by title/tag/content match, configured type importance, confidence, recency, links, and session relevance. Graph traversal also rejects explicitly cross-project nodes. The prompt includes up to eight escaped, durable memory records and labels them as reference data, never instructions. New memory nodes and extracted nodes are linked to the session root and inherit project metadata so future recall can find them without cross-project leakage.
- **Extraction:** `packages/server/src/session/prompt.ts` detaches extraction at prompt-loop and compaction exits. `packages/server/src/session/memory-scheduler.ts` also performs an initial and daily **extraction** pass and exposes a manual extraction trigger. The extractor prompt permits an empty result and its parser accepts `[]`, so sessions with nothing durable do not require a fabricated memory or retry.
- **Tools and route:** eight memory tools are registered in `packages/server/src/tool/registry.ts`; the manual extraction endpoint is in `packages/server/src/server/routes/instance/httpapi/handlers/memory.ts`.
- **Consolidation:** the consolidation service exists and the `memory.consolidate` tool can invoke it manually. The scheduler does **not** currently call `ConsolidationService.runMaintenance()`; daily consolidation/maintenance from the original proposal is not implemented.

## Verification still pending

Do not mark these complete based only on source presence:

- [x] Run `bun run test` in `packages/memory`: 2 tests and 16 expectations pass, including query ranking, session-root linking, project-scoped recall, and escaped reference-only prompt injection.
- [ ] Complete typechecks: `packages/memory` reports errors in unchanged `packages/db/src/adaptive/detect.ts`, `packages/db/src/database/database.ts`, and `packages/memory/src/index.ts`; the server typecheck process was SIGKILLed without diagnostics. No errors were reported in the edited memory implementation files.
- [ ] Boot the server with memory enabled and exercise prompt-context loading, lazy root creation, extraction, and the manual extraction route.
- [ ] Verify daily extraction scheduling and manual extraction behavior in a runtime/integration test.
- [ ] Add or run a full create → link → retrieve → update → delete integration test. `packages/memory/test/memory.test.ts` now covers create/retrieve and query-ranked session linking, but not the full CRUD/link cycle.
- [ ] Exercise all eight tools against empty/missing/invalid data and confirm public failures are structured.
- [ ] Verify disabling the memory feature prevents layer, scheduler, route, and tool work.
- [ ] Decide whether daily consolidation is still required; if yes, wire scheduled `runMaintenance()` separately from daily extraction and test it.
- [ ] Review/fix the merge atomicity risk in `packages/memory/src/consolidation.ts:194–265`: duplicate links/nodes are changed or deleted before the primary node update, with no enclosing transaction despite the inline comment.
