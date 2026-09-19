# DiveeOI Documentation

Welcome to the DiveeOI docs. Start here to understand, run, and extend the project.

## Index

| Document | What it covers |
|----------|---------------|
| [Getting Started](getting-started.md) | Install, first run, provider setup, your first AI session |
| [Architecture](architecture.md) | System design, monorepo map, server bootstrap, data flow, Effect layer graph, database schema |
| [Optimization](optimization.md) | **Memory/speed/adaptive stack — the fork's core perf work** |
| [Development](development.md) | Dev scripts, testing, conventions, project patterns, troubleshooting |
| [API Reference](api.md) | HTTP API groups, endpoints, auth, streaming, SDK usage |
| [Configuration](configuration.md) | Config files, config hierarchy, env vars, providers, MCP, themes, adaptive resources |
| [Deployment](deployment.md) | Build, self-hosting, Docker, production checklist, updates |

## Quick Links

- **Root README**: [`../README.md`](../README.md) — overview and quick start
- **Project brief**: [`../DIVEEOI_BRIEF.md`](../DIVEEOI_BRIEF.md) — the full story: what DiveeOI is, why it exists, how it works, and for whom
- **Exhaustive architecture reference**: [`../PROJECT_GUIDE.md`](../PROJECT_GUIDE.md) — every package, every directory, every layer
- **Hard-won lessons**: [`../PROJECT_LESSONS.md`](../PROJECT_LESSONS.md) — gotchas, fixes, patterns that survived production
- **Per-package READMEs**: each `packages/*/README.md` — package-scoped setup and API

## Where to Look by Role

- **New contributor** → [Getting Started](getting-started.md) → [Architecture](architecture.md) → [Development](development.md)
- **Frontend work** → [Architecture](architecture.md#frontend) + `packages/app/README.md` + `packages/ui/README.md`
- **Server / session / LLM work** → [Architecture](architecture.md#server) + `packages/server/README.md` + `packages/db/README.md`
- **API integration** → [API Reference](api.md) + `packages/api/README.md` + `packages/sdk/README.md`
- **Self-hosting** → [Deployment](deployment.md) + [Configuration](configuration.md)
- **Perf / memory** → [Optimization](optimization.md) + `packages/profiler/README.md` + `packages/db/src/adaptive`
- **Memory / knowledge graph** → `packages/memory/README.md` + [Architecture](architecture.md#memory-system)

## Conventions Used in These Docs

- `bun` is the package manager everywhere. Commands assume `bun`.
- Code blocks show the file path they come from where it helps.
- Effect-TS service names use their tag, e.g. `@opencode/Session`.
- `PORT` defaults to `4097` (overridden from `4096` in the global `PORT` env in some older docs — `main.ts` uses `4097`).
- Paths like `@/` resolve to `packages/server/src/` in server code.
