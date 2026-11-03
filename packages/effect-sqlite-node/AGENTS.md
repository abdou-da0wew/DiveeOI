# Effect SQLite Node Package (@diveeoi/effect-sqlite-node)

Node.js bridge for Effect SQLite. Provides a `SqliteClient` service backed by `node:sqlite` (Node's built-in SQLite module, available since Node 22).

- **Single file** — `src/index.ts` contains everything: `make(options)`, `layer(config)`, `SqliteClient` service, `SqliteClientConfig` interface. Read the full file before modifying.
- **`make(options)`** creates an `SqliteClient` with: compiled statements via `Statement.makeCompilerSqlite`, connection pool via semaphore, WAL mode as default (unless `disableWAL: true`), and extension loading support.
- **`layer(config)`** wraps `make()` in an Effect layer. Provides both `SqliteClient` and `Client.SqlClient` services.
- Uses `Effect` from the catalog version (currently `4.0.0-beta.74`), imported from `effect/unstable/sql/` namespace. If `effect/unstable/sql/` APIs change between betas, this file breaks.
- **`SqliteClientConfig`** accepts: `filename`, `readonly`, `create`, `readwrite`, `disableWAL`, `timeout`, `allowExtension`, `spanAttributes`, `transformResultNames`, `transformQueryNames`.
- **Not a generic SQLite driver** — only bridges `node:sqlite` into Effect's `SqlClient` interface. Bun uses the separate `@diveeoi/effect-drizzle-sqlite` adapter stack.
- **`executeStream` is not implemented** — calls to it die with `Stream.die("executeStream not implemented")`.

## Current DiveeComposer incident handoff (2026-11-02)

For any work involving provider authentication, model catalogues, model selection, Composer routing, or Models settings, read the repository-root `COMPOSER_INCIDENT_HANDOFF.md` before editing. It records the production regression, the current uncommitted recovery work, exact verification status, and the repair order. Preserve the strict free-only and context-fit guarantees. A display-only Composer catalogue entry must never be routed to an LLM request. Do not assume the uncommitted recovery work is built or deployed.
