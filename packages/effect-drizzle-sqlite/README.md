# @diveeoi/effect-drizzle-sqlite

Generic Effect <-> Drizzle ORM bridge for SQLite. Intentionally provider-agnostic — no `opencode` tables, paths, or migrations in this package. Upstream target is `drizzle-orm/effect-sqlite`.

## What it does

Adapts generic `SqlClient` implementations (`@effect/sql-*` family, `bun:sqlite` via shim) to Drizzle's SQLite `Session` / `Transaction` / `PreparedQuery` so Drizzle query builders are usable as `Effect` programs:

- `src/effect-sqlite/driver.ts` — `make(client) ->EffectDrizzleSqlite` and `makeWithDefaults()` that reads the ambient `SqlClient` service.
- `src/effect-sqlite/session.ts` — `EffectSQLiteSession<TRelations>` bridging `client.unsafe(sql, params)` to `SqlClient.Statement.{withoutTransform,values,first}` semantics; nested savepoint support (`savepoint effect_sql_N`) with `uninterruptibleMask` and deferred-constraint `commit -> rollback-on-failure`.
- `src/sqlite-core/effect/*` — effect-yieldable builders (`select/insert/update/delete`) that return `Effect<A, SqlError|EffectDrizzleQueryError>` rather than promises.
- `src/internal/drizzle-utils.ts` — local shim for RC2 internals importable after `drizzle-orm@1.0.0-rc.2` hides them from declaration.

## Usage

```ts
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { EffectDrizzleSqlite } from "@diveeoi/effect-drizzle-sqlite"
import { drizzle } from "drizzle-orm/effect/bun" // or the SqlClient you have

const db = EffectDrizzleSqlite.makeWithDefaults().pipe(
  // actual client is provided via Layer, not via import
)
yield* EffectDrizzleSqlite.withClient(sqliteClient, (db) =>
  db.select().from(t)
)
```

In DiveeOI:

```ts
import { EffectDrizzleSqlite } from "@diveeoi/effect-drizzle-sqlite"
const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
const layer = Layer.effect(Database.Service, Effect.gen(function*(){
  const db = yield* makeDatabase
  yield* db.run("PRAGMA journal_mode = WAL")
  // ...
}))
```

## Testing / Example

```bash
bun --cwd packages/effect-drizzle-sqlite run typecheck
bun --cwd packages/effect-drizzle-sqlite run test
# examples/basic.ts hits Bun's sqlite driver directly
```

## Import note

Do not import a concrete driver (`@effect/sql-sqlite-bun`) here unless a package-scoped helper explicitly requires it. Production bindings belong in the consumer (`packages/db`) and tests.
