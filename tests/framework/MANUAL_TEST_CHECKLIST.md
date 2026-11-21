# DiveeOI — Manual QA Checklist

A step-by-step manual test script for a human tester. It walks the real UI flow
(login → workspace → session → composer → library → settings) and explicitly
re-checks the known-issue areas from
[`docs/testing/2026-11-09-ui-test/docs/DiveeOI_ManualTest_Report_2026-11-09.md`](../../docs/testing/2026-11-09-ui-test/docs/DiveeOI_ManualTest_Report_2026-11-09.md).

Time budget: ≈ 30–45 minutes. Do the steps in order; sections 5–8 need a
running LLM provider + backend; everything else only needs the app booted.

---

## 0. Environment (fill in before starting)

| Field | Value |
|---|---|
| Date / time (UTC) | ____________________ |
| Tester (name/handle) | ____________________ |
| App version | ____________________ (`packages/app/package.json` → `version`; DEV badge visible in-app when running from source) |
| Frontend URL | ____________________ (local dev default: `http://127.0.0.1:3000` — Vite port from `packages/app/vite.config.ts`) |
| Backend URL | ____________________ (local dev default: `http://127.0.0.1:4097` — the app proxies API paths there) |
| Browser + OS | ____________________ |
| Auth mode | ____________________ (local dev Basic auth defaults: user `DIVEEOI`, password `divee`; see `docs/security-auth.md`) |
| How booted | ____________________ (recommended: `bun run dev:both` → server `packages/server` + app `packages/app` together) |
| Books in library before test | ____________________ |

**Legend:** `[ ] P` = pass · `[ ] F` = fail · `[ ] N/A` = not applicable.
For every **F**, paste a screenshot + console excerpt into the Notes line.
Screenshots naming suggestion: `M<step>-<slug>.png`.

---

## 1. First load & login

1. Open the frontend URL in a fresh private/incognito window.
   **Expected:** the app shell renders (header/sidebar visible); if not yet
   authenticated you land on the login page titled **"Welcome back"** with
   *"Sign in to continue to your DiveeOI workspace."*
   `[ ] P  [ ] F  [ ] N/A` — Notes:
2. Confirm the login form contents: **Username or email** input (pre-filled
   with `DIVEEOI` for local dev), **Password** input (dev placeholder mentions
   the default `divee`), a **Sign in** button, and a **"Create an account"**
   link to `/register`.
   `[ ] P  [ ] F  [ ] N/A` — Notes:
3. Enter a **wrong** password and submit.
   **Expected:** an inline error alert (red box, `role="alert"`) appears; you
   stay on `/login`; no uncaught crash.
   `[ ] P  [ ] F  [ ] N/A` — Notes:
4. Log in with the correct credentials.
   **Expected:** you navigate to `/` and see the workspace: projects sidebar,
   session list / project grid. (Known slow first paint ~25–35 s on the
   2026-11-09 deployment — note your timing, ⚪ Bug 10.)
   `[ ] P  [ ] F  [ ] N/A` — Notes:

## 2. Workspace & projects

5. Open the **projects sidebar**.
   **Expected:** your project(s) are listed with avatars; switching projects
   keeps the sidebar usable.
   `[ ] P  [ ] F  [ ] N/A` — Notes:
6. Refresh the page (F5).
   **Expected:** the auth cookie persists (no forced re-login) and the
   workspace reloads to the same project.
   `[ ] P  [ ] F  [ ] N/A` — Notes:

## 3. New session

> ⚠️ **PAY ATTENTION — known bug area (report Bug 5):** the **"New session"
> banner button was dead** on 2026-11-09 (no network call fired). Workaround
> used then: `POST /session` via fetch. Verify the button actually works now.

7. Click the **"New session"** entry/banner button (do **not** use the keyboard
   shortcut if one exists).
   **Expected:** a new session view opens **and** DevTools → Network shows a
   request creating the session (e.g. `POST …/session`).
   `[ ] P  [ ] F  [ ] N/A` — Network evidence in Notes:
8. Confirm the new session appears in the sidebar/session list with a title
   (auto or "New session").
   `[ ] P  [ ] F  [ ] N/A` — Notes:

## 4. Composer basics

> ⚠️ **PAY ATTENTION — known bug area (report Bug 6):** the composer **Send
> button was dead** — only Enter submitted. Test the button explicitly.

9. Type `Hello DiveeOI` in the composer (session from step 7).
   **Expected:** text renders; model/agent picker visible near the composer;
   no layout jump.
   `[ ] P  [ ] F  [ ] N/A` — Notes:
10. Click the **Send button** (mouse click — not Enter).
    **Expected:** the message is submitted, appears in the timeline, and the
    assistant/agent starts responding (or a clear error appears — see step 12).
    `[ ] P  [ ] F  [ ] N/A` — Notes:
11. Send a second message with the **Enter** key.
    **Expected:** same submission path works.
    `[ ] P  [ ] F  [ ] N/A` — Notes:
12. Watch the turn complete end-to-end (streaming tokens, tool chips if any).
    **Expected:** the answer streams and finishes; status returns to idle.
    ⚠️ If it queues forever with 0 tokens in **all** sessions, you have hit
    report **Bug 14 (prompt-execution stall)** — record `time.updated` frozen
    evidence and continue with UI-only steps.
    `[ ] P  [ ] F  [ ] N/A` — Notes:

## 5. @-mention popup

> ⚠️ **PAY ATTENTION — known bug area (report Bug 7):** the **@ mention popup
> listed agents/files but NOT books** (regression vs Phase A).

13. In the composer type `@` and wait for the popup.
    **Expected:** popup lists agents and files; **and now also books**
    (Targeted-Learning library titles) — if books are missing again, FAIL and
    screenshot the popup.
    `[ ] P  [ ] F  [ ] N/A` — Notes:
14. Continue typing to filter (e.g. `@` + first letters of a file) and select an
    item with Enter/click.
    **Expected:** the mention is inserted into the composer text and survives
    sending (message shows the mention).
    `[ ] P  [ ] F  [ ] N/A` — Notes:

## 6. Document library & book ingest (Targeted Learning)

> ⚠️ **PAY ATTENTION — known bug areas (report Bugs 1 & 13):** ingest used to
> fail silently with `error:"null"`; the library UI showed only `null` with **no
> meaningful error tooltip**; and the **Targeted Learning settings tab was
> missing** from the new settings layout (library management API-only).

15. Open the Targeted-Learning **book library** UI (in-app panel/component
    `targeted-learning-library`).
    **Expected:** your books are listed with status (`ready` / `failed` /
    processing) and chunk counts.
    `[ ] P  [ ] F  [ ] N/A` — Notes:
16. **Upload** a small `.md` or `.txt` file via **Add book** (keep it < 190 MB —
    the UI enforces `MAX_UPLOAD_MB = 190`).
    **Expected:** status transitions to `ready` within ~1 min with a chunk count
    ≥ 1.
    `[ ] P  [ ] F  [ ] N/A` — Notes:
17. **Error path:** upload a file that fails (e.g. a > 190 MB file, or a
    corrupt/empty file).
    **Expected:** the row/book shows `failed` **and a human-readable error
    message/tooltip** — **not** the literal string `null`. This is the explicit
    regression check for the Bug 1 / "library error tooltip" issue.
    `[ ] P  [ ] F  [ ] N/A` — Exact error text shown:
18. **Delete** the probe book (JS confirm dialog expected).
    **Expected:** row disappears; library count returns to the step-15 baseline.
    `[ ] P  [ ] F  [ ] N/A` — Notes:
19. Open **Settings** and enumerate the tabs.
    **Expected:** General / Shortcuts / Servers / Providers / Models (new
    "OpenCode Desktop" layout). Note explicitly whether a **Targeted Learning**
    tab exists — if it exists again, the Bug 13 regression is fixed; if not,
    mark N/A-with-note (management stays API-only per the Ops Manual).
    `[ ] P  [ ] F  [ ] N/A` — Tabs seen:

## 7. Settings — providers & models

20. Settings → **Providers**.
    **Expected:** connected providers are listed; adding/removing a provider
    updates the list without console errors.
    `[ ] P  [ ] F  [ ] N/A` — Notes:
21. Settings → **Models**.
    **Expected:** model rows render with per-model rows (format / burst /
    tool-output / compaction options exist in the LLM section); toggling a
    value persists after close+reopen.
    `[ ] P  [ ] F  [ ] N/A` — Notes:

## 8. Grounded Q&A (needs ≥ 1 `ready` book + working provider)

22. In a session, mention a book via `@book` and ask a question **the book
    answers** (e.g. a figure/section title).
    **Expected:** the answer cites passages/chunk ids (e.g. `[bk…-s0-p2-c17]`).
    ⚠️ If a citation-verify warning appears ("…could not be verified…
    (not shown to the model this turn)"), that is the known **Bug 15** behavior
    on follow-up turns — record it, don't fail the run for it.
    `[ ] P  [ ] F  [ ] N/A` — Notes:
23. Ask an **out-of-book** question (e.g. "What is the capital of France?").
    **Expected:** an honest refusal ("not covered in the selected book(s)") —
    no world-knowledge leak.
    `[ ] P  [ ] F  [ ] N/A` — Notes:
24. Numeric follow-up **without** re-mentioning the book.
    **Expected:** answer grounded or honestly refused — ⚠️ known soft spot
    (Bugs 4/5-intermittent): numbers can be injected pre-retrieval; if wrong
    numbers appear, FAIL and record the exact figures.
    `[ ] P  [ ] F  [ ] N/A` — Notes:

## 9. Sessions & persistence

25. Reload the page and reopen the session from step 7.
    **Expected:** full transcript (both messages + answers) is still there.
    ⚠️ Known issue (Bug 8): sessions list once showed "No sessions found" with
    console `SSE failed: 401` — if the list is empty after reload, FAIL.
    `[ ] P  [ ] F  [ ] N/A` — Notes:

## 10. Console errors sweep (do this LAST, covering the whole flow)

26. Open DevTools → Console, clear it, then click through: home → new session →
    composer send → @ mention → library → settings → session reload.
    **Expected:** record every red error. Known/expected noise you may note as
    *expected*:
    - `SSE failed: 401` while logged out (Bug 8, auth bootstrap before login);
    - `Failed to load resource` for deliberate error-path probes (step 17);
    - anything else is a finding: paste the exact message + count below.
    `[ ] P  [ ] F  [ ] N/A` — Unexpected console errors (message × count):

## 11. Sign out / register link

27. Click **"Create an account"** from the login page (use a logged-out window).
    **Expected:** `/register` renders the account-creation form; no crash.
    `[ ] P  [ ] F  [ ] N/A` — Notes:
28. If a logout affordance exists in your build, log out and confirm you are
    returned to the login page and protected views no longer load data.
    `[ ] P  [ ] F  [ ] N/A` — Notes:

---

## Sign-off summary

| Section | Steps | P | F | N/A |
|---|---|---|---|---|
| 1. First load & login | 1–4 | | | |
| 2. Workspace & projects | 5–6 | | | |
| 3. New session (⚠ Bug 5) | 7–8 | | | |
| 4. Composer (⚠ Bug 6) | 9–12 | | | |
| 5. @ mention popup (⚠ Bug 7) | 13–14 | | | |
| 6. Library & ingest (⚠ Bugs 1/13) | 15–19 | | | |
| 7. Settings | 20–21 | | | |
| 8. Grounded Q&A (⚠ Bugs 4/15) | 22–24 | | | |
| 9. Sessions & persistence (⚠ Bug 8) | 25 | | | |
| 10. Console errors sweep | 26 | | | |
| 11. Register / logout | 27–28 | | | |

**Overall result:** ☐ PASS ☐ PASS WITH ISSUES ☐ FAIL
**Blockers found:**
**Follow-ups filed (links/tickets):**
**Artifacts (screenshot folder / HAR / notes):**

---

### Known-issue quick reference (from the 2026-11-09 live-UI report)

| Report bug | What to watch for in this checklist |
|---|---|
| #1 ingest `error:"null"` + missing library error tooltip | step 17 |
| #4 numeric hallucination on Arabic/book QA | step 24 |
| #5 "New session" banner button dead | step 7 |
| #6 composer Send button dead (Enter worked) | step 10 |
| #7 @ mention popup missing books | step 13 |
| #8 sessions list "No sessions found" + SSE 401 | step 25 |
| #10 slow first paint (~25–35 s) | step 4 timing |
| #13 Targeted Learning settings tab removed | step 19 |
| #14 prompt-execution stall (0 tokens, queued) | step 12 |
| #15 citation-verify warning on follow-up turns | step 22 |
