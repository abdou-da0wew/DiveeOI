# @diveeoi/api

Effect `HttpApi` surface that both the app and the server include. Owns the typed endpoint definitions, auth, CORS, schema-error, and PTY environment — but no storage or LLM code (it imports `Database`, `EventV2` from `@diveeoi/db`).

## Shape

`src/api.ts`:

```ts
Api = HttpApi.make("server")
  .add(HealthGroup).add(LocationGroup).add(AgentGroup).add(SessionGroup)
  .add(MessageGroup).add(ModelGroup).add(ProviderGroup).add(IntegrationGroup)
  .add(CredentialGroup).add(PermissionGroup).add(FileSystemGroup).add(CommandGroup)
  .add(SkillGroup).add(EventGroup).add(PtyGroup).add(QuestionGroup)
  .add(ReferenceGroup).add(ProjectCopyGroup).add(PrefsGroup).add(AuthGroup)
  .annotateMerge(OpenApi { title: "opencode HttpApi", version: "0.0.1" })
  .middleware(Authorization).middleware(SchemaErrorMiddleware)
```

Each group in `src/groups/*.ts` is `HttpApiGroup.make("server.xxx")` with `HttpApiEndpoint.{get,post}` typed by `Schema`. Each handler in `src/handlers/*.ts` is `HttpApiBuilder.group(Api, "xxx", (handlers) => Effect.gen(function*(){ const svc=yield* X; return handlers.handle("op", ...) }))`.

## Notable groups

- `session` — `GET /api/session (SessionsQuery -> {data: SessionV2.Info[], cursor:{previous?,next?}})`, `POST /api/session`, `GET /api/session/:sessionID [SessionLocationMiddleware]`, `POST .../prompt -> SessionInput.Admitted`, `POST .../compact/wait`, `GET .../context -> SessionMessage.Message[]`. Cursor is `SessionsCursor` — an `opaque base64url` of a JSON union `withCursor(SessionsDirectory|Project|AllQuery)`. See `src/groups/session.ts:215 lines`.
- `prefs` — `GET/PUT /api/prefs/:scope` for settings sync (settings globally, permissions per server-scope).
- `pty` — `PtyConnectApi` is served via `handleRaw` for WebSocket upgrade (`packages/server/.../handlers/pty.ts`).

## Plumbing

- `src/routes.ts:createRoutes(password?)` — `HttpApiBuilder.layer(Api,{openapiPath:"/openapi.json"})` with `handlers, PtyEnvironment, authorizationLayer, schemaErrorLayer, ServerAuth.Config.layer, LocationServiceMap, Database, EventV2, JwtAuth, FetchHttpClient`. The v2 webHandler is `HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices, MailService.defaultLayer)), {disableLogger:true})`.
- `src/cors.ts` (54 lines) — the allowlist (localhost, oc://renderer, tauri, `*.opencode.ai`, RFC1918 + CGNAT 100.64/10, explicit `CORS` entries) via `isAllowedCorsOrigin/isAllowedRequestOrigin`.
- `src/middleware/authorization.ts` (22/44) — the `ServerAuth.Config` -> `Authorization` -> per-endpoint enforcement split; the per-route variant is `authorizationRouterMiddleware` for raw router branches.
- `src/middleware/schema-error.ts` — maps `Schema.decode` faults to `422` with structured bodies.
- `src/pty-environment.ts` — `Context.Service` that adapters (e.g. `FileSystemGroup`) `yield*` for the current PTY env.

## Error contracts

Defined in `src/errors.ts` as explicit `Schema.ErrorClass` types (`ApiNotFoundError` etc.). The server translators map domain/Storage errors at the handler boundary; the domain layers themselves stay `HttpApi`-free. Prefer a declared error with `message` over empty `HttpApiError.*`.

## Adding an endpoint

1. Add to the `Group` (`src/groups/<name>.ts`). If it is per-directory, annotate the endpoint with `.middleware(SessionLocationMiddleware)` so `workspaceRoutingLive + instanceContextLayer` can resolve the `Location`.
2. Implement the handler (`src/handlers/<name>.ts`) via `HttpApiBuilder.group`.
3. Import `Group` in `src/api.ts` (`Api.add(Group)`) and the handler module in `src/handlers.ts`.
4. Provide the backing service in the relevant `Layer.provide` chain — `createRoutes` for v2, `createRoutes` in `packages/server/.../server.ts` for instance routes.

## Run

```bash
bun --cwd packages/api run typecheck   # systemd-run wrapper
# no direct tests — exercised via server httpapi-exercise
```

See also `packages/server/src/server/routes/instance/httpapi/AGENTS.md` for route style and middleware layering guidance.
