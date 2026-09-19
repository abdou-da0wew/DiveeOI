# Getting Started

## Prerequisites

- **Bun 1.3.14+** — `curl -fsSL https://bun.sh/install | bash` — primary runtime and package manager
- **Node 22+** — secondary, used by some tooling and `effect-sqlite-node`
- **Git** — for worktree and project detection

Check versions:

```bash
bun --version   # want 1.3.14+
node --version  # want v22+
```

## Install

```bash
git clone https://github.com/abdou-da0wew/DiveeOI.git
cd DiveeOI
bun install
```

`bun install` resolves `bun.lock` with `exact = true` in `bunfig.toml`. Do not use `npm` or `pnpm` in this repo.

## Run

Preferred — server + app together with live reload:

```bash
bun run dev:both
# server --watch on http://localhost:4097  (cyan)
# app    Vite HMR on http://localhost:3000  (green)
```

Separately:

```bash
bun run dev       # server only — packages/server/src/main.ts, port 4097, 0.0.0.0
bun run dev:web   # app only   — packages/app Vite dev, HMR
```

Production build:

```bash
bun run build        # turbo build: sdk -> app -> server
bun run typecheck    # tsgo --noEmit per package
bun run lint         # oxlint
```

Open `http://localhost:3000` in a browser. The app connects to the server it finds at the current origin in production, or `http://localhost:4097` in dev (`VITE_DIVEEOI_SERVER_HOST` / `VITE_DIVEEOI_SERVER_PORT`).

## First Project

1. In the app sidebar, open a directory that contains a project (a git repo or any folder).
2. The server:
   - resolves the project via `InstanceState.context` (worktree + directory),
   - loads config (see [Configuration](configuration.md)),
   - scans `.opencode/` dirs, installs `@diveeoi/plugin` deps in the background,
   - registers file watchers and LSP clients.
3. Click **New session** or press the prompt input on `/new-session`. Type a message and send.

## Configure an LLM Provider

DiveeOI ships no API keys. You must configure at least one provider.

### Option A — Global config file

Create `~/.config/opencode/opencode.jsonc` (auto-created on first `Config.get`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openai": { "apiKey": "$OPENAI_API_KEY" }
  },
  "model": "openai/gpt-4o-mini"
}
```

Use `$VAR` so keys stay in env vars and are expanded by `ConfigVariable.substitute`.

Supported providers (non-exhaustive): `openai`, `anthropic`, `google`, `azure` (OpenAI via Azure), `amazon-bedrock`, `cloudflare` (gateway + Workers AI), `github-copilot`, `openrouter`, `xai`, plus any OpenAI-compatible endpoint via `openai-compatible` and `models.json` overrides. See [Configuration](configuration.md#providers).

### Option B — Environment

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

And set `provider`/`model` in the global config as above.

### Verify

```bash
# in the app: Settings -> Providers should list your configured provider
# or hit the API directly:
curl http://localhost:4097/api/provider | jq
```

## Accounts and Remote Config (optional)

DiveeOI can fetch a remote config via `.well-known/opencode` when `auth` contains a `wellknown` entry, and can pull console-managed org config via `account`/`active_org_id`. Most users do not need this — ignore it unless you are wiring a private registry.

## Your First Session

- **Send a message**: default agent is `build` (primary, full permissions).
- **Attach context**: mention files (`@path/to/file`), drag-and-drop, or paste — the prompt resolver (`SessionPrompt.resolvePromptParts`) materializes file content via the `Read` tool and LSP symbol ranges.
- **Tools**: the agent can call `read`, `write`, `edit`, `glob`, `grep`, `shell`, `webfetch`, `websearch`, `skill`, `task`, etc. Tool permissions are enforced by the `Permission` service (`allow` / `deny` / `ask`).
- **Permissions**: `ask` pauses the agent and shows a prompt in the UI; `always` remembers, `once` does not. The permission ruleset is merged from agent defaults, `.opencode` policy, and your global config.
- **Streaming**: the LLM response streams via `SessionProcessor` → `LLM.Service` → `LLMClient` (native route) or AI SDK path. Tokens, costs, and busy/idle status are persisted.

## Health and Debug

- `GET /api/health` — basic health (always works)
- `GET /doc` — OpenAPI spec (from `PublicApi`)
- App connection gate (`app.tsx:ConnectionGate`) polls `GET /api/health` with a 10s retry loop; on failure it offers other recorded servers or asks to retry.

## Next Steps

- [Architecture](architecture.md) — how the server, DB, LLM, and app fit together
- [Configuration](configuration.md) — full config hierarchy and every flag
- [API Reference](api.md) — endpoints and SDK usage
- [Development](development.md) — testing, typecheck, and conventions
