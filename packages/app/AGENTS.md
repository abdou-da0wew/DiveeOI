## Priorities

- Prioritise, in this order: stability, simplicity, performance.
- Before changing session or timeline code, record a production benchmark baseline and compare it after the change.

## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- Run the backend and app dev servers separately.
- Backend (from `packages/server`): `bun run packages/server/src/main.ts` (default port 4097, set via `PORT` env var)
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## Browser Automation

Use `agent-browser` for web automation. Read the installed `core` skill before browser work and the `dogfood` skill for exploratory QA. Run `agent-browser --help` for all commands.

Manual browser testing is required for user-visible UI changes after fixes; automated tests alone do not complete UI verification. Use a named session, interact with the actual UI, verify persistence and error states, capture screenshots, and record the result in `WORKLOG.md` or `docs/qa/`. For settings and credential flows, use a local test server with isolated XDG data/config directories, never the live instance or real provider credentials.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 \"text\"` - Interact using refs
4. Re-snapshot after page changes

## Current DiveeComposer incident handoff (2026-11-02)

For any work involving provider authentication, model catalogues, model selection, Composer routing, or Models settings, read the repository-root `COMPOSER_INCIDENT_HANDOFF.md` before editing. It records the production regression, the current uncommitted recovery work, exact verification status, and the repair order. Preserve the strict free-only and context-fit guarantees. A display-only Composer catalogue entry must never be routed to an LLM request. Do not assume the uncommitted recovery work is built or deployed.
