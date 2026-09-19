# API Reference

Base URL: `http://HOST:PORT` from `main.ts` (default `http://0.0.0.0:4097`). All routes are `HttpApi`-typed via Effect; non-API paths are served as SPA from `serveUIEffect`.

## Overview

Two surfaces are served from one `HttpRouter`:

- **Instance routes** (`InstanceHttpApi`, `RootHttpApi`, `EventApi`, `PtyConnectApi`) — mounted from `packages/server/src/server/routes/instance/httpapi/server.ts`, auth via `authorizationLayer` / `authorizationRouterMiddleware`, workspace routing via `workspaceRoutingLive + instanceContextLayer`.
- **v2 API** (`Api` from `packages/api/src/api.ts`) — mounted in the same router as typed `HttpApiBuilder.layer(Api)`, auth via `serverAuthorizationLayer` + `JwtAuth`.

Both expose `GET /openapi.json` (via `openapiPath: "/openapi.json"`). `GET /doc` serves a cached `jsonUnsafe(OpenApi.fromApi(PublicApi))` response (auth-gated).

## Auth

Configured via `ServerAuth.Config.defaultLayer` (disabled) or `ServerAuth.Config.layer({ username: "opencode", password: Option.some(password) })` when `createRoutes(password)` receives a password. Middleware is `Authorization` / `SchemaErrorMiddleware`.

In the browser, credentials flow as:

```
?auth_token=<base64(username:password)> -> authFromToken -> ServerConnection.Http.authToken = true
VITE_DIVEEOI_SERVER_USERNAME/PASSWORD  -> same
```

`CORS` is evaluated before auth (`packages/api/src/cors.ts`). Health and static assets may bypass auth depending on the route layer.

## CORS

`CorsOptions = { cors?: string[] }` provided as `Context.Reference<CorsConfig>`.

Allowed origins:

- `http://localhost:*`, `http://127.0.0.1:*`, `oc://renderer`, `tauri://localhost` variants, `https://*.opencode.ai`, private networks `10/8`, `172.16/12`, `192.168/16`, CGNAT `100.64/10`, or explicit `opts.cors` entries. `sameHost(origin,host)` also allows same-host requests (`isAllowedRequestOrigin`).

Pass extra origins via env `CORS=a,b,...` (split in `main.ts`).

## Groups

### `packages/api/src/api.ts` — `Api = HttpApi.make("server")`

| Group | Prefix | Notes |
|-------|--------|-------|
| `health` | `/api/health` | `GET` — health check |
| `location` | `/api/location` | per-directory location listing |
| `agent` | `/api/agent` | list/get/generate agent |
| `session` | `/api/session` | CRUD, prompt, compact, wait, context (see below) |
| `message` | `/api/message` | message + parts, streaming SSE with `HttpApiSchema.asText` content-type |
| `model` | `/api/model` | list models, default model |
| `provider` | `/api/provider` | provider status, auth |
| `integration` | `/api/integration` | installed integrations |
| `credential` | `/api/credential` | credential CRUD |
| `permission` | `/api/permission` | `list`, `reply` (`once/always/reject`) |
| `fs` (`FileSystemGroup`) | `/api/fs` | file system ops (read stat list etc., PTY-aware env) |
| `command` | `/api/command` | list, execute named command template |
| `skill` | `/api/skill` | list/get skill, dirs |
| `event` | `/api/event` | SSE event stream (`HttpApiBuilder.group` with `handle` -> `HttpServerResponse.stream`) |
| `pty` | `/api/pty` | PTY connect (WebSocket upgrade via `handleRaw`) |
| `question` | `/api/question` | question ask/reply |
| `reference` | `/api/reference` | reference list |
| `project-copy` | `/api/project-copy` | project copy operations |
| `prefs` | `/api/prefs` | `GET/PUT /api/prefs/:scope` for settings sync (see `packages/app/src/components/global-pref-sync.tsx`) |
| `auth` | `/api/auth` | account-level auth helpers |

Each group is defined in `packages/api/src/groups/*.ts` as `HttpApiGroup.make("server.xxx")` via `HttpApiEndpoint.{get,post}` with `Schema` request/response and `OpenApi.annotations({ identifier: "v2.xxx" })`. Public errors are explicit `Schema.ErrorClass` contracts (`ApiNotFoundError` etc.) rather than raw `HttpApiError.*`.

### `InstanceHttpApi` / `RootHttpApi` (server-owned)

Examples (representative, not exhaustive — see `packages/server/src/server/routes/instance/httpapi/groups/*.ts`):

- `GET /api/config` — global + instance merged config
- `POST /api/session/:id/prompt` — prompt one user input (see `Session` / `Message` v2)
- `POST /api/session/:id/cancel` — `SessionPrompt.cancel`
- `GET /api/event` — SSE stream of `EventV2` types (`session.*`, `mcp.*`, `permission.*`, `tool.*`)
- `POST /api/workspace/:id/select` — workspace routing

## Sessions

Cursor type: `SessionsCursor = String(brand)` base64url of `Schema.fromJsonString(SessionsCursorInput)` where `SessionsCursorInput` is a union of `withCursor(SessionsDirectoryQuery | SessionsProjectQuery | SessionsAllQuery)`. Created as `SessionsCursor.make({ directory, limit, ... })`, parsed as `SessionsCursor.parse(string)` (async effect).

Endpoints (from `packages/api/src/groups/session.ts`):

```
GET  /api/session?directory=&project=&subpath=&workspace=&limit=&order=&search=&cursor=
  -> { data: SessionV2.Info[], cursor: { previous?, next? } }

POST /api/session
  body: { id?, agent?, model?: ModelV2.Ref, location?: Location.Ref }
  -> { data: SessionV2.Info }

GET  /api/session/:sessionID                          [SessionLocationMiddleware]
POST /api/session/:sessionID/prompt                   [SessionLocationMiddleware]
  body: { id?, prompt: Prompt, delivery?, resume? } -> { data: SessionInput.Admitted }
POST /api/session/:sessionID/compact                  [SessionLocationMiddleware]
POST /api/session/:sessionID/wait                     [SessionLocationMiddleware]
GET  /api/session/:sessionID/context                  [SessionLocationMiddleware]
  -> { data: SessionMessage.Message[] }  (post-compaction active context)
```

`Prompt` shape (`packages/db/src/session/prompt.ts`): `text | agents[] | files[{uri,mime,name}]`. Files may be `file://`, `data:`, or MCP `resource://` (resolved by `SessionPrompt.resolvePromptParts` via `mcp.readResource`).

`SessionPrompt.prompt` input (`PromptInput`): `{ sessionID, messageID?, model?, agent?, noReply?, tools?: Record<string,bool>, format?: SessionV1.Format, system?, variant?, parts: (TextPartInput|FilePartInput|AgentPartInput|SubtaskPartInput)[] }`.

### Streaming

Message streaming is via `SessionProcessor` SSE, surfaced as `text/event-stream` endpoints annotated with `HttpApiSchema.asText({ contentType: "text/event-stream" })` and returned via `HttpServerResponse.stream(...)` inside `HttpApiBuilder.group` (do not use `HttpRouter.provideRequest` for this).

## SDK

`packages/sdk` exports both versions:

- v1 hand-written client: `import { Client } from "@diveeoi/sdk"` — fetch wrapper.
- v2 generated client: `import { createClient } from "@diveeoi/sdk/v2/client"` — generated from the OpenAPI spec via `@hey-api/openapi-ts`. Always prefer v2 for typed covers of the `Api` surface. The `packages/sdk/v2/gen/client/` dir is regenerated from `GET /openapi.json`.

Example (v2):

```ts
import { createClient } from "@diveeoi/sdk/v2/client"
const client = createClient({ baseUrl: "http://localhost:4097" })
const { data } = await client.get("/api/session", { query: { limit: 10 } })
```

Server-side SDK helpers: `packages/sdk/src/server.ts` and `packages/sdk/src/v2/server.ts`.

## Adding an Endpoint

1. Define it in `packages/api/src/groups/<name>.ts` (`HttpApiEndpoint.*().annotateMerge(OpenApi.annotations({ identifier: "v2.xxx", summary, description }))`).
2. Implement its handler in `packages/api/src/handlers/<name>.ts` via `HttpApiBuilder.group(Api, "<name>", (handlers) => Effect.gen(function* () { const svc = yield* SomeService; return handlers.handle("op", ... ) }))`.
3. Register the group in `packages/api/src/api.ts:Api.add(Group)` and the handler in `packages/api/src/handlers.ts:handlers`.
4. For server-owned instance routes, add to `InstanceHttpApi` groups and `packages/server/src/server/routes/instance/httpapi/handlers/*`, then wire the handler in `server.ts:instanceApiRoutes`.

Add the `SessionLocationMiddleware` (or similar) at the endpoint declaration, provide its layer at assembly (`Layer.provide(httpApiAuthLayer, workspaceRoutingLive, instanceContextLayer, schemaErrorLayer)`), and never `Effect.provide(SomeLayer)` inside a request handler.
