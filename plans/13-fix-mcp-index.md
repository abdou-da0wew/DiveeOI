# Plan 13 — Fix `packages/server/src/mcp/index.ts`

## Errors (1)

- `src/mcp/index.ts(466,22): TS2464: A computed property name must be of type 'string', 'number', 'symbol', or 'any'.`

## Context (already explored)

- Line 31: `import { resolveContextModeMCP } from "@/setup/context-mode"`
- Lines 458-467 (approx):
  ```ts
  const initialCfg = yield* cfgSvc.get()   // (pattern)
  const contextModeEntry = resolveContextModeMCP(initialCfg.builtin?.context_mode)
  if (contextModeEntry) {
    config = { [contextModeEntry.name]: contextModeEntry.config, ...config }
  }
  ```
- `src/setup/context-mode.ts` (lines 1-40, read in full): `resolveContextModeMCP` returns
  `Record<string, { type: "local"; command: string[]; enabled: boolean }> | undefined` — it has
  NO `name`/`config` properties; it's a plain record keyed by the MCP server name.

## Root cause (hypothesis to verify by reading)

The call site treats the return value as `{ name, config } | undefined`, but the function
actually returns a Record. The `.name`/`.config` access is stale. TS reports TS2464 on the
computed key because the expression's type fails the computed-key constraint.

## Prescribed fix

Read `src/mcp/index.ts` lines 455-475 AND `src/setup/context-mode.ts` fully, then make the call
site match the real API. Likely shape:

```ts
const contextModeEntry = resolveContextModeMCP(initialCfg.builtin?.context_mode)
if (contextModeEntry) {
  config = { ...contextModeEntry, ...config }
}
```
(spread the record of MCP server configs into `config` — note values are
`{ type, command, enabled }` which must match whatever shape `config` holds; if `config` values
differ, map them: `Object.fromEntries(Object.entries(contextModeEntry).map(([name, cfg]) => [name, { ...cfg }]))`).

If reading reveals the types differ (e.g. `config` needs `{ command, enabled, type }` exactly),
map accordingly. Preserve the `DIVEEOI_CONTEXT_MODE_DISABLED` / `enabled: false` semantics —
those live inside the function already, so the call-site change is purely mechanical.

## Verify

- `grep -n "contextModeEntry" src/mcp/index.ts` — the `.name`/`.config` accesses are gone.
- Do NOT run typecheck.
