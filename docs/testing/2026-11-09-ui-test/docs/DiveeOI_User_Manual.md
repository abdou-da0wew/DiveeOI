# DiveeOI — User Manual (v1.17.8, verified live 2026-11-09)

Everything in this manual was verified against the running app at `https://diveeoi.celestialb.cv` during the live UI test of 2026-11-09. Where the app currently misbehaves, the workaround is marked ⚠️.

---

## 1. Sign in

1. Open `https://diveeoi.celestialb.cv`.
2. The sign-in card shows "Welcome back"; the **username field is pre-filled** (`DIVEEOI` on this instance).
3. Enter the instance password → **Sign in**. The workspace loads in ~25–35 s on first paint (DEV badge shows in the top-left banner).
- "Create an account" exists for new users on self-hosted instances.
- ⚠️ Known issue: the first load can take up to ~35 s and the sessions list may show "No sessions found" on a bad day — reload once before assuming data loss.

## 2. The workspace at a glance

| Area | What it does |
|---|---|
| **Top banner** | Home · New session · per-tab close |
| **Left sidebar** | Projects list + **Settings** + **Help** at the bottom |
| **Right panel** | Recent sessions with a search box |
| **Session view** | Chat timeline, composer at the bottom, "Review" panel (git-style changes) on the right |

## 3. Starting a chat session

⚠️ **Current bug:** the banner **"New session" button is dead**, and the composer's **Send button** doesn't work — **Enter** sends.

Working paths:
- Open an existing session from the Recent sessions list (most reliable), **or**
- Create one programmatically (developer path): in the browser console on the app origin:
  ```js
  fetch('/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'my-session'})}).then(r=>r.json())
  ```
  then open `/DiveeOI/session/<id>`.
- Type your message and press **Enter**. The model picker (bottom of composer) currently defaults to GPT 5.6 Sol via AgentRouter.

## 4. Targeted Learning — using your books (the core feature)

DiveeOI's superpower: **book-grounded tutoring**. The assistant answers **only from books you index**, with passage citations like `[bk…-s0-p2-c17]`, and refuses questions the books don't cover.

### 4.1 Add a book

⚠️ **New-layout regression (2026-11-09 late evening):** the Settings modal no longer contains the **Targeted Learning tab** (the new OpenCode Desktop v1.19.5 layout ships General / Shortcuts / Servers / Providers / Models only). Until the tab returns, add/remove books through the API (from the server, or as JSON from anywhere):

```bash
# file already on the server
curl -u DIVEEOI:<pw> -X POST http://127.0.0.1:6050/targeted-learning/books/import \
  -H 'Content-Type: application/json' \
  -d '{"path":"/path/to/book.pdf","title":"Book Title"}'

# file on your machine (base64 JSON — multipart is rejected with 415)
curl -u DIVEEOI:<pw> -X POST http://127.0.0.1:6050/targeted-learning/books \
  -H 'Content-Type: application/json' \
  -d "{\"filename\":\"book.md\",\"contentBase64\":\"$(base64 -w0 book.md)\",\"title\":\"Book Title\"}"

# delete / retry
curl -u DIVEEOI:<pw> -X DELETE http://127.0.0.1:6050/targeted-learning/books/<bookId>
curl -u DIVEEOI:<pw> -X POST http://127.0.0.1:6050/targeted-learning/jobs/<jobId>/retry
```

Verified live: a 176-byte `.md` file went `ready` with 1 passage in ≤12 s via the base64 path. When the old UI returns: Settings → Targeted Learning → **Library** → **Add book** accepts `.pdf/.docx/.txt/.md`; a 10-page PDF ≈ 50 passages, ~1 min.

⚠️ If a book gets stuck in `failed`, see the Troubleshooting section (§7) — the error tooltip currently shows only `null`.

### 4.2 Ask about a book
- In a session, mention the book by typing `@` (mention popup) or literally:
  - `@book:"Mathematics (English) - Part 1" …question…`
  - `@book:"DiveeOI Scientific Research" ما هو المميز في المعادلة التربيعية؟`
- ⚠️ **Current bug:** the @ popup may only list agents/files — **type the literal `@book:"<title>"` text**; it attaches correctly (verified).
- ⚠️ **Always re-mention the book for each question** (verified 2026-11-09 22:0x): a pronoun follow-up without a mention ("And how many attention heads does **it** have…?") was refused even though the index passes the same query (`decision:"pass"`); a single-fact follow-up without mention worked once, so the behavior is flaky. Re-mentioning is 100 % reliable in testing (4/4).
- After the first mention, the session stays in targeted mode — but **re-typing the mention costs nothing and avoids refusals**.

### 4.3 What good answers look like (verified examples)
- **In-book:** asked about the student encoder's architecture → exact figures (16,801,792 parameters, 384 hidden, 4 layers, 6 heads, FFN 1536) with a chunk citation.
- **Out-of-book refusal:** asked "What is the capital of Japan?" → "This isn't covered in the selected book(s)." — the tutor will not answer from general knowledge.
- **Arabic:** ask in Arabic and the tutor answers in Arabic, citing the book's Arabic passages.

### 4.4 Reading the citations
- `[bk_1054259ed5844b74-s0-p2-c17]` = book id · section 0 · page 2 · chunk 17.
- ⚠️ If you see a warning like "تعذّر التحقق من مرجع" (Arabic) or **"1 citation could not be verified: [bk…] (not shown to the model this turn)"** (English), treat that answer cautiously — the verifier could not match the citation to a passage *in the current turn*. On follow-up turns the model sometimes cites chunks it saw in **earlier** turns' answers (chat memory) — the warning is your tell. Observed live on the FFN follow-up (harmless there: figure was correct) and on the Arabic numeric answer that got figures wrong (Q4).

## 5. Targeted Learning settings (Settings → Targeted Learning)

⚠️ **Currently unreachable:** the new layout removed the TL tab from the Settings modal (Bug 13). The tunings below still apply server-side; editing them needs an operator until the UI returns.

- **Setup panel**: shows model download (~568 MB bge-m3) and 7 self-test steps (Probe, Preflight, Download, Verify, Runtime check, Golden self-test, Benchmark). All should be ✅ Complete.
- **Presets**: Low / Balanced / High learning profiles.
- **Tuning sections** (12 collapsible): Chunking, OCR, Retrieval, Retrieval gate, Grounding, Student memory, AR/EN language, etc. Defaults are calibrated; the **Retrieval gate** currently rides on the v3b student encoder's calibrated thresholds (dense 0.35 / fused 0.03) — lower it only if the tutor refuses questions it should answer.
- **OCR**: enable when indexing scanned books (`ara+eng` languages supported).

## 6. Where your data lives (self-hosted)

| Thing | Location on the server |
|---|---|
| Books database | `~/.local/share/diveeoi/targeted-learning/books.db` (SQLite + sqlite-vec) |
| Embedding models | `~/.local/share/diveeoi/targeted-learning/models/` (teacher `Xenova/bge-m3`, query encoder `divee-query-student`) |
| App config | `~/.config/diveeoi/` |

## 7. Troubleshooting (current known state)

| Symptom | Cause today | What to do |
|---|---|---|
| Book stuck `failed`, error `null` | Compiled-server dynamic-import bug (fixed by running from source) | Confirm the server runs from source (`/tmp/diveeoi-src.log`), then re-upload or use API import (Ops Manual §3) |
| 502 Bad Gateway from Cloudflare | Origin server process down | Restart the server (Ops Manual §2); the public tunnel itself is fine |
| Chat answers canned refusal for everything | Query-encoder runtime missing/strict gate | Check active student runtime is v3b with gate 0.35 (Ops Manual §4) |
| "New session" / Send buttons dead | UI bug #5/#6 | Use Enter to send; create sessions via existing list or fetch workaround (§3) |
| Sessions list empty + SSE 401/503 console errors | Known issue #8 | Reload; sessions still work |
| **Answers never arrive; tokens stay 0; console floods "Failed to load sessions" / "bootstrap instance → 503"** | Prompt-execution stall (observed 22:20–22:45 UTC, all sessions incl. previously-working ones) | Wait for provider/server recovery or restart the server; nothing is lost — queued prompts may need re-sending |

## 8. Status & health quick-checks

- **In-app**: Settings → Targeted Learning → Setup (all steps green) · session "Status" dialog (MCP, LSP, providers).
- **From the server** (see Ops Manual for the full command list):
  - `curl -u DIVEEOI:<password> http://127.0.0.1:6050/targeted-learning/books` → library JSON
  - `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:6050/` → `200` = alive

---
*Manual generated from the 2026-11-09 live UI test; updated after Round C3 (evening) — new-layout TL-tab removal, follow-up flakiness, citation-verify mechanism, prompt-stall symptom. Update after fixing issues #5–#9 and #12–#15.*
