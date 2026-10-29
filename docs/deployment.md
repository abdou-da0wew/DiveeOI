# Deployment

## Building

```bash
bun install
bun run typecheck   # tsgo per package (server/db/api wrappers use systemd-run --scope)
bun run build       # turbo:  @diveeoi/sdk -> @diveeoi/app -> @diveeoi/server
```

Outputs:

- `packages/sdk/dist/` — v2 generated client artifacts (`hey-api` output) consumed by the app.
- `packages/app/dist/` — Vite `dist/` SPA (`index.html` + assets), served by `serveUIEffect` in `packages/server/src/server/shared/ui.ts`.
- `packages/server/dist/` — Node/Bun entry (`main.ts` bundled) plus collected `app/dist` for static hosting.

Build script is `packages/script/src/build.ts` (invoked by root `bun scripts/build.ts`). Flags:

```bash
bun run build -- --no-binary   # skip binary emit (e.g. for checks)
bun run build -- --current     # current-platform only
bun run build -- --all         # all platforms/arches (SST use)
```

## Running the Server

Production invocation is the same as dev but without `--watch`:

```bash
PORT=4097 HOST=0.0.0.0 bun --cwd packages/server --conditions=browser ./src/main.ts
```

or the npm script:

```bash
bun --cwd packages/server run dev   # dev flags baked in; for prod use the raw bun command above
```

The static UI is served from whatever `serveUIEffect` was bundled against; mismatched `app/dist` will produce stale asset hashes. Always rebuild `app` before `server`.

Environment for production (minimum):

```bash
PORT=4097
HOST=0.0.0.0              # or 127.0.0.1 if behind a reverse proxy
DIVEEOI_AUTH_MODE=both    # Basic + JWT; authentication remains required
DIVEEOI_SERVER_USERNAME=DIVEEOI
DIVEEOI_SERVER_PASSWORD=replace-with-a-strong-unique-secret
DIVEEOI_JWT_SECRET=replace-with-at-least-32-random-characters
# CORS=https://trusted-frontend.example.com  # only if the UI is hosted separately
# OPENCODE_DB=           # legacy DB flag, if needed
# OPENAI_API_KEY=        # or provider keys via config file
```

Database location defaults to `Global.Path.data/opencode.db` (channel-aware: `opencode-{channel}.db` if `InstallationChannel` is not `latest|beta|prod`). Override with `OPENCODE_DB` flag.

## Self-Hosting Behind a Proxy

Put the server behind nginx/Caddy and set `HOST=127.0.0.1`, terminating TLS at the proxy. There is no built-in TLS.

Example (nginx):

```nginx
server {
  listen 443 ssl;
  server_name diveeoi.example.com;
  location / {
    proxy_pass http://127.0.0.1:4097;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
  }
}
```

Set `CORS=https://diveeoi.example.com` if the app is served separately from the API origin. Health and doc endpoints to expose are `GET /api/health` and `GET /doc`.

## Docker

The repository includes a Targeted Learning-aware [`Dockerfile`](../Dockerfile) based on Bun 1.3.14 and Debian/glibc. It persists `/data`, including the generated JWT signing key and Targeted Learning model/library state, and its healthcheck accepts an authenticated `401` as a live response. See [`targeted-learning-deployment.md`](targeted-learning-deployment.md) for build, model pre-seeding and run commands. Configure a strong Basic secret or JWT account auth; production does not default to `divee`.

## SST / CI

`sst-env.d.ts` in `packages/server` and `packages/app` exists for SST deployments (`sst` consumes `packages/server/src/main.ts` as a lambda/packed handler in that mode). The monorepo uses `turbo` task deps (`sdk -> app -> server`) that translate well to `sst` function builds; set `OPENCODE_DISABLE_CHANNEL_DB=1` in CI to force a single `opencode.db` filename.

Colab/EC2 CI note from `PROJECT_LESSONS.md`: always `git fetch origin && git checkout <branch> && git pull origin <branch>` before building a branch binary and verify version string (`0.0.0-dev-*` vs `0.0.0-main-*`). The default branch defaulted `main` silently validates the wrong code.

## Production Checklist

- [ ] `bun run typecheck` green (or at least `packages/server packages/db packages/api` clean)
- [ ] `bun run build` produced fresh `app/dist` consumed by `server/dist`
- [ ] `DIVEEOI_AUTH_MODE` is `both` or `jwt`, not `disabled`
- [ ] If Basic auth is enabled, `DIVEEOI_SERVER_PASSWORD` is a strong, unique secret; production has no default Basic password
- [ ] `DIVEEOI_JWT_SECRET` is a stable random value of at least 32 characters, or the generated key file and data directory are persisted
- [ ] Public registration is disabled unless intentionally required (`DIVEEOI_AUTH_ALLOW_REGISTRATION`)
- [ ] Reverse proxy forwards `X-Forwarded-Proto` so secure refresh cookies are emitted behind TLS termination
- [ ] `CORS` env set for any non-loopback browser origins
- [ ] `OPENCODE_DB` points to a durable path (ideally on a volume, not ephemeral storage)
- [ ] provider keys are in `opencode.jsonc` via `$VAR` references, not inline
- [ ] reverse proxy `proxy_read_timeout` >= LLM `maxOutputTokens` worst-case wall time (minutes, not seconds)
- [ ] `DIVEEOI_PROFILER` left off (or with a sampled `0.01`) — full profiling adds `AsyncLocalStorage` overhead
- [ ] DB pragma `wal` verified (`PRAGMA journal_mode=WAL` in `database.ts`); if mounted on NFS, `wal` can fail — fall back to `DELETE` at that layer
- [ ] `Session` port lease fall-forward (up to +16) is expected; firewall accordingly if `PORT` is pinned

## Updates

```bash
git pull
bun install
bun run build
# restart the server process (SIGTERM -> graceful close of HttpServer + WebSocketTracker)
```

Long-lived sessions (`SessionRunState`) will be re-resolved after restart against the on-disk `session` + `session_input` rows; in-flight LLM streams cannot survive a restart and will surface as `tool-error: Tool execution aborted` partials.

## Known Limits

- The TUI/CLI path is removed. Features gated on `RuntimeFlags.client === "cli"` (like `plan_exit`) remain in code but are not wired to a TUI host. `packages/plugin/tui` is dead code; treat `OS` shell kind differences (win32 vs posix) as the only installer-relevant sniffing.
- MCP stdio servers are spawned per-directory via `StdioClientTransport` with `BUN_BE_BUN=1` for `command: opencode`. If `Bun` is absent the transport is still `node`, but the env bit avoids a nested Bun re-exec.
