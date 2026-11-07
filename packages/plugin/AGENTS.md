# Plugin Package (@diveeoi/plugin)

Plugin SDK for building DiveeOI plugins.

- **Three export paths**: `@diveeoi/plugin` (main SDK), `@diveeoi/plugin/tool` (tool creation helpers), `@diveeoi/plugin/tui` (TUI helpers).
- **TUI exports are dead** — the TUI subsystem was removed from this fork. `src/tui.ts` and `@diveeoi/plugin/tui` exist but are unused. The `@opentui/*` peer deps are optional.
- **`Plugin` type** in `index.ts` is `(input: PluginInput, options?) => Promise<Hooks>`. A plugin receives an SDK client, project info, shell, and returns lifecycle hooks.
- **Hooks system** (`Hooks` interface): `dispose`, `event`, `config`, `tool`, `auth`, `provider`, `chat.message`, `chat.params`, `chat.headers`, `permission.ask`, `command.execute.before`, `tool.execute.before`, `shell.env`, `tool.execute.after`, and several `experimental.*` hooks.
- **`plugin/tool.ts`** exports `ToolDefinition` type and helpers. `createTool()` is the main tool factory.
- **Shell helper** (`shell.ts`): `BunShell` type for spawning processes within plugins.
- **`PluginModule` type** expects a `server: Plugin` export. Plugins are loaded by the server's plugin system.
- **Optional peer deps**: `@opentui/core`, `@opentui/keymap`, `@opentui/solid` — only needed if a plugin uses TUI features (not applicable post-TUI-removal).
- **Auth hook** (`AuthHook`) supports OAuth (`type: "oauth"`) and API key (`type: "api"`) auth methods with prompt builders.
- **Workspace adapters** (`WorkspaceAdapter`) allow plugins to register custom workspace types (local/remote).

## Key files

| File | Purpose |
|---|---|
| `src/index.ts` | Plugin types, `Plugin`, `Hooks`, `AuthHook`, `ProviderHook`, `WorkspaceAdapter` |
| `src/tool.ts` | `ToolDefinition`, `createTool()` |
| `src/shell.ts` | `BunShell` process spawner |
| `src/tui.ts` | Dead code — TUI helpers (unused post-removal) |
| `src/example.ts` | Minimal example plugin |
| `src/example-workspace.ts` | Example workspace adapter plugin |

## Current DiveeComposer incident handoff (2026-11-02)

For work involving provider authentication, model catalogues, model selection, Composer routing, or Models settings, read the repository-root `COMPOSER_INCIDENT_HANDOFF.md` for the historical incident analysis and `CONTEXT.md` / `RELEASE_HANDOFF_2026-11-06.md` for the current source/runtime and verification boundary. Preserve the strict free-only and context-fit guarantees. A display-only Composer catalogue entry must never be routed to an LLM request. Do not infer deployment provenance from the current source HEAD.
