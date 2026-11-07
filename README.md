# DiveeOI

**A self-hosted AI development workspace.** Run AI agents in a browser, point them at your projects, and let them inspect files, edit code, execute commands, use MCP tools, and keep project context across sessions.

DiveeOI keeps the application server and project data under your control. Model requests go to the provider you configure; web search/fetch, remote MCP servers, and other connected services also make network requests when you use them.

## What it does

| Area | Capabilities |
|---|---|
| **AI sessions** | Streaming conversations, tool calls, context compaction, retry, revert, fork, and handoff |
| **Project work** | Multiple project directories, worktrees, file watching, Git-aware workflows, and per-project configuration |
| **Agent tools** | File read/write/edit, shell, search, LSP, patch, task planning, questions, and other permission-gated tools |
| **Model providers** | Provider catalogue and authentication, OpenAI-compatible endpoints, and per-turn model resolution |
| **DiveeComposer** | A synthetic model choice that selects a concrete eligible provider/model for each turn; it is not sent upstream itself |
| **MCP and plugins** | Local or remote Model Context Protocol servers, plus the plugin SDK and bundled integrations |
| **Memory** | Persistent project knowledge graph, recall, extraction, and consolidation |
| **Targeted Learning** | Book/document ingestion, Arabic and English OCR support, grounded `@book:` sessions, hybrid retrieval, and separate student memory |
| **Retrieval V2** | Optional persistent Rust retrieval engine with a TypeScript fallback, plus an offline query-encoder training/evaluation pipeline |
| **Operations** | Basic/JWT authentication, adaptive resource controls, JSONL profiling, and deployment-oriented health/API endpoints |
| **Interface** | SolidJS web app, shared component library, localization, and light/dark themes |

Targeted Learning and the distilled query encoder are configurable features. The `auto` query-encoder mode only selects a student model after its promotion manifest passes the configured evaluation gates; otherwise it uses BGE-M3. A training pipeline existing in the repository does not mean a student model has already been trained or promoted on your machine.

## Quick start

### Requirements

- **Bun 1.3.14** (pinned by the repository's `packageManager` field)
- **Node.js 22 or newer** for secondary tooling
- A supported Linux/macOS development environment; the server's Node SQLite bridge exists for secondary runtime paths, but Bun is the primary development/runtime path

### Install

```bash
git clone https://github.com/abdou-da0wew/DiveeOI.git
cd DiveeOI
bun install
```

### Run the server and web app

```bash
bun run dev:both
```

Open **http://localhost:3000**. The Vite development server proxies API requests to the backend at **http://localhost:4097**.

To run either side separately:

```bash
bun run dev        # backend server
bun run dev:web    # frontend with Vite HMR
```

### First run and authentication

The default authentication mode is `both` (Basic authentication and JWT accounts). In non-production development, the server has a `DIVEEOI / divee` Basic-auth fallback when no password is configured. **Production has no default Basic password.** Configure a strong password or use the account/JWT flow before exposing the server.

Registration is closed after the first account by default. Set `DIVEEOI_AUTH_ALLOW_REGISTRATION=1` only when you intentionally want to allow additional regular-user registrations. Do not use `DIVEEOI_AUTH_MODE=disabled` on a reachable server.

Configure an LLM provider in the application settings or the appropriate config file, then create a project and start a session.

## Configuration

Copy [`.env.example`](.env.example) to `.env` when environment-based configuration is useful. The full configuration hierarchy and provider settings are documented in [Configuration](docs/configuration.md).

| Variable | Default / behaviour | Purpose |
|---|---|---|
| `PORT` | `4097` | Backend listen port |
| `HOST` | `0.0.0.0` | Backend listen address |
| `CORS` | automatic same-origin/local rules | Extra trusted browser origins, comma-separated |
| `DIVEEOI_AUTH_MODE` | `both` | `both`, `basic`, `jwt`, or `disabled` |
| `DIVEEOI_SERVER_USERNAME` | `DIVEEOI` | Basic-auth username |
| `DIVEEOI_SERVER_PASSWORD` | development fallback only | Basic-auth password; set an explicit secret in production |
| `DIVEEOI_JWT_SECRET` | generated and stored persistently when omitted | JWT signing secret; configure a stable secret for production |
| `DIVEEOI_AUTH_ALLOW_REGISTRATION` | closed after first account | Set to `1`, `true`, or `yes` to allow later registrations |
| `OPENCODE_DB` | application data directory default | Compatibility database-path override |
| `VITE_DIVEEOI_SERVER_HOST` | `127.0.0.1` | Vite proxy target host |
| `VITE_DIVEEOI_SERVER_PORT` | `4097` | Vite proxy target port |
| `DIVEEOI_TL_DATA_DIR` | resolved from application data paths | Optional Targeted Learning data-directory override |

The server also retains selected `OPENCODE_*` variables for compatibility with the upstream-derived configuration surface. Prefer the documented `DIVEEOI_*` names where both exist. Never commit secrets or generated credentials.

## Targeted Learning

Targeted Learning is a separate, book-grounded workflow rather than ordinary chat with a different prompt. Import or ingest a book, wait for indexing to finish, then start a session with the book selected or referenced using `@book:`.

The retrieval path combines SQLite FTS5/BM25 candidates with dense vector candidates and Reciprocal Rank Fusion. The optional Rust engine performs the retrieval hot path; `retrieval.engine=auto` uses it when its binary is available and falls back to the TypeScript implementation when it is not. Query rewriting, gating, grounding policy, and parent-context expansion remain in TypeScript.

BGE-M3 is the indexing teacher. A smaller multilingual student can serve chat queries in the same 1024-dimensional vector space after its held-out evaluation and promotion checks pass. The `auto` setting keeps BGE-M3 as the query encoder until a valid promoted student is installed. See the [Targeted Learning overview](docs/targeted-learning.md), [deployment guide](docs/targeted-learning-deployment.md), [debugging guide](docs/targeted-learning-debugging.md), and [Retrieval V2 execution plan](packages/learning/RETRIEVAL_V2_PLAN.md).

## Development commands

```bash
# Root workspace
bun run dev          # server
bun run dev:web      # web app
bun run dev:both     # server + web app
bun run build        # production build
bun run typecheck    # Turbo typecheck
bun run lint         # oxlint
bun run clean        # remove package dist/.turbo output

# Package-level checks (run from the package directory)
bun run typecheck
bun test

# Targeted Learning package
cd packages/learning
bun test
bun run typecheck

# Rust retrieval engine
cd packages/learning/native/retrieval
cargo fmt --check
cargo test --offline
cargo clippy --offline -- -D warnings
cargo build --release --offline

# Offline training toolkit (Python environment)
cd packages/learning/training
pip install -r requirements.txt
python smoke_test.py
```

The root does not define a single aggregate `test` script. Run the relevant package suites; use [Development](docs/development.md) for the full workflow and test matrix.

## Repository map

```text
DiveeOI/
├── packages/
│   ├── server/                 # HTTP server, session orchestration, tools, providers
│   ├── db/                     # SQLite schemas, migrations, providers, session engine
│   ├── api/                    # Effect HttpApi contracts
│   ├── app/                    # SolidJS application
│   ├── ui/                     # Shared UI components and theme system
│   ├── learning/               # Targeted Learning, retrieval, ingestion, training
│   │   ├── native/retrieval/   # Rust BM25 + dense + RRF engine
│   │   └── training/           # Offline corpus and student-encoder toolkit
│   ├── memory/                 # Persistent knowledge graph
│   ├── llm/                    # Schema-first LLM client and provider routing
│   ├── sdk/                    # Typed API clients (v1 and generated v2)
│   ├── plugin/                 # Plugin SDK
│   ├── plugins/                # Bundled integrations
│   ├── mcp/                    # Built-in MCP server
│   ├── identity/               # Brand assets
│   ├── profiler/               # In-process profiling
│   ├── script/                 # Internal build and migration tooling
│   ├── effect-drizzle-sqlite/  # Drizzle adapter for Effect SQLite
│   ├── effect-sqlite-node/     # Node SQLite bridge for Effect
│   └── http-recorder/          # Test-only HTTP cassette recorder
├── docs/                       # Operator, contributor, architecture, and QA docs
├── scripts/                    # Build and PDF generation scripts
├── PROJECT_GUIDE.md            # Detailed package and code-structure reference
├── DIVEEOI_BRIEF.md            # Product and design brief
└── package.json                # Bun workspace and Turbo configuration
```

## Documentation

| Start here | Use it for |
|---|---|
| [Documentation index](docs/README.md) | Complete documentation map |
| [Getting started](docs/getting-started.md) | Install, first run, provider setup |
| [Architecture](docs/architecture.md) | Runtime shape, package boundaries, request flow, data stores |
| [Targeted Learning](docs/targeted-learning.md) | Book ingestion, grounded sessions, retrieval, student encoder |
| [API reference](docs/api.md) | HTTP surfaces, authentication, streaming, SDK |
| [Configuration](docs/configuration.md) | Config hierarchy, environment, providers, feature settings |
| [Security and authentication](docs/security-auth.md) | Basic/JWT modes, accounts, secrets, proxy hardening |
| [Deployment](docs/deployment.md) | Builds, self-hosting, Docker, persistent data, updates |
| [Targeted Learning deployment](docs/targeted-learning-deployment.md) | Model setup, offline import, persistent learning data |
| [Targeted Learning debugging](docs/targeted-learning-debugging.md) | Diagnostics, status endpoints, live validation |
| [Development](docs/development.md) | Commands, tests, conventions, troubleshooting |
| [Optimization](docs/optimization.md) | Resource adaptation and performance work |
| [Contributing](docs/contributing.md) | Contribution workflow and review checklist |
| [Project guide](PROJECT_GUIDE.md) | Detailed package and source map |
| [Project lessons](PROJECT_LESSONS.md) | Historical engineering lessons and pitfalls |
| [Project brief](DIVEEOI_BRIEF.md) | Product goals and design rationale |
| [Current engineering context](CONTEXT.md) | Current source/runtime state and verification boundaries |
| [Current release hand-off](RELEASE_HANDOFF_2026-11-06.md) | Source revision, live service snapshot, and release caveats |

### PDF editions

- [DiveeOI overview](DiveeOI.pdf)
- [Technical architecture overview](DiveeOI-technical.pdf)
- [Architecture paper — dark](DiveeOI-architecture-dark.pdf) · [light](DiveeOI-architecture-light.pdf)
- [Engineering field notes — dark](DiveeOI-field-notes-dark.pdf) · [light](DiveeOI-field-notes-light.pdf)

## Security and data boundaries

Self-hosted does not mean every operation is offline. The server stores project and session data locally, but configured LLM providers receive prompts and context; web tools contact external sites; remote MCP servers receive the inputs sent to their tools. Review provider, MCP, and permission settings before exposing a shared instance. Put public deployments behind TLS termination, keep authentication enabled, and back up the main application database and the separate Targeted Learning data directory.

For operational details, start with [Security and authentication](docs/security-auth.md) and [Deployment](docs/deployment.md).
