# Configuration

## Hierarchy

`packages/server/src/config/config.ts:loadInstanceState` merges in order (later wins):

1. `auth` `wellknown` remote config — `url/.well-known/opencode` returns `{ remote_config: { url, headers? }, config? }`, then `remote.url` is fetched (content-type HTML -> `RemoteAuthError`), both are variable-substituted and lenient-decoded.
2. Global files under `Global.Path.config` (usually `~/.config/opencode/`): `config.json`, `opencode.json`, `opencode.jsonc` (auto-created with `"$schema": "https://opencode.ai/config.json"` if none exists), then extra `diveeagent/diveeoi.jsonc` paths (DiveeOI override).
3. `Flag.OPENCODE_CONFIG` — single explicit file.
4. Per-worktree `.opencode` discovered via `ConfigPaths.files("opencode", directory, worktree)` and directory loop over `ConfigPaths.directories`.
5. `Flag.OPENCODE_CONFIG_DIR` extra `.opencode` dirs.
6. `Flag.OPENCODE_CONFIG_CONTENT` JSON (`OPENCODE_CONFIG_CONTENT` env).
7. Active account org config — `accountSvc.config(accountID, orgID)` + `OPENCODE_CONSOLE_TOKEN` injection.
8. `managed/managedConfigDir()` + macOS MDM `.mobileconfig`.
9. Derived merges: `mode -> agent`, `Flag.OPENCODE_PERMISSION` JSON, `tools -> permission` mapping ( `write/edit/patch -> edit` ), `username` via `os.userInfo`, `autoshare -> share = "auto"`, `Flag.OPENCODE_DISABLE_AUTOCOMPACT/PRUNE`.

`plugin_origins: ConfigPlugin.Origin[]` tracks winning `{ spec, source, scope }` deduplicated by `ConfigPlugin.deduplicatePluginOrigins`; `plugin` array itself is just the specs. The global config is cached via `cachedInvalidateWithTTL(Duration.infinity)` and can be reloaded by `Config.invalidate()`.

## Schema

Canonical shape is `ConfigV1.Info` (`packages/db/src/v1/config/config.ts`). Interesting branches:

- `provider: Record<string, { apiKey? auth? options? modelOptions? }>` — per-provider credentials and `providerOptions` forwarded to `@diveeoi/llm` routes.
- `model?: string` — `provider/model` id accepted at the root; also `mcp`, `lsp`, `plugin: ConfigPluginV1.Spec[]`, `agent`, `mode`, `permission`, `command`, `compaction`, `watcher`, `formatter`, `lsp`, `mcp`, `reference`, `tool_output`, `attachments`, `experimental`.
- `instructions?: string[]` — concatenated per-file, deduped by `Set`.
- Variables are substituted via `ConfigVariable.substitute({ text, type: "path"|"virtual", dir/source, env })` before parsing. Use `$VAR`, `${VAR:-default}`, `~/`.

Parse pipeline: `substitute -> ConfigParse.jsonc -> normalizeLoadedConfig (strips legacy theme/keybinds/tui) -> ConfigParse.schemaLenient(ConfigV1.Info) -> resolveLoadedPlugins (normalize relative plugin specs relative to their file) -> $schema injection`.

## Flags / Environment

From `packages/db/src/flag/flag.ts` and `packages/server/src/env` (canonical flags are read via `ConfigProvider.fromEnv()` refreshed per `listenerLayer` so each `Server.listen` reflects current `process.env`):

- `PORT`, `HOST`, `CORS` (split comma) — handled in `main.ts` before layers.
- `OPENCODE_CONFIG` — explicit config file path.
- `OPENCODE_CONFIG_DIR` — additional config dirs.
- `OPENCODE_CONFIG_CONTENT` — JSON config content.
- `OPENCODE_DISABLE_PROJECT_CONFIG` — skip per-project config.
- `OPENCODE_DISABLE_AUTOCOMPACT`, `OPENCODE_DISABLE_PRUNE`, `OPENCODE_PERMISSION` (JSON ruleset merge), `OPENCODE_DB` (`:memory:` or path or filename under `Global.Path.data`), `OPENCODE_DISABLE_CHANNEL_DB`, `OPENCODE_EXPERIMENTAL`, `OPENCODE_EXPERIMENTAL_NATIVE_LLM`, `OPENCODE_MODEL`, `DIVEEOI_PROFILER` (`1` enables profiler), `DIVEEOI_PROFILER_SAMPLE_RATE` (`(0,1]`).
- Provider keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_*`, `AWS_*`, etc. — resolved per-provider by `AuthOptions.bearer`.

Global config file detection: checks `Global.Path.config/opencode.jsonc` then `.json` then `config.json` (the last is an alternative name). When none exists a blank `opencode.jsonc` stub with `$schema` is written.

On `config.update` (per-instance `config.json`) the existing file is read and merged with `mergeDeep(writable(existing), writable(next))`. On `config.updateGlobal` the closest candidate is patched via `jsonc-parser` `modify/applyEdits` (preserving comments) or plain `JSON.stringify` for `.json`, then `invalidate()`d.

## Feature Flags

Startup features can be disabled entirely: a disabled feature's machinery (Effect layers, fibers, MCP clients, language-server processes, memory scheduler, tools, routes) is never constructed at all, which cuts baseline RAM. Gating is resolved exactly once at module load in `packages/server/src/features.ts`, before any layer builds. Per-project config is deliberately not consulted — layers are process-global.

Available features: `memory`, `mcp`, `lsp`, `profiler` (all enabled by default). Two sources, lowest to highest priority:

1. The `features` object in a global config file (same candidates as the Config service — `~/.config/opencode/opencode.jsonc` / `.json` / `config.json`, `~/.diveeagent/diveeoi.jsonc`, or `DIVEEOI_CONFIG` / `OPENCODE_CONFIG`):

   ```jsonc
   {
     // ~/.config/opencode/opencode.jsonc
     "features": { "memory": false, "lsp": false }
   }
   ```

2. `DIVEEOI_DISABLE_FEATURES` / `OPENCODE_DISABLE_FEATURES` — comma-separated feature names forced off (wins over config):

   ```sh
   DIVEEOI_DISABLE_FEATURES=memory,mcp,lsp
   ```

Behavior when disabled:

- `memory` — no memory extraction or scheduler fiber, no memory tools in the registry, no memory service graph built anywhere (Session/SessionShare/ToolRegistry included), and `POST /api/session/:id/memory-extract` returns 404.
- `mcp` — no config-driven connects or SDK clients; the MCP API reports an empty surface with `status: "disabled"`, and connect/auth endpoints fail with `NotFoundError`.
- `lsp` — no language-server processes; hover/diagnostics/symbol calls return empty results.
- `profiler` — the profiler module is never loaded at startup (runtime activation still additionally requires `DIVEEOI_PROFILER=1`).

The web UI exposes these under **Settings → Features** (both v1 and v2 settings dialogs): a toggle per feature plus per-language-server on/off switches. Saving a change PATCHes the global config (`PATCH /global/config`) and then automatically restarts the server in place — the UI shows a "Restarting server…" overlay until the health endpoint answers again, then reloads the page. `GET /global/features` returns the effective flags, any `DIVEEOI_DISABLE_FEATURES` env overrides (shown as locked toggles), and the built-in LSP server list with their disabled state. `POST /global/restart` re-execs the server process (the replacement waits for the old process to release the listen port).

## Providers

Defined in `packages/db/src/config/*` and runtime in `packages/llm/providers/*`. A provider is typically:

```ts
Route.make({
  id: "openai-chat",
  provider: "openai",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: "https://api.openai.com/v1" }),
  auth: Auth.bearer(),
  framing: Framing.sse,
})
```

Provider facades (`OpenAI.configure({ apiKey, baseURL }).model("gpt-4o")`) configure endpoint/auth before `.model(id)`; `AtLeastOne<...>` enforces required URL parts (Azure needs `resourceName|baseURL`, Bedrock needs `region`). Catalog metadata (`cost`, `capabilities.temperature`, `variants`) stays outside `packages/llm`.

`ProviderTransform` merges `smallOptions` vs `options({ model, sessionID, providerOptions })` with `model.options`, `agent.options`, `variant` deep-merged, `Azure.useCompletionUrls` cleans up `reasoningSummary/include`, `openai oauth` moves `system` into `options.instructions`.

## Auth

- `packages/server/src/auth` and `packages/db/src/account/auth` handle account tokens, refresh, and `auth.*` WellKnown fetching.
- Server HTTP auth is password-only: `ServerAuth.Config { username: "opencode", password: Option<string> }`. An empty/disabled layer allows all requests; a password layer is enforced by `authorizationLayer` middleware on HttpApi and `authorizationRouterMiddleware` on raw router routes.
- Browser passes `?auth_token=base64(user:pass)` -> `authFromToken` -> `ServerConnection.Http.authToken`.

## MCP

Declared in `ConfigV1.Info["mcp"]: Record<string, ConfigMCPV1.Info>`:

```jsonc
{
  "mcp": {
    "myserver": { "type": "local", "command": ["node", "server.js"], "cwd": ".", "enabled": true },
    "remoteapi": { "type": "remote", "url": "https://api.example.com/mcp", "oauth": { "scope": "openid" } }
  }
}
```

See `docs/architecture.md#mcp` for the full runtime (dual `StreamableHTTP` -> `SSE` fallback, `ToolListChanged` watch, `permissions` propagation).

## LSP

Built-in language servers (typescript, deno, vue, eslint, oxlint, biome, gopls, ruby-lsp, pyright, ty, …) are **enabled by default**: the first touch of a matching file spawns the server if its binary is available (some servers auto-download when missing, unless `RuntimeFlags.disableLspDownload` is set). Diagnostics for edited files are appended to the `edit`/`write`/`apply_patch` tool results, and the agent can query current errors on demand via the `lsp` tool's `diagnostics` operation.

Config overrides (`ConfigLSP.Info` = `Boolean | Record<string, Entry>`):

```jsonc
{
  "lsp": false,                                  // turn all servers off
  "lsp": { "typescript": { "disabled": true } }, // disable one server
  "lsp": { "myserver": { "command": ["node", "server.js"], "extensions": [".js"] } } // add a custom server
}
```

The startup feature flag (`features.lsp` in config, or `DIVEEOI_DISABLE_FEATURES=lsp`) removes the whole subsystem — no servers spawn and LSP calls return empty results.

These same keys are manageable from the web UI under **Settings → Features** (master "All language servers" toggle writes `lsp: true/false`; per-server switches write `lsp.<id>.disabled`). Saving restarts the server automatically — see [Feature Flags](#feature-flags).

## Themes

Controlled from `packages/ui/src/theme/context.tsx` and exposed via `DialogProvider` settings. Storage keys: `opencode-theme-id`, `opencode-color-scheme`, `opencode-theme-css-light/dark`. `themes/oc-2.json` is the bundled default; the other 40 `themes/*.json` are lazy `import.meta.glob`. Preview is transactional (`previewTheme`/`previewColorScheme` -> `commitPreview`/`cancelPreview`); actual `applyThemeCss` resolves tokens (`resolveThemeVariant + themeToCss`) and v2 tokens and writes `style#oc-theme`.

Server also serves `_opencode/themes` (fetched by `_ExternalThemeLoader` after `onMount`) for desktop-pushed themes.

## Adaptive Resources

`packages/db/src/adaptive` drives:

- `sqliteCacheMB` -> `PRAGMA cache_size=-MB*1000` and `mmap_size=MB*2*1024*1024`
- `dbQueryTimeoutMs` -> `withDbQueryTimeout` wrapper around every DB call
- `maxToolConcurrency` -> `Semaphore` used by `ToolRegistry` and `Plugin` dispatch
- `gcIntervalMs` / `rssTargetMB` / `profile` -> `main.ts` GC fiber and `profiler/core.ts` sampling

Profiles switch between `balanced` and `critical` (and potentially others) based on RSS vs target.

## Observability / Profiler

Enable profiler with env:

```bash
DIVEEOI_PROFILER=1 DIVEEOI_PROFILER_SAMPLE_RATE=0.1 bun run dev
```

Code paths call `profiler.wrap` / `measure` / `scope` / `gauge`; sampled scopes are emitted via `profiler/writer.ts` to a NDJSON stream (or the in-memory `snapshot()` aggregate). `Server.Default.app.fetch` wraps each route handler with `measureAsync` when enabled.

OpenTelemetry is gated behind `cfg.experimental.openTelemetry` and the optional `OtelTracer` service.

## Writing Config Safely

- For machine writes, call `Config.updateGlobal` (for `~/.config/opencode/*`) or `Config.update` (for instance `config.json`). Do not round-trip JSON manually — the `jsonc-parser` patch preserves comments.
- For file references, always use absolute `pathToFileURL` imports (Windows-safe) and let `ConfigPlugin.resolvePluginSpec` normalize relative `plugin` entries relative to their declaring file.

## Quick Reference (frequently used keys)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "build",
  "model": "openai/gpt-4o-mini",
  "provider": {
    "anthropic": { "apiKey": "$ANTHROPIC_API_KEY" }
  },
  "compaction": { "auto": true, "prune": true },
  "permission": {
    "*": "ask",
    "external_directory": {
      "~/projects/*": "allow"
    }
  },
  "mcp": {
    "context7": { "type": "remote", "url": "https://context7.example.com/mcp" }
  },
  "snapshot": true,
  "experimental": {
    "openTelemetry": false,
    "mcp_timeout": 30000
  }
}
```
