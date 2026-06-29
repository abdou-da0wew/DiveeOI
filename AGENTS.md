# DiveeOI Project Guide

**DiveeOI** is a fork of [OpenCode](https://github.com/anomalyco/opencode) that extracts only the web UI and server components into a standalone web application. The TUI (terminal UI) subsystem has been completely removed.

## First Read

Start with `PROJECT_GUIDE.md` — it has the full architecture, every package, server startup flow, database schema, and development commands.

## Key Facts an Agent Would Miss

- **TUI was removed** — all TUI/CLI code (`src/plugin/tui/`, `src/config/tui*`, `src/stubs/tui-*`, `src/cli/`, TUI tests) was deleted. Do not reference or attempt to use TUI features. `@diveeoi/plugin/tui` exists but is dead code.
- **Effect version**: `4.0.0-beta.74` — beta APIs like `Effect.fn`, `Effect.callback`, and `effect/unstable/*` are in use. Check the catalog version before upgrading.
- **Typecheck command**: `bun turbo typecheck` (runs per-package via tsgo). Some packages (`db`, `api`) wrap it in `systemd-run --user --scope -p MemoryMax=1.8G` for memory-constrained environments.
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
| `@diveeoi/api` | `packages/api` | Effect HttpApi definitions (~18 groups) |
| `@diveeoi/app` | `packages/app` | SolidJS SPA frontend |
| `@diveeoi/ui` | `packages/ui` | Shared UI component library (197+ components) |
| `@diveeoi/llm` | `packages/llm` | Effect Schema-first LLM client |
| `@diveeoi/sdk` | `packages/sdk` | API client SDK (v1 + v2 generated) |
| `@diveeoi/plugin` | `packages/plugin` | Plugin SDK |
| `@diveeoi/effect-drizzle-sqlite` | `packages/effect-drizzle-sqlite` | Drizzle ORM + Effect SQLite adapter |
| `@diveeoi/effect-sqlite-node` | `packages/effect-sqlite-node` | Node.js SQLite bridge |
| `@diveeoi/http-recorder` | `packages/http-recorder` | Record/replay HTTP (test only) |
| `@diveeoi/script` | `packages/script` | Build utilities (internal) |
| `@diveeoi/identity` | `packages/identity` | Brand assets (logos/icons) |

## Architecture Notes

- **Stack**: TypeScript 5.8, Bun 1.3.14, Effect-TS 4.0.0-beta.74, SolidJS 1.9, Vite 7.1, Tailwind 4.1, Drizzle ORM 1.0 RC2, SQLite.
- **Server**: Effect-TS `HttpRouter`/`HttpApi` framework. All business logic is Effect layers. Entry: `packages/server/src/main.ts`.
- **Auth**: Simple password-gated auth. No OAuth, no API keys on the server side.
- **Database**: SQLite via Drizzle ORM with a custom `effect-drizzle-sqlite` bridge. 35+ migrations in `packages/db/src/database/migration/`.
- **Per-package AGENTS.md files exist** — read the one for the package you're working on before making changes.
