# SDK Package (@diveeoi/sdk)

API client SDK — TypeScript client for the DiveeOI HTTP API.

- **Two API versions**: V1 (`client.ts`, `server.ts`) is a lightweight fetch wrapper; V2 (`v2/`) is generated from the OpenAPI spec via `@hey-api/openapi-ts`. V2 is the preferred path for new integrations.
- **`createOpencode(options?)`** in `index.ts` creates both a server and client from scratch — useful for embedded/child-process scenarios.
- **Build pipeline**: `bun ./script/build.ts` runs `@hey-api/openapi-ts` to regenerate V2 client code from the OpenAPI spec. The generated output lives in `src/v2/gen/client/`.
- **V2 client** has typed methods for all API endpoints: accounts, agents, auth, sessions, config, filesystem, git, MCP, models, permissions, plugins, skills, snapshots, tools, workspaces.
- **`process.ts`** exports cross-platform process-spawn utilities used by the SDK.
- **`error-interceptor.ts`** provides centralized error interception for API calls.
- The SDK is a devDependency-free build artifact (only `cross-spawn` at runtime). It has no Effect or server dependencies.
- V2 client entry: `@diveeoi/sdk/v2/client`, V2 server entry: `@diveeoi/sdk/v2/server`.

## Current DiveeComposer incident handoff (2026-11-02)

For work involving provider authentication, model catalogues, model selection, Composer routing, or Models settings, read the repository-root `COMPOSER_INCIDENT_HANDOFF.md` for the historical incident analysis and `CONTEXT.md` / `RELEASE_HANDOFF_2026-11-06.md` for the current source/runtime and verification boundary. Preserve the strict free-only and context-fit guarantees. A display-only Composer catalogue entry must never be routed to an LLM request. Do not infer deployment provenance from the current source HEAD.
