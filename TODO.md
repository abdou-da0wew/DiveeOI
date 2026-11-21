# DiveeOI — Master TODO

> Produced by a deep investigation of the whole repository on **2026-11-22** (source HEAD `c0951df`, `dev` branch).
> Method: every package, all of `docs/`, root hand-off/worklog files, skills, tools, and a repo-wide
> `TODO/FIXME/@ts-nocheck` marker scan were reviewed; every code-location claim below was re-verified in the
> current source before being listed. Items marked **(doc)** come from the project's own dated documents;
> items marked **(code)** were verified directly in source at the cited file:line.

**The single most important fact in this list:** the last *full* monorepo verification (typecheck + build + all
test suites) is the November 3 one recorded in `WORKLOG.md`. Everything committed after that (Nov 4 settings/UI,
Nov 5–6 training/SDK, Nov 19–20 SSH + Rich UI + indexing, Nov 21 coenx-video) has **not** received a full
verification pass, and the deployed production binary predates all of it. `CONTEXT.md` and the release hand-offs
say this explicitly — do not inherit the Nov 3 test counts by implication.

---

## 1. Ops / release blockers (start here)

- [ ] **Rebuild the production binary from current source and restore the service.**
      The 2026-11-09 ingest `error:"null"` root-cause fix is already in source — `packages/learning/src/embed/pipeline.ts:101-105`
      no longer maps the Transformers.js import failure to `null`, and `packages/learning/src/ingest/run.ts:768` now uses
      `util.inspect(err)` (code). But the deployed binary predates Nov 5+ source (`CONTEXT.md`, `RELEASE_HANDOFF_2026-11-06.md` (doc)),
      so production still runs the broken build. Ops checklist: rebuild → verify migrations/backups → get explicit user approval →
      restart `diveeoi.service` (`docs/testing/2026-11-09-ui-test/docs/DiveeOI_Ops_Debug_Manual.md` §5, §9.4 (doc)).
- [ ] **Run a full monorepo verification** (`bun turbo typecheck` + per-package `bun test` + `bun run build`) on the
      current HEAD. Nov 4–21 commits are unverified as a whole (doc: `CONTEXT.md` "Verification boundaries",
      `docs/targeted-learning.md:78`). Known wrinkle: the server `tsgo` typecheck has OOMed historically —
      `docs/audit/2026-10-31-comprehensive-findings.md` records that its status was "not verified" (doc).
- [ ] **Bug #14 (🔴, 2026-11-09): prompt-execution stall** — all sessions stopped producing tokens (~22:20 UTC).
      Diagnosed as the LLM dispatch/bootstrap layer, not Targeted Learning. No doc records a confirmed fix; verify on
      the rebuilt binary (`docs/testing/2026-11-09-ui-test/docs/DiveeOI_ManualTest_Report_2026-11-09.md` (doc)).
- [ ] **Bug #2 (🔴, 2026-11-09): server crash under ingest memory spike** (RSS → 15.8 GB). Adaptive resource budgets
      were tightened on Nov 19–20 (`d9ce5bc perf(learning): tune adaptive resource budgets and grounding`), but a
      deliberate ingest-under-load re-test is still needed (doc).
- [ ] **Recover the lost "Mathematics (English) - Part 1" book** (Bug #12 🟠) — re-upload via UI or restore from the
      67 MB corpus backup; candidates identified in `docs/testing/2026-11-09-ui-test/docs/mathbook_hunt.md` (doc).
      The golden math exam question is blocked on this.
- [ ] **Composer release verification never done** (`COMPOSER_INCIDENT_HANDOFF.md` "Remaining verification" (doc)):
  - [ ] Validate authenticated requests against OpenRouter / AgentRouter with real provisioned test credentials.
  - [ ] Exercise upstream free-quota exhaustion + cooldown/reselection end-to-end (unit tests only cover classification).
  - [ ] Verify every OAuth provider with its own loader is still available after the provider-auth patch.
  - [ ] Confirm streaming errors reliably reach `FreeTier.learn()` on the free-tier path.
- [ ] **Cut an actual release.** `CHANGELOG.md` contains only **Unreleased** — nothing since the fork has ever been
      versioned/tagged. Also resolve the Bun mismatch: verified with Bun 1.4.4, pinned `packageManager` is 1.3.14
      (`RELEASE_HANDOFF_2026-11-03.md` §5 (doc)).
- [ ] **Fix the HTTP API exercise** (`RELEASE_HANDOFF_2026-11-03.md` §5/§6 (doc)): effect mode fails
      (`ChildProcessSpawner` not provided); coverage mode reports **58 missing route scenarios** — decide to add or formally accept them.
- [ ] **Run the FTS anchor-content migration against the live production DB** — still pending per
      `RELEASE_HANDOFF_2026-11-03.md` §2.5 (doc).
- [ ] **Mobile / responsive browser QA** — explicitly "not performed" in every QA pass so far (doc).

## 2. UI bugs from the 2026-11-09 manual test (re-verify against current HEAD)

Source: `docs/testing/2026-11-09-ui-test/docs/DiveeOI_ManualTest_Report_2026-11-09.md` + `fix_round2–5.md` (doc).

- [ ] #5 (🟠) "New session" banner button is dead — no network call.
- [ ] #6 (🟡) Composer **Send** button dead; Enter key works.
- [ ] #7 (🟡) `@` mention popup lists agents/files but **not books** (regression vs earlier build).
- [ ] #8 (🟡) Sessions list shows "No sessions found"; console shows `SSE failed: 401` and 503 bootstrap errors.
- [ ] #9/#15 (⚪) Citation-verify warnings fire when the model cites chunks from *earlier* turns ("not shown to the model this turn") — grounding turn-state bounds.
- [ ] #10 (⚪) First paint ~25–35 s — frontend performance work.
- [ ] #11 (🟠) Arabic RTL word-order garbling in chunk extraction (feeds #4: pre-retrieval figures leaking into Arabic numeric answers).
- [ ] #4 (🟠) Grounding enforcement should **require term-verification for numeric claims**.
- [ ] #13 (🔴) Targeted Learning settings UI missing in the new/v2 layout ("library management is API-only until the tab returns") — confirm current state of `settings-v2/targeted-learning.tsx` mounting.
- [ ] Ingest error UI shows only `null` — render the real error message in the library tooltip.

## 3. coenx-video renderer roadmap

Authoritative sources: `docs/handoffs/coenx-video-renderer-handoff-2026-11-21.md`,
`docs/plans/coenx-video-renderer-roadmap.md` (doc). Status at handoff: WP1 implemented (62 tests / 243 assertions),
**WP2 is the declared next action**; do-not-start list included.

- [ ] **WP2 (NEXT, P0)** — reusable masks & compositing: design the additive alpha-mask resource + node-reference
      semantics; schema/validation tests **first**; then bounded SVG/Canvas/Cairo paths; luminance masks stay
      capability-gated. Hand-off §9 has the 11-step first slice. ("Begin WP2 … Do not start GPU 3D.")
- [ ] **WP5 (P0, transversal, OPEN — I-002)** — CML authoring gaps: no path/clip/gradient syntax yet; mesh3d not
      exposed; add source-location diagnostics + round-trip fixtures.
- [ ] **WP6 (ACTIVE, partial, I-003)** — missing AI tools, quoted from handoff §5.5: *"Do not claim these exist yet"*
      → `coenx_video_inspect`, `coenx_video_preview`, `coenx_video_export`, `coenx_video_reference`. Also: tests for
      permission-sensitive project-file ops/path confinement/cancellation, and a whole-catalogue skill parity test.
- [ ] **WP3 (P1)** — gradient spread modes (pad/repeat/reflect), gradient transforms, conic gradients, reusable
      paint resources, CML gradient syntax. Freeze current behavior in tests first.
- [ ] **WP4 (P1)** — bounded filter/effect graph: start with Gaussian blur, drop shadow, color adjustment; hard
      bounds on radius/chain depth/memory.
- [ ] **WP7 (PLANNED)** — renderer-selection planner with reason codes, per-render telemetry, shared cross-renderer
      fixtures, benchmark baselines.
- [ ] **WP1 leftovers** — confirm clipping interacts correctly with images/text/transitions/z-order; expand
      cross-backend fixtures (image crop, text reveal, nested transforms); dedupe per-node SVG clip defs.
- [ ] Split `packages/coenx-video/src/model/validate.ts` (~511 lines vs the 300-line preference).
- [ ] Replace the hand-authored capability matrix with generated data; enforce full package↔skill sync.
- [ ] **Product integration** (`docs/coenx-video.md:50` (doc)): server routes for preview/export, an authoring UI,
      a Targeted Learning hand-off route, application-level persistence, student-progress integration. Today only
      `coenx_video_capabilities` + `coenx_video_validate` are registered as agent tools
      (`packages/db/src/tool/coenx-video.ts` (code)); nothing renders MP4s in production yet.
- [ ] **WP8 GPU 3D — DEFERRED (I-004).** Explicitly do not start.

## 4. Targeted Learning / Retrieval V2

- [x] **DONE 2026-11-22** Implement LLM query rewriting — `packages/learning/src/retrieve/rewrite.ts`:
      the `llm` mode is implemented behind an injectable `RewriteLLMClient` port (optional `llm?` on
      `RewriteInput`) with a strict fallback contract (any LLM failure/throw/empty/oversized/missing client
      → heuristic rewrite; `Effect.isEffect` guards non-Effect client returns). 21 unit tests. NOT yet wired
      to a real LLM service — wiring is the remaining step when a consumer exists.
- [ ] Resolve the dead worker-pool stub `packages/learning/src/ingest/pool.ts` — `makePool` returns a Phase-1 no-op
      (status() = empty pool, pause/resume/cancel no-ops) while the real path is `src/ingest/embed-pool.ts`.
      Either finish it or delete it so the HTTP pool-status endpoint stops reporting fiction. (code)
- [ ] Harden every `catch: () => null` mapper in the learning pipeline (`pipeline.ts`, `parsers/index.ts` ×5,
      `hybrid.ts`, `store`, …) so failures surface instead of becoming silent `null`s (doc: 2026-11-09 report §6).
- [ ] Real-corpus student evaluation + promotion (`packages/learning/RETRIEVAL_V2_PLAN.md` §10 (doc)): held-out
      eval against a finished real-book corpus; student-vs-teacher comparison through the same retrieval path;
      measure p50/p95 latency + steady-state RSS on deployment hardware; promote only after all gates pass.
      Until then `auto` correctly keeps BGE-M3.
- [ ] Decide on approximate search (HNSW) **only if** measured library-scale p95 justifies it (doc).
- [ ] Freeze and review golden vectors on a host with the pinned BGE-M3 model (`tl:selftest:freeze`); golden
      vectors historically shipped empty. Build eval golden sets of 10–20 questions per book (doc).
- [ ] Live-model runs were never executed in CI sandboxes: `tl:selftest:freeze`, live-embedding selftest,
      Retrieval-V2 training (needs GPU + weights) (doc: audit §8, WORKLOG 2026-11-03).
- [ ] Wire the full OCR pipeline for scanned books (embedded-image OCR per-page exists; end-to-end wiring + ops
      coverage was still listed open in the 2026-11-09 docs) (doc).
- [ ] `@book:` mention chip rendering + citation chips into the timeline `PART_MAPPING` (requires SDK regen) (doc).
- [ ] Clean up 3 `@ts-nocheck` files when Effect v4-beta typing stabilizes: `packages/learning/src/parsers/index.ts:2`,
      `src/embed/pipeline.ts:2`, `src/eval/index.ts:2` (code).
- [ ] Complete monorepo-route integration testing for TL-specific routes (`CONTEXT.md` verification boundary) (doc).

## 5. Memory system

- [x] **DONE 2026-11-22** `linksAdded` tracking in `packages/memory/src/consolidation.ts` —
      `ConsolidationResult.linksAdded` is now populated with the real, deduplicated `MemoryLink` objects created
      by both the strengthen-connections path and the `mergeNodes` backlink-redirect path (read-back via the
      indexer). 4 new tests in `packages/memory/test/consolidation.test.ts` (6/6 suite green).
- [ ] Fix non-transactional `mergeNodes` + naive `String.includes` duplicate detection in
      `packages/memory/src/consolidation.ts:194-265` (doc: audit; code-verified — still open).
- [ ] The scheduler **does not** call `ConsolidationService.runMaintenance()` — daily consolidation from the original
      plan is not implemented. Decide whether it is still required; if yes, wire it
      (`plans/MemoryPlan/MEMORY_SERVER_INTEGRATION_PLAN.md` (doc)).
- [ ] `executeStream()` is stubbed with `Stream.die("executeStream not implemented")` in
      `packages/db/src/database/sqlite.bun.ts:101-102`, `sqlite.node.ts:102-103`, and
      `packages/effect-sqlite-node/src/index.ts:118` — any new consumer crashes at runtime, not typecheck (doc + code).
- [ ] Execute the pending memory-integration verification list (doc): boot with memory enabled and exercise prompt
      context loading; verify daily extraction scheduling; full create→link→retrieve→update→delete test; all eight
      tools vs empty/missing/invalid data; verify disabling the feature prevents layer/scheduler/route/tool work.
- [ ] Re-check `MEMORY_REVIEW_1/2/3` criticals (path traversal, prompt injection, non-atomic merges, O(n²) queue)
      against current source — the reviews are stamped historical (doc).
- [ ] `@diveeoi/memory`'s GraphView is only mounted in an isolated corner of the app — decide its product surface.

## 6. Server / core — source-verified TODO comments

- [ ] `packages/server/src/tool/tool.ts:15` — `// TODO: remove this hack`
- [ ] `packages/server/src/agent/agent.ts:458` — clean up provider-specific logic bleed
- [ ] `packages/server/src/provider/transform.ts:64` — `// TODO: fix this stupid inefficient dogshit function`
- [ ] `packages/server/src/provider/provider.ts:315` and `:575` — direct `process.env` use because `Env.set` only
      updates a shallow copy
- [ ] `packages/server/src/session/session.ts:453` — better pricing model pending models.dev update
- [ ] `packages/server/src/account/account.ts:423` — let the user choose when multiple orgs exist
- [ ] `packages/server/src/plugin/index.ts:229` — make proper plugin events
- [ ] `packages/server/src/format/index.ts:140` — combine formatters (shared Ruff/uv handling)
- [ ] `packages/server/src/server/routes/instance/httpapi/middleware/cors-vary.ts:11` — upstream the Vary-merge fix
- [ ] `packages/server/src/control-plane/workspace.ts:487` — `tapError` status-setting cleanup
- [ ] `packages/api/src/handlers/pty.ts:174` — integrate graceful-shutdown socket tracking before clients migrate
- [ ] **Watchdog is half-built** — `packages/server/src/session/prompt.ts:1333-1348`: it logs stalls but *"does NOT
      interrupt the run yet"* (needs the run fiber's `FiberId`). Finish the interrupt-and-restart path (code + doc).
- [ ] **v1↔v2 session-message dual-write** — "Temporary dual-write while migrating session messages to v2 events
      (removal in v2)" (`prompt.ts`); the db v2 tool layer still carries long deferred-feature lists
      (`packages/db/src/tool/edit.ts:84-88` fuzzy edit correction, `write.ts`, `bash.ts:80-91` parser-based
      approvals/PowerShell/background jobs/output streaming, `file-mutation.ts:198-204` seven V2 TODOs incl.
      snapshots/undo, formatter hooks, LSP diagnostics, multi-file transactions, crash recovery) (code + doc).
- [ ] `packages/db/src/session.ts:252` — restore recorded sessions onto replacement workspaces; `event.ts:24` —
      opaque cursor for the HTTP/SDK surface; `public/opencode.ts:84,131` — storage injection + facade (code).
- [ ] `packages/db/src/github-copilot/chat/...:386` — "we lost type safety on Chunk … MUST FIX" (code).
- [ ] `packages/server/test/provider/gitlab-duo.test.ts:2` — `TODO: UNCOMMENT WHEN GITLAB SUPPORT IS COMPLETED` (code).
- [ ] `packages/effect-drizzle-sqlite/src/up-migrations/sqlite.ts:168,234` — hash-match migration fallback
      "not implemented for now" (code).
- [ ] `packages/server/test/provider/gitlab-duo` + `packages/db/test/session-runner-recorded` suites rely on
      recorded fixtures — keep `RECORD=true` doc drift in mind (`README` says `RECORD=1`, code checks `"true"`).

## 7. Frontend (packages/app)

- [x] **DONE 2026-11-22** `src/i18n/parity.test.ts` extended to ALL 118 keys in the `targetedLearning.*`,
      `settings.llm.*`, `settings.features.*` namespaces across 17 locales (defined+non-empty, reverse-drift
      check, placeholder-preservation check, legacy 2-key ≠-en assertion kept). Drift it exposed was fixed:
      1,934 translations added (ar +46, every other locale +118). Mutation-verified: missing key, corrupted
      placeholder and unknown-key injections all fail with locale+key named.
- [ ] Route hardcoded English strings through i18n: exam workspace, `book-pdf-panel.tsx`, remote-session dialogs,
      console device login (code).
- [ ] **Exam restore timing** — `ExamTabPersistence` restores exams with the message's `time.created` as
      `startedAt` (`exam-side-tabs.tsx`); a duration-limited exam restored mid-session may instantly expire and
      auto-submit. Verify and fix (code — flagged, needs confirmation).
- [ ] Collapse the deliberate v1/v2 settings duplication per the "Phase 5" plan noted in
      `src/components/settings-targeted-learning.tsx:7-10` (code).
- [ ] Refactor hotspots: `prompt-input.tsx` (~3.1k lines) and `session.tsx` (~1.7k lines) (code).
- [ ] `_ExternalThemeLoader` is mounted outside `ServerKey` gating with an empty catch — harmless but half-wired (code).
- [ ] Legacy `?auth_token` Basic-credential links still supported in `entry.tsx` — decide deprecation (code).
- [ ] Email-verification polling is a no-op by design (`context/auth.tsx:124-127`) — finish when server email delivery exists (code).

## 8. Repo hygiene / build / housekeeping

- [ ] **5 orphan patch files** in `patches/` are NOT registered in `package.json#patchedDependencies` and are
      therefore silently inert under Bun: `gcp-metadata@8.1.2`, `@npmcli/agent@4.0.2`,
      `@silvia-odwyer/photon-node@0.3.4` (**a runtime dep of `db`+`server` — its wasm fix is likely not applied**),
      `@standard-community/standard-openapi@0.2.9`, `pacote@21.5.0`. Register or delete. (code — verified:
      10 registered vs 16 patch files.)
- [ ] Version drift: `@ff-labs/fff-bun` is patched at **0.9.3** but pinned **0.9.4** (code).
- [ ] `packages/plugins/built-in/image-understanding.ts` imports `@opencode-ai/plugin` / `@opencode-ai/sdk` —
      package names that do not exist in this workspace; nothing wires `packages/plugins`. Un-wired upstream
      leftover — delete or port (code).
- [ ] `packages/mcp/built-in/opencode-db-reader/` ships **prebuilt Go binaries in git** (`ocred` = 7.7 MB) — remove
      from VCS or add LFS; `packages/mcp` has no package.json and is unreferenced by the server (code).
- [ ] `packages/server/migration/` is a vestigial drizzle-kit output dir; real migrations live in
      `packages/db/src/database/migration/` (code).
- [ ] `third_party/motion-graphics` git submodule is **never initialized** (empty dir) — init it
      (`git submodule update --init`) or drop the `.gitmodules` entry (code).
- [ ] **Dockerfile runs the dev script in production**: `CMD ["bun","run","--cwd","packages/server","dev"]`
      (Dockerfile:90) despite `NODE_ENV=production` — switch to the built binary (code).
- [ ] `REMINDERS.md` contains only the heading `# Reminders` — the reminders feature is effectively unused; either
      populate the workflow or remove the file (code).
- [ ] `tools/self-hosted-ci` (Go CI runner): `go test`/`go vet` were never run (no Go toolchain in the dev
      environment) — run them, then decide document-vs-retire (doc: audit, WORKLOG 2026-10-30).
- [ ] `tests/fixtures/` (mini-app, test-ui-lib, stale-design-md) have no automated consumer outside a README note —
      add a consumer or document their purpose (code).
- [ ] Single-source the favicons: `brand/generated/` and `packages/ui/src/assets/favicon/` are near-duplicates that
      can drift (code).
- [ ] Create `docs/plans/INDEX.md` separating live vs superseded plans; archive the `.draft-01…09` files
      (recommendation from the 2026-10-31 audit, still unimplemented) (doc).
- [ ] Remove the trial-flagged "history" blocks in `skills/hyperframes/SKILL.md:36-40` and
      `skills/hyperframes-cli/SKILL.md:30-41` (`<!-- history (trial): remove this block … -->`) (code).
- [ ] Root `skills/hyperframes-*` suite is **not wired into the product** (zero references from `packages/`) — it is
      vendored content for the external `npx hyperframes` ecosystem; decide whether it belongs in this repo (code).

## 9. Planned-but-unbuilt feature programs

- [ ] **`.draft-10-autonomous-agent.md`** (755 lines, implementation-grade, v2): P0–P11 phases — linktree anchor
      context + FTS5 recall memory, auto-healing model fallback rotation, watchdog interrupt/restart (P3), persisted
      restartable agent tasks with committed-call journal (P4: "Without this P4 does not ship"), subagent model
      choice, machine tools (10 tools × 3 OS), access surfaces (SSH REPL / curl / messaging), prompt rewrite (P8),
      "todos that nag" (notes "Todos never reach the model (code-verified)"), privilege elevation with redaction
      tests. Fragments landed independently (inbound SSH REPL listener, `agent_task` tables); the roadmap itself has
      no execution record (doc).
- [ ] **System-prompt redesign v2** (`docs/system-prompt-redesign-plan-v2.md`): hardened skill-aware prompt system,
      identity loader (soul/user/lessons), research agent, subagent pool, reminders system, `/btw` command,
      `@skill` mentions — partially implemented (subagents `@code-reviewer/@explore/@general/@research/@subthinker`
      exist; the rest has no completion record) (doc).

## 10. Explicitly deferred — do NOT start now

- **GPU 3D renderer** (coenx WP8, I-004) — deferred by design; CPU path retained.
- **HNSW / approximate vector search** — only if measured p95 justifies it.
- **Skia evaluation** for the native renderer — deferred.
- **TUI** — removed upstream-on-purpose; `@diveeoi/plugin/tui` is dead code kept only to typecheck.

---

### Coverage note

Investigation covered 100% of directories and every substantive file-group: all 19 packages (incl. both Rust
natives), all `docs/` (excluding binary screenshots/PDFs/HARs), root hand-off and draft files, `plans/`, `skills/`
(10 skills), `.agents/skills/` (19 coenx skills), `tools/`, `scripts/`, `tests/`, `brand/`, git history (236
commits). One claim from the exploration pass (a "broken `const ealth]` declaration" in the TL settings tabs) was
**rejected after source verification** — both files are correct in the current HEAD.
