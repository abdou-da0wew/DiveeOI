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
      no longer maps the Transformers.js import failure to `null`, and `packages/learning/src/ingest/run.ts:789` now uses
      `util.inspect(err)` (code). But the deployed binary predates Nov 5+ source (`CONTEXT.md`, `RELEASE_HANDOFF_2026-11-06.md` (doc)),
      so production still runs the broken build. Ops checklist: rebuild → verify migrations/backups → get explicit user approval →
      restart `diveeoi.service` (`docs/testing/2026-11-09-ui-test/docs/DiveeOI_Ops_Debug_Manual.md` §5, §9.4 (doc)).
      → **REBUILD DONE 2026-11-23**: linux-x64 production binary `packages/server/dist/@diveeoi/server-linux-x64/bin/diveeoi`
      self-reports `DiveeOI 1.19.7`, build smoke test passed. **Remaining: copy to VDS + user-approved `diveeoi.service` restart** (needs production access).
- [x] **DONE 2026-11-23 (sandbox, 4 GB / 2 cores)** **Full monorepo verification** on HEAD `00a1cf0` + release fixes:
      typecheck **PASS for all 18 packages with a typecheck script except `server`** — the server `tsgo --noEmit` OOM-reproduces
      (SIGKILL at ~3.5 GB RSS; same historical wrinkle, `docs/audit/2026-10-31-comprehensive-findings.md`); it needs the 32 GiB VDS.
      Tests **PASS**: coenx-video, db (1082/1082 after fixture fix), effect-drizzle-sqlite, http-recorder, learning, llm, memory,
      profiler, ui, app, and the server suite (215 files, run in memory-sized chunks: all green after the fixes below).
      `bun run build` **PASS** (5/5 turbo tasks, binary smoke-tested). Failures found and fixed during the pass:
      db location-layer fixture (coenx-video tools), plugin openai-ws Bun-1.3.14 message wording, RemoteSession missing from
      5 minimal test stacks, v2-location SSE schema (`location.project` now optional), file-picker lazy-index race
      (`findFile` served `[]` — real production bug, fixed), stale tool-parameters snapshots.
      Known pre-existing (documented, not blocking): `httpapi-targeted-learning` + `httpapi-sync` interfere when run in ONE
      process (each passes in isolation); server typecheck needs a ≥6 GB machine.
- [ ] **Bug #14 (🔴, 2026-11-09): prompt-execution stall** — all sessions stopped producing tokens (~22:20 UTC).
      Diagnosed as the LLM dispatch/bootstrap layer, not Targeted Learning. No doc records a confirmed fix; verify on
      the rebuilt binary (`docs/testing/2026-11-09-ui-test/docs/DiveeOI_ManualTest_Report_2026-11-09.md` (doc)).
      → **STATUS 2026-11-23**: `git log --since=2026-11-08` over `packages/llm` + `packages/server` shows NO stall-specific fix
      has landed; the verification is still an **ops action on the rebuilt binary** after the user-approved restart
      (session turns, provider dispatch, bootstrap 503s). Server-side regression coverage that does exist (route boot tests,
      prompt loop tests, ws upgrade paths) is green as of this verification.
- [x] **DONE 2026-11-22** **Bug #2 (🔴, 2026-11-09): server crash under ingest memory spike** (RSS → 15.8 GB) — ROOT CAUSE FOUND AND FIXED: TXT/DOCX parsers stamped every outline entry `page: 1`, so `buildSectionsFromOutline` duplicated the ENTIRE book text once per heading (O(headings × bookSize)); sections now tile page text between headings via character offsets (120-heading 277 KB book: Σ section text 33.0 MB → 0.277 MB; chunk-stage RSS 380 → 108 MB). Ingest-time page/outline retention also pruned. Automated ingest-under-load stress test added (`test/ingest-load.test.ts`: bounded in-flight vectors, per-wave checkpointing, post-completion cleanup). A deliberate re-test on deployment hardware remains an ops action.
- [ ] **Recover the lost "Mathematics (English) - Part 1" book** (Bug #12 🟠) — re-upload via UI or restore from the
      corpus backup; candidates identified in `docs/testing/2026-11-09-ui-test/docs/mathbook_hunt.md` (doc):
      `/home/celestial-dev/diveeoi-artifacts/Mathematics-EN-Part1.pdf` (1,248,223 B, mtime Nov 8 23:03) is the primary
      recovery candidate; fallback `eb-pdf/` curriculum set + orphaned sections (`bk_5e4f6d18c33342f6`, 320 KB text).
      → **Cannot be executed from the dev sandbox**: the artifacts live on the VDS filesystem. Runbook: upload the PDF via
      the Library UI (or copy into `~/.local/share/diveeoi/targeted-learning/` and ingest), then confirm 552 passages
      re-index and the golden math exam question unblocks. The golden math exam question is blocked on this.
- [ ] **Composer release verification never done** (`COMPOSER_INCIDENT_HANDOFF.md` "Remaining verification" (doc)):
  - [ ] Validate authenticated requests against OpenRouter / AgentRouter with real provisioned test credentials.
        → **Blocked on credentials**: no authorized key exists in this environment; not attempted (no requests invented).
  - [ ] Exercise upstream free-quota exhaustion + cooldown/reselection end-to-end (unit tests only cover classification).
        → **Blocked on a real upstream account**; classification/cooldown unit tests pass in this verification.
  - [ ] Verify every OAuth provider with its own loader is still available after the provider-auth patch.
        → Source-verified 2026-11-23: per-provider loaders are wired (provider-auth layer chain intact); live confirmation
        still needs credentials.
  - [ ] Confirm streaming errors reliably reach `FreeTier.learn()` on the free-tier path.
        → Code-path reviewed; the ws upgrade-rejection surfacing test now passes on the pinned Bun 1.3.14 (message
        normalization); end-to-end confirmation needs credentials.
- [x] **DONE 2026-11-23** **Cut an actual release.** `CHANGELOG.md` was Unreleased-only since the fork — now cut as
      **1.19.7 (2026-11-23)** (matches the built binary's upstream-gated derived version; tag `v1.19.7`), server+app
      `package.json` bumped to 1.19.7. **Bun mismatch resolved in the safe direction**: this full verification ran on the
      **pinned Bun 1.3.14** (`packageManager`), and the one Bun-version-dependent test message was made portable
      (`plugin/openai-ws`). Turbo strict env was also fixed to pass `DIVEEOI_VERSION`/`DIVEEOI_BUMP`/`DIVEEOI_RELEASE`/
      `DIVEEOI_CHANNEL` so future release builds can pin versions explicitly.
- [x] **DONE 2026-11-23** **Fix the HTTP API exercise** (`RELEASE_HANDOFF_2026-11-03.md` §5/§6): effect mode FIXED —
      `AppLayer` (and the route-tree composition) now provide `ChildProcessSpawner` (`CrossSpawnSpawner.defaultLayer`) and
      `FSUtil.defaultLayer`; the experimental tool-ID route's `ToolRegistry.ids()` passes (`--mode effect --include tool.ids`
      exit 0, zero `Service not found` in a full effect-mode run). The **58 missing route scenarios are FORMALLY ACCEPTED**
      as documented coverage debt: auth mode re-verified 194/194 passing with the layer changes; coverage mode stays
      `--fail-on-missing` as the enforcement point once scenarios are written (tracked below).
- [ ] **Write the 58 missing HTTP API route scenarios** — accepted debt from the decision above; registry lives in
      `packages/server/test/server/httpapi-exercise/`.
- [ ] **Run the FTS anchor-content migration against the live production DB** — still pending per
      `RELEASE_HANDOFF_2026-11-03.md` §2.5. → Verified 2026-11-23: migration `20261103001500_bootstrap_anchor_content_fts`
      is registered in `packages/db/src/database/migration.gen.ts:54` and rehearsed on a disposable DB copy (per doc);
      the live-DB run happens automatically at first boot of the rebuilt binary — the user-approved restart IS the run.
- [ ] **Mobile / responsive browser QA** — explicitly "not performed" in every QA pass so far (doc). No real devices/
      browsers available in this environment; needs a device/browser QA pass against the restarted service.

## 2. UI bugs from the 2026-11-09 manual test (re-verify against current HEAD)

Source: `docs/testing/2026-11-09-ui-test/docs/DiveeOI_ManualTest_Report_2026-11-09.md` + `fix_round2–5.md` (doc).

- [x] **DONE 2026-11-22** #5 (🟠) "New session" banner button is dead — no network call — FIXED (picker-fallback): `openNewSession()` silently returned with no open project and the header only wired the handler when `newSessionProject()` was truthy. Now the CTA is always live — with no project it opens the directory picker and starts the session on the first picked directory (`chooseProject(conn, after)`); both session-group headers pass the handler unconditionally. `docs/testing/2026-11-09-ui-test/docs/fix_round6.md`.
- [x] **DONE 2026-11-22** #6 (🟡) Composer **Send** button dead; Enter key works — FIXED (direct click path): Enter/Send already shared `handleSubmit`, so the click was lost in the implicit form-submit chain through the Kobalte button + tooltip trigger. Both `data-action="prompt-submit"` IconButtons now call `handleSubmit(event)` explicitly on `onClick` with `preventDefault()` to suppress double-fire. fix_round6.md.
- [x] **DONE 2026-11-22** #7 (🟡) `@` mention popup lists agents/files but **not books** (regression vs earlier build) — FIXED (resilient loader): the old single promise chain cleared book options on any failing `/health` call (stale-cookie 401, 503 bootstrap) with no retry. New `prompt-input/book-options.ts`: only an authoritative `booksDbAvailable: false` short-circuits; `/books` is retried ×3; stale loads dropped; 9 new unit tests. fix_round6.md.
- [x] **DIAGNOSED 2026-11-22** #8 (🟡) Sessions list shows "No sessions found"; console shows `SSE failed: 401` and 503 bootstrap errors — no HEAD defect: "No sessions found" is the empty-projects corollary (the Home list queries open projects of the focused server only); the SSE 401 is the stale-cookie re-auth case on the same session every request uses; the 503s come from the workspace-routing middleware while a workspace sync connection is still establishing ("broken sync connection", transient by design). UX follow-up (re-login prompt on 401) recorded in §11. fix_round6.md.
- [x] **DONE 2026-11-22** #9/#15 (⚪) Citation-verify warnings fire when the model cites chunks from *earlier* turns ("not shown to the model this turn") — grounding turn-state bounds — FIXED (recent-turns window): `grounding/turn-state.ts` now keeps a sliding window of the last `CITATION_TURN_WINDOW = 10` turns (start-of-turn pushes a fresh set instead of wiping; union is the verifiable set; 20k-id/session cap across the window, 2 048-session LRU, 30-min TTL preserved); `post.ts` no longer wipes state at end of turn. 5 new window tests. fix_round6.md.
- [x] **DONE 2026-11-22** #10 (⚪) First paint ~25–35 s — first-load entry JS reduced **−49.6%** (1793.7 KB → 904.1 KB; gzip 536 → 273 KB) by lazy-loading the markdown/kaTeX/Shiki provider and the file viewer and removing the Effect runtime from the entry path (effective bytes-before-paint incl. the marked chunk: −32.5%). Remaining eager weight (luxon, kobalte) noted for a future pass.
- [x] **DONE 2026-11-22** #11 (🟠) Arabic RTL word-order garbling in chunk extraction — root causes fixed: (a) sentence splitting treated `.` as a terminator, mangling figures like `3.5` (digit-aware regex now); (b) chunks stored raw display text in `text_norm` so FTS never matched retrieval normalization (chunker now emits `normalizeForSearch`; display `text` untouched). ⚠️ Pre-fix books were chunked with old boundaries/normalization → **re-ingest required after upgrade** (a NORMALIZER_VERSION bump is intentionally deferred until the migration-job runner exists).
- [x] **DONE 2026-11-22** #4 (🟠) Grounding requires term-verification for numeric claims — verifier check #3: figures in the answer/citations (Latin + Arabic-Indic digits ٠-٩/۰-۹/０-۹, thousand/decimal separators incl. Arabic `٫`/`٬`, percent, zero-trimming) must appear in the cited chunk; ungrounded figures are named per citation and in retry prompts; `off`/`flag`/`retry` modes preserved. 19 new tests.
- [x] **DONE 2026-11-22** #13 (🔴) Targeted Learning settings UI in the v2 layout — VERIFIED MOUNTED (no wiring fix needed): `dialog-settings-v2.tsx` declares the `learning` trigger and mounts `SettingsTargetedLearningV2`, reachable via the layout's dynamic-imported settings dialog; v1 fallback intact. Library management is available in both layouts.
- [x] **DONE 2026-11-22** Ingest error UI — hardened: `displayBookError` helper trims the backend error and falls back to a translated message (`targetedLearning.library.errorUnavailable`, added to all 18 locales) when null/empty/literal-"null"; full error exposed via tooltip title; the failed-book row no longer requires a truthy error to render.

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
- [x] **DONE 2026-11-22** Dead worker-pool stub resolved by DELETION — `packages/learning/src/ingest/pool.ts` removed (verified: `makePool`/`IngestPool` had zero real importers and no HTTP pool-status endpoint ever existed; repo-wide + `git log -S` searches). Barrel re-export, stale comment and the dangling `./ingest/pool` package export removed; a regression test guards against reintroduction.
- [x] **DONE 2026-11-22** Hardened the silent `catch: () => null` mappers in the learning pipeline — all 9 verified sites fixed (parsers ×6, sqlite-vec ×1, hybrid ×2) plus adjacent same-class catches; failures now surface as typed errors or recorded diagnostics (`parse.*`, `availability.probeFailed`, `dense.legFailed`, `native.engineError`, …). Empirically confirmed the old pattern short-circuited Effect generators with null errors — the 2026-11-09 `error:"null"` incident mechanism.
- [ ] REMAINING (same treatment, next pass): `packages/learning/src/store/index.ts` silent catch mappers (~132/229/246) and `sqlite-vec/index.ts:198,207` pre-existing `.catch(() => undefined)` metric inserts.
- [x] **TOOLING DONE 2026-11-22** Real-corpus student evaluation + promotion — the offline-runnable `tl:eval` CLI exists (`packages/learning/scripts/eval-corpus.ts`): pluggable embedder (`real` fails fast without the model / `standin` deterministic for CI / `student`), golden-set schema v2 + synthetic fixtures, recall@k (BM25/dense/fused), MRR, nDCG, gate precision/recall, refusal + false-refusal, p50/p95 latency, peak RSS, student-vs-teacher comparison, promotion-gate PASS/FAIL verdicts matching promote.py thresholds. The LIVE run against a finished real-book corpus on deployment hardware stays open (no GPU/weights in the dev sandbox): `bun run tl:eval --embedder real --corpus … --golden …`.
- [ ] (still open) Execute the live real-corpus eval + promotion decision on the model host.
- [ ] Decide on approximate search (HNSW) **only if** measured library-scale p95 justifies it (doc) — decision tooling ready: `tl:eval` reports p50/p95 latency + peak RSS per run; measure on the real corpus, then decide.
- [ ] Freeze and review golden vectors on a host with the pinned BGE-M3 model (`tl:selftest:freeze`); golden
      vectors historically shipped empty. **Tooling done 2026-11-22**: golden-set schema v2 (in-book/paraphrased/cross-lingual/follow-up/off-topic questions, portable expectations) + 2-book synthetic fixture + harness; the actual freeze still requires the pinned-model host.
- [ ] Live-model runs were never executed in CI sandboxes: `tl:selftest:freeze`, live-embedding selftest,
      Retrieval-V2 training (needs GPU + weights) (doc: audit §8, WORKLOG 2026-11-03).
- [x] **DONE 2026-11-22** OCR pipeline end-to-end — verified the ingest OCR branch (scanned pages below `SCANNED_PAGE_MIN_CHARS` → `ocrPdfPages`) with a REAL offline run: pinned `eng.traineddata` (sha256-matched) runs tesseract.js WASM in the test sandbox; scanned PDF → OCR text → chunks → searchable. Mock-pack fallback mode also covered (`TL_OCR_E2E_MODE=mock`). Non-eng languages still need a host carrying their tessdata.
- [ ] `@book:` mention chip rendering + citation chips into the timeline `PART_MAPPING` (requires SDK regen) (doc).
- [x] **DONE 2026-11-22** All 3 `@ts-nocheck` directives removed (`parsers/index.ts`, `embed/pipeline.ts`, `eval/index.ts`) — learning `tsgo --noEmit` exits 0; the only blocker (transformers.js `pipeline()` overload union, TS2590) was resolved with a narrow single-callsite factory cast.
- [x] **DONE 2026-11-22** TL route integration testing — 26 route-level tests run the FULL production `HttpApiApp.routes` tree offline (basic-auth + temp XDG root): books list/health/setup-status, settings get+schema+presets+PATCH deep-merge, memory/debug/probe, upload/import 3 paths + 400 shapes, jobs list/pause/resume/cancel/retry, delete, auth + no-404 contract. Documented gaps: HTTP-level successful indexing needs a live embed model (covered at service level by the OCR e2e); setup/start needs network. Also fixed en route: the route graph could not resolve `@diveeoi/RemoteSession` (every authenticated instance request died "Service not found"; pre-existing httpapi-instance suite 0/7 → 7/7).

## 5. Memory system

- [x] **DONE 2026-11-22** `linksAdded` tracking in `packages/memory/src/consolidation.ts` —
      `ConsolidationResult.linksAdded` is now populated with the real, deduplicated `MemoryLink` objects created
      by both the strengthen-connections path and the `mergeNodes` backlink-redirect path (read-back via the
      indexer). 4 new tests in `packages/memory/test/consolidation.test.ts` (6/6 suite green).
- [x] **DONE 2026-11-22** Non-transactional `mergeNodes` + naive duplicate detection fixed — merges run as plan-then-single-SQLite-transaction (link redirects + duplicate deletions + primary update + outgoing-link rebuild + in-transaction verification with rollback) via additive `IndexerService.runInTransaction`; filesystem-mirror writes happen after commit (documented limitation: stale/orphan .md files possible on post-commit fs failure). `String.includes` duplicate-content detection replaced with normalized containment (NFKC/lowercase/punctuation-strip/Arabic-harakat folding). Failure-injection + content-detection tests; 10/10 suite green ×3.
- [x] **DONE 2026-11-23** Daily consolidation wired — decision: REQUIRED (extraction adds nodes after every session
      via `extractOnEnd`, and without scheduled maintenance duplicates/weak links accumulate until a user manually
      invokes the consolidate tool). `SessionMemoryIntegration` gained `runConsolidationMaintenance()` (gated on
      `consolidation.enabled`) and the memory scheduler's daily 12:00 tick now runs it after the extraction pass,
      failure-isolated so it can never break extraction or rescheduling.
- [x] **DONE 2026-11-23** `executeStream()` implemented in all three SQLite connection adapters
      (`sqlite.bun.ts`, `sqlite.node.ts`, `effect-sqlite-node/src/index.ts`) — rows are materialized inside the
      acquired connection (the same invariant as `execute`; the synchronous drivers already materialize) and then
      chunked through `Stream.fromIterable`, so `Statement.stream` consumers get incremental rows instead of a
      defect. Fixed en route: statement PREPARATION sat outside the try block in all six run/runValues fns, so
      bad queries (missing table, syntax error) died as raw defects instead of failing with `SqlError`. 3 tests
      (`packages/db/test/sqlite-execute-stream.test.ts`) pin rows-vs-execute parity, transformRows and SqlError
      failure semantics; db migration suite 16/0.
- [x] **DONE 2026-11-23** Memory-integration verification list executed as real offline tests:
      `packages/server/test/session/memory-integration.test.ts` (boots the REAL Memory node + SessionMemoryIntegration
      + REAL MemoryScheduler with the Session service; prompt-context loading incl. XML-escaping of hostile content;
      full create→link→recall→update→delete; real consolidation maintenance run; scheduler next-run + manual
      extractNow incl. missing-session tolerance; all eight tools + extract-status/toggle vs valid/empty/missing/
      invalid data — 44 assertions) and `memory-disabled.test.ts` (child-process run with
      `DIVEEOI_DISABLE_FEATURES=memory`: flag off, scheduler/integration layers are no-ops with zero requirement
      nodes, memory HTTP route never registers, tool registry skips the dynamic `./memory` import). Bugs fixed by
      the verification: scheduler `extractNow(sessionId)` failed uncaught for a missing session (now logs + skips),
      and extractor-generated node IDs contained UUID hyphens violating `NODE_ID_REGEX` (which would have failed
      any later merge's Phase C "Path traversal attempt") — extractor now reuses `generateNodeId()`.
- [x] **DONE 2026-11-23** `MEMORY_REVIEW_1/2/3` criticals re-checked against current source (all evidence at
      current file:line): path traversal CLOSED (id regex + resolve/startsWith guard in `node.ts`), non-atomic
      merges CLOSED (Phase A/B/C transactional merge with in-transaction verification + failure-injection test),
      O(n²) queue CLOSED (level-order BFS with `maxVisited` cap replaced the per-push sort), prompt injection
      PARTIAL — delimiters, untrusted-data marker, input truncation and strict output validation are in place, and
      the residual raw-interpolation arm is now closed too (`sanitizeUntrusted` neutralizes `</conversation>`
      break-outs in `extractor.ts`); remaining hardening (LLM tool-calling extraction) is future work. Review
      follow-ups that remain open as NEW items (§11): extractor session-idempotency, multi-node creation without a
      wrapping transaction, public `updateNode` wikilink rebuild outside a transaction, indexer schema DDL still
      raw-string with `PRAGMA user_version` missing.
- [x] **DECIDED 2026-11-23** GraphView product surface: `packages/app/src/components/GraphView.tsx` currently has
      ZERO consumers (the "isolated corner" mounting no longer exists; the file also carries a mock-data demo
      export). Decision: KEEP the component as the intended visualization for a future Settings → Memory inspector
      tab; the surface requires (a) a read-only memory graph/stats HTTP endpoint (the HTTP API today exposes only
      the memory-extract route), (b) the settings-v2 tab wiring, (c) i18n keys across all 18 locales. Tracked as a
      §11 follow-up; deleting the 462-line d3 implementation was rejected because it is the working basis for that
      tab.

## 6. Server / core — source-verified TODO comments

- [x] **DONE 2026-11-23** `tool.ts` dead `DynamicDescription` type removed (zero users repo-wide, verified).
- [x] **DONE 2026-11-23** provider-specific logic bleed cleaned — `Agent.generate` now reads
      `Provider.requestCapabilities(model)` (`systemViaInstructions`, `preferStreamingObjectGeneration`); the
      OpenAI-OAuth stateless-Responses quirk lives in the provider layer, agent code branches on capabilities only.
      (`Agent.generate` currently has no in-repo callers; verified before touching.)
- [x] **DONE 2026-11-23** `normalizeMessages` hot path fixed — `sanitizeSurrogates` fast-path (regex `.test`
      pre-check) avoids the allocating `.replace` on every text segment of every request; behavior identical,
      TODO removed.
- [x] **DONE 2026-11-23** `Env.set`/`Env.remove` were SILENT NO-OPS (built `Effect.sync` without yielding — an
      Effect 4 generator-body pitfall; invalidated every test that "set" env vars). Fixed, and the Env service's
      runtime contract made explicit: it mutates real `process.env` (the AWS/SAP SDKs read from it). The two
      provider.ts TODO sites (Bedrock bearer token, sap-ai-core service key) now publish auth keys through the
      Env service instead of direct `process.env` writes; provider tests re-run green.
- [x] **DECIDED 2026-11-23** session pricing: keep the stopgap (reasoning tokens billed at the output rate) —
      models.dev's cost schema has no reasoning-rate field; the correct fix is contributing the field upstream and
      then reading `costInfo?.reasoning ?? costInfo?.output`. No code change until the data exists (guessing rates
      per provider would be worse than the documented approximation).
- [x] **DECIDED 2026-11-23** multiple orgs on login: keep default-first-org (current behavior, existing
      `Account.use` switching already works); a choose-your-org screen needs a client surface (endpoint + UI) and is
      tracked as a §11 follow-up rather than silently changing login semantics here.
- [x] **DONE 2026-11-23** plugin init failures are no longer swallowed silently: the dead commented
      `events.publish(Session.Event.Error, …)` TODO is replaced by routing through the existing
      `publishPluginError` channel (the same surface loader-stage failures use, with the error bound — the old
      block couldn't even reference `message`). A dedicated `plugin.failed` lifecycle event on the global bus
      remains a §11 follow-up.
- [x] **DONE 2026-11-23** shared-backend formatters combined — `Formatter.Info` gained `backend?: string`
      (`ruff` and `uv` both declare `backend: "ruff"`); the config disable check generalizes over backends and
      removes every formatter of a disabled backend (config-key ↔ registry-key mismatch handled: config `uv` →
      registry `uvformat`). Existing ruff/uv disable tests green.
- [x] **DONE (tracking) 2026-11-23** cors-vary upstream item: the local mitigation (`cors-vary.ts` middleware +
      tests) is complete and correct; the upstream target is **Effect-TS/effect** v4 "smol" beta,
      `HttpMiddleware.cors` / `headersFromRequestOptions` (~line 332) merging `Vary` instead of overwriting. Filing
      the upstream PR is an external action; removing the middleware after an upstream release stays the follow-up.
- [x] **DONE 2026-11-23** workspace `tapError` cleanup — `syncWorkspaceLoop` failures now `Effect.tapError` (set
      error status + log) and RE-FAIL, so FiberMap drops the dead fiber and a later `startSync` restarts it; the
      restart guard (`status !== "error"`) is unchanged.
- [x] **DONE 2026-11-23** api-package `pty.connect` gained the graceful-shutdown tracker gate before client
      migration: new `packages/api/src/handlers/pty-ws-tracker.ts` (mirrors the server tracker contract; the tag
      lives in the API package because dependency direction forbids importing server internals), the handler
      refuses upgrades with the 1001 server-closing frame once closing/capped (degrading to "allowed" standalone),
      and `routes.ts` provides the tracker layer (hosts may bridge their own implementation to the same tag).
- [x] **DONE 2026-11-23** Watchdog interrupt-and-restart path FINISHED (code + doc + live test). The supervisor
      moved out of the run fiber: ONE supervisor per session, forked by `runLoop` into the instance-lifetime scope,
      sharing per-session `WatchdogState` with the run's touches. On a stall (adaptive heartbeat 60/45/30s, stall
      300/240/180s) it: verifies the session is still busy/retry, logs + diagnostics, interrupts the wedged run via
      `SessionRunState.cancel` (the prompt caller unwinds through the standard interrupted-assistant path), queues
      `diagnosisMessage` into the restarted run's system prompt, resets timers and forks a fresh `loop()` from the
      persisted checkpoint. After `MAX_AUTO_RESTARTS` (3) restarts without progress it fully cancels and publishes a
      degraded `session.error`. Live test (`test/session/watchdog-restart.test.ts`) drives a hanging LLM through
      trip → interrupt → restart ×3 → pause event, with adaptive thresholds shrunk for test speed. prompt.test.ts
      56-test file still green; design docs updated in `watchdog.ts` header.
- [x] **DECIDED 2026-11-23** v1↔v2 session-message dual-write: **v1 stays canonical** until v2 event-sourced
      projections are proven equivalent; the v2 half remains a flag-gated mirror (`OPENCODE_EXPERIMENTAL_EVENT_SYSTEM`,
      default off) so removal of the v2 half is a pure deletion of `if (flags.experimentalEventSystem)` blocks when
      the flag is retired. Deleting the v1 half instead would flip every reader (run loop, REST messages API, tool
      history, compaction) onto unproven projections — rejected. The db v2 tool layer's deferred-feature lists
      (edit fuzzy correction, bash parser-approvals/PowerShell/background jobs, file-mutation snapshots/undo/
      formatter/LSP/multi-file/crash-recovery) are classified in-source: most are explicitly blocked on missing V2
      infrastructure ("after V2 X runtime exists") and stay; parser-based shell advisories and crash-recovery/
      idempotency are the two items worth prioritizing IF background/detached tool execution ships (§11 note).
- [x] **DONE (partial) 2026-11-23** db public facade storage injection — `layerWithDatabase(dbLayer)` added to
      `packages/db/src/public/opencode.ts` (`layer` = default DB). The remaining three sub-items are decisions, not
      mechanical fixes, and stay open as §11 entries: recorded-session restore onto replacement workspaces (needs a
      `SessionV2.reattach` API slice + control-plane caller), opaque event cursor for HTTP/SDK (API-shape decision
      affecting SDK compat), and the `OpenCode.create()` Promise facade (~150 lines, public-API naming/lifecycle
      review).
- [x] **DONE 2026-11-23** github-copilot Chunk type safety restored — the chunk schema's error member is now
      concrete (`ZodType<OpenAICompatibleErrorData>`; `errorStructure?: ProviderErrorStructure<OpenAICompatibleErrorData>`),
      so `z.infer` of the union is a real union and the stream transform's `"error" in value` narrows type-safely.
      Runtime schema unchanged; "MUST FIX" resolved.
- [x] **DECIDED 2026-11-23** gitlab-duo commented suite: gitlab support IS implemented in src (provider loader,
      workflow routing, V2 plugin) but the 410-line commented test suite targets pre-Effect APIs (bare `list()`/
      `getModel()`, `ProviderID` symbols that no longer exist) and its `Env.set` calls were no-ops until the Env fix
      above. Decision: keep the suite commented until someone rewrites it against `testEffect`/instance fixtures +
      `ProviderV2.ID.gitlab`; rewrite tracked as §11 follow-up (deleting the reference tests was rejected).
- [x] **DONE 2026-11-23** hash-match migration fallback: DECIDED fail-loud — the serial-id fallback stays
      unimplemented on purpose (positional pairing would silently mislabel migration history when files were
      regenerated or the DB came from a different tool version); the throw is the conservative, operator-honest
      behavior. Both doc comments now record the decision instead of "not implemented for now".
- [x] **DONE 2026-11-23** RECORD mode drift fixed — canonical spelling is `RECORD=true` with `RECORD=1` tolerated;
      new shared `isRecordMode()` in `@diveeoi/http-recorder` used by both recorded suites (`llm-native-recorded`,
      `session-runner-recorded`), and both READMEs updated to match the code. (Note: gitlab-duo itself has NO
      recorded fixtures — that part of the TODO premise was stale; the drift was purely README vs the two test
      files.)

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

- [x] **DONE 2026-11-22** Orphan patch files resolved — 10 registered vs 16 files. **Registered:**
      `@silvia-odwyer/photon-node@0.3.4` (runtime dep of db+server — wasm fix now provably applied:
      installed copy has zero `module.exports.__wbg` remnants and a runtime `new_from_base64`+`resize` probe
      exits 0) and `@npmcli/agent@4.0.2`. **Deleted:** `gcp-metadata@8.1.2` (lock resolves 8.1.3, patch target
      absent), `pacote@21.5.0` (lock resolves 21.5.1; note — the deleted patch fixed a tarball-fallback bug
      still present upstream in 21.5.1, re-derive as a 21.5.1 patch only if it ever bites),
      `@standard-community/standard-openapi@0.2.9` (absent from lock entirely). `bun install` green;
      `bun install --frozen-lockfile --dry-run` exit 0; bun.lock diff audited hunk-by-hunk (no version churn).
      Mutation-checked: a bogus patchedDependencies entry fails `bun install --dry-run` hard.
- [x] **DONE 2026-11-22** `@ff-labs/fff-bun` drift fixed by re-keying the patch to **0.9.4** (patch context
      matches 0.9.4 source exactly; applied copy verified — `FFF_LIBC` present, `createRequire` gone); patch
      file renamed to `@ff-labs%2Ffff-bun@0.9.4.patch`; no manifest pin change needed.
- [x] **DONE 2026-11-22** `packages/plugins` DELETED — contained only `built-in/image-understanding.ts`, which
      imported `@opencode-ai/plugin`/`@opencode-ai/sdk` (names that exist only as transitive deps of npm auth
      plugins, never declared anywhere); zero functional references repo-wide (code globs `ts/tsx/js/json/go/sh`
      → 0 matches).
- [x] **DONE 2026-11-22** Prebuilt Go binaries removed from VCS — `ocred` (7.7 MB) and `ocread` (16 KB) deleted;
      `go.mod`/`go.sum`/`main.go` sources kept; `.gitignore` guards the rebuilt binary names;
      `packages/mcp/README.md` documents the source-only, unreferenced-by-design status.
- [x] **DONE 2026-11-22** Vestigial `packages/server/migration/` DELETED — its `migration.sql` duplicated the real
      `packages/db/src/database/migration/20260511173437_session-metadata.ts` (which even has an idempotency
      guard); the sole drizzle config outs to `packages/db/migration`, and `script/migration.ts` overrides `out`
      to an `os.tmpdir()` scratch dir; server tsconfig already excluded the dir.
- [x] **DONE 2026-11-22** `third_party/motion-graphics` submodule INITIALIZED — `git submodule update --init`
      succeeded, checked out at the pinned commit `3d83d987d658601d8a1269eb691622bdcd427335` (matches the index
      gitlink and the CONTEXT.md/WORKLOG.md pin); `.gitmodules` unchanged; superproject tree stays clean.
- [x] **DONE 2026-11-22** Dockerfile now runs the compiled production binary — `RUN cp "$(find
      packages/server/dist -type f -name diveeoi | head -n 1)" /usr/local/bin/diveeoi` after the existing
      `bun run build:current` (which emits one compiled Bun standalone executable with the runtime embedded at
      `dist/@diveeoi/server-linux-<arch>/bin/diveeoi`), and `CMD ["/usr/local/bin/diveeoi"]` exec-form (clean
      PID 1 / SIGTERM). HEALTHCHECK, VOLUME /data, EXPOSE 4097, NODE_ENV=production preserved. A
      `docker build && docker run` smoke on a real daemon is the recorded follow-up (sandbox has no daemon).
- [x] **DONE 2026-11-22** `REMINDERS.md` DELETED — content was only the `# Reminders` heading; all references are
      historical docs; the live reminders feature is DB-backed (`packages/server/src/session/reminders.ts`) and
      never reads the file.
- [x] **DONE 2026-11-22** `tools/self-hosted-ci` verified with Go 1.27.4 (toolchain downloaded to /tmp, never into
      the repo): `go vet ./...` exit 0 (zero findings) and `go test ./...` 36/36 pass — **KEEP**; the README now
      documents how to run it (`make check` / `go vet ./... && go test ./...`) and records the verified-clean
      result.
- [x] **DONE 2026-11-22** `tests/fixtures/` documented — `tests/fixtures/README.md` covers each fixture's purpose,
      origin commits (verified against git log) and consumers (all three are reference material with no
      automated consumer, stated explicitly); plus `tests/fixtures/check-fixtures.ts` integrity script (20
      checks pass; plain Bun script because the root bunfig tripwire blocks `bun test` from repo root).
- [x] **DONE 2026-11-22** Favicons single-sourced — `packages/ui/src/assets/favicon/` declared canonical (the
      consumed set: `favicon.tsx` head tags, `site.webmanifest`, `app/index.html`, the byte-identical
      `app/public/` served copies, `server/public-ui.ts` allowlist); 3 unreferenced exact duplicates deleted
      from `brand/generated/` (sha256-verified byte-identical); the 22 kept brand variants have zero hash
      overlap with canonical; `brand/README.md` documents the rule; `scripts/check-favicons.sh` drift checker
      (mutation-verified: detects a re-introduced duplicate, exit 1 naming it).
- [x] **DONE 2026-11-22** `docs/plans/INDEX.md` created — evidence-backed LIVE / SUPERSEDED / UNBUILT-ROADMAP /
      ARCHIVED classification of all 13 plan docs (3 live, 6 superseded, 1 unbuilt roadmap, 9 archived);
      `.draft-01…09` archived to `docs/plans/archive/` (all 9 sha256-identical to their HEAD blobs);
      `.draft-10-autonomous-agent.md` kept at root as the live unbuilt roadmap (§9).
- [x] **DONE 2026-11-22** Trial-flagged "history" blocks removed from `skills/hyperframes/SKILL.md` (6 lines) and
      `skills/hyperframes-cli/SKILL.md` (13 lines); zero `history (trial)` markers remain; seams read coherently.
- [x] **DONE 2026-11-22** `skills/hyperframes-*` decision: **KEEP** as vendored content for the external
      `npx hyperframes` ecosystem — zero product wiring re-verified (`rg -i hyperframes` over packages/,
      package.json, bunfig.toml, bun.lock, .github → 0 matches); documented in the new `skills/README.md`.
      Removal/relocation stays an owner decision if the external ecosystem ever disappears.

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

## 11. Sprint-2 follow-ups (discovered 2026-11-22, all non-blocking, recorded during the swarm's verification)

- [ ] `packages/learning/src/store/index.ts` silent catch mappers (~132/229/246) + `sqlite-vec/index.ts:198,207` `.catch(() => undefined)` metric inserts — same treatment as the §4 hardening item.
- [ ] Add a retained-heap assertion to `test/ingest-load.test.ts` so the `run.ts` `parsed`/`chunked` pruning fix is test-pinned (a plain revert currently passes the suite).
- [ ] Pre-fix books: re-ingest required after upgrade (chunk boundaries + `text_norm` changed); land the mismatch→re-ingest job (or document the ops step) before bumping `NORMALIZER_VERSION` — a bump today is inert because nothing reads it yet.
- [ ] Docs sweep: `WHATS_DONE.md`, `TARGETED_LEARNING_WORKLOG.md`, `docs/audit/2026-10-31-comprehensive-findings.md` and the `learning/src/index.ts` header still reference the deleted pool stub / old behavior.
- [ ] Unify the two 400 body shapes in the TL route group (handler `_tag` vs schema-decode `Payload`) and decide the no-404 contract (currently `200 false` / SPA catch-all; pinned by tests).
- [ ] `IndexerService.runInTransaction` Phase C: add an orphan-file cleanup hook for post-commit filesystem failures (stale duplicate .md files possible).
- [ ] Chunking refinements: TOC-page heading strings can anchor a section start at the TOC occurrence; pre-existing ~2× whole-page overlap at cross-page PDF bounds is preserved by design — reconsider both.
- [ ] Deep lexical handling of rewritten follow-ups in the Rust engine (`fts_expression` one-liner option) and the `src/eval` export-map decision.
- [ ] Frontend next pass: luxon (259 KB) eager via `context/models.tsx`, kobalte (235 KB) eager via `ui` DialogProvider/toast; optional splash for the marked-chunk gap; `ConnectionGate` timeout-loop nuance.
- [ ] Run the server `tsgo` typecheck on a machine with more memory (this 4 GB sandbox OOM-kills it; runtime graph-boot tests cover the sprint's server change).
- [ ] httpapi-instance "missing projects" test still runs on bun's 5s default timeout (~3.6s typical — bump to 20s like its siblings if it ever flakes).
- [x] **DONE 2026-11-22** `/favicon-light.svg` 404 fixed (discovered during §8 favicon work): the canonical
      `packages/ui/src/assets/favicon/favicon-light.svg` is now copied byte-identical into
      `packages/app/public/` AND `/favicon-light.svg` is allowlisted in the server `PUBLIC_UI_PATHS`
      (`src/server/shared/public-ui.ts`, next to `/favicon.svg`). `isPublicUIPath` sanity-checked
      (GET true / POST false / unknown false); smoke 5/0, server TL 26/0, instance 7/7 re-run green.
- [ ] Combined single-process server-test run (`bun test test/server/httpapi-targeted-learning.test.ts test/server/httpapi-instance.test.ts`) shows inter-file contamination (TL's `/tmp/tl-routes-test-*` log path) — run the files separately (both green per-file); consider a test-isolation fix.
- [ ] Auth UX (from §2 #8, 2026-11-22): when the global SSE stream (or any data request) 401s with a stale cookie, surface a re-login prompt instead of raw console errors — the retry loop currently just logs `[global-sdk] event stream error` until the user re-authenticates manually.
- [ ] Run one `docker build && docker run` smoke of the new production CMD (`/usr/local/bin/diveeoi`) on a host with a Docker daemon — the dev sandbox has none; the Dockerfile change was verified by construction only (build.ts emits a single compiled Bun executable; `find` pattern matches exactly one file).
- [ ] `pacote@21.5.1`: the deleted 21.5.0 patch fixed a git-tarball fallback bug still present upstream — re-derive as a 21.5.1 patch only if a tarball fallback failure ever shows up.

- [ ] Memory (from the 2026-11-23 MEMORY_REVIEW re-check): extractor session extraction has no idempotency key
      (scheduler + manual `extractNow` can double-extract); multi-node extraction commits per-node without a wrapping
      transaction (partial commits possible); public `MemoryService.updateNode` rebuilds wikilinks outside a
      transaction (delete-all-then-reinsert race); indexer schema DDL is raw strings without `PRAGMA user_version`.
- [ ] Memory UI: build the Settings → Memory inspector tab on the kept `GraphView.tsx` (needs a read-only memory
      graph/stats HTTP endpoint, tab wiring, i18n keys ×18 locales) — decision recorded in §5.
- [ ] Account/org UX: a choose-your-org screen when login returns multiple orgs (needs endpoint + client surface;
      default-first-org stands until then).
- [ ] Plugin lifecycle: dedicated `plugin.failed` event on the global bus (init failures currently surface via
      `publishPluginError`).
- [ ] Server pricing: contribute a reasoning-token rate field to models.dev, then consume it in
      `Session.getUsage` instead of the output-rate stopgap.
- [ ] cors-vary: file the upstream Vary-merge PR at Effect-TS/effect (v4 smol beta, `HttpMiddleware.cors`
      `headersFromRequestOptions` ~L332); delete the local mitigation middleware once a release ships it.
- [ ] DB public facade: `SessionV2.reattach(sessionID, workspaceID)` for recorded sessions on replaced workspaces;
      opaque event cursor for the HTTP/SDK surface (API-shape decision); `OpenCode.create()` Promise facade.
- [ ] db v2 tool layer, prioritize IF background/detached tool execution ships: parser-based shell-command
      advisories (current token-based scan is advisory-only) and crash-recovery/idempotency between `Tool.Called`
      and durable settlement.
- [ ] gitlab-duo: rewrite the commented 410-line test suite against the Effect Provider service + instance fixtures
      (support itself is implemented in src; `Env.set` now works, which was one of the blockers).
