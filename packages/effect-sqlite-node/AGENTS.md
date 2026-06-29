# Effect SQLite Node Package (@diveeoi/effect-sqlite-node)

Node.js bridge for Effect SQLite. Provides a `SqliteClient` service backed by `node:sqlite` (Node's built-in SQLite module, available since Node 22).

- **Single file** — `src/index.ts` contains everything: `make(options)`, `layer(config)`, `SqliteClient` service, `SqliteClientConfig` interface. Read the full file before modifying.
- **`make(options)`** creates an `SqliteClient` with: compiled statements via `Statement.makeCompilerSqlite`, connection pool via semaphore, WAL mode as default (unless `disableWAL: true`), and extension loading support.
- **`layer(config)`** wraps `make()` in an Effect layer. Provides both `SqliteClient` and `Client.SqlClient` services.
- Uses `Effect` from the catalog version (currently `4.0.0-beta.74`), imported from `effect/unstable/sql/` namespace. If `effect/unstable/sql/` APIs change between betas, this file breaks.
- **`SqliteClientConfig`** accepts: `filename`, `readonly`, `create`, `readwrite`, `disableWAL`, `timeout`, `allowExtension`, `spanAttributes`, `transformResultNames`, `transformQueryNames`.
- **Not a generic SQLite driver** — only bridges `node:sqlite` into Effect's `SqlClient` interface. Bun uses the separate `@diveeoi/effect-drizzle-sqlite` adapter stack.
- **`executeStream` is not implemented** — calls to it die with `Stream.die("executeStream not implemented")`.
