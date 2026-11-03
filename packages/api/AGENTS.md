# API Package (@diveeoi/api)

Effect HttpApi definitions and handlers. Defines ~18 API groups with endpoints, middleware, and error types.

- **`createRoutes(password?)`** in `routes.ts` is the single route assembly entrypoint. It composes `HttpApiBuilder.layer(Api)` with all handler layers, auth, CORS, schema-error middleware, database, event bus, and fetch-HTTP client via `Layer.provide` chains.
- The `password` parameter controls auth: `undefined` → `ServerAuth.Config.defaultLayer` (auth disabled), string → password-guarded layer.
- **`webHandler()`** wraps the routes in `HttpRouter.toWebHandler(..., { disableLogger: true })`. Read it when you need to serve the API.
- **18 API groups** in `groups/` and matching handlers in `handlers/`. Each group follows the `HttpApiBuilder.group(Api, "name", (handlers) => ...)` pattern. If you add an endpoint, add it to both the group definition and the handler.
- **Middleware stack** (order matters): `authorizationLayer` (auth guard) → `schemaErrorLayer` (decode errors) → PTY environment → auth config.
- **Auth config** (`ServerAuth.Config.layer`) is the auth policy; `authorizationLayer` enforces it per-request. Auth is simply password-gated (no OAuth, no API keys).
- **`api.ts`** defines the `Api` — `HttpApi.make("server")` with all groups registered. Add new groups here.
- **`errors.ts`** defines API error schemas (`ApiNotFoundError`, etc.). Prefer explicit `Schema.ErrorClass` contracts over raw `HttpApiError.*` classes.
- **`cors.ts`** — CORS config passed to `HttpApiBuilder`.
- **`middleware/schema-error.ts`** — maps Schema decode failures to HTTP 422 with structured error bodies.
- **`pty-environment.ts`** — provides PTY environment context needed by some API groups.
- The API package depends on `@diveeoi/db` for `Database`, `EventV2`, and domain types. It does NOT depend on `@diveeoi/server`.

## Current DiveeComposer incident handoff (2026-11-02)

For any work involving provider authentication, model catalogues, model selection, Composer routing, or Models settings, read the repository-root `COMPOSER_INCIDENT_HANDOFF.md` before editing. It records the production regression, the current uncommitted recovery work, exact verification status, and the repair order. Preserve the strict free-only and context-fit guarantees. A display-only Composer catalogue entry must never be routed to an LLM request. Do not assume the uncommitted recovery work is built or deployed.
