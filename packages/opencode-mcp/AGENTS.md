# ocreadb

A Go MCP (Model Context Protocol) server that queries all opencode SQLite databases (`opencode*.db` in `~/.local/share/opencode/`) and merges results.

## Build

```sh
CGO_ENABLED=1 go build -ldflags="-s -w" -o ocreadb .
```

## Usage

Discovers all `opencode*.db` files in `~/.local/share/opencode/` automatically. Override dir with `OPENCODE_DATA_DIR` env var.

Tools:

- `get_current_session` — Most recent session across all DBs
- `list_sessions` — Filtered session list (merged, deduplicated)
- `show_session` — Session messages with page-based pagination (first → newest). Use `page=N` to go forward (1-based). Pagination response: `page`, `total_pages`, `has_next`, `has_prev`.
- `search` — Search across sessions and message text

The binary is registered in `~/.config/opencode/opencode.jsonc`.
