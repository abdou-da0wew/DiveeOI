# Plan 15 — Fix `packages/server/src/session/session.ts` (5 errors)

## Errors

- `381,17` TS2552: `Cannot find name 'Global'. Did you mean 'global'?`
- `385,42` TS2833: `Cannot find namespace 'Provider'. Did you mean 'ProviderV2'?`
- `431,17` TS7006: Parameter `item` implicitly has an 'any' type.
- `432,14` + `432,17` TS7006: Parameters `a`, `b` implicitly have 'any' types.

## Context (already explored)

- Line 381: `path.join(Global.Path.data, "plans")` inside `plan(...)`.
- Line 385: `export const getUsage = (input: { model: Provider.Model; usage: Usage; metadata?: ProviderMetadata }) => {...}`
- Lines 431-432: inside `getUsage`, `input.model.cost?.tiers?.filter((item) => ...).sort((a, b) => ...)`
  — the implicit-any params are a CASCADE: because `Provider` is unresolved, `input.model` is
  untyped, so `item`/`a`/`b` are implicit any.

## Root cause

Two missing imports in this file: `Global` (used for `Global.Path.data`) and `Provider`
(used at line 385 only). Both are used elsewhere in the codebase with working imports:
- `snapshot/index.ts:79` and `config/config.ts:141,252,267,268` use `Global.Path.*` — find
  where they import `Global` from (grep `import` lines containing `Global` in those files,
  or `export.*Global` / `namespace Global` in `src/` — it is likely a local module like
  `@/global` or a db util). Add the SAME import to session.ts.
- `session/llm.ts:4` does `import { Provider } from "@/provider/provider"` — session.ts needs
  the same import (`Provider.Model` must come from there, matching the repo's server-side
  provider service).

## Prescribed fix

1. Grep to find the `Global` import source (check `src/snapshot/index.ts` and
   `src/config/config.ts` imports) and add the identical import statement to session.ts.
2. Add `import { Provider } from "@/provider/provider"` to session.ts (match llm.ts:4).
3. Confirm `Usage` and `ProviderMetadata` are already imported (they may come from `ai`) —
   if the file already compiles those (no errors reported for them), leave as-is.
4. The 431/432 implicit-any params should resolve automatically once `Provider` is imported.
   If they still fail, annotate them explicitly: `filter((item: { tier: { type: string; size: number } }) => ...)`
   and `sort((a: {...}, b: {...}) => ...)` using the `cost.tiers` shape — but only if needed.

## Verify

- `grep -n "Global" src/session/session.ts` — Global usage now has an import.
- `grep -n 'Provider' src/session/session.ts` — imported + used at 385.
- Do NOT run typecheck.
