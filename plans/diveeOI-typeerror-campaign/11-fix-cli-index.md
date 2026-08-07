# Plan 11 — Fix `packages/server/src/cli/index.ts`

## Errors (1)

- `src/cli/index.ts(1,10): TS2305: Module '"bun"' has no exported member 'Database'.`

## Root cause

Effect beta.74-era bump of bun-types to 1.3.13 removed the `Database` export from the `"bun"`
module namespace. Verified: `node_modules/.bun/bun-types@1.3.13/node_modules/bun-types/sqlite.d.ts`
line 7 documents `import { Database } from 'bun:sqlite'` and line 117 declares
`export class Database implements Disposable`.

## Prescribed fix

Line 1 of `src/cli/index.ts`:
```ts
import { Database } from "bun:sqlite"
```

## Verify

- Confirm no other `from "bun"` imports exist in this file (`grep -n 'from "bun"' src/cli/index.ts`).
- If other bun globals are imported from `"bun"` (e.g. `Bun`), keep that import intact — only move
  `Database`.
- Do NOT run typecheck.
