# @diveeoi/plugin

Plugin SDK for extending DiveeOI's tools, providers, and lifecycle hooks. Plugins are discovered from file-system `{tool,tools}/*.{js,ts}` directories under each project or via `Config.plugin` entries.

## Shape

A plugin module may export named tools:

```ts
// .opencode/tools/review.ts
export const review = {
  description: "Review a PR",
  args: { pr: z.string().describe("PR number") },
  async execute(args, ctx) {
    // ctx: { sessionID, callID, agent, abort signal, ask(req)->Promise, directory, worktree }
    return { output: "done", title: "Reviewed", metadata: {} }
  }
} satisfies ToolDefinition
export default review // also supported for {namespace}_default interop
```

`ctx.ask` is an Effect-bridged `(req)=>Promise` via `EffectBridge` so the tool's `await ask` correctly pins to the server's per-directory Effect context. Environment derivation for `shell.env` plus `PluginToolContext.directory/worktree` are injected before `execute`.

`packages/server/src/tool/registry.ts:fromPlugin` converts `ToolDefinition.args` (Zod shapes) -> `Tool.Def` via `z.toJSONSchema` (with metadata registry covering `description` vs `.meta()`) for the LLM, while wrapping execution inside a `toolSemaphore` permit with `truncate.output` post-processing.

## Exports

```ts
import "@diveeoi/plugin"        // main SDK (trigger/hook surface)
import "@diveeoi/plugin/tool"   // ToolDefinition, ToolContext typing
import "@diveeoi/plugin/tui"    // dead code — exists but not mounted (TUI removed)
import "@diveeoi/plugin/shell"  // shell helper for plugin authors
```

`@diveeoi/plugin/tui` requires peer `OpenTUI`; the actual TUI host was removed in DiveeOI so tui plugin exports will typecheck but never run.

## Hooks

Plugins receive `plugin.trigger(hook, meta, payload)` where `hook` is a namespaced string:

- `experimental.text.complete` (in `SessionProcessor:text-end` — transform the assistant text after the model completes it)
- `experimental.chat.system.transform` / `chat.params` / `chat.headers` (in `LLMRequestPrep` / `ConfigProvider` flows)
- `tool.definition` (per tool id) in `Handle.process` where `jsonSchema` and `parameters` may be rewritten
- `tool.execute.before|after` around each `TaskTool` subtask
- `shell.env` (`shell` tool)
- `chat.message`, `command.execute.before`, `storage`-layer hooks (see `packages/server/src/plugin/meta.ts` for the full list)

## Adding a plugin

1. Add to `opencode.jsonc`:
   ```jsonc
   { "plugin": ["./my-plugin.ts", "@org/my-pack"] }
   ```
   Relative paths are normalized at config load relative to the file that declared them.

2. Or drop a JS/TS tool file under `<project>/.opencode/tool/` or `.../tools/` — `registry.ts` `Glob.scanSync` picks it up without config.

## Test

```bash
bun --cwd packages/plugin run typecheck
```

No runtime tests — exercised via `server`'s `ToolRegistry` and `InstanceState` suites.
