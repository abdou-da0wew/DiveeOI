CRITICAL SYSTEM DIRECTIVE: Before writing, editing, or scaffolding ANY code, you MUST read the root `.zcode-quality.md` file. You must strictly align your architecture, naming styles, and code-shaping structures to its exact instructions. No exceptions.

# DiveeOI Project Guide

**DiveeOI** is a fork of [OpenCode](https://github.com/anomalyco/opencode) that extracts only the web UI and server components into a standalone web application. The TUI (terminal UI) subsystem has been completely removed.

## First Read

Start with `PROJECT_GUIDE.md` for the package/source map and `CONTEXT.md` for the current source/runtime hand-off. The current release and verification boundary is recorded in `RELEASE_HANDOFF_2026-11-06.md`.

## Key Facts an Agent Would Miss

- **TUI was removed** — all TUI/CLI code (`src/plugin/tui/`, `src/config/tui*`, `src/stubs/tui-*`, `src/cli/`, TUI tests) was deleted. Do not reference or attempt to use TUI features. `@diveeoi/plugin/tui` exists but is dead code.
- **Effect version**: `4.0.0-beta.74` — beta APIs like `Effect.fn`, `Effect.callback`, and `effect/unstable/*` are in use. Check the catalog version before upgrading.
- **Typecheck command**: `bun turbo typecheck` (runs per-package via tsgo). Some packages (`db`, `api`) wrap it in `systemd-run --user --scope -p MemoryMax=1.8G` for memory-constrained environments.
- **Targeted Learning owns separate persistence** — `packages/learning` stores the book library in `books.db` and student memories in `student.db`; do not describe all product state as one SQLite file. Read `packages/learning/AGENTS.md` before changing it.
- **`@diveeoi/http-recorder` is a test-only dependency** — never import it in production code.
- **`packages/script` is an internal build tool** — not an npm-published package. Only referenced as a dev dependency.
- **Conditional imports** in `packages/db`: `#sqlite`, `#pty`, `#fff` resolve to Bun or Node implementations based on runtime. Add both implementations when adding platform-specific code.
- **Self-reexport pattern**: `export * as Foo from "./foo"` at the bottom of each module file. Consumers do `import { Foo } from "@/foo/foo"`. See `packages/server/AGENTS.md` for full details.
- **Module shape**: flat top-level exports + self-reexport. No `export namespace`, no barrel `index.ts` in multi-sibling directories.
- **`as never` casts at `LayerNode.make` call sites** — needed because Effect v4 beta.74 propagates `unknown` as RIn when layers with opaque RIn are composed via `Layer.provide`/`Layer.provideMerge`.
- **`testEffect()`** from `test/lib/effect.ts` is the shared Effect test runner. All packages use it.
- **Type errors with `Context.Service<Self, Interface>()`** — structural type conflicts between different Service classes are a known TypeScript limitation. Fix: widen body types to `Body<A,E2,any>`.

## Package Map

| Package | Path | Role |
|---|---|---|
| `@diveeoi/server` | `packages/server` | Main server, business logic, HTTP server bootstrap, ~50+ Effect layers |
| `@diveeoi/db` | `packages/db` | Database, AI providers, session engine, tool definitions |
| `@diveeoi/api` | `packages/api` | Effect HttpApi definitions (21 registered groups) |
| `@diveeoi/app` | `packages/app` | SolidJS SPA frontend |
| `@diveeoi/ui` | `packages/ui` | Shared SolidJS UI component library |
| `@diveeoi/llm` | `packages/llm` | Effect Schema-first LLM client |
| `@diveeoi/sdk` | `packages/sdk` | API client SDK (v1 + v2 generated) |
| `@diveeoi/plugin` | `packages/plugin` | Plugin SDK |
| `@diveeoi/learning` | `packages/learning` | Targeted Learning runtime, hybrid retrieval, grounding, student memory, and offline training |
| `@diveeoi/effect-drizzle-sqlite` | `packages/effect-drizzle-sqlite` | Drizzle ORM + Effect SQLite adapter |
| `@diveeoi/effect-sqlite-node` | `packages/effect-sqlite-node` | Node.js SQLite bridge |
| `@diveeoi/http-recorder` | `packages/http-recorder` | Record/replay HTTP (test only) |
| `@diveeoi/script` | `packages/script` | Build utilities (internal) |
| `@diveeoi/identity` | `packages/identity` | Brand assets (logos/icons) |

## Architecture Notes

- **Stack**: TypeScript 5.8, Bun 1.3.14, Effect-TS 4.0.0-beta.74, SolidJS 1.9, Vite 7.1, Tailwind 4.1, Drizzle ORM 1.0 RC2, SQLite.
- **Server**: Effect-TS `HttpRouter`/`HttpApi` framework. All business logic is Effect layers. Entry: `packages/server/src/main.ts`.
- **Auth**: Authentication supports Basic and JWT/account modes; default `DIVEEOI_AUTH_MODE` is `both`. Production must use explicit strong credentials/secrets. See `docs/security-auth.md`.
- **Database**: SQLite via Drizzle ORM with a custom `effect-drizzle-sqlite` bridge. 35+ migrations in `packages/db/src/database/migration/`.
- **Targeted Learning stores**: the book library and vectors live in `books.db`; student memories/notes live in `student.db`. These are separate from the core application database. Read `packages/learning/AGENTS.md` before changing the feature.
- **Per-package AGENTS.md files exist** — read the one for the package you're working on before making changes.

## DiveeComposer incident references

For work involving provider authentication, model catalogues, model selection, Composer routing, or Models settings, read `COMPOSER_INCIDENT_HANDOFF.md` for the historical incident analysis and `CONTEXT.md` / `RELEASE_HANDOFF_2026-11-06.md` for current source/runtime status. Preserve the strict free-only and context-fit guarantees. A display-only Composer catalogue entry must never be routed to an LLM request. Do not infer deployment provenance from the current source HEAD.


## Verification Requirements

- User-visible UI changes require manual browser QA after fixes, in addition to automated tests and typechecks. On the VDS, use `agent-browser` with its installed `core` and `dogfood` skills, a named session, real UI interactions, and screenshot evidence. Record results in `WORKLOG.md` or `docs/qa/`.
- For settings/credential QA, use a disposable local server with isolated XDG data/config directories. Never run experimental key saves/removals against the live service or use production provider credentials.
- Repository commit hooks are tracked in `.githooks/`. This checkout enables them with `git config core.hooksPath .githooks`; the `commit-msg` hook appends the DiveeAgent co-author trailer.

## Active release handoff

For current release readiness, read `RELEASE_HANDOFF_2026-11-06.md` and `CONTEXT.md`; the November 3 hand-off is a historical snapshot. `COMPOSER_INCIDENT_HANDOFF.md` remains the original incident-specific analysis. Do not restart `diveeoi.service` or run privileged deployment commands without explicit user approval.
