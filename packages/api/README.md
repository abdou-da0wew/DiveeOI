# @diveeoi/api

Typed v2 HTTP contract for DiveeOI. This package defines Effect `HttpApi` groups, request/response schemas, error contracts, OpenAPI metadata, and the middleware contracts shared by the app and server. It does not own the server's instance route tree, database lifecycle, or session implementation.

## Main entry points

- `src/api.ts`: root `Api = HttpApi.make("server")` definition and registered groups.
- `src/groups/*.ts`: typed group and endpoint definitions.
- `src/handlers/*.ts`: API handler implementations that are assembled by the server.
- `src/cors.ts`: origin policy used by the HTTP API.
- `src/errors.ts`: explicit schema-backed public error contracts.
- `src/middleware/schema-error.ts`: maps request/schema decode failures to structured HTTP errors.
- `src/pty-environment.ts`: PTY environment context used by selected handlers.

The production route assembly and authentication policy are server-owned. See `packages/server/src/server/routes` and [the API reference](../../docs/api.md) before changing middleware or request routing.

## Adding an endpoint

1. Define the endpoint in the appropriate `src/groups/*.ts` group with a schema for its payload/query and success/error contract.
2. Register the group in `src/api.ts` when adding a new group.
3. Implement the handler in the matching `src/handlers/*.ts` module and wire it through the server's route assembly.
4. Add request/response tests and update the OpenAPI/API docs.
5. Keep authentication, workspace scoping, and permission enforcement at the server boundary; do not assume that a typed endpoint is automatically safe to expose.

The server also has instance-owned route groups that are not part of this package's v2 `Api`. Targeted Learning is an example: its routes are defined in `packages/server/src/server/routes/instance/httpapi/groups/targeted-learning.ts` and mounted under `/targeted-learning`.

## Typecheck

```bash
bun --cwd packages/api run typecheck
```
