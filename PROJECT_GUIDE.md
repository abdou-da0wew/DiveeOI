# DiveeOI Project Guide

> **DiveeOI** is a fork of [OpenCode](https://github.com/anomalyco/opencode) that extracts only the web UI and server components into a standalone web application. It is an AI-powered development web app that provides AI chat sessions, MCP (Model Context Protocol), tool definitions, an agent system, authentication, project management, file operations, git integration, and a complete HTTP API.

---

## Table of Contents

1. [Stack & Toolchain](#1-stack--toolchain)
2. [Repository Structure](#2-repository-structure)
3. [Package Dependency Graph](#3-package-dependency-graph)
4. [Root Configuration](#4-root-configuration)
5. [Package: @diveeoi/server](#5-package-diveeoiserver)
6. [Package: @diveeoi/db](#6-package-diveeoidb)
7. [Package: @diveeoi/api](#7-package-diveeoidb)
8. [Package: @diveeoi/app](#8-package-diveeoidb)
9. [Package: @diveeoi/ui](#9-package-diveeoidb)
10. [Package: @diveeoi/llm](#10-package-diveeoidb)
11. [Package: @diveeoi/sdk](#11-package-diveeoidb)
12. [Package: @diveeoi/plugin](#12-package-diveeoidb)
13. [Support Packages](#13-support-packages)
14. [Key Architecture Patterns](#14-key-architecture-patterns)
15. [Server Startup Flow](#15-server-startup-flow)
16. [Database Schema & Migrations](#16-database-schema--migrations)
17. [Development Commands](#17-development-commands)
18. [Build Output](#18-build-output)

---

## 1. Stack & Toolchain

| Layer | Technology |
|---|---|
| Language | TypeScript 5.8 (strict mode) |
| Runtime | Bun 1.3.14 (primary), Node ≥22 (secondary) |
| Monorepo | Bun workspaces + Turbo 2.8 |
| Server HTTP | Effect-TS HttpRouter / HttpApi (unstable) |
| Server DI | Effect-TS Context / Layer / Service system |
| Frontend | SolidJS 1.9 + Vite 7.1 |
| Styling | Tailwind CSS 4.1 |
| Database | SQLite via Drizzle ORM 1.0 RC2 |
| ORM Adapter | Custom `effect-drizzle-sqlite` bridge |
| LLM Client | Custom `@diveeoi/llm` (Effect Schema first) |
| AI SDK | Vercel AI SDK 6.0 (secondary path, bundled in @diveeoi/db) |
| API | Effect HttpApi + OpenAPI |
| Testing | Bun test, Playwright |
| Linting | oxlint |
| Formatting | Prettier 3.6 |
| CI/CD | SST (serverless deployment support via sst-env.d.ts) |

### Package Manager

`bun` (v1.3.14) with exact version resolution via `bunfig.toml`:

```toml
[install]
exact = true
```

### Patch Overrides

Several dependencies are patched (in `patches/`):
- `solid-js@1.9.10` — SolidJS runtime patch
- `@tanstack/solid-virtual@3.13.28` — virtualizer patch
- `@pierre/trees@1.0.0-beta.4` — file-tree patch
- `@modelcontextprotocol/sdk@1.29.0` — MCP SDK patch
- `effect@4.0.0-beta.74` — Effect-TS patch
- `@ff-labs/fff-bun@0.9.3` — file-system abstraction patch
- `@ai-sdk/xai@3.0.82`, `@ai-sdk/google@3.0.73` — AI SDK provider patches

### Catalog Dependencies

The root `package.json` defines a `catalog` section that pins shared dependency versions across all workspace packages:
- **Effect ecosystem**: `effect@4.0.0-beta.74`, `@effect/opentelemetry`, `@effect/platform-node`
- **SQLite**: `drizzle-orm@1.0.0-rc.2`, `drizzle-kit@1.0.0-rc.2`
- **AI**: `ai@6.0.168` (Vercel AI SDK)
- **Frontend**: `solid-js@1.9.10`, `vite@7.1.4`, `tailwindcss@4.1.11`
- **OpenTUI**: `@opentui/core@0.3.4`, `@opentui/solid@0.3.4`, `@opentui/keymap@0.3.4`
- **Kobalte**: `@kobalte/core@0.13.11` (accessible UI primitives)
- **Misc**: `ulid`, `fuzzysort`, `luxon`, `remeda`, `semver`, `marked`, `shiki`, `zod`, `diff`, `dompurify`

---

## 2. Repository Structure

```
DiveeOI/
├── package.json            # Root workspace config, catalog, scripts
├── bunfig.toml             # Bun config (exact installs)
├── tsconfig.json           # Root TS config (extends @tsconfig/bun)
├── turbo.json              # Turbo task definitions
├── bun.lock                # Lockfile
├── .gitignore
├── patches/                # Patched dependencies
│   ├── solid-js@1.9.10.patch
│   ├── effect@4.0.0-beta.74.patch
│   ├── @modelcontextprotocol/sdk@1.29.0.patch
│   └── ...
└── packages/
    ├── server/             # @diveeoi/server - Main server + business logic
    ├── db/                 # @diveeoi/db     - Database, LLM, session engine
    ├── api/                # @diveeoi/api    - HTTP API definitions (Effect HttpApi)
    ├── app/                # @diveeoi/app    - SolidJS SPA frontend
    ├── ui/                 # @diveeoi/ui     - Shared UI component library
    ├── llm/                # @diveeoi/llm    - Effect Schema-first LLM client
    ├── sdk/                # @diveeoi/sdk    - API client SDK (v1/v2)
    ├── plugin/             # @diveeoi/plugin - Plugin SDK
    ├── effect-drizzle-sqlite/  # Drizzle ORM + Effect SQLite adapter
    ├── effect-sqlite-node/     # Effect SQLite for Node.js bridge
    ├── http-recorder/      # Record/replay HTTP traffic for testing
    ├── script/             # Build/utility scripts
    └── identity/           # Brand assets (logos, icons)
```

---

## 3. Package Dependency Graph

```
                    ┌─────────────────────────────────────┐
                    │           @diveeoi/server            │
                    │  (business logic, HTTP server, TUI)  │
                    └────┬──────┬──────┬──────┬────────────┘
                         │      │      │      │
              ┌──────────┘      │      └──────────────────┐
              ▼                 ▼                         ▼
       ┌────────────┐   ┌──────────────┐   ┌────────────────┐
       │@diveeoi/api│   │ @diveeoi/db  │   │  @diveeoi/sdk  │
       │(HttpApi    │   │(DB, session  │   │  (API client)   │
       │ groups)    │   │ engine, LLM) │   │                 │
       └─────┬──────┘   └──┬───────┬───┘   └────────────────┘
             │             │       │
             └─────────────┤       └──────────────────┐
                           │                          │
                    ┌──────▼──────┐          ┌────────▼────────┐
                    │@diveeoi/llm │          │@diveeoi/plugin  │
                    │(LLM client) │          │(Plugin SDK)     │
                    └─────────────┘          └────────┬────────┘
                                                      │
                                              ┌───────▼───────┐
                                              │ @diveeoi/sdk  │
                                              └───────────────┘

  @diveeoi/app  ───►  @diveeoi/ui  ───►  @diveeoi/db (types only)
                    ───►  @diveeoi/sdk
                    ───►  @diveeoi/db

  Support packages:
    effect-drizzle-sqlite  ◄──  @diveeoi/db
    effect-sqlite-node     ◄──  @diveeoi/db
    http-recorder          ◄──  @diveeoi/db, @diveeoi/server (test only)
    script                 ◄──  @diveeoi/server (devDependency)
```

---

## 4. Root Configuration

### `package.json` (root)
- **`workspaces.packages`**: `["packages/*", "packages/sdk"]` — all 13 packages
- **`workspaces.catalog`**: Shared dependency version catalog
- **Scripts**:
  - `dev` — Start the server: `bun --cwd packages/server dev`
  - `dev:web` — Start the frontend dev server: `bun --cwd packages/app dev`
  - `build` — Run turbo build across all packages
  - `typecheck` — Run turbo typecheck
  - `lint` — Run oxlint
  - `clean` — Remove all `dist/` and `.turbo/` directories

### `turbo.json`
Defines `typecheck` and `build` tasks. Build outputs go to `dist/**`.

### `tsconfig.json`
Extends `@tsconfig/bun/tsconfig.json`. Root is minimal; each package has its own tsconfig.

---

## 5. Package: @diveeoi/server

**Location**: `packages/server/`
**Entry**: `src/main.ts`
**Role**: The main server package containing ALL business logic: AI chat sessions, MCP, tools, agents, auth, config, projects, permissions, plugins, file ops, git, and the HTTP server bootstrap.

### 5.1 Source Map (`src/`)

| Directory | Description |
|---|---|
| `account/` | Account/user management, server URL normalization, OAuth device code flow, account repo |
| `acp/` | Agent Client Protocol implementation — agent/service/session/tool/permission/event/content/usage/error/directory types |
| `agent/` | AI agent definitions, prompts (compaction/explore/summary/title), subagent permissions |
| `auth/` | Authentication — single `index.ts` |
| `background/` | Background job processing — single `job.ts` |
| `bus/` | Event bus system — single `global.ts` |
| `command/` | Command system for AI actions — `index.ts` + `template/` |
| `config/` | Comprehensive configuration system — agent config, command config, managed config, markdown, parse, paths, plugin config, TUI config, TUI CWD, TUI host attention, variables |
| `control-plane/` | Workspace/control plane — workspace model, workspace context, workspace adapter runtime, adapters (worktree, index), dev helpers |
| `effect/` | Effect-TS utilities — `run-service.ts` (makeRuntime), `instance-state.ts` (InstanceState with ScopedCache), instance-ref, instance-registry, config-service, app-runtime, bootstrap-runtime, bridge, promise, runner, runtime-flags |
| `env/` | Environment detection — single `index.ts` |
| `format/` | Code formatting — formatter + index |
| `git/` | Git operations — single `index.ts` |
| `id/` | ID generation (ulid-based) — single `id.ts` |
| `ide/` | IDE integration detection — single `index.ts` |
| `image/` | Image handling — single `image.ts` |
| `installation/` | Installation management — single `index.ts` |
| `lsp/` | Language Server Protocol — client, diagnostic, language, launch, server, lsp |
| `mcp/` | Model Context Protocol — auth, catalog, index, oauth-callback, oauth-provider |
| `patch/` | Code patch application — single `index.ts` |
| `permission/` | Permission system — arity, evaluate, index |
| `plugin/` | Plugin integration — install, loader, meta, shared, pty-environment, MCP connectors, TUI plugins, provider plugins (azure, cloudflare, digitalocean, snowflake-cortex, xai, openai, github-copilot) |
| `project/` | Project management — bootstrap, bootstrap-service, instance-context, instance-layer, instance-runtime, instance-store, project, VCS |
| `provider/` | AI provider management — auth, error, model-status, provider, transform |
| `question/` | User question handling — index + schema |
| `server/` | **HTTP SERVER BOOTSTRAP** — the core server module |
| `session/` | AI chat sessions — core business logic for running sessions, LLM integration, streaming, events, prompts, compaction, status, todo, tools, summary, retry, revert, reminders |
| `share/` | Session sharing — `session.ts` + `share-next.ts` |
| `skill/` | Skills system — discovery + index |
| `snapshot/` | Session snapshots — single `index.ts` |
| `storage/` | Database storage layer — schema + storage (conditional imports: `db.bun.ts` / `db.node.ts`) |
| `sync/` | Sync functionality — schema + README |
| `tool/` | 40+ tool definitions — apply_patch, edit, glob, grep, read, write, shell, websearch, webfetch, plan, task, skill, question, lsp, todo, truncate, registry, schema, JSON-schema, external-directory, invalid, mcp-websearch, and shell/ subdirectory |
| `util/` | General utilities — archive, bom, data-url, defer, effect-http-client, error, filesystem, html, iife, lazy, local-context, locale, media, process, proxy-env, queue, record, repository, rpc, signal, timeout, token, wildcard |
| `worktree/` | Git worktree management — single `index.ts` |

### 5.2 Entry Point: `src/main.ts`

```typescript
import { Server } from "./server/server"

const port = parseInt(process.env.PORT || "4096", 10)
const host = process.env.HOST || "0.0.0.0"

const server = await Server.listen({ port, hostname: host })
// Graceful shutdown on SIGINT/SIGTERM
```

### 5.3 Server Bootstrap: `src/server/server.ts`

The `Server` module is the heart of the HTTP server. Key functions:

- **`listen(opts)`** — Creates an `Effect` that:
  1. Resolves CORS config
  2. Starts MDNS publishing (bonjour-service)
  3. Creates `HttpRouter.serve()` from `HttpApiApp.webHandler()`
  4. Wraps in Node HTTP server via `NodeHttpServer`
  5. Tracks WebSocket connections via `WebSocketTracker`
  6. Returns a `Listener` with `stop()` for graceful shutdown

- **`Default`** — Lazy singleton `{ app }` where `app.fetch()` wraps the HttpApi web handler

- **`openapi()`** — Generates OpenAPI spec from the `PublicApi`

- **Server layers** (assembled in `HttpApiApp`):
  - `Database.defaultLayer`
  - `EventV2.defaultLayer`
  - `Account.Service.layer`
  - `Agent.Service.layer`
  - `Auth.Service.layer`
  - `BackgroundJob.Service.layer`
  - `Command.Service.layer`
  - `Config.Service.layer`
  - `Format.Service.layer`
  - `Git.Service.layer`
  - `Installation.Service.layer`
  - `LSP.Service.layer`
  - `MCP.Service.layer`
  - `Permission.Service.layer`
  - `Plugin.Service.layer`
  - `Project.Service.layer`
  - `Provider.Service.layer`
  - `Question.Service.layer`
  - `Session.*` layers (compaction, instruction, LLM, processor, prompt, revert, run-state, session, status, summary, todo)
  - `Skill.Service.layer`
  - `Snapshot.Service.layer`
  - `Storage.Service.layer`
  - `ToolRegistry.Service.layer`
  - `Worktree.Service.layer`
  - `ServerAuth.Config.layer`
  - `CorsConfig.layer`
  - `Observability.*` layers
  - Plus WebSocket, MDNS, and many more

> Total: ~50+ Effect Service layers composed into the final application layer.

### 5.4 Server Route Structure

```
server/src/server/
├── routes/instance/httpapi/
│   ├── api.ts              # InstanceHttpApi, RootHttpApi definitions
│   ├── server.ts           # HttpApiApp — layer assembly, webHandler
│   ├── public.ts           # PublicApi — health, static file serving
│   ├── groups/             # HttpApi groups
│   │   ├── account.ts
│   │   ├── agent.ts
│   │   ├── auth.ts
│   │   ├── config.ts
│   │   ├── event.ts
│   │   ├── provider.ts
│   │   ├── session.ts
│   │   ├── tool.ts
│   │   └── workspace.ts
│   ├── handlers/            # Handler implementations
│   │   ├── account.ts
│   │   ├── agent.ts
│   │   ├── auth.ts
│   │   ├── config.ts
│   │   ├── event.ts
│   │   ├── provider.ts
│   │   ├── session.ts
│   │   ├── tool.ts
│   │   └── workspace.ts
│   ├── middleware/          # Auth, CORS, lifecycle
│   │   ├── authorization.ts
│   │   └── ...
│   ├── lifecycle.ts         # Dispose middleware
│   ├── websocket-tracker.ts # WebSocket connection tracking
│   └── AGENTS.md            # Route patterns documentation
├── server.ts               # HttpRouter serve, MDNS, listener
├── auth.ts                 # Server-side auth config
├── event.ts                # Global event definitions
├── mdns.ts                 # Bonjour MDNS publishing
├── projectors.ts           # Init projectors (stub)
├── proxy-util.ts           # HTTP proxy utilities
├── shared/ui.ts            # UI static file serving
└── tui-event.ts            # TUI event definitions
```

### 5.5 Storage Layer: `src/storage/`

Uses **conditional imports** via the `#db` subpath import:

```json
"imports": {
  "#db": {
    "bun": "./src/storage/db.bun.ts",
    "node": "./src/storage/db.node.ts",
    "default": "./src/storage/db.bun.ts"
  }
}
```

- `storage.ts` — File-based JSON storage with caching, transactions, migration support
- `schema.ts` — Effect Schema definitions for storage objects

### 5.6 Config System: `src/config/`

A comprehensive Effect Config-based configuration system:
- `config.ts` — Main Config service with `makeRuntime`
- `agent.ts` — Agent configuration
- `command.ts` — Command configuration
- `managed.ts` — Managed config state
- `markdown.ts` — Markdown rendering config
- `parse.ts` — Config parsing
- `paths.ts` — Config file paths
- `plugin.ts` — Plugin configuration
- `variable.ts` — Variable expansion in config values
- `entry-name.ts` — Config entry naming
- TUI-specific config files

### 5.7 Session System: `src/session/`

The core AI chat session engine:
- `session.ts` — Main Session service
- `processor.ts` — Session event processor
- `llm.ts` + `llm/` — LLM orchestration (AI SDK path + native route path)
- `prompt.ts` + `prompt/` — Prompt management
- `message.ts`, `message-v2.ts`, `message-error.ts` — Message handling
- `status.ts` — Session status tracking
- `run-state.ts` — Session run state
- `retry.ts` — Retry logic
- `revert.ts` — Message/session revert
- `compaction.ts` — Context compaction
- `summary.ts` — Session summarization
- `todo.ts` — Todo management during sessions
- `tools.ts` — Tool execution during sessions
- `overflow.ts` — Context overflow handling
- `instruction.ts` — User/system instruction handling
- `reminders.ts` — Reminder system
- `schema.ts` — Session schemas
- `system.ts` — System context

### 5.8 Tool System: `src/tool/`

40+ tool definitions, each typically a `.ts` file with a corresponding `.txt` prompt file:

| Tool | File | Description |
|---|---|---|
| Read files | `read.ts` | Read file contents |
| Write files | `write.ts` | Write file contents |
| Edit files | `edit.ts` | Inline file editing |
| Glob search | `glob.ts` | File pattern matching |
| Grep search | `grep.ts` | Content search |
| Shell execution | `shell.ts` | Shell command execution |
| Web fetch | `webfetch.ts` | HTTP URL fetching |
| Web search | `websearch.ts` | Internet search |
| Apply patch | `apply_patch.ts` | Patch application |
| Task execution | `task.ts` | Background task management |
| Skill execution | `skill.ts` | Skill system tools |
| Question | `question.ts` | User questioning |
| LSP | `lsp.ts` | Language Server Protocol |
| Plan | `plan.ts` | Implementation planning |
| Todo | `todo.ts` | Task management |
| Truncate | `truncate.ts` | Context truncation |

Supporting modules:
- `registry.ts` — Tool registry service
- `schema.ts` — Tool schema definitions
- `json-schema.ts` — JSON Schema utilities
- `invalid.ts` — Invalid tool call handling
- `mcp-websearch.ts` — MCP-based web search adapter
- `external-directory.ts` — External directory access
- `shell/` — Shell sub-modules

---

## 6. Package: @diveeoi/db

**Location**: `packages/db/`
**Role**: Lower-level database, AI provider, and session engine. Provides the database layer, schemas, migrations, AI provider adapters, the session runner (core execution engine), tool definitions, file system abstraction, PTY support, and system context.

### 6.1 Source Map (`src/`)

| Directory | Description |
|---|---|
| `database/` | SQLite database setup (Bun vs Node conditional), Drizzle schema, migrations |
| `session/` | Session engine — runner, execution, events, messages, store, projector, coordinator, history, info, input, logging, compaction, todo, prompt, context-epoch, message-id, message-updater |
| `tool/` | Tool system — 18 files: application-tools, bash, edit, glob, grep, read, write, websearch, webfetch, skill, todowrite, apply-patch, question, builtins, registry, tools, tool |
| `system-context/` | System context provider — builtins, registry, index |
| `config/` | Config schemas — agent, provider, command, compaction, watcher, formatter, LSP, markdown, MCP, plugin, reference, tool-output, attachments, experimental |
| `project/` | Project management — schema, SQL, directories, copy, copy-strategies |
| `event/` | Event system — event definitions, SQL |
| `filesystem/` | File system abstraction — fff.bun/fff.node (conditional imports), ignore, protected, schema, search, watcher |
| `pty/` | PTY (pseudo-terminal) — pty.bun/pty.node (conditional imports), ticket |
| `plugin/` | Plugin system — boot, agent, command, provider, skill, models-dev, layer-map |
| `effect/` | Effect utilities — layer-node, layer-node-platform, runtime, service-use, keyed-mutex, memo-map |
| `observability/` | Observability — logging, OTLP, shared |
| `flag/` | Feature flags — `flag.ts` |
| `control-plane/` | Move session logic |
| `public/` | Public API surface — agent, location, model, opencode, session, tool |
| `credential/` | Credential management |
| `integration/` | Integration management |
| `account/` | Account types |
| `agent.ts` | Agent types |
| `aisdk.ts` | AI SDK adapter |
| `catalog.ts` | Provider/model catalog |
| `config.ts` | Configuration types |
| `git.ts` | Git types |
| `model.ts` | Model types |
| `provider.ts` | Provider types |
| `schema.ts` | Shared schemas |
| `workspace.ts` | Workspace types |

### 6.2 Database Layer: `src/database/`

```
database/
├── database.ts       # Main Database service — PRAGMA setup, migration apply, path resolution
├── sqlite.bun.ts     # Bun SQLite client (conditional import via #sqlite)
├── sqlite.node.ts    # Node SQLite client (conditional import via #sqlite)
├── sqlite.ts         # Shared SQLite types
├── schema.sql.ts     # Timestamps utility (time_created, time_updated)
├── schema.gen.ts     # Generated schema from Drizzle Kit
├── migration.ts      # Migration service
├── migration/        # Individual migration files (35 migrations)
│   ├── 20260127222353_familiar_lady_ursula.ts
│   ├── 20260211171708_add_project_commands.ts
│   ├── 20260225215848_workspace.ts
│   ├── 20260312043431_session_message_cursor.ts
│   ├── 20260611035744_credential.ts
│   └── ...
└── path.ts           # Database path resolution
```

### 6.3 Session Engine: `src/session/`

```
session/
├── runner/           # Session runner module
│   ├── index.ts      # SessionRunner interface — `run({ sessionID, force })`
│   ├── llm.ts        # LLM integration in runner
│   ├── model.ts      # Model selection
│   ├── to-llm-message.ts  # Message format conversion
│   └── publish-llm-event.ts  # LLM event publishing
├── execution/        # Session execution
│   └── local.ts      # Local execution coordinator (Layer + SessionRunCoordinator)
├── store.ts          # Session store (database CRUD)
├── projector.ts      # Session event projector
├── run-coordinator.ts # Run coordination logic
├── compaction.ts     # Context compaction
├── todo.ts           # Session-level todo management
├── event.ts          # Session events
├── schema.ts         # Session schemas
├── input.ts          # Session input handling
├── info.ts           # Session info
├── history.ts        # Session history
├── message.ts        # Session messages
├── message-id.ts     # Message ID generation
├── message-updater.ts # Message updates
├── prompt.ts         # Prompt management
├── context-epoch.ts  # Context epoch tracking
├── error.ts          # Session errors
├── logging.ts        # Session logging
└── sql.ts            # Session SQL queries
```

### 6.4 Tool Definitions: `src/tool/`

| File | Description |
|---|---|
| `tool.ts` | Base Tool type definitions |
| `tools.ts` | Tool collection utilities |
| `registry.ts` | Tool registry |
| `builtins.ts` | Built-in tool definitions |
| `application-tools.ts` | Application-level tool registration |
| `bash.ts` | Bash/shell execution tool |
| `edit.ts` | File edit tool |
| `glob.ts` | Glob pattern tool |
| `grep.ts` | Content search tool |
| `read.ts` | File read tool |
| `read-filesystem.ts` | Read filesystem info tool |
| `write.ts` | File write tool |
| `webfetch.ts` | Web fetch tool |
| `websearch.ts` | Web search tool |
| `skill.ts` | Skill execution tool |
| `todowrite.ts` | Todo write tool |
| `apply-patch.ts` | Patch application tool |
| `question.ts` | User question tool |

### 6.5 Public API: `src/public/`

The intentional supported public API surface:

```typescript
// packages/db/src/public/index.ts
export { Agent } from "./agent"
export { Model } from "./model"
export { OpenCode } from "./opencode"
export { Session } from "./session"
export { Tool } from "./tool"
export { Location } from "./location"
export { Prompt } from "../session/prompt"
export { AbsolutePath } from "../schema"
```

### 6.6 Conditional Imports

Uses `#sqlite`, `#pty`, `#fff` subpath imports with platform-specific resolution:

```json
"imports": {
  "#sqlite": { "bun": "./src/database/sqlite.bun.ts", "node": "./src/database/sqlite.node.ts" },
  "#pty":   { "bun": "./src/pty/pty.bun.ts",         "node": "./src/pty/pty.node.ts" },
  "#fff":   { "bun": "./src/filesystem/fff.bun.ts",   "node": "./src/filesystem/fff.node.ts" }
}
```

---

## 7. Package: @diveeoi/api

**Location**: `packages/api/`
**Role**: Effect HttpApi definitions — the HTTP API layer. Defines ~18 HttpApi groups with their endpoints, handlers, middleware, and error types.

### 7.1 Source Map

| File | Description |
|---|---|
| `api.ts` | Main `Api` definition — `HttpApi.make("server")` with 18 groups |
| `routes.ts` | Route assembly — `createRoutes()` returns composed Layer with all handlers |
| `auth.ts` | Server auth configuration for the API |
| `cors.ts` | CORS middleware configuration |
| `errors.ts` | API error types |
| `pty-environment.ts` | PTY environment service |
| `groups/` | HttpApi group definitions (18 files) |
| `handlers/` | Handler implementations (18 files) |
| `middleware/` | Middleware (authorization, schema-error) |

### 7.2 API Groups (`groups/`)

| Group | Endpoints |
|---|---|
| `agent.ts` | Agent CRUD |
| `command.ts` | Command execution |
| `credential.ts` | Credential management |
| `event.ts` | Event streaming |
| `fs.ts` | File system operations |
| `health.ts` | Health check |
| `integration.ts` | Integration management |
| `location.ts` | Location management |
| `message.ts` | Chat messages |
| `model.ts` | AI model listing |
| `permission.ts` | Permission queries |
| `project-copy.ts` | Project copy operations |
| `provider.ts` | AI provider configuration |
| `pty.ts` | PTY terminal endpoints |
| `question.ts` | User question management |
| `reference.ts` | Reference management |
| `session.ts` | Session CRUD, prompting, streaming |
| `skill.ts` | Skill management |

### 7.3 Handler Pattern

Handlers follow a consistent pattern using `HttpApiBuilder.group`:

```typescript
export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    return handlers.handle("list", () => session.list())
  }),
)
```

---

## 8. Package: @diveeoi/app

**Location**: `packages/app/`
**Role**: SolidJS web frontend SPA. Built with Vite + SolidJS + Tailwind CSS + Kobalte + OpenTUI.

### 8.1 Source Map (`src/`)

| Directory | Description |
|---|---|
| `app.tsx` | **Root app component** — routing, providers, layout |
| `entry.tsx` | **Browser entry point** — connects to server, sets up auth, renders |
| `index.tsx` | Entry module |
| `index.css` | Global styles (Tailwind import) |
| `components/` | 57+ UI components |
| `context/` | 40+ SolidJS context providers |
| `pages/` | Page components and layouts |
| `i18n/` | Internationalization (17+ locales) |
| `utils/` | 42+ utility modules |
| `hooks/` | Custom hooks (useProviders) |
| `addons/` | Serialization utilities |
| `constants/` | Constants (file-picker) |
| `wsl/` | WSL integration |

### 8.2 Entry Point: `src/entry.tsx`

The browser entry point:
1. Reads locale from `navigator.languages`
2. Reads default server URL from `localStorage` key `diveeoi.settings.dat:defaultServerUrl`
3. Sets up `Sentry` for error tracking
4. Configures platform-specific APIs (notifications, clipboard, open URL)
5. Parses auth token from URL hash (`authFromToken`)
6. Renders the `AppBaseProviders` + `AppInterface` tree

### 8.3 App Component: `src/app.tsx`

The root component assembles the entire provider tree (~40 providers):

```
ThemeProvider
├── MetaProvider
│   ├── QueryClientProvider
│   │   ├── I18nProvider
│   │   │   ├── LanguageProvider
│   │   │   │   ├── LayoutProvider
│   │   │   │   │   ├── ServerProvider
│   │   │   │   │   │   ├── ServerSDKProvider
│   │   │   │   │   │   │   ├── SDKProvider
│   │   │   │   │   │   │   │   ├── SettingsProvider
│   │   │   │   │   │   │   │   │   ├── ModelsProvider
│   │   │   │   │   │   │   │   │   │   ├── PermissionProvider
│   │   │   │   │   │   │   │   │   │   │   ├── GlobalProvider
│   │   │   │   │   │   │   │   │   │   │   │   ├── TabsProvider
│   │   │   │   │   │   │   │   │   │   │   │   │   ├── FileProvider
│   │   │   │   │   │   │   │   │   │   │   │   │   │   ├── TerminalProvider
│   │   │   │   │   │   │   │   │   │   │   │   │   │   │   ├── Router {...}
│   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   └── routes...
```

### 8.4 Routes

Defined in `app.tsx` via `@solidjs/router`:

| Route | Component | Description |
|---|---|---|
| `/` | `Layout` → `HomeRoute` | Home page |
| `/new` | `Layout` → `NewSession` | New session creation |
| `/session/:id` | `Layout` → `Session` | Session view (chat) |
| `/session/:id/message/:messageId` | `Layout` → `Session` | Session at specific message |
| `/settings` | `Layout` → Settings | Settings pages |
| `/library` | `Layout` → Library | Library/project browsing |

### 8.5 Pages (`src/pages/`)

| File | Description |
|---|---|
| `home.tsx` | Home/landing page |
| `session.tsx` | Session page wrapper |
| `new-session.tsx` | New session creation page |
| `layout.tsx` + `layout/` | Main app layout (sidebar, content area) |
| `error.tsx` | Error page |
| `error-description.ts` | Error description utilities |
| `directory-layout.tsx` | Directory/project layout |

**`src/pages/session/`** — 24 files for session sub-components:
- `composer/` — Message composer
- `timeline/` — Session timeline
- `session-layout.ts` — Session layout orchestration
- `session-side-panel.tsx` — Side panel
- `terminal-panel.tsx` — Terminal integration
- `file-tabs.tsx` — File tabs
- `review-tab.tsx` — Review tab
- `handoff.ts` — Session handoff
- `helpers.ts` — Session helpers
- `message-gesture.ts` — Message gesture handling

### 8.6 Context Providers (`src/context/`)

40+ providers managing global state:

| Provider | Description |
|---|---|
| `server.tsx` | Server connection |
| `server-sdk.tsx` | Server SDK instance |
| `server-sync.tsx` | Server synchronization |
| `sdk.tsx` | SDK service |
| `platform.tsx` | Platform APIs (notifications, etc.) |
| `settings.tsx` | User settings |
| `models.tsx` | AI model state |
| `permission.tsx` | Permission state |
| `global.tsx` | Global application state |
| `tabs.tsx` | Tab management |
| `file.tsx` + `file/` | File system state |
| `terminal.tsx` | Terminal state |
| `layout.tsx` | Layout state |
| `language.tsx` | Locale/language |
| `notification.tsx` | Notifications |
| `command.tsx` | Command execution |
| `comments.tsx` | Code comments |
| `highlights.tsx` | Code highlights |
| `prompt.tsx` | Prompt state |
| `local.tsx` | Local state |
| `mcp.ts` | MCP connection state |
| `model-variant.ts` | Model variant state |
| `sync.tsx` + `sync-optimistic` | Optimistic sync |
| `global-sync/` | Global sync |

### 8.7 i18n (`src/i18n/`)

17 locales with full translations:
`en`, `zh`, `zht`, `ja`, `ko`, `fr`, `de`, `es`, `pt-BR`, `ru`, `ar`, `tr`, `th`, `pl`, `no`, `da`, `uk`

---

## 9. Package: @diveeoi/ui

**Location**: `packages/ui/`
**Role**: Shared UI component library used by the app. Contains 197+ components, theme system, icons, styles, the pierre file viewer, and v2 component system.

### 9.1 Source Map (`src/`)

| Directory | Description |
|---|---|
| `components/` | 197+ UI components (see below) |
| `v2/` | V2 component redesign (81 components) |
| `theme/` | Theme system — color, context, default themes, resolver, themes/ dir, types |
| `styles/` | CSS — base, colors, theme, utilities, animations, tailwind/ |
| `context/` | SolidJS contexts (marked, dialog, file) |
| `hooks/` | Shared hooks |
| `i18n/` | UI translations |
| `pierre/` | File viewer system — comment-hover, commented-lines, diff-selection, file-find, file-runtime, file-selection, media, selection-bridge, virtualizer, worker |
| `assets/` | Fonts, audio files |
| `storybook/` | Storybook stories |

### 9.2 Key UI Components (selected from 197)

| Component | Description |
|---|---|
| `accordion.tsx` | Collapsible sections |
| `avatar.tsx` | User/provider avatars |
| `button.tsx` | Action buttons |
| `card.tsx` | Content cards |
| `checkbox.tsx` | Checkbox input |
| `context-menu.tsx` | Right-click menus |
| `dialog.tsx` | Modal dialogs |
| `dropdown-menu.tsx` | Dropdown selectors |
| `file.tsx` | File system browser |
| `file-icon.tsx` | File type icons |
| `icon.tsx` | Icon system |
| `icon-button.tsx` | Icon action buttons |
| `inline-input.tsx` | Inline text editing |
| `keybind.tsx` | Keyboard shortcut display |
| `list.tsx` | Virtualized lists |
| `logo.tsx` | Application logo |
| `markdown.tsx` | Markdown renderer (with Shiki syntax highlighting, workers) |
| `message-part.tsx` | Message content rendering |
| `message-nav.tsx` | Message navigation |
| `popover.tsx` | Popover overlays |
| `progress.tsx` | Progress indicators |
| `scroll-view.tsx` | Scrollable containers |
| `select.tsx` | Select/dropdown |
| `session-review.tsx` | Session review UI |
| `session-turn.tsx` | Session turn display |
| `shell-submessage.tsx` | Shell sub-message display |
| `spinner.tsx` | Loading spinners |
| `switch.tsx` | Toggle switches |
| `tabs.tsx` | Tab navigation |
| `tag.tsx` | Tags/badges |
| `text-field.tsx` | Text inputs |
| `text-reveal.tsx` | Animated text reveal |
| `thinking-heading.tsx` | "Thinking..." animation |
| `toast.tsx` | Toast notifications |
| `tooltip.tsx` | Tooltips |
| `typewriter.tsx` | Typewriter animation |
| `tool-error-card.tsx` | Tool error display |
| `tool-count-label.tsx` | Tool count badges |
| `diff-changes.tsx` | Diff visualization |
| `line-comment.tsx` | Line comments |
| `image-preview.tsx` | Image lightbox |
| `motion-spring.tsx` | Spring animations |

### 9.3 V2 Components (`src/v2/components/`)

A parallel component system with 81 redesigned components:
`accordion-v2`, `avatar-v2`, `badge-v2`, `basic-tool-v2`, `button-v2`, `checkbox-v2`, `dialog-v2`, `diff-changes-v2`, `field-v2`, `icon-button-v2`, `inline-input-v2`, `keybind-v2`, `line-comment-v2`, `menu-v2`, `project-avatar-v2`, `radio-v2`, `segmented-control-v2`, `select-v2`, `switch-v2`, `tabs-v2`, `text-input-v2`, `text-shimmer-v2`, `textarea-v2`, `toast-v2`, `tool-error-card-v2`, `tooltip-v2`, `wordmark-v2`

### 9.4 Theme System (`src/theme/`)

- `color.ts` — Color manipulation utilities
- `context.tsx` — `ThemeProvider` context
- `default-themes.ts` — Built-in light/dark themes
- `resolve.ts` — Theme resolution
- `types.ts` — Theme type definitions
- `loader.ts` — Theme loading
- `themes/` — Additional theme definitions
- `v2/` — V2 theme overrides

### 9.5 Pierre File Viewer (`src/pierre/`)

A code file viewing system with:
- `file-find.ts` — File search
- `file-runtime.ts` — File content runtime
- `file-selection.ts` — File selection state
- `diff-selection.ts` — Diff selection
- `comment-hover.ts` — Comment hover
- `commented-lines.ts` — Commented line tracking
- `selection-bridge.ts` — Selection bridging
- `media.ts` — Media file handling
- `virtualizer.ts` — Virtual scrolling
- `worker.ts` — Web worker

---

## 10. Package: @diveeoi/llm

**Location**: `packages/llm/`
**Role**: Effect Schema-first LLM client library. Provides typed protocols for OpenAI Chat/Responses, Anthropic Messages, Gemini, Bedrock Converse, and provider facades.

### 10.1 Architecture

```
                       ┌──────────────┐
                       │  LLMClient   │
                       │ (route/      │
                       │  client.ts)  │
                       └──────┬───────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
       ┌────────────┐ ┌──────────────┐ ┌──────────────┐
       │  Protocol  │ │  Endpoint    │ │    Auth      │
       │ (request   │ │ (URL constr) │ │ (Bearer,     │
       │  body,     │ │              │ │  Header,     │
       │  stream)   │ │              │ │  SigV4)      │
       └────────────┘ └──────────────┘ └──────┬───────┘
                                              │
                                     ┌────────▼───────┐
                                     │   Transport     │
                                     │ (HTTP/WebSocket)│
                                     └────────────────┘
```

### 10.2 Source Map

| Directory | Description |
|---|---|
| `schema/` | Canonical Schema model — `ids.ts` (branded IDs), `options.ts` (generation/limits/model), `messages.ts` (content parts, messages, LLMRequest), `events.ts` (LLMEvent, usage), `errors.ts` (LLMError) |
| `route/` | Route system — `client.ts` (LLMClient), `executor.ts` (RequestExecutor), `protocol.ts`, `endpoint.ts`, `auth.ts`, `auth-options.ts`, `framing.ts`, `transport/` (HTTP, WebSocket) |
| `protocols/` | Provider protocol implementations — `openai-chat.ts`, `openai-responses.ts`, `anthropic-messages.ts`, `gemini.ts`, `bedrock-converse.ts`, `openai-compatible-chat.ts`, `bedrock-event-stream.ts`, `shared.ts`, `utils/` |
| `providers/` | Provider facades — `openai.ts`, `anthropic.ts`, `google.ts`, `azure.ts`, `amazon-bedrock.ts`, `cloudflare.ts`, `github-copilot.ts`, `openai-compatible.ts`, `openai-compatible-profile.ts`, `openrouter.ts`, `xai.ts` |
| Root files | `index.ts`, `llm.ts`, `provider.ts`, `tool.ts`, `tool-runtime.ts`, `cache-policy.ts`, `provider-error.ts`, `utils/` |

### 10.3 Protocols

| Protocol | Transport | Providers |
|---|---|---|
| `OpenAIChat` | HTTPS + SSE | OpenAI, DeepSeek, TogetherAI, Cerebras, etc. |
| `OpenAIResponses` | HTTPS + SSE | OpenAI only (Responses API) |
| `AnthropicMessages` | HTTPS + SSE | Anthropic |
| `Gemini` | HTTPS + SSE | Google |
| `BedrockConverse` | HTTPS + AWS Event Stream | AWS Bedrock |
| `OpenAICompatibleChat` | HTTPS + SSE | Generic compatible (reuses OpenAIChat protocol) |

### 10.4 Provider Facades

| Provider | Key File | Auth Method |
|---|---|---|
| OpenAI | `providers/openai.ts` | Bearer token (apiKey) |
| Anthropic | `providers/anthropic.ts` | Bearer token (x-api-key header) |
| Google | `providers/google.ts` | Bearer token (apiKey) |
| Azure | `providers/azure.ts` | Resource name + apiKey |
| AWS Bedrock | `providers/amazon-bedrock.ts` | AWS SigV4 |
| Cloudflare | `providers/cloudflare.ts` | Gateway API key |
| GitHub Copilot | `providers/github-copilot.ts` | Token exchange |
| OpenRouter | `providers/openrouter.ts` | Bearer token |
| XAI (Grok) | `providers/xai.ts` | Bearer token |

### 10.5 LLMClient API

```typescript
// Build a request
const request = LLM.request({
  model: OpenAI.configure({ apiKey }).responses("gpt-4o-mini"),
  system: "You are concise.",
  prompt: "Say hello.",
})

// Stream events
const events = yield* LLMClient.stream(request).pipe(Stream.runCollect)

// Generate (collect into response)
const response = yield* LLMClient.generate(request)

// Prepare without sending
const prepared = yield* LLMClient.prepare(request)
```

---

## 11. Package: @diveeoi/sdk

**Location**: `packages/sdk/`
**Role**: API client SDK — TypeScript client for the DiveeOI HTTP API.

### 11.1 Source Map

| File | Description |
|---|---|
| `index.ts` | Public exports |
| `client.ts` | V1 HTTP client (basic fetch wrapper) |
| `server.ts` | V1 server utilities |
| `process.ts` | Process spawn utilities |
| `error-interceptor.ts` | Error interception |
| `gen/` | Generated code |
| `v2/` | V2 client/server — generated from OpenAPI spec via `@hey-api/openapi-ts` |
| `v2/client.ts` | V2 API client |
| `v2/server.ts` | V2 server utilities |
| `v2/gen/client/` | Generated client code |

### 11.2 V2 Client

Generated from the OpenAPI specification. Provides typed methods for all API endpoints:
- Account management
- Agent configuration
- Authentication
- Chat sessions (CRUD, prompt, stream)
- Configuration
- Filesystem operations
- Git operations
- MCP management
- Model/provider queries
- Permissions
- Plugins
- Skills
- Snapshots
- Tools
- Workspace management

---

## 12. Package: @diveeoi/plugin

**Location**: `packages/plugin/`
**Role**: Plugin SDK for building DiveeOI plugins.

### 12.1 Source Map

| File | Description |
|---|---|
| `index.ts` | Main plugin module |
| `tool.ts` | Tool definition helpers |
| `tui.ts` | TUI plugin helpers (requires OpenTUI peer deps) |
| `shell.ts` | Shell execution for plugins |
| `example.ts` | Example plugin |
| `example-workspace.ts` | Example workspace plugin |

### 12.2 Exports

```typescript
// @diveeoi/plugin           — main SDK
// @diveeoi/plugin/tool      — tool creation helpers
// @diveeoi/plugin/tui       — TUI (terminal UI) helpers (optional deps)
```

---

## 13. Support Packages

### 13.1 `@diveeoi/effect-drizzle-sqlite`

**Location**: `packages/effect-drizzle-sqlite/`

Custom Drizzle ORM + Effect SQLite adapter. Bridges Drizzle queries with Effect's SQL infrastructure.

Key exports:
- `src/effect-sqlite/driver.ts` — `make()` and `makeWithDefaults()` for creating Effect-backed Drizzle DB
- `src/effect-sqlite/session.ts` — Adapter from Effect `SqlClient` to Drizzle SQLite sessions
- `src/sqlite-core/effect/*` — Effect-yieldable SQLite query builders
- `src/internal/drizzle-utils.ts` — Typed shims for Drizzle runtime internals

### 13.2 `@diveeoi/effect-sqlite-node`

**Location**: `packages/effect-sqlite-node/`

Node.js bridge for Effect SQLite. Single export file providing Node-compatible SQLite client for Effect.

### 13.3 `@diveeoi/http-recorder`

**Location**: `packages/http-recorder/`

Record and replay HTTP traffic for testing. Provides:
- Cassette-based request/response recording
- Deterministic replay mode
- Binary body support (base64 encoding)
- Filtered matching (multi-interaction flows)
- Pretty-printed JSON cassettes

### 13.4 `@diveeoi/script`

**Location**: `packages/script/`

Build and utility scripts. Used by `packages/server` as a dev dependency.

### 13.5 `@diveeoi/identity`

**Location**: `packages/identity/`

Brand assets — SVG/PNG logos and icons (96x96, 192x192, 512x512, mark light/dark variants).

---

## 14. Key Architecture Patterns

### 14.1 Effect-TS Everywhere

All server code uses Effect-TS for:
- **Dependency Injection**: `Context.Service`, `Layer`, `Effect.provide()`
- **Error Handling**: Typed `Schema.TaggedErrorClass` errors
- **Async Composition**: `Effect.gen(function* () { ... })`
- **HTTP Routing**: `HttpRouter`, `HttpApi`, `HttpServer`
- **Streaming**: `Stream.Stream` for events, LLM responses
- **State Management**: `Scope`, `ScopedCache`, `Ref`, `RcMap`

### 14.2 `@/` Path Alias

In `packages/server`, `@/` maps to `./src/` in tsconfig:

```json
{ "paths": { "@/*": ["./src/*"] } }
```

### 14.3 Conditional Imports

`packages/db` uses subpath imports for platform-specific implementations:
- `#sqlite` → `sqlite.bun.ts` / `sqlite.node.ts`
- `#pty` → `pty.bun.ts` / `pty.node.ts`
- `#fff` → `fff.bun.ts` / `fff.node.ts`

`packages/server` uses `#db` similarly:
- `#db` → `db.bun.ts` / `db.node.ts`

### 14.4 SMO Pattern (Scoped Modular Orchestration)

The codebase follows SMO-like patterns:
- `InstanceState` + `ScopedCache` for per-directory state
- `makeRuntime` for deduplicated Effect runtimes
- Services scoped to project/workspace instances
- Cleanup via `Effect.addFinalizer`, `Effect.acquireRelease`

### 14.5 Self-Re-Export Pattern

Modules use the self-reexport pattern:

```typescript
// src/foo/foo.ts
export interface Interface { ... }
export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}
export * as Foo from "./foo"

// Consumer
import { Foo } from "@/foo/foo"
yield* Foo.Service
```

### 14.6 Layer Assembly

Services are assembled via `Layer.provide()` chains. The server's layer graph in `server.ts` is ~50+ layers deep, structured as a dependency tree:

```
WebHandler Layer
  ├── HttpApiBuilder.layer(Api)
  │   └── handlers (all @diveeoi/api handlers)
  ├── ServerAuth.Config.layer (auth config)
  ├── CorsConfig.layer
  ├── Observability layers
  ├── Database.defaultLayer
  ├── EventV2.defaultLayer
  ├── Session layers (SessionV2, SessionProjector, SessionExecution...)
  ├── Domain services layer (50+ services)
  └── WebSocketTracker.layer
```

---

## 15. Server Startup Flow

### 15.1 Full Startup Sequence

```
1. bun run --conditions=browser ./src/main.ts
2. main.ts:
   a. Reads PORT (default 4096) and HOST (default 0.0.0.0) from env
   b. Calls Server.listen({ port, hostname })
3. server.ts:
   a. Calls init-projectors (stub)
   b. Sets globalThis.AI_SDK_LOG_WARNINGS = false
   c. Resolves CORS config
   d. Creates HttpApiApp.webHandler()
      - Assembles the full Layer tree (~50 layers)
      - Creates HttpRouter.toWebHandler()
   e. Starts MDNS publishing (bonjour-service)
   f. Creates Node HTTP server wrapping the HttpRouter
   g. Starts WebSocket connection tracker
   h. Returns Listener { hostname, port, url, stop }
4. Server is now listening on http://0.0.0.0:4096
5. main.ts registers SIGINT/SIGTERM for graceful shutdown
```

### 15.2 Request Flow

```
HTTP Request → Node HTTP Server
  → HttpRouter.toWebHandler(disableLogger: true)
    → CORS middleware
      → Auth middleware (password/token check)
        → HttpApiBuilder routing (match endpoint)
          → Handler (yields Effect)
            → Domain service (business logic)
              → Database (SQLite via Drizzle + Effect)
                → Response
```

### 15.3 SPA Serving

The server also serves the SolidJS SPA static files. The `public.ts` route handles static file serving for the built frontend, with a catch-all fallback to `index.html` for SPA routing.

---

## 16. Database Schema & Migrations

### 16.1 Database Stack

```
Drizzle ORM schema → Drizzle Kit (migration generation)
  → SQLite database (Bun: bun:sqlite / Node: better-sqlite3)
    → Effect SQLite bridge (@diveeoi/effect-drizzle-sqlite)
      → Effect Drizzle driver
        → Effect services
```

### 16.2 Key Tables (from generated schema)

The Drizzle schema (generated via Drizzle Kit) defines tables for:
- **Sessions** — AI chat sessions with metadata (model, provider, workspace, status)
- **Messages** — Chat messages with content, role, tool calls
- **Events** — Event-sourced session events
- **Session Input** — Input inbox for session prompting
- **Session Context Snapshot** — Context compression snapshots
- **Providers** — AI provider configurations
- **Models** — AI model configurations
- **Projects** — Project management (directories, commands)
- **Workspaces** — Workspace management
- **Accounts** — User accounts
- **Credentials** — Stored credentials
- **Integrations** — External integrations
- **Permissions** — Permission rules
- **Plugins** — Plugin metadata
- **Skills** — Skill definitions
- **Snapshots** — Session snapshots
- **Sync** — Sync ownership/metadata
- **State** — Global state storage

### 16.3 Migrations

Located in `packages/db/src/database/migration/`. Currently 35 migration files:

| Migration | Description |
|---|---|
| `familiar_lady_ursula` | Initial schema |
| `add_project_commands` | Project commands |
| `wakeful_the_professor` | Session extensions |
| `workspace` | Workspace support |
| `add_session_workspace_id` | Workspace sessions |
| `session_message_cursor` | Message cursor pagination |
| `events` | Event system |
| `credential` | Credential storage |
| `session_usage` | Session usage tracking |
| `session_input_inbox` | Input inbox |
| `event_sourced_session_input` | Event-sourced input |
| `session_context_snapshot` | Context snapshots |
| `context_epoch_agent` | Context epochs |
| `project_dir_strategy` | Directory strategies |
| ... and 20+ more |

### 16.4 Migration Application

In `packages/db/src/database/database.ts`:

```typescript
export const layer = Layer.effect(Service, Effect.gen(function* () {
  const db = yield* makeDatabase
  yield* db.run("PRAGMA journal_mode = WAL")
  yield* db.run("PRAGMA synchronous = NORMAL")
  yield* db.run("PRAGMA busy_timeout = 5000")
  yield* db.run("PRAGMA cache_size = -64000")
  yield* db.run("PRAGMA foreign_keys = ON")
  yield* DatabaseMigration.apply(db)
  return { db }
}).pipe(Effect.orDie))
```

---

## 17. Development Commands

### Root Level

| Command | Description |
|---|---|
| `bun dev` | Start the server (`packages/server`) |
| `bun dev:web` | Start the web dev server (`packages/app`) |
| `bun build` | Run turbo build across all packages |
| `bun typecheck` | Run turbo typecheck |
| `bun lint` | Run oxlint |
| `bun clean` | Clean build artifacts |

### `packages/server`

| Command | Description |
|---|---|
| `bun dev` | Run `./src/main.ts` with `--conditions=browser` |
| `bun build` | Build script |
| `bun test` | Run tests (only failures mode) |
| `bun test:httpapi` | HTTP API exercise tests |
| `bun typecheck` | TypeScript type checking |

### `packages/app`

| Command | Description |
|---|---|
| `bun dev` or `bun start` | Vite development server (port 3000) |
| `bun build` | Production build to `dist/` |
| `bun serve` | Vite preview |
| `bun test` | Unit + virtualizer tests |
| `bun test:e2e` | Playwright E2E tests |

### `packages/db`

| Command | Description |
|---|---|
| `bun db` | Run Drizzle Kit |
| `bun migration` | Run migration generation script |
| `bun test` | Run tests |

### `packages/ui`

| Command | Description |
|---|---|
| `bun dev` | Vite dev server |
| `bun test` | Run tests |
| `bun generate:tailwind` | Generate Tailwind output |
| `bun generate:v2-oc2` | Generate v2 overrides |

### `packages/llm`

| Command | Description |
|---|---|
| `bun test` | Run tests (timeout 30s, only failures) |
| `bun typecheck` | TypeScript check |
| `bun setup:recording-env` | Setup recording test environment |

---

## 18. Build Output

### `packages/server`

- Runs via: `bun run --conditions=browser ./src/main.ts`
- No explicit build step required (Bun runs TypeScript directly)
- Optional: `bun build` for packaging

### `packages/app`

- Build: `vite build` → output to `dist/`
- Config: `vite.config.ts` (Tailwind + SolidJS plugins)
- Target: `esnext`
- Sourcemaps enabled
- Dev server on port 3000 (all hosts)

### `packages/sdk`

- Build: `bun ./script/build.ts` → output to `dist/`
- Uses `@hey-api/openapi-ts` for client generation

### `packages/plugin`

- Build: `tsc` → output to `dist/`

### `packages/http-recorder`

- Build: `bun ./script/build.ts` → output to `dist/`

### Output Artifacts

All build outputs go to `dist/` directories within each package (gitignored). Cache artifacts go to `.turbo/`.

---

## Appendix: Export Maps by Package

### `@diveeoi/server`
```json
{ "./*": "./src/*.ts" }
```

### `@diveeoi/db`
```json
{
  "./public":       "./src/public/index.ts",
  "./session/runner": "./src/session/runner/index.ts",
  "./system-context": "./src/system-context/index.ts",
  "./*":            "./src/*.ts"
}
```

### `@diveeoi/api`
```json
{ "./*": "./src/*.ts" }
```

### `@diveeoi/app`
```json
{
  ".":              "./src/index.ts",
  "./desktop-menu": "./src/desktop-menu.ts",
  "./updater":      "./src/updater.ts",
  "./wsl/types":    "./src/wsl/types.ts",
  "./vite":         "./vite.js",
  "./index.css":    "./src/index.css"
}
```

### `@diveeoi/ui`
37 export entries spanning components, v2, pierre, icons, theme, fonts, audio, hooks, context, and styles.

### `@diveeoi/llm`
17 export entries covering the main module, route, provider, providers, protocols, and individual protocol/provider files.

### `@diveeoi/sdk`
10 export entries: main, client, server, v2, v2/client, v2/server, v2/gen/client.

### `@diveeoi/plugin`
```json
{ ".": "./src/index.ts", "./tool": "./src/tool.ts", "./tui": "./src/tui.ts" }
```

### `@diveeoi/effect-drizzle-sqlite`
4 export entries: main, effect-sqlite, migrator, and sqlite-core/effect.

### `@diveeoi/http-recorder`
```json
{ ".": "./src/index.ts", "./internal": "./src/internal.ts" }
```
