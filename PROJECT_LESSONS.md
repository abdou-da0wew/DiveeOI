# Project Lessons

## CORS: Tailscale / private network origins blocked

**Problem**: Browser requests from external machines (even on the same Tailscale/LAN) failed with CORS errors. The `isAllowedCorsOrigin()` function in `packages/api/src/cors.ts` only allowed `localhost` and `127.0.0.1`, which meant any browser accessing the frontend from a non-loopback address would have its API requests blocked.

The Tailscale IPs were `100.x.x.x` (CGNAT range `100.64.0.0/10`), and LAN IPs like `192.168.x.x` were also blocked.

**Fix**: Added `isPrivateOrigin()` check in `cors.ts` that allows:
- `10.x.x.x` (RFC 1918)
- `172.16-31.x.x` (RFC 1918)
- `192.168.x.x` (RFC 1918)
- `100.64-127.x.x` (CGNAT / Tailscale)

Also added `CORS` env var to the server's `main.ts` for custom origins, and documented everything in `.env.example`.

## Dev workflow: running both frontend and backend

**Setup**: Use `bun run dev:both` from the project root. It uses `concurrently` to run:
- Server with `--watch` (nodemon-like auto-reload on file changes)
- Vite dev server (HMR)

Install `concurrently` was added as a root devDependency.

## `git checkout --` glob expansion silently reverts ALL tracked files

**Problem**: Running `git checkout -- bun.lock packages/server/src/tool/shell.ts` in a shell with glob expansion caused zsh to expand the glob BEFORE git saw it. The result was `git checkout --` executing against ALL tracked files matching the glob pattern, reverting ALL source edits (ctx7, context-mode, TOON, config changes, everything).

**Root cause**: `git checkout` does NOT use `--` as a stopword for glob expansion — the SHELL expands the glob before git receives the arguments. A glob like `bun.lock packages/server/src/tool/*.ts` matches many files.

**Fix**: 
- Use explicit paths with `git checkout -- bun.lock` (single file, no glob)
- Or use `git restore bun.lock` (safer, no glob expansion risk)
- Or use `git checkout HEAD -- bun.lock` (explicit reference)
- NEVER use a glob pattern with `git checkout --`
- Prefer `git restore <file>` over `git checkout -- <file>` for reverting specific files

**Detection**: After running git checkout with a glob, run `git diff --stat` immediately. If more files changed than expected, you caught a glob expansion.

## `"latest"` version tag in package.json pollutes bun.lock

**Problem**: Using `"@upstash/context7-tools-ai-sdk": "latest"` in package.json causes `bun install` to resolve the newest version AND all its transitive dependencies. This pulled incompatible Effect v4 transitive deps that differed from the project's pinned beta.74 versions, breaking the Effect service composition chain at runtime (`InstanceRef not provided` at `instance-state.ts:16`).

**Fix**: Always pin npm dependencies to a specific semver range (e.g., `"^1.0.0"`) instead of `"latest"`. This ensures `bun.lock` stability.

**Detection**: If a new dependency causes a runtime crash in Effect service composition, suspect `bun.lock` corruption from transitive dependency conflicts. Check `grep effect bun.lock | head -20` for version mismatches.

## ocreadb MCP Server at packages/opencode-mcp

**Setup**: A Go binary at `packages/opencode-mcp/ocreadb` exposes 4 MCP tools (`get_current_session`, `list_sessions`, `show_session`, `search`) that query ALL opencode SQLite DBs (`opencode*.db` in `~/.local/share/opencode/`) and merge/deduplicate results. Results tagged with `db_name`.

**Registration**: Registered in `~/.config/opencode/opencode.jsonc` under `mcp.ocreadb`. Note: V1 config format (no `servers` wrapper).

**Rebuild**: After Go code changes: `CGO_ENABLED=1 go build -ldflags="-s -w" -o ocreadb .` in `packages/opencode-mcp/`. Restart the agent to pick up the new binary.

**DB discovery**: Auto-discovers all `opencode*.db` files in `~/.local/share/opencode/`. Override dir with `OPENCODE_DATA_DIR` env var.

**show_session pagination**: Uses simple integer page-based pagination (first → newest). Params: `page` (1-based int, default 1) and `limit` (default 20, max 100). Response: `pagination.page`, `pagination.total_pages`, `pagination.has_next`, `pagination.has_prev`. Agent just increments `page` to go forward. Over-range pages clamp to last page. Removed: base64 `cursor` encoding/decoding, `has_more`, `next_cursor`, `prev_cursor` fields.

**list_sessions pagination**: Also supports `page` (1-based) as a simpler alternative to `offset`.

**Dependencies**: Uses `github.com/mark3labs/mcp-go` for MCP server and `github.com/mattn/go-sqlite3` (CGO) for SQLite.
