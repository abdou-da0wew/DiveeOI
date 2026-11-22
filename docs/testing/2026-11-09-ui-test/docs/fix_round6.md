# fix_round6 — UI bug round re-verified against HEAD (2026-11-22)

Re-verification of the 2026-11-09 manual-test UI findings against current HEAD, with code-level
root causes and fixes. Companion to `DiveeOI_ManualTest_Report_2026-11-09.md` + `fix_round2–5.md`
(those rounds covered the ingest pipeline; this round covers the composer / home / grounding UI).

## #5 (🟠) "New session" banner button is dead — no network call — FIXED

Root cause (code): `packages/app/src/pages/home.tsx` wired the banner CTA as
`onNewSession={newSessionProject() ? openNewSession : undefined}` and `openNewSession()` started
with `if (!conn || !project) return`. With no *open* project yet (fresh state, or the project
list not hydrated), the button either rendered with no handler or died silently — no navigation,
no network call. Exactly what the manual test observed.

Fix: picker-fallback. `openNewSession()` now falls back to the directory picker when no project
is open (`chooseProject(conn, after)` gained an `after` callback that starts the session on the
first picked directory), and both session-group headers pass the handler unconditionally, so the
CTA is always live: existing project → new session; no project → picker → new session.

## #6 (🟡) Composer Send button dead; Enter key works — FIXED

Root cause (analysis): Enter and Send share the same `createPromptSubmit().handleSubmit` store
path (`packages/app/src/components/prompt-input.tsx` → `prompt-input/submit.ts`), so the state
layer was never the problem. The button sits inside `DockShellForm` (a real `<form
onSubmit={handleSubmit}>`) and relies on the browser's implicit submit-button activation to fire
the form's submit event — a chain that passes through the Kobalte `ButtonRoot` wrapper and the
tooltip trigger. When that implicit chain does not produce the form submit event, the click is
swallowed while Enter (explicit keydown → `handleSubmit`) keeps working.

Fix: direct click path. Both submit IconButtons (`data-action="prompt-submit"`, v2 and normal
composer layouts) now carry an explicit `onClick` that `preventDefault()`s (suppressing the
implicit submission that would double-fire) and calls `handleSubmit(event)` directly. The button
now works even when the implicit form-submission chain is broken.

## #7 (🟡) @ mention popup lists agents/files but not books — FIXED (regression)

Root cause (code): the book options were loaded by a single fragile promise chain in
`prompt-input.tsx`: `authFetch(/targeted-learning/health).then(r => r.json())` — a failing health
call (stale-cookie 401, 503 while a workspace sync/bootstrap is still connecting, non-JSON error
page) threw into `.catch(() => setBookOptions([]))` and cleared the list with **no retry**;
`booksDbAvailable` false also short-circuited the chain. Agents/files come from other sources,
hence the exact reported symptom: agents/files present, books missing.

Fix: resilient loader (`prompt-input/book-options.ts`, wired via `listBookOptions`):
- an explicit `booksDbAvailable: false` from a *successful* health call is the only
  short-circuit; a failing health call means "unknown" and must **not** block `/books`
- transient `/books` failures are retried (3 attempts, small delay) before giving up
- stale loads (server/directory switched mid-flight) are dropped via an `isStale` probe
- never throws: total failure resolves to `[]`
Covered by 9 new unit tests (`book-options.test.ts`).

## #8 (🟡) Sessions list shows "No sessions found"; console `SSE failed: 401` + 503 bootstrap — DIAGNOSED, no HEAD defect

- "No sessions found" (`home.sessions.empty`) is the empty-projects corollary: the Home list
  queries sessions for the *open projects* of the focused server (`projectDirectories()` ←
  `focusedServerCtx()?.projects.list()`); with zero open projects the query runs over an empty
  directory set and the empty banner is the correct render. Not a sessions-loss defect.
- `SSE failed: 401`: the global event stream (`eventSdk.global.event`, `server-sdk.tsx`
  `onSseError`) authenticates with the same cookie session as every other request. A stale/
  expired cookie (e.g. after a server restart with rotated bootstrap state) makes the stream
  connect 401 and the client logs the error until re-login; data endpoints would 401 identically.
- 503s: produced by the workspace-routing middleware
  (`packages/server/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:128` —
  "broken sync connection for workspace") while a workspace's sync/instance connection is still
  being established. Transient by design; they disappear once bootstrap completes.
- Actionable follow-up (UX, not a defect): after a 401 the UI should prompt re-login instead of
  surfacing raw console errors. Recorded in TODO.md §11.

## #9/#15 (⚪) Citation-verify false "not shown to the model this turn" for earlier-turn chunks — FIXED

Root cause (code): `grounding/turn-state.ts` kept ONE flat per-session set that
`prepareTargetedTurn` reset at the start of every turn (`resetRetrieved`) and that `post.ts`
additionally wiped after every verification (`clearRetrieved`). Any citation of a passage
retrieved in an earlier turn — which the model may legitimately do from conversation history —
failed verification with "not shown to the model this turn".

Fix: recent-turns window. `resetRetrieved` now starts a new turn (pushes a fresh chunk set)
instead of wiping history; `getRetrieved` returns the union over the last
`CITATION_TURN_WINDOW = 10` turns. Bounds preserved: 20 000 chunk ids per session across the
whole window (oldest evicted first), 2 048 sessions LRU, 30-min TTL; `post.ts` no longer clears
state at end of turn (the window + TTL bound it instead). 5 new window tests
(`turn-state.test.ts`); the existing verifier/memory suites pass unchanged.

## Gates (all green on this round's HEAD)

- smoke `bun tests/framework/runner.ts smoke` → 5 pass / 0 fail
- memory `cd packages/memory && bun test` → 10 pass / 0 fail
- learning `SKIP_LIVE_EMBED=1 bun test` → 326 pass / 2 skip / 0 fail (+5 window tests)
- app `bun run test:unit` → 460 pass / 0 fail (+9 book-options tests)
- server TL routes 26/0, httpapi-instance 7/7
- `tsgo` typecheck clean for packages/app and packages/learning
