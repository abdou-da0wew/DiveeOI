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

## Current DiveeComposer incident handoff (2026-11-02)

For any work involving provider authentication, model catalogues, model selection, Composer routing, or Models settings, read the repository-root `COMPOSER_INCIDENT_HANDOFF.md` before editing. It records the production regression, the current uncommitted recovery work, exact verification status, and the repair order. Preserve the strict free-only and context-fit guarantees. A display-only Composer catalogue entry must never be routed to an LLM request. Do not assume the uncommitted recovery work is built or deployed.
