# API Package (@diveeoi/api)

Effect `HttpApi` contracts for the v2 API. This package owns typed group/endpoint definitions, schemas, error contracts, OpenAPI annotations, and API-side middleware contracts. It does not own the production server bootstrap, instance-specific route groups, storage lifecycle, or LLM/session implementation.

## Entry points

- `src/api.ts`: registers the v2 `Api` groups.
- `src/groups/`: request/response endpoint schemas.
- `src/handlers/`: typed handler implementations consumed by server route assembly.
- `src/cors.ts`, `src/middleware/schema-error.ts`, `src/errors.ts`: cross-cutting HTTP contracts.

Authentication policy and route assembly are server-owned. Read `packages/server/src/server/routes` and `docs/security-auth.md` before changing auth or middleware behavior. Targeted Learning is an instance-owned API group under `packages/server/src/server/routes/instance/httpapi/groups/targeted-learning.ts`, not a group in this package's v2 API.

## Rules

- Define request/response payloads with Effect Schema; prefer explicit public error schemas over leaking internal exceptions.
- Register new v2 groups in `src/api.ts` and wire the corresponding handler through the server.
- Preserve workspace, session, and permission boundaries. Typed schemas do not replace authorization.
- Keep OpenAPI identifiers stable and unique; SDK generation depends on the public schema surface.
- Do not add storage or provider implementation logic here; place it in the owning package.

## Validation

```bash
bun --cwd packages/api run typecheck
```
