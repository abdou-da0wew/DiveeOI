# @diveeoi/effect-sqlite-node

Node-only `SqlClient` implementation for Effect SQL (the peer to `@effect/sql-sqlite-bun`). Lets packages that must run under Node (>=22) use the same Drizzle bridge as Bun consumers without branching on `#sqlite` outside `packages/db`.

## What it provides

A `SqlClient`-compatible `Layer` and `execute/prepared-query` surface backed by `better-sqlite3`-style binding (via Node `node:sqlite` in newer Node or the `better-sqlite3` fallback). Concrete `database` construction lives in `packages/db/src/database/sqlite.node.ts -> node(memoMap)`, which consumes this bridge so `DatabaseService.layer` is swappable by runtime.

In DiveeOI the typical seam is:

```ts
// packages/db/src/database/sqlite.node.ts
import { SqlClient } from "@diveeoi/effect-sqlite-node"
export const node = (memoMap, fileName) =>
  SqlClient.make({ filename: fileName, url: `file:${fileName}` })
```

vs the Bun counterpart:

```ts
// packages/db/src/database/sqlite.bun.ts
import { SqlClient } from "@effect/sql-sqlite-bun"
```

The two are stitched together via `package.json#imports` `#sqlite: { bun -> sqlite.bun.ts, node -> sqlite.node.ts }` so a single `import { Database } from "@diveeoi/db/database/database"` is ambient to the package — callers never choose.

## Intended audience

Only `packages/db` and `packages/effect-drizzle-sqlite`. Do not depend on this package from `app`, `ui`, `api`, `llm`, `sdk`, `plugin` or `memory`.

## Scripts

```bash
bun --cwd packages/effect-sqlite-node run typecheck
bun --cwd packages/effect-sqlite-node run test
```

No Bun-specific patches; keep the public surface compatible with `@effect/sql-sqlite-bun`'s `make`/`layer` so switchovers stay mechanical.
