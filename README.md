# DiveeOI

> AI-powered development web app. Chat with AI agents that read, write, and execute code in your projects. Self-hosted: the web UI and the server run on your machine, your code stays local, and the only thing that leaves the machine is the LLM traffic you configure.

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
| `CORS` | _(auto)_ | Additional trusted browser origins (comma-separated) |
| `DIVEEOI_AUTH_MODE` | `both` | Accept Basic and JWT (`basic`, `jwt`, `disabled` are also available) |
| `DIVEEOI_SERVER_USERNAME` | `DIVEEOI` | Basic-auth username; `OPENCODE_SERVER_USERNAME` is a legacy fallback |
| `DIVEEOI_SERVER_PASSWORD` | `divee` in non-production only | Basic-auth password; production has no default password |
| `DIVEEOI_JWT_SECRET` | generated if omitted | Stable signing key (at least 32 characters recommended) |
| `DIVEEOI_AUTH_ALLOW_REGISTRATION` | closed after first account | Set `1`/`true`/`yes` to allow regular-user registrations |
| `VITE_DIVEEOI_SERVER_HOST` | `127.0.0.1` | Vite development proxy target host |
| `VITE_DIVEEOI_SERVER_PORT` | `4097` | Vite development proxy target port |
| `OPENCODE_DB` | `~/.local/share/opencode/opencode.db` | SQLite file (channel-aware) |
| `DIVEEOI_PROFILER` | `0` | Set `1` to enable call-tree profiler |

Create a `.env` file at the project root if needed; start from [`.env.example`](.env.example). For authentication modes, account setup, and production security guidance, see [`docs/security-auth.md`](docs/security-auth.md) and `docs/configuration.md`.

---

## Features

| Area | Details |
|------|---------|
| **AI Sessions** | Streaming chat, tool calling, compaction, retry, revert, handoff, forking |
| **Providers** | OpenAI, Anthropic, Google, Bedrock, Azure, Groq, Mistral, Cohere, DeepSeek, OpenRouter, XAI, and any OpenAI-compatible endpoint |
| **Tools** | Read, write, edit, glob, grep, shell, webfetch, websearch, LSP, patch, skill, question, todo, plan, task |
| **MCP** | Full Model Context Protocol support — connect external tool servers |
| **Memory** | Knowledge graph with nodes/edges, vector recall, extraction, consolidation |
| **Targeted Learning** | Indexed books, grounded `@book:` sessions, hybrid retrieval, student memory, OCR and resumable ingest jobs |
| **Projects** | Multi-directory workspaces, git worktrees, per-project config |
| **Permissions** | Fine-grained tool permission system with auto-approve rules |
| **Plugins** | Extensible plugin SDK for custom tools and providers |
| **Optimization** | **Adaptive resource system** — cgroup-aware resource detection, 4 profiles, GC/backpressure and 22 tuned targets |
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
│   ├── api/                    # @diveeoi/api     — Effect HttpApi definitions (21 groups)
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
│   ├── mcp/                    # Built-in MCP server (ocreadb)
│   ├── plugins/                # Plugin registry / discovery
│   ├── identity/               # Brand assets (logos, icons)
│   └── script/                 # Internal build scripts
├── docs/                       # Documentation
├── patches/                    # Patched dependencies
├── PROJECT_GUIDE.md            # Full architecture reference
├── DIVEEOI_BRIEF.md            # Detailed project brief
└── package.json                # Workspace root (Bun workspaces + Turbo)
```

See [`docs/architecture.md`](docs/architecture.md) for the full architecture breakdown, [`docs/optimization.md`](docs/optimization.md) for the adaptive perf system, and [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) for the exhaustive package map.

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
| [`docs/security-auth.md`](docs/security-auth.md) | Authentication modes, account flows, credentials and production hardening |
| [`docs/optimization.md`](docs/optimization.md) | **Memory/speed/adaptive resources — the core perf work** |
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

1. **You open a project** — the server watches the directory, indexes files, and loads config. On boot it samples host/container resources (including Linux cgroup v1/v2 limits) and picks an adaptive profile (comfortable→critical) that tunes GC, SSE/WS queue sizes, tool concurrency, and SQLite cache.
2. **You send a message** — the session engine builds a prompt (system instructions + conversation history + file context), picks a model, and streams the LLM response with an adaptive buffer/throttle.
3. **The agent calls tools** — the LLM emits tool calls (read, edit, shell, etc.), the server executes them under a per-profile `Semaphore` and feeds results back into the loop; memory extraction at turn exit is fire-and-forget so it never stalls the next first token.
4. **Everything is persisted** — sessions, messages, and events are stored in SQLite with lazy pagination + transparent GZIP (>10KB). The frontend syncs via SSE/WebSocket and renders the timeline in real time. A background `Bun.gc(true)` scheduler + 60s `DevMonitor` keep the process on its RSS/heap targets.

## Performance — Why DiveeOI Is Fast

> **DiveeOI is built to stay fast on ordinary hardware.** The server adapts to the machine it runs on, keeps its queues bounded, and never blocks the first token on background work.

- **No stall on the first token**: `prompt.ts` loop exit + compaction stop fork the memory extraction instead of awaiting it — the first token is never blocked.
- **Adaptive targets** (`packages/db/src/adaptive`): host/container-aware detection → 4 profiles. RSS/heap budgets scale with detected memory (45%/30% in comfortable mode down to 12%/8% in critical mode); GC intervals are 60s→5s, tool concurrency is capped by CPU quota (up to 16→1), stream buffers are 400→32, and SQLite cache targets are 256→16 MB. Targets refresh every 90s; pressure sheds resources immediately and recovery uses hysteresis.
- **All hot queues bounded adaptively**: PTY tickets, WS tracker, SSE event/global queues, LLM stream, DB PRAGMA cache/mmap — each via `useAdaptiveTargets` or `makeAdaptiveLayer` so RSS tracks the profile, not the load.
- **Profiler**: `packages/profiler` `AsyncLocalStorage` call-tree + gauges + JSONL `.divee/profiler.jsonl` — run with `DIVEEOI_PROFILER=1` to see per-route `durMs/heapDelta/concurrentMax`.
- **Storage**: zero-deletion — full history stays queryable; disk savings come from GZIP on large tool outputs and paginated `messages({limit,before,after})`.
- **Project retention you control**: idle projects are released after 10 minutes by default so memory tracks the work in front of you; `performance.keep_projects_warm` (or the **Settings → Features → Performance** switch) keeps them warm instead.

Full phase plan + target table: [`docs/optimization.md`](docs/optimization.md) and `plans/Optimization_1.0/OPTIMIZATION_PLAN.md`.

---

## DiveeComposer

DiveeOI ships with a built-in model called **DiveeComposer** — an internal router, not a provider:

- You pick it like any other model, and it is the default when you have not chosen one.
- It is never sent to a provider. Each turn it resolves to the best **free** model that is currently reachable (preferring the bundled free tier), and only that concrete model is used for the request.
- It picks by **quality, not by price**: a curated family tier table, the variant words in the model name, the version lineage inside a family, and the capabilities the catalog reports — plus a small boost for models that actually completed a turn. It prefers models that are reachable *right now* (the bundled free tier needs no key), and it learns from refusals: a model the gateway rejects is dropped, and a provider that rejects several of its models is dropped entirely. `performance.composer.preferred` lets you override the ranking with your own similarity list.
- Its capabilities — image/PDF/audio/video input, context window, reasoning, variants — always mirror the model it currently routes to, so the UI enables exactly what the routed model can do.
- The routing is invisible in the interface but explicit in the logs (`composer.route` in the server log) and in the request itself.

---

## License

MIT — see [LICENSE](LICENSE).
