# @diveeoi/sdk

Typed HTTP client for the DiveeOI/HttpApi surface. Provides both a hand-written v1 fetch client and a generated v2 client derived from `GET /openapi.json`.

## Structure

```
src/
  client.ts           # v1 fetch wrapper
  server.ts           # v1 server helper (process spawn, error-interceptor)
  process.ts          # CLI process helpers
  error-interceptor.ts
  gen/                # generated artifacts backing v1
  v2/
    client.ts         # createClient({ baseUrl })
    server.ts         # sidecar HTTP helpers
    gen/client/       # @hey-api/openapi-ts output from /openapi.json
```

The root `package.json#exports` (for app) also re-exports `@diveeoi/app/vite` and similar; `sdk` itself is consumed by `app`, `server`, `db` (lightly), and the CLI.

## Usage

```ts
// v2 (preferred — typed over Api)
import { createClient } from "@diveeoi/sdk/v2/client"
const client = createClient({ baseUrl: "http://localhost:4097" })
const { data, error } = await client.get("/api/session", { query: { limit: 10 } })
const created = await client.post("/api/session", { body: { agent: "build" } })

// v1 (legacy)
import { Client } from "@diveeoi/sdk"
const c1 = new Client({ baseUrl: "http://localhost:4097" })
```

`v2/gen/client/` is regenerated from the live OpenAPI spec. Regenerate after adding an HttpApi group:

```bash
# from packages/sdk
bun run gen   # wraps hey-api via @hey-api/openapi-ts + download of /openapi.json
```

## Build / Test

```bash
bun --cwd packages/sdk run build
bun --cwd packages/sdk run typecheck
```

No dedicated tests; exercised through `server/test/.../httpapi-exercise` and `app` playwright.
