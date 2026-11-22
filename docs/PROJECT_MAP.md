# DiveeOI — Project Map

> Deep-understanding document produced 2026-11-22 from source HEAD `c0951df` (`dev`).
> Companion file: [`TODO.md`](../TODO.md) holds the consolidated pending-work list.
> This file explains **what every part of the repo is and how it works**. Where possible, claims carry the
> file path that proves them. Authoritative in-repo sources this map summarizes: `README.md`,
> `PROJECT_GUIDE.md`, `DIVEEOI_BRIEF.md`, `AGENTS.md`, `CONTEXT.md`, `DECISIONS.md`, `docs/*`, and per-package
> `README`/`AGENTS` files.

---

## 1. Identity

**DiveeOI is a self-hosted AI development workspace** — a browser UI + one server process; you point it at project
directories and AI agents read/write files, run shell commands, use MCP tools, and stream results back. It is a
**fork of OpenCode** (SST) with the TUI/CLI removed (`AGENTS.md`: "extracts only the web UI and server components";
fork port log in `plans/MigrateBranding/CHANGES_TO_PORT.md`). Upstream DNA survives as `OPENCODE_*` env fallbacks,
`opencode.db` defaults, and `@opencode/*` service tags.

On top of the OpenCode core, DiveeOI adds its own product surface: **JWT accounts + Basic auth**, a persistent
**Memory knowledge graph**, **Targeted Learning** (book-grounded RAG tutoring with Arabic/English OCR, grounded
`@book:` sessions, citation verification, separate student memory), **Retrieval V2** (a Rust BM25+dense+RRF engine
with a distilled student query encoder), **Remote SSH Sessions** (outbound profiles + inbound REPL), **Rich UI**
(model-authored declarative UI), **Exams** (encrypted answer keys, grading flow), and the **coenx-video**
code-authored video/interactive-lesson engine.

Design stance (`DIVEEOI_BRIEF.md`): everything stays local and inspectable — schema, config, logs, DB files.
Single-node app; non-goals are multi-tenant hosting, cloud sync, chat SaaS.

## 2. Stack

| Layer | Technology |
|---|---|
| Language / runtime | TypeScript 5.8 strict, **Bun 1.3.14** primary (Node ≥22 secondary) |
| Monorepo | Bun workspaces + Turborepo 2.8; `tsgo` (`@typescript/native-preview`) for typecheck |
| Server | Effect-TS **4.0.0-beta.74** (HttpApi/HttpRouter, Layers, `Effect.fn` beta APIs) |
| Frontend | SolidJS 1.9 + `@solidjs/router`, Vite 7, Tailwind 4, Kobalte, TanStack solid-query/solid-virtual |
| Data | SQLite via Drizzle ORM 1.0-rc2 through a custom `@diveeoi/effect-drizzle-sqlite` bridge; separate `books.db` / `student.db` for learning |
| LLM | Vercel AI SDK 6 (default runtime) + `@diveeoi/llm` schema-first native runtime (opt-in) |
| Native | Rust: `divee-retrieval` (learning) + `coenx-video-native` (Cairo/Pango renderer) — JSONL sidecars, not napi |
| Misc | Go (self-hosted CI runner), Python (student-encoder training toolkit), pdf.js, ghostty-web terminal, tree-sitter (shell permission scanning) |

Root `package.json` declares: `"description": "AI-powered development web app - fork of OpenCode"`, 10
`patchedDependencies` (Bun patches for solid-js, effect beta, MCP SDK, AI-SDK providers, virtualizers…).

## 3. Repository layout

```text
DiveeOI/
├── packages/            19 workspace packages (§4)
├── docs/                operator/contributor/architecture/QA docs + audit + plans + handoffs
├── plans/               historical implementation plans (branding migration, optimization, memory)
├── skills/              hyperframes-* agent skill packs (NOT wired into the app; external ecosystem content)
├── .agents/skills/      19 coenx-video project skills — IS wired (server Skill service scans .agents/skills/**)
├── tools/self-hosted-ci Go CI runner (poll-based, hardened Docker exec)
├── scripts/             build orchestrator, brand PDF generators, rag-e2e, tl-live-check
├── tests/fixtures/      sample apps used as fixtures (no root test runner on purpose — bunfig.toml tripwire)
├── brand/, packages/identity/   logo/favicon assets (Mark 02 "Frame + Cursor")
├── .draft-10.md         the unbuilt autonomous-agent program roadmap (drafts 01–09 archived 2026-11-22 → docs/plans/archive/)
├── CONTEXT.md           current engineering hand-off (2026-11-20)
├── WORKLOG.md           chronological work journal (newest last)
├── DECISIONS.md         durable technical decisions (TL, SSH, video, UI)
└── TODO.md              consolidated pending-work list (generated 2026-11-22)
```

## 4. Packages

| Package | Role in one line |
|---|---|
| `@diveeoi/server` | The only stateful service: HTTP bootstrap, ~55 Effect layers, session loop, tools, MCP, permissions, plugins, SSH |
| `@diveoi/db` (sic: `@diveeoi/db`) | Persistence + provider glue + session engine + canonical tool implementations + LayerNode graph |
| `@diveeoi/api` | Typed v2 HTTP contract: 21 HttpApi groups + auth handlers + JWT middleware |
| `@diveeoi/app` | SolidJS SPA (sessions, composer, exams, books, settings, i18n ×18 locales) |
| `@diveeoi/ui` | Shared component library: Kobalte primitives, v2 redesign peers, 40 themes, pierre virtualized viewer |
| `@diveeoi/llm` | Schema-first LLM client: Route = {protocol, endpoint, auth, framing}; provider facades |
| `@diveeoi/sdk` | Client SDK: v1 hand-written + v2 generated from live OpenAPI via hey-api |
| `@diveeoi/learning` | Targeted Learning: ingestion/OCR/chunking/BGE-M3 embeddings/hybrid retrieval/grounding/student memory + Rust engine + training toolkit |
| `@diveeoi/memory` | Persistent knowledge graph (nodes/links, FTS index, graph scorer, LLM extractor, consolidation) |
| `@diveeoi/coenx-video` | Deterministic video authoring + rendering engine (TS) with Rust/Cairo native renderer and interactive-player output |
| `@diveeoi/plugin` | Plugin SDK (ToolDefinition + hook namespaces) |
| `@diveeoi/profiler` | In-process call-tree profiler → JSONL (`DIVEEOI_PROFILER=1`) |
| `@diveeoi/http-recorder` | Test-only VCR: ordered HTTP/WS cassettes with redaction (`RECORD=true`) |
| `@diveeoi/effect-drizzle-sqlite` | Effect ↔ Drizzle SQLite bridge (savepoints, yieldable builders) |
| `@diveeoi/effect-sqlite-node` | Node `node:sqlite` SqlClient (secondary runtime path) |
| `@diveeoi/script` | Internal build/migration helpers (devDependency only) |
| `@diveeoi/identity` | Brand assets only — **not** auth |
| `packages/mcp` | Not a package: Go MCP server source (read-only opencode.db reader), binaries removed from VCS 2026-11-22 — build locally with `go build` |

### 4.1 `packages/server` — the core

- **Entry** `src/main.ts`: waits for parent exit (in-process restart), optional profiler import, CLI dispatch,
  then `Server.listen({port 4097})`; forks DevMonitor, Composer-ban restore, task boot-resume (replays stale
  `agent_task` journals), inbound SSH listener, and an adaptive GC loop (`Bun.gc` incremental/emergency driven by
  host memory).
- **Route assembly** `src/server/routes/instance/httpapi/server.ts`: merges v1 instance groups (global/event/pty/
  instance) + **v2 `Api` from `@diveeoi/api`** (21 groups) + `/doc` OpenAPI + theme + memory-extract + remote-probe
  + UI catch-all; middleware: error, compression, CORS, `MoveSession`, `JwtAuth`, `AdaptiveResource`,
  Observability. DI = `LayerNode.buildLayer(app)` (memo + cycle detection over ~55 nodes; the `provideMerge`
  seam exposes Memory/ToolRegistry outside the group — documented in `DIVEEOI_BRIEF.md` §7).
- **Session loop** `src/session/prompt.ts` (~2.4k lines): `createUserMessage` (materializes file/MCP/image parts) →
  token window → `runLoop` { status busy → filter compacted → stream via `SessionProcessor` → dispatch tool-calls →
  compaction → todo-completion gate with ≤3 nudges → exit on finish }. `processor.ts` handles events, enforces
  **doom-loop detection** (3 identical tool inputs → `permission.ask("doom_loop")`), dual-writes v1 rows + v2
  events, retries with provider policy. Supporting: `llm.ts` (AI-SDK default / native opt-in via CircuitBreaker),
  `compaction.ts`, `model-fallback.ts`, `watchdog.ts` (logs stalls; cannot interrupt yet), `book-mentions.ts`,
  `skill-mentions.ts`.
- **Tools** `src/tool/registry.ts`: built-ins (shell, read, glob, grep, edit, write, task, webfetch, todo,
  websearch, db-export, question, rich-ui, tasks/*, memory/* ×10, learning book tools, coenx capability/validate),
  lazy (skill, apply_patch, lsp, plan), custom via `Glob.scanSync("{tool,tools}/*.{js,ts}")` + plugin tools; shell
  commands are tree-sitter parsed (bash+powershell) for permission scanning (`src/tool/shell.ts`).
- **Permissions** `src/permission/index.ts`: rules `{permission, pattern, action}` — **last matching wildcard wins**,
  default `ask`; `ask()` = Deferred + `permission.asked` event; `reply` supports `once`/`always` (persists rule,
  wakes peers)/`reject` (optionally carries user feedback as `CorrectedError`).
- **Auth** (with `packages/api`): Basic (`DIVEEOI_SERVER_USERNAME/PASSWORD`, non-prod default `DIVEEOI/divee`) +
  JWT accounts (`jose` HS256; access 15 min, refresh 4 d as HttpOnly cookie `diveeoi_refresh`; server-session
  cookie carries `credential_version` HMAC so password changes invalidate it). Registration closes after the first
  account unless `DIVEEOI_AUTH_ALLOW_REGISTRATION`; first admin claimed atomically via
  `packages/db/src/auth-user/user.ts`.
- **MCP** `src/mcp/index.ts` (969 lines): stdio + StreamableHTTP→SSE fallback, OAuth provider + callback,
  tool-list-changed watch.
- **Remote sessions**: `src/ssh-client/` (outbound: OpenSSH discovery, strict known_hosts verification,
  AES-256-GCM-encrypted server-owned profiles, SFTP fs) + `src/ssh/` (inbound REPL listener).
- Also: `src/agent/` (build/plan/general/explore/research/subthinker/code-reviewer/compaction/title/summary),
  `src/task/` (persisted autonomous tasks), `src/acp/` (Agent Client Protocol), `src/exam/`, `src/skill/`,
  `src/worktree/`, `src/snapshot/`, `src/plugin/` (loader + 9 auth plugins: codex, github-copilot, gitlab, poe,
  cloudflare, azure, digitalocean, xai, snowflake-cortex), `src/provider/composer.ts` + `free-tier.ts`
  (**DiveeComposer**: display-only free router that selects a concrete eligible provider/model per turn; strict
  free-only guarantee — see `COMPOSER_INCIDENT_HANDOFF.md`).

### 4.2 `packages/db`

The lower half of the core. Runtime seams via package `imports`: `#sqlite` (bun ↔ node), `#pty`, `#fff` (walker).
Database open sets WAL/NORMAL/busy_timeout/adaptive cache pragmas (`src/database/database.ts`); migration engine
runs a generated bootstrap (`schema.gen.ts`, 454 lines of DDL) for empty DBs and 51 incremental TS migrations
otherwise. **Main tables**: `project`, `project_directory`, `workspace`, `session`, `session_message`,
`message`/`part` (v1), `session_input` (event-sourced inbox), `session_context_epoch`, `session_anchor(_ref)`,
`session_share`, `todo`, `reminder`, `agent_task`(+`_call`,`_event`), `user`, `auth_refresh_token`,
`verification_token`, `account(_state)`, `control_account`, `credential`, `permission`, `preference`,
`event_sequence`/`event` (event sourcing), `diveeoi_exam`/`diveeoi_exam_attempt` (**AES-GCM-encrypted answer
keys**), `data_migration`. Also hosts: v2 session store/projector/runner, canonical tool implementations,
`adaptive/` (4 resource profiles × 13 targets re-evaluated every 90 s), `LayerNode`, ripgrep, vendored
GitHub-Copilot models, and the **coenx-video agent tools** (`src/tool/coenx-video.ts`) + 40 bundled skills under
`src/plugin/skill/bundled/` (20 × coenx-video*, charts/docx/pdf/xlsx/pptx, research-explorer, skill-creator,
ui-ux-pro-max…).

### 4.3 `packages/llm`

Schema-first provider core (opt-in native runtime). Canonical Effect Schema model: branded IDs,
`GenerationOptions`, `Model{id, providerID, route}`, message parts, `LLMEvent` union (text/reasoning/tool/step/
finish + Usage). **Route = {protocol, endpoint, auth, framing}** — one protocol powers many providers
(`openai-chat` → OpenAI/DeepSeek/Together/Cerebras/…). Protocols: openai-chat, openai-responses,
anthropic-messages, gemini, bedrock-converse (+event-stream/auth/cache/media), openai-compatible-chat. Client
(`src/route/client.ts`) does request/generate/stream/generateObject over HTTP-SSE or WebSocket executors; hosted
tools flagged `providerExecuted`. Recorded fixture tests via `@diveeoi/http-recorder` (`RECORD=true`,
`RECORDED_PROVIDER=…`).

### 4.4 `packages/app` (frontend)

- Boot `src/entry.tsx` (Sentry, platform impl, legacy `?auth_token`) → `app.tsx` provider tree
  (`ServerProvider > GlobalProvider > ConnectionGate` → routes `/login`, `/register`, `/`, `/:dir/session/:id?`,
  `/new-session`) — gates: connection health (Effect loop) + `AccountGate`.
- **Sync engine** `src/context/`: one SSE stream per server (`server-sdk.tsx`: 16 ms coalescing, stale-delta drop,
  heartbeat, reconnect) → `server-sync.tsx`/`global-sync/*` (bootstrap queries; per-directory child stores LRU 30 /
  TTL 20 min; event-reducer applies SSE; optimistic merges; session prefetch/trim) → `sdk.tsx`/`sync.tsx` dir-scoped
  views. `auth.tsx` = JWT in memory + HttpOnly refresh cookie (12-min refresh scheduler).
- **Session UI**: `pages/session/timeline/` (model/projection/rows → `message-timeline.tsx`),
  `composer/` (state machine for permission/question/todo/revert/followup docks; submit pipeline in
  `components/prompt-input/submit.ts`: create session or queue follow-up → optimistic add → `session.promptAsync` →
  rollback on error), terminal panel (ghostty-web WASM over `/pty/:id` WS), file tabs, review tab.
- **Exam mode** (`exam-tabs.ts`, `exam-workspace.tsx`, `exam-side-tabs.tsx`): timeline `create_exam` tool parts open
  exam tabs; submission builds a report prompt that makes the model call **`grade_exam`** (server owns the private
  AES-encrypted key); `grade_exam`/`review_exam` parts apply grades; retries honor `grade.nextAttempt`.
- **Book PDF panel** (`book-pdf-panel.tsx`): pdf.js byte-range streaming from `/targeted-learning/books/raw`,
  chunk metadata, citation-chip → highlight-overlay matching, selection bubble (explain/memorize/ask) → composer.
- **Targeted Learning UI**: schema-driven settings form from `GET /targeted-learning/settings/schema` (per-field
  PATCH, presets), library manager (upload ≤190 MB, job pause/resume/cancel/retry, 2 s poll), memory manager
  (pin/delete), status badges.
- **Settings**: v1 dialog + v2 redesign mirror (toggle `settings.general.newLayoutDesigns`); providers/models/LLM/
  features/servers; `dialog-select-model-unpaid.tsx` enforces the free-only Composer catalogue guarantee.
- i18n: 18 locale dictionaries + narrow parity test. Desktop-shell extras: `wsl/` (WSL server management), updater,
  remote-session dialogs. Tests: ~80 bun unit files + Playwright smoke/regression/performance suites.

### 4.5 `packages/learning` — Targeted Learning

Pipeline: **ingest** (PDF/DOCX/TXT parsers + OCR via pdf.js page images + tesseract.js with pinned ara/eng
tessdata) → **chunk** (parent slices; chunk rows `…-sN-pK`) → **embed** (pinned `Xenova/bge-m3` teacher,
1024-dim CLS+L2, sha256 manifest compiled into `src/manifest/pinned.ts`; Transformers.js in Bun) → store in
**`books.db`** (`books`, `sections`, `chunks`, `chunks_fts` FTS5, `chunk_vecs` base64/BLOB, `ingest_jobs`) →
**retrieve**: query rewrite (stubbed) → gate (pre-LLM refusal on dense/fused thresholds + Arabic small-talk) →
hybrid BM25 + dense cosine + RRF fusion; policy in TS, hot path in **Rust** `divee-retrieval`
(`native/retrieval/`: raw libsqlite3 FFI, Arabic normalization + 54 EN/AR stopwords, persistent `--serve` NDJSON
child with 4 s timeout / 30 s cooldown, optional in-Rust ONNX query embedding, `--eval` Recall/MRR/nDCG,
`--compact` BLOB migration) → grounded answer with `[chunk_id]` citations → post-turn **grounding verifier**
(`/grounding/post`) → student memory + book notes in **`student.db`**. Query encoder policy `auto|student|bge-m3`:
`auto` uses a **promoted** distilled student manifest (`divee-student.json`) or falls back to BGE-M3. Offline
training toolkit in `training/` (dataset builder, distillation, ONNX INT8 export, promotion gates: Recall@10 ≥0.95
etc.). Mounted by the server under `/targeted-learning` when `Features.flags.learning` (last among data services so
book-DB failure can't block boot); session integration via `prompt.ts` hooks through a process-wide runtime
(`DECISIONS.md` #6) to avoid layer-graph changes.

### 4.6 `packages/coenx-video`

One validated, versioned composition model → four backends: MP4 via per-frame SVG → vendored/system ImageMagick →
FFmpeg; MP4 via **Rust/Cairo/Pango** sidecar (`render_frame` ops, PNG per frame, `select` unsupported); interactive
browser project (validated interaction AST, Canvas/SVG stage, `coenx:event` DOM events); educational compositions
require `provenance.mode = education` + citations. TS↔Rust boundary = persistent child process, newline-delimited
JSON (`AGENTS.md`: never log protocol output to stdout). Determinism: frames addressed by number, physics
precomputed per scene, bounded render profiles (18k–36k frames), single active render, atomic `.partial.mp4` rename
after ffprobe verify. CML+CSS+JS source compiles via `compileCmlProject`; 16 font families (incl. Arabic) bundled.
Status: WP1 done, 62 tests / 243 assertions green at the 2026-11-21 handoff; no production route/UI yet. See
`docs/coenx-video.md`, `docs/plans/coenx-video-renderer-roadmap.md`, `docs/handoffs/coenx-video-renderer-handoff-2026-11-21.md`.

### 4.7 Skills system

Server `Skill` service (`packages/server/src/skill/index.ts`) scans `~/.claude/skills`, `~/.agents/skills`,
project `.agents/skills` + `.claude/skills`, config dirs, and configured `skills.paths`/`skills.urls` (URL pull
with path-traversal safety). The `skill` tool injects instructions into conversations; ACP lists them. Bundled
skills are materialized from `packages/db/src/plugin/skill/bundled/` (40). `.agents/skills/coenx-video*` (19
skills + font library) is the project-level half. Root `skills/hyperframes-*` (10 skills, 276 files) is an
**external-ecosystem skill library** for the `npx hyperframes` CLI — read by coding agents, not executed by
DiveeOI; nothing in `packages/` references it.

## 5. End-to-end flow (a real prompt)

1. **UI capture** — composer resolves attachments/mentions (`resolvePromptParts`); `@book:` mentions become book
   context (`book-mentions.ts`); exam/book citation chips dispatch `diveeoi:*` window events.
2. **HTTP** — POST `/session/:id/prompt(Async)` (v1) or `/api/session/...` (v2), JWT/Basic enforced.
3. **Persist** — user message + parts written to SQLite; title generated on a forked small-model fiber.
4. **Loop** — `runLoop` builds system + instructions (+ up to 8 memory nodes via `SessionMemoryIntegration`,
   extraction fork-detached so the first token never stalls), applies token window, streams from the provider
   (AI SDK default; native `@diveeoi/llm` opt-in).
5. **Tools** — tool-call events dispatched through `ToolRegistry` → permission gate → execute (shell is
   tree-sitter-scanned; remote sessions bind SFTP/exec contexts); outputs truncated/stream-limited; results loop
   back as tool results.
6. **Events** — everything publishes v1 parts + v2 `SessionEvent`s → SSE → frontend sync engine → timeline.
7. **Stop/recover** — exit on finish without pending tool parts; crash mid-stream recovers as `interrupted` tool
   errors (event-sourced); compaction on overflow; todo gate nudges ≤3 times.

## 6. Data boundaries

Three stores: (1) **core app DB** `opencode.db` (sessions, projects, accounts, exams, tasks, events); (2)
**`books.db`** (library + vectors, `DIVEEOI_TL_DATA_DIR`); (3) **`student.db`** (student memories/notes). Keeping
them separate is a documented decision (`DECISIONS.md` #3): chats survive book-file loss and vice versa — back up
all three. Remote profiles/keys are server-owned AES-256-GCM files under `~/.config/diveeoi` (back up the key file
with them).

## 7. Build / deploy / ops

- `bun scripts/build.ts` (variants `:nobin|:current|:all`, memory-adaptive) → server binary with the built web UI
  embedded; turbo orders app→sdk→server.
- **Dockerfile**: Debian bookworm-slim (glibc for onnxruntime), Bun 1.3.14, optional `model-seed` stage
  pre-downloading BGE-M3; `HEALTHCHECK` treats 401 as healthy (auth-on-by-default); ⚠ currently runs the dev
  script as CMD (TODO #8).
- **Config hierarchy** (`server/src/config/config.ts`): remote `.well-known/opencode` → global config →
  `diveeoi.jsonc` → explicit flag → per-worktree `.opencode` → env content → account org → managed/MDM → derived
  defaults. `updateGlobal` must use jsonc edits to preserve comments.
- **Adaptive resources** (`packages/db/src/adaptive`): profiles comfortable/balanced/constrained/critical across 13
  targets (GC interval, RSS, SQLite cache, tool concurrency, stream/SSE/WS limits…), re-evaluated every 90 s with
  30% interpolation; drives `main.ts` GC fiber and every formerly-unbounded queue.
- **Profiler** (`packages/profiler`): AsyncLocalStorage call-tree + gauges → `.divee/profiler.jsonl`.
- **CI**: `tools/self-hosted-ci` — Go daemon polling git remotes, repo-owned `.diveeoi/pipeline.yml` (learning
  tests → server/app typecheck → `build:nobin`), hardened Docker steps. No GitHub Actions.
- Dev: `bun run dev:both` (server :4097, Vite :3000 proxying ~30 API prefixes). Tests run **per package** —
  `bunfig.toml` sets a tripwire root so `bun test` cannot run from the repo root.

## 8. Testing landscape

- Per-package `bun test` with a shared `testEffect` runner; DB 1,047 / server 2,770 / app 429 tests recorded at
  the Nov 3 verification (stale for current HEAD).
- Recorded provider suites via `http-recorder` cassettes (db, llm, server, memory devDeps).
- Rust: `cargo test --offline` ×9 (retrieval) + renderer pixel tests; clippy `-D warnings`.
- Playwright: smoke (session timeline, remote sessions, attach), regression ×4, performance benchmarks (AGENTS.md
  mandates baseline capture before timeline changes).
- Scripts-as-tests: `scripts/rag-e2e.ts` (full RAG proof), `scripts/tl-live-check.ts` (live gate calibration).
- CI pipeline: `.diveeoi/pipeline.yml` via the Go runner.

## 9. History in one screen

2026-09 fork/rebrand + `.draft-01…10` architecture drafts → 2026-10 Optimization 1.0 (adaptive stack) →
2026-10-26/27 Targeted Learning built (167 tests) → 10-29 hardening → 10-30 Go CI → 10-31 comprehensive audit
(9 bug clusters, 14 stubbed systems) → 11-02/04 Composer incident + recovery + full verification (Nov 3 =
last full green matrix) → 11-03/04 Retrieval V2 (Rust `--serve` + student distillation) → 11-05/06 release
hand-offs, docs/PDF refresh → 11-09 live UI test (15 bugs; ingest `error:"null"` crisis) → 11-19/20 SSH Remote
Sessions + Rich UI Learning/platformer + exam validation, commits published to `origin/dev` → 11-21 coenx-video
native Rust/Cairo renderer + roadmap/handoff. `CHANGELOG.md` remains **Unreleased-only**.

## 10. Sharp edges every contributor must know

From `AGENTS.md`, `DIVEEOI_BRIEF.md` §15, `PROJECT_LESSONS.md`, `DECISIONS.md`:

- Read the root `.zcode-quality.md` before writing code (Effect v4-beta.74 shaping rules; `Effect.fn` etc.).
- TUI is removed on purpose; `@diveeoi/plugin/tui` is dead code.
- Self-reexport pattern (`export * as Foo from "./foo"`) + flat exports; no barrels, no namespaces.
- `as never` casts at `LayerNode.make` call sites are a known Effect-beta workaround, not sloppiness.
- `Layer.provide(Node)` is a type violation — always `LayerNode.buildLayer(node)`; `Layer.pipe(layerObject)`
  typechecks but throws at runtime.
- Per-package `AGENTS.md` files exist — read the one for the package you touch (`packages/learning/AGENTS.md`
  especially).
- `http-recorder` is test-only (restricted-import enforced); never in production code.
- A display-only Composer catalogue entry must **never** be routed to an LLM request.
- Remote SSH must keep strict known_hosts verification and POSIX shell quoting; never accept-all host keys.
- `DIVEEOI_*` env names are preferred over legacy `OPENCODE_*`.
- Tests run per package, never from the root (tripwire in `bunfig.toml`).
- Verification discipline: user-visible UI changes require manual browser QA with screenshot evidence recorded in
  `WORKLOG.md`/`docs/qa/`; never claim live-model/provider verification that was not actually run.
