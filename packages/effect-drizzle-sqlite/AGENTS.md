# Effect Drizzle SQLite

This package vendors a Drizzle Effect SQLite adapter for this repo.

- Keep this package generic: Drizzle + Effect + SQLite only.
- Do not add opencode-specific tables, paths, migrations, post-commit hooks, or domain storage APIs here.
- Runtime code should depend on generic `effect/unstable/sql/SqlClient`, not a specific SQLite driver.
- Concrete SQLite clients such as `@effect/sql-sqlite-bun` belong in tests or examples unless this package intentionally adds a driver-specific helper.
- Preserve Drizzle adapter naming and behavior where possible so this can be replaced by upstream `drizzle-orm/effect-sqlite` later.
- If touching copied Drizzle internals, compare with current `drizzle-orm@1.0.0-rc.2` declarations and runtime JS.
- If touching Effect APIs, verify against `effect` package's actual type declarations in `node_modules/effect`.

Useful entry points:

- `src/effect-sqlite/driver.ts`: creates the Effect-backed Drizzle database with `make` and `makeWithDefaults`.
- `src/effect-sqlite/session.ts`: adapts generic Effect `SqlClient` execution and transactions to Drizzle SQLite sessions.
- `src/sqlite-core/effect/*`: Effect-yieldable SQLite query builders.
- `src/internal/drizzle-utils.ts`: local typed shims for Drizzle runtime internals that RC2 does not expose in declarations.
- `examples/basic.ts`: minimal usage example with Bun SQLite.

## Current DiveeComposer incident handoff (2026-11-02)

For any work involving provider authentication, model catalogues, model selection, Composer routing, or Models settings, read the repository-root `COMPOSER_INCIDENT_HANDOFF.md` before editing. It records the production regression, the current uncommitted recovery work, exact verification status, and the repair order. Preserve the strict free-only and context-fit guarantees. A display-only Composer catalogue entry must never be routed to an LLM request. Do not assume the uncommitted recovery work is built or deployed.
