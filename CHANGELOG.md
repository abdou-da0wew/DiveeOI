# Changelog

Notable changes to DiveeOI are recorded here. Unreleased work remains under **Unreleased** until it is included in a release.

## Unreleased

### Added
- The memory scheduler now runs daily graph consolidation maintenance (duplicate merge, link strengthening, orphan decay) right after the daily extraction pass, gated on `consolidation.enabled`.
- `executeStream()` is implemented for all three SQLite connection adapters (bun, node, effect-sqlite-node): `Statement.stream` returns rows incrementally instead of dying; query failures surface as `SqlError`.
- New memory-integration test coverage: enabled-path boot (real memory layers + real scheduler, prompt-context loading, create→link→recall→update→delete, all memory tools vs bad data) and disabled-path child-process run (no layers/scheduler/tools work with the feature off).
- `Provider.requestCapabilities(model)` exposes per-provider request-shape quirks (OpenAI-OAuth stateless Responses requirements) so agent code stops branching on provider identity.
- `Formatter.Info` gained a `backend` field; shared backends (Ruff/uv) disable as a unit without special-casing.
- The API-package `pty.connect` raw WebSocket handler now participates in graceful-shutdown socket tracking (1001 close frame once closing/capped), with a tracker layer provided for standalone use.
- `@diveeoi/http-recorder` exports `isRecordMode()` (accepts `RECORD=true` and the historic `RECORD=1`), shared by both recorded test suites.
- `packages/db/src/public/opencode.ts` gained `layerWithDatabase(dbLayer)` so tests and embeddings can inject disposable storage.

### Fixed
- Fixed `Env.set`/`Env.remove` being silent no-ops (the `Effect.sync` was never yielded), and made the Env runtime contract explicit; the Bedrock and sap-ai-core provider loaders now publish auth keys through the Env service instead of writing `process.env` directly.
- Fixed the session watchdog being half-built: it now interrupts a no-progress run (session-scoped supervisor living outside the run fiber), restarts the loop from the persisted checkpoint with a queued diagnosis system-reminder, and pauses the session with a degraded error event after 3 unsuccessful restarts.
- Fixed statement preparation sitting outside the try block in all six SQLite driver execute paths — bad queries (missing table, syntax error) failed as raw defects instead of `SqlError`.
- Fixed scheduler memory extraction failing uncaught for a missing/unreadable session id (now logs and skips).
- Fixed extractor-generated memory node IDs containing UUID hyphens that violate the `NODE_ID_REGEX` path-validation rule (a later merge of such a node failed Phase C with "Path traversal attempt"); extraction now reuses `generateNodeId()`.
- Fixed the prompt-injection residual in memory extraction: conversation content is sanitized so injected `</conversation>` sequences cannot break out of the untrusted-data tag.
- Fixed the memory-indexer initialization failing to reach `ConsolidationService` from the server (the service was not exported from the `@diveeoi/memory` package root).
- Fixed the workspace sync listener swallowing failures (error status is now set via `Effect.tapError` and the fiber actually fails, so FiberMap drops it and restarts become possible).
- Fixed plugin initialization failures being swallowed without any event (now reported through the existing `publishPluginError` channel).
- Fixed the Copilot chat stream losing chunk type safety (concrete error schema; the `"error" in value` narrowing is now checked by the compiler).
- Removed the dead `DynamicDescription` tool type and normalized the LLM request message hot path (surrogate sanitization now pre-tests before the allocating replace).

## 1.19.7 (2026-11-23)

First tagged release since the fork; everything previously listed under **Unreleased** ships here, plus the release-day fixes below.

### Added

- Added the `@diveeoi/coenx-video` package foundation for shared composition authoring, keyframe animation, interactive state/event logic, Canvas/DOM playback, 2D and basic mesh rendering, SVG/FFmpeg MP4 export, audio tracks, and batched Rust physics.
- Added project-discoverable coenx-video agent skills for standard/interactive output selection, 17 visual styles, three explainer formats, transcript-led motion inserts, optional object separation and sound design.
- Archived the Awesome Claude motion-graphics page, its complete 17 style prompts, downloadable skill and page assets; cloned Barty-Bart/motion-graphics at a pinned MIT-licensed revision with source-specific asset notices intact.
- Added Rich UI Learning blocks and an interactive platformer component, including dedicated parser/schema modules, shared renderers, composition handling, and engine tests.
- Added exam-content validation that rejects embedded self-grading quizzes, and aligned exam tool schemas and review/export metadata with the Rich UI contract.
- Added server-managed outbound SSH Remote Sessions: OpenSSH host/profile discovery, Ed25519 key generation, saved-profile probing, encrypted password/passphrase storage, and per-session attach/disconnect with remote working-directory selection.
- Added strict SSH host-key verification against the server account's OpenSSH `known_hosts`, including hashed host entries, non-default ports, wildcard exclusions, and revoked-key handling.
- Added remote SFTP recursive globbing, upward discovery (`findUp`, `up`, `groupUp`, `globUp`), recursive parent creation, recursive copy destination creation, chmod, rename, and directory-aware removal.
- Added a separately configurable inbound SSH REPL listener with an explicit host-key file and optional username enforcement.
- Added focused SFTP and SSH host-verification tests, a reusable live SSH smoke script, and browser regressions for Settings and session attachment.

- Added Coenx Video's CML/CSS/CoenxScript source authoring pipeline for safe declarative video and interactive lessons.
- Bundled a 16-family offline typography library with Arabic/Latin WOFF2 subsets and per-family SIL OFL notices, used consistently in MP4 and interactive outputs.
- Added the Coenx video guidance skill suite, including examples, style prompts, capability maps and authoring references in DiveeOI's skill registry.
- Added a Rust/Cairo/Pango native frame renderer and an opt-in TypeScript-to-FFmpeg native MP4 pipeline with animation evaluation and audio muxing.
- Added an SVG DOM renderer option to the interactive player alongside the Canvas renderer.
- Expanded CPU 3D composition support with configurable lights/material shading, morph targets, keyframed 3D transforms, deterministic 3D physics, additional scene transitions and projected-mesh support in the opt-in Cairo native MP4 renderer.
- Added an offline-runnable Targeted Learning evaluation CLI (`tl:eval`) with a pluggable embedder (real/stand-in/student), golden-set schema v2 and synthetic fixtures, recall@k/MRR/nDCG/gate/refusal metrics, p50/p95 latency and peak-RSS measurement, student-vs-teacher comparison, and promotion-gate verdicts matching the Retrieval-V2 plan thresholds.
- Added route-level integration tests for the Targeted Learning HTTP group that boot the full production route tree offline, plus an end-to-end OCR ingest test running the real pinned tessdata pack offline with a mocked-pack fallback mode.
- Added numeric-claim grounding verification: figures in answers and citations (Latin and Arabic-Indic digits, thousand/decimal separators including Arabic `٫`/`٬`, percent) must appear in the cited chunk, with ungrounded figures reported per citation and named in retry prompts.
- Added an ingest-under-load stress test pinning bounded in-flight vectors, per-wave checkpointing, monotonic progress and post-completion cleanup, and regression tests pinning the outline-tiling fix.
- Registered the previously-inert orphan patches (`@silvia-odwyer/photon-node@0.3.4` — the wasm fix now provably applies at runtime — and `@npmcli/agent@4.0.2`), deleted three orphan patch files whose target versions no longer resolve (`gcp-metadata@8.1.2`, `pacote@21.5.0`, `@standard-community/standard-openapi@0.2.9`), and re-keyed the `@ff-labs/fff-bun` patch to the pinned 0.9.4.
- Added `docs/plans/INDEX.md` with an evidence-backed LIVE/SUPERSEDED/UNBUILT-ROADMAP/ARCHIVED classification of all plan documents, and archived the root `.draft-01…09` files to `docs/plans/archive/`.
- Added `tests/fixtures/README.md` documenting each fixture's purpose, origin and consumers, with an integrity-check script, and `brand/README.md` plus a `scripts/check-favicons.sh` drift checker establishing `packages/ui/src/assets/favicon/` as the single source of app favicons.

### Improved

- Tightened adaptive memory, concurrency, queue, stream, and cache budgets; SQLite cache sizing now respects an HDD-aware ceiling, and the server begins its low-memory cleanup path earlier.
- Made workspace fallback indexing lazy and bounded, built directory indexes incrementally, and revalidated cached project paths through a single workspace root.
- Improved Arabic and English grounding instructions and the Targeted Learning embedding/query-encoding path.
- Made server packaging more resilient by allowing reuse of an existing Web UI distribution and serving a file-backed UI asset directory when the embedded module is unavailable.
- Added Oxlint and Biome as root development tools, a focused remote test configuration, and explicit Playwright port/backend configuration.
- Reduced the app's first-load JavaScript by roughly half (1793.7 KB → 904.1 KB entry, gzip 536 → 273 KB) by lazy-loading the markdown/kaTeX/Shiki provider and the file viewer and removing the Effect runtime from the entry path.
- Pruned ingest-time page/outline/chunk structures after use so large-book ingests no longer retain whole-book text through the embedding phase.
- Hardened silent `catch: () => null` mappers across the learning pipeline (parsers, sqlite-vec availability probe, hybrid retrieval legs) so failures surface as typed errors or recorded diagnostics instead of nulls, and removed `@ts-nocheck` from the learning parser, embed pipeline and eval modules.
- Made memory-graph consolidation merges transactional (single SQLite transaction with in-transaction verification and rollback via a new `IndexerService.runInTransaction`) and replaced naive substring duplicate-content detection with normalized containment (NFKC, case, punctuation, Arabic-harakat folding).
- Switched the Dockerfile to run the compiled production binary (`CMD ["/usr/local/bin/diveeoi"]` after promoting the single built executable) instead of the dev script, preserving the healthcheck, data volume, port and `NODE_ENV=production`.
- Initialized the `third_party/motion-graphics` submodule at its pinned commit so vendored references resolve.
- Verified the `tools/self-hosted-ci` Go runner clean (Go 1.27.4: `go vet` zero findings, `go test` 36/36) and documented how to run it.
- Documented the vendored `skills/hyperframes-*` suite as external-ecosystem content and removed the trial-flagged "history" blocks from its SKILL.md files.

### Fixed

- Fixed the "New session" banner CTA doing nothing when no project was open yet (no navigation, no network call): the button now falls back to the directory picker and starts a session on the picked project, and the session-group headers always wire the handler.
- Fixed the composer Send button being dead while Enter worked: both submit icon buttons now submit explicitly on click instead of relying on the implicit form-submission chain through the Kobalte button + tooltip trigger.
- Fixed the `@` mention popup losing book options whenever the `/targeted-learning/health` call failed (stale-cookie 401, 503 during bootstrap, non-JSON error) with no retry: a resilient loader now retries transient `/books` failures, only an authoritative `booksDbAvailable: false` short-circuits, and stale loads are dropped.
- Fixed citation verification falsely reporting "not shown to the model this turn" for passages retrieved in earlier turns: grounding turn-state now keeps a sliding window of the last 10 turns (bounded at 20k chunk ids per session, oldest evicted first) instead of a per-turn flat set wiped at every turn boundary.
- Shell execution now quotes remote working directories and environment values as POSIX shell arguments instead of using JSON string quoting.
- Remote connection cache identities include the selected profile/authentication identity, preventing stale connection reuse after profile edits.
- Playwright's app proxy configuration now uses the backend's actual default port (`4097`) and the `VITE_DIVEEOI_SERVER_*` variables.
- Unsupported lower-level SFTP operations fail explicitly rather than silently claiming to succeed with incomplete behavior.
- Fixed the 2026-11-09 ingest memory-spike root cause: TXT/DOCX outlines stamped every heading with page 1, duplicating the entire book text once per heading; sections now tile page text between headings via character offsets (O(headings) instead of O(headings × book size)) while genuine multi-page PDF outlines keep their legacy ranges.
- Fixed Arabic sentence splitting treating decimal points as sentence terminators (figures such as `3.5` were mangled in extracted chunks), and chunks now persist search-normalized text in `text_norm` so FTS queries match retrieval normalization.
- Fixed the production route graph failing to resolve `@diveeoi/RemoteSession`, which made every authenticated instance request (including Targeted Learning routes) fail with "Service not found".
- Fixed BM25 retrieval of heuristic-rewritten follow-up queries by stripping the `(re: …)` marker before building the FTS match expression, while the dense path keeps embedding the raw query.
- The library UI no longer renders a literal `null` for books that fail indexing: a display helper trims the backend error, falls back to a translated message when absent, and exposes the full error in a tooltip.
- Fixed the light-scheme favicon 404: `/favicon-light.svg` (referenced by `index.html` for `prefers-color-scheme: light`) was neither shipped in the app's public directory nor allowlisted in the server's `PUBLIC_UI_PATHS`; the canonical asset is now copied byte-identical and the path is served publicly.
- Removed the dead Phase-1 worker-pool stub (`packages/learning/src/ingest/pool.ts`) and its dangling package export; the real pool remains `ingest/embed-pool.ts`.
- Removed un-wired upstream leftovers and dead weight: `packages/plugins` (imported non-existent `@opencode-ai/*` packages), the 7.7 MB prebuilt Go binaries under `packages/mcp/built-in/opencode-db-reader/` (sources kept, rebuilds git-ignored), the vestigial `packages/server/migration/` drizzle output duplicating a real db migration, and the empty `REMINDERS.md` heading file.
- Fixed the HTTP API exercise effect mode (`packages/server/script/httpapi-exercise.ts`): `AppLayer` never provided `ChildProcessSpawner` or `FSUtil`, so the lazily-initialized P6 machine tools (notify/exec/screenshot/kill-process/open-url/list-processes) and the skill/apply_patch tools failed at `ToolRegistry` init and the experimental tool-ID route died with `Service not found: effect/process/ChildProcessSpawner`; both layers are now merged into `AppLayer` in `packages/server/src/effect/app-runtime.ts` and into the HTTP route-tree composition in `packages/server/src/server/routes/instance/httpapi/server.ts`, which also repairs the machine tools in production (the `as never` cast had hidden the unsatisfied requirements). Auth mode: 194/194 passing; effect mode `tool.ids` passes.
- Fixed the file-picker fallback index race (`packages/db/src/filesystem/search.ts`): the lazy ripgrep crawl was forked fire-and-forget, so every cold `find()` query raced the scan and served an empty index (`findFile` returned `[]` — deterministic on any machine slower than the original VDS). The first caller now joins the scoped crawl fiber; later callers hit the warm index immediately.
- Fixed the minimal test stacks that construct `InstanceContextMiddleware` / `SessionPrompt` / glob+grep tools without `RemoteSession.Service` (the production graph gets it from `AppServices.serviceNodes` since `e7baab3`): `httpapi-instance-context`, `httpapi-promptasync-context`, `session/prompt`, `tool/glob`, `tool/grep` now provide `RemoteSession.defaultLayer` explicitly.
- Updated the `httpapi-v2-location` SSE test to the real event contract: filesystem-scoped events (`file.watcher.updated`) carry `location.directory` without `location.project`, so the decoded schema marks `project` optional instead of failing every stream.
- Refreshed the stale `tool/parameters` JSON-Schema snapshots after the glob/grep description updates.
- Added `db` location-layer test fixtures for the two coenx-video tools (`coenx_video_capabilities`, `coenx_video_validate`) missing from the expected application-tool lists.
- Turbo strict env mode silently dropped `DIVEEOI_VERSION`/`DIVEEOI_BUMP`/`DIVEEOI_RELEASE`/`DIVEEOI_CHANNEL` from build tasks, so release builds could not pin a version (the binary silently derived it from upstream npm latest); all four are now declared in `globalPassThroughEnv`.
- The 58 route scenarios missing from the HTTP API exercise registry are formally accepted as documented coverage debt: auth mode passes 194/194 registered scenarios, coverage-mode `--fail-on-missing` remains the enforcement point once the scenarios are written (decision recorded in `TODO.md`).
