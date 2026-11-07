# DiveeOI Documentation

Use this index to find the right document for the task. The root [README](../README.md) is the user-facing entry point; this folder contains operator, contributor, architecture, API, and feature references.

## Index

| Document | Scope |
|---|---|
| [Getting Started](getting-started.md) | Install, first run, provider setup, first session |
| [Architecture](architecture.md) | Runtime shape, packages, request flow, data stores, Effect layers |
| [Targeted Learning](targeted-learning.md) | Book ingestion, grounded sessions, retrieval, student encoder |
| [API Reference](api.md) | HTTP surfaces, endpoint groups, auth, streaming, SDK |
| [Configuration](configuration.md) | Config hierarchy, environment variables, providers, MCP, feature settings |
| [Security and Authentication](security-auth.md) | Basic/JWT modes, account lifecycle, secrets, proxy hardening |
| [Deployment](deployment.md) | Build, self-hosting, Docker, persistent data, updates |
| [Targeted Learning Deployment](targeted-learning-deployment.md) | Model setup, offline import, persistent learning data |
| [Targeted Learning Debugging](targeted-learning-debugging.md) | Diagnostics, status endpoints, live validation |
| [Development](development.md) | Workspace commands, tests, conventions, troubleshooting |
| [Optimization](optimization.md) | Adaptive resources, memory, performance measurement |
| [Contributing](contributing.md) | Contribution workflow and review checklist |
| [Skills](skills.md) | Embedded skill metadata and authoring |

## Project references

- [Root README](../README.md): overview, quick start, repository map, documentation links.
- [Project brief](../DIVEEOI_BRIEF.md): product goals, user model, system capabilities, design rationale.
- [Project guide](../PROJECT_GUIDE.md): detailed package and source map.
- [Project lessons](../PROJECT_LESSONS.md): historical engineering lessons and recurring pitfalls.
- [Current engineering context](../CONTEXT.md): current source/runtime hand-off.
- [Current release hand-off](../RELEASE_HANDOFF_2026-11-06.md): repository, runtime, and verification boundaries.
- [Chronological worklog](../WORKLOG.md): implementation and verification history.
- [Targeted Learning worklog](TARGETED_LEARNING_WORKLOG.md): subsystem history.
- [What is implemented](WHATS_DONE.md): feature inventory and progress notes.

## PDF editions

The generated PDFs are maintained from the canonical scripts in `scripts/`:

- [DiveeOI overview](../DiveeOI.pdf) and [technical overview](../DiveeOI-technical.pdf).
- [Architecture paper — dark](../DiveeOI-architecture-dark.pdf) · [light](../DiveeOI-architecture-light.pdf).
- [Engineering field notes — dark](../DiveeOI-field-notes-dark.pdf) · [light](../DiveeOI-field-notes-light.pdf).

## Where to start by role

- **New user/operator:** [Getting Started](getting-started.md) → [Configuration](configuration.md) → [Security](security-auth.md).
- **Self-hosting:** [Deployment](deployment.md) → [Targeted Learning deployment](targeted-learning-deployment.md).
- **Frontend work:** [Architecture](architecture.md) + `packages/app/README.md` + `packages/ui/README.md`.
- **Server/session/provider work:** [Architecture](architecture.md) + [API](api.md) + `packages/server/README.md`. For provider/Composer recovery history, see `COMPOSER_INCIDENT_HANDOFF.md`; current status is in [CONTEXT](../CONTEXT.md).
- **Targeted Learning work:** [Targeted Learning](targeted-learning.md) → [package README](../packages/learning/README.md) → [Retrieval V2 plan](../packages/learning/RETRIEVAL_V2_PLAN.md) → [training README](../packages/learning/training/README.md).
- **API integration:** [API Reference](api.md) + `packages/api/README.md` + `packages/sdk/README.md`.
- **Performance work:** [Optimization](optimization.md) + `packages/db/src/adaptive` + [Targeted Learning](targeted-learning.md).

## Documentation conventions

- Commands assume Bun unless a file explicitly documents Rust or Python tooling.
- The repository pins Bun `1.3.14`; Node `22+` is secondary tooling/runtime support.
- Paths and schema names in code blocks should be checked against the current source before operational use.
- Targeted Learning's core app DB, `books.db`, and `student.db` are distinct stores; do not describe the product as using only one SQLite file.
- Historical worklogs, audits, QA captures, and draft plans retain their original dates and describe the state at that time. Use `CONTEXT.md` and the current release hand-off for present-tense status.
