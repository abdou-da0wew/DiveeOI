# DiveeOI

> AI-powered development web app. Chat with AI agents that read, write, and execute code in your projects. Fork of [OpenCode](https://github.com/anomalyco/opencode) — web UI and server only, no TUI.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-1.3.14-black?logo=bun)](https://bun.sh)
[![Effect](https://img.shields.io/badge/Effect-4.0.beta.74-purple)](https://effect.website)
[![SolidJS](https://img.shields.io/badge/SolidJS-1.9-4488ff?logo=solid)](https://solidjs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What is DiveeOI?

DiveeOI is a self-hosted web application where AI agents collaborate with you inside your codebase. You open a project directory, start a chat session, and the agent can:

- **Read and write files** — explore your project, edit code, create new files
- **Execute shell commands** — run tests, builds, linters, any CLI tool
- **Search the codebase** — grep, glob, LSP diagnostics
- **Browse the web** — fetch URLs, search the internet
- **Manage tasks** — plan implementations, track todos, ask clarifying questions
- **Use MCP servers** — connect any Model Context Protocol server for extended capabilities
- **Remember context** — persistent memory graph, session history, compaction

The frontend is a SolidJS single-page app. The backend is an Effect-TS HTTP server backed by SQLite. Everything runs locally — your code never leaves your machine except for the LLM API calls you configure.

---

## Quick Start

### Prerequisites

- **Bun** 1.3.14+ — [install](https://bun.sh/docs/installation)
- **Node.js** 22+ (secondary, for some tooling)

### Install and Run

```bash
# Clone
git clone https://github.com/abdou-da0wew/DiveeOI.git
cd DiveeOI

# Install all workspace dependencies
bun install

# Start server + frontend together (recommended)
bun run dev:both

# Or start them separately:
bun run dev        # server on http://localhost:4097
bun run dev:web    # frontend on http://localhost:3000  (Vite HMR)
```

Open `http://localhost:3000` in your browser. Pick a project directory and start chatting.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4097` | Server listen port (`packages/server/src/main.ts`) |
| `HOST` | `0.0.0.0` | Server listen host |
| `CORS` | _(auto)_ | Extra CORS origins (comma-separated, split in `main.ts`) |
| `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | SQLite file (channel-aware) |
| `DIVEEOI_PROFILER` | `0` | Set `1` to enable call-tree profiler |

Create a `.env` file at the project root if needed. See `docs/configuration.md` for the full list.

---

## Features

| Area | Details |
|------|---------|
| **AI Sessions** | Streaming chat, tool calling, compaction, retry, revert, handoff, forking |
| **Providers** | OpenAI, Anthropic, Google, Bedrock, Azure, Groq, Mistral, Cohere, DeepSeek, OpenRouter, XAI, and any OpenAI-compatible endpoint |
| **Tools** | Read, write, edit, glob, grep, shell, webfetch, websearch, LSP, patch, skill, question, todo, plan, task |
| **MCP** | Full Model Context Protocol support — connect external tool servers |
| **Memory** | Knowledge graph with nodes/edges, vector recall, extraction, consolidation |
| **Projects** | Multi-directory workspaces, git worktrees, per-project config |
| **Permissions** | Fine-grained tool permission system with auto-approve rules |
| **Plugins** | Extensible plugin SDK for custom tools and providers |
| **Optimization** | **Adaptive resource system** — cross-platform detection, 4 profiles, GC/backpressure & 13 tuned targets |
| **Profiler** | In-process call-tree profiler → `.divee/profiler.jsonl` (opt-in via `DIVEEOI_PROFILER=1`) |
| **i18n** | 17 locales (en, zh, ja, ko, fr, de, es, pt-BR, ru, ar, and more) |
| **Themes** | Light/dark themes with a full theme engine |

---

## Project Structure

```
DiveeOI/
├── packages/
│   ├── server/                 # @diveeoi/server  — HTTP server + all business logic (~50 Effect layers)
│   ├── db/                     # @diveeoi/db      — SQLite, session engine, AI providers, tools
│   ├── api/                    # @diveeoi/api     — Effect HttpApi definitions (20 groups)
│   ├── app/                    # @diveeoi/app     — SolidJS SPA frontend
│   ├── ui/                     # @diveeoi/ui      — Shared UI component library (197+ components)
│   ├── llm/                    # @diveeoi/llm     — Effect Schema-first LLM client
│   ├── sdk/                    # @diveeoi/sdk     — Typed API client (v1 + generated v2)
│   ├── plugin/                 # @diveeoi/plugin  — Plugin SDK
│   ├── memory/                 # @diveeoi/memory  — Knowledge graph memory system
│   ├── effect-drizzle-sqlite/  # Drizzle ORM + Effect SQLite adapter
│   ├── effect-sqlite-node/     # Node.js SQLite bridge for Effect
│   ├── http-recorder/          # HTTP cassette recorder (test only)
│   ├── profiler/               # Performance profiler utilities
│   ├── identity/               # Brand assets (logos, icons)
│   └── script/                 # Internal build scripts
├── docs/                       # Documentation
├── patches/                    # Patched dependencies
├── PROJECT_GUIDE.md            # Full architecture reference
├── DIVEEOI_BRIEF.md            # Detailed project brief
└── package.json                # Workspace root (Bun workspaces + Turbo)
```

See [`docs/architecture.md`](docs/architecture.md) for the full architecture breakdown, [`docs/optimization.md`](docs/optimization.md) for the adaptive perf system that is the fork's largest change, and [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) for the exhaustive package map.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript 5.8 (strict) |
| Runtime | Bun 1.3.14, Node 22 |
| Monorepo | Bun workspaces + Turbo 2.8 |
| Server | Effect-TS 4.0.0-beta.74 (HttpRouter, HttpApi, Layers, Streams) |
| Frontend | SolidJS 1.9 + Vite 7.1 + Tailwind 4.1 + Kobalte |
| Database | SQLite + Drizzle ORM 1.0 RC2 + custom Effect adapter |
| LLM | Custom `@diveeoi/llm` + Vercel AI SDK 6.0 (20+ providers) |
| Testing | Bun test + Playwright |
| Linting | oxlint + Prettier + tsgo |

---

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/getting-started.md`](docs/getting-started.md) | Installation, first session, provider setup |
| [`docs/architecture.md`](docs/architecture.md) | System design, layer graph, data flow, startup sequence |
| [`docs/development.md`](docs/development.md) | Dev workflow, scripts, testing, conventions |
| [`docs/api.md`](docs/api.md) | HTTP API groups, endpoints, auth, streaming |
| [`docs/configuration.md`](docs/configuration.md) | Config files, env vars, providers, MCP, themes |
| [`docs/optimization.md`](docs/optimization.md) | **Memory/speed/adaptive resources — the fork's core perf work** |
| [`docs/deployment.md`](docs/deployment.md) | Building, self-hosting, Docker, production checklist |
| [`docs/contributing.md`](docs/contributing.md) | How to contribute, code style, PR process |
| [`DIVEEOI_BRIEF.md`](DIVEEOI_BRIEF.md) | Super detailed project brief — what, why, how, and for whom |
| [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) | Exhaustive architecture reference (every package, every directory) |
| [`PROJECT_LESSONS.md`](PROJECT_LESSONS.md) | Hard-won lessons and gotchas from building this project |

Each package also has its own `README.md` with package-specific docs.

---

## Development Commands

```bash
# Root
bun run dev          # Start server
bun run dev:web      # Start frontend (Vite HMR)
bun run dev:both     # Both concurrently (server --watch + Vite)
bun run build        # Turbo build all packages
bun run typecheck    # Turbo typecheck (tsgo --noEmit per package)
bun run lint         # oxlint
bun run clean        # Remove dist/ and .turbo/

# Per package (from package directory)
bun run typecheck    # Typecheck single package
bun test             # Run package tests
```

See [`docs/development.md`](docs/development.md) for the full command reference.

---

## How It Works (30-Second Version)

1. **You open a project** — the server watches the directory, indexes files, and loads config. On boot it also samples the host (`/proc/meminfo`, `sysctl`, `os.freemem`) and picks an adaptive profile (comfortable→critical) that tunes GC, SSE/WS queue sizes, tool concurrency, and SQLite cache.
2. **You send a message** — the session engine builds a prompt (system instructions + conversation history + file context), picks a model, and streams the LLM response with an adaptive buffer/throttle.
3. **The agent calls tools** — the LLM emits tool calls (read, edit, shell, etc.), the server executes them under a per-profile `Semaphore` and feeds results back into the loop; memory extraction at turn exit is fire-and-forget so it never stalls the next first token.
4. **Everything is persisted** — sessions, messages, and events are stored in SQLite with lazy pagination + transparent GZIP (>10KB). The frontend syncs via SSE/WebSocket and renders the timeline in real time. A background `Bun.gc(true)` scheduler + 60s `DevMonitor` keep the process on its RSS/heap targets.

## Performance — Why This Fork Is Fast

> **DiveeOI's headline change is not the TUI removal — it is the adaptive optimization stack.** Upstream's server had a 1-5 minute stall on every turn (blocking memory extraction) and a fixed 30s GC/queue footprint that OOM'd constrained hosts. DiveeOI fixes both without deleting any user data.

- **Stall removed**: `prompt.ts` loop exit + compaction stop now `Effect.forkDetach(extractSessionMemory)` instead of `yield*` — first token is never blocked.
- **Adaptive targets** (`packages/db/src/adaptive`): cross-platform detection → 4 profiles (700→250 MB RSS, 400→150 MB heap, 60→8s GC, 8→1 tool threads, 200→25 stream buffer, 128→8 MB SQLite, etc.) recomputed every 90s with 30% interpolation. Binary ceilings at 1200 MB RSS / 512 MB heap.
- **All hot queues bounded adaptively**: PTY tickets, WS tracker, SSE event/global queues, LLM stream, DB PRAGMA cache/mmap — each via `useAdaptiveTargets` or `makeAdaptiveLayer` so RSS tracks the profile, not the load.
- **Profiler**: `packages/profiler` `AsyncLocalStorage` call-tree + gauges + JSONL `.divee/profiler.jsonl` — run with `DIVEEOI_PROFILER=1` to see per-route `durMs/heapDelta/concurrentMax`.
- **Storage**: zero-deletion — full history stays queryable; disk savings come from GZIP on large tool outputs and paginated `messages({limit,before,after})`.

Full phase plan + target table: [`docs/optimization.md`](docs/optimization.md) and `plans/Optimization_1.0/OPTIMIZATION_PLAN.md`.

---

## Origin

DiveeOI is a fork of [OpenCode](https://github.com/anomalyco/opencode) by the OpenCode community. The original project includes a terminal UI (TUI) built with OpenTUI. DiveeOI strips the TUI and ships only the web UI + server as a standalone web application.

- **Upstream**: `anomalyco/opencode`
- **Fork diff**: TUI/CLI code removed (`src/plugin/tui/`, `src/config/tui*`, `src/cli/`, TUI tests). All web/server functionality preserved and heavily extended — most notably a full adaptive memory/speed stack (`packages/db/src/adaptive`, `packages/profiler`, `main.ts` GC, `prompt.ts` fork-detach, bounded queues everywhere).

---

## License

MIT — see [LICENSE](LICENSE).
