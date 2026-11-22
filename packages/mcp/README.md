# packages/mcp — Go MCP servers (source only)

This directory is **not** an npm workspace package (no `package.json` by design) and is not wired into
`packages/server` or any other product code (zero references verified 2026-11-22, sprint TODO §8).
It holds two standalone, read-only `opencode.db` reader tools written in Go:

- `built-in/opencode-db-reader/` — SQLite reader MCP server (`main.go` + `go.mod`/`go.sum`).
- `built-in/diveeoi-mcp/` — second reader MCP server variant (`main.go`, see its `AGENTS.md`).

## Binaries are not committed

`opencode-db-reader` historically shipped prebuilt artifacts in git: `ocred` (~7.7 MB ELF Go binary)
and `ocread` (small Python helper script). Both were removed (sprint TODO §8); the Go sources are kept
so the tools can be rebuilt locally. The root `.gitignore` ignores the built names so rebuilt binaries
cannot be re-committed accidentally.

Rebuild locally (requires a Go toolchain):

```sh
cd packages/mcp/built-in/opencode-db-reader
go build -o ocred .
```

`diveeoi-mcp` has its own local `.gitignore` covering its build outputs (`ocreadb`, `opencode-mcp`).
