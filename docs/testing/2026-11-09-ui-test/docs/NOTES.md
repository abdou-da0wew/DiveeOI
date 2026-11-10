# UI TEST NOTES — DiveeOI (session 2)

## Phase 0 — LOGIN (2026-11-09, ~16:18–16:25 UTC)
- Fresh browser session, viewport 1440x900.
- First load very slow; `networkidle` timed out twice; login form fully rendered after ~25s. Screenshot 00-initial-load.png.
- Login: username prefilled "DIVEEOI", password = pair A (not recorded here). Signed in OK.
- Workspace visible: sidebar with Home / New session / Add project / Settings / Help + "Recent sessions" region. Screenshot 30-logged-in.png.
- ANOMALY: "Recent sessions" list shows **"No sessions found"** — empty even after reload and clicking Home/Projects. Expected an existing working session (per test plan). Console shows `[global-sdk] event stream error ... SSE failed: 401`.
- Origin intermittently returns **502 Bad gateway** (Cloudflare, origin overloaded) for some API calls (e.g. /project) — apps slow/unstable right now.

## Phase A — upload (16:47–17:00 UTC)
- LOGIN: session cookie persisted from Phase 0 — workspace loaded directly, no login form shown. Screenshot 40-in.png.
- Library UI: Settings → "Targeted Learning" tab. Setup section visible; Library section is below it (page scroll, a11y snapshot does not list Library — used `eval document.body.innerText` to read it). Screenshot 41-library.png.
- UPLOAD (worked): hidden `input[type=file]` exists in DOM (accept=".pdf,.docx,.txt,.md", class="hidden", NOT in a11y snapshot). **`agent-browser upload "input[type=file]" <path>` via CSS selector worked first try** — label flipped "Add book" → "Uploading…", no confirm button needed. Screenshot 42-uploading.png. Network: POST /targeted-learning/books → 200.
- INDEXING: UI flashed "Indexing started. This can take a few minutes." then entry went to **failed**. Clicked Retry ("Ingest job retry requested.", POST /targeted-learning/jobs/job_e732c30985d1/retry → 200). Polled 10× ~20s (≈3.5 min): status stayed **failed**. Screenshot 44-upload-error.png (43-book-ready.png not applicable).
- Book entry (via GET /targeted-learning/books): id bk_c6da187cdd4241ea, title "DiveeOI_Scientific_Research", slug/@mention `@book:diveeoi-scientific-research`, status "failed", **pages null, chunkCount 0, indexedAt null, progress 0, error: literally "null"** (server does not populate the error field — UI shows no failure reason). Same for pre-existing tl_probe_book (job_f1214971ad7b) — suggests systemic ingest failure on origin, not a file problem (health panel: books.db Available, manifest Loaded, model Ready).
- SESSION CHECK: New session → project picker → "DiveeOI". Page took ~12–15 s to render (initially only "DEV/New session/?", no composer — slow load, not the blank bug). Composer appeared: "Ask anything, / for commands, @ for context…". Screenshot 45-new-session.png.
- MENTION POPUP: `@` in composer (contenteditable div; plain `type` didn't register — used `fill`) shows agents (@code-reviewer/@explore/@general/@research/@subthinker) **and both books incl. the failed one**: `@book:diveeoi-scientific-research — DiveeOI_Scientific_Research`. Screenshot 46-mention-popup.png. Escaped out.
- Console errors: `[global-sdk] event stream error … SSE failed: 401`, `SSE failed: 502` ×2, `TypeError: network error` ×2. Captured network also shows intermittent GET /global/event → 502.
- NOTE: screenshots initially saved to CWD (/home/z/my-project) — moved into evidence dir.

## Phase B — upload retry (2026-11-09, 18:02–18:07 UTC)

- LOGIN NEEDED: cookie from session 2 was gone; login form shown again (username prefilled "DIVEEOI"). Signed in with pair A at 18:02:0x. Screenshot 50-relogin.png. Server response fast this time (~10 s to workspace), no 502s observed.
- LIBRARY STATE (18:02:5x): Settings → Targeted Learning → Library showed the 2 prior failed books: **"DiveeOI_Scientific_Research"** (@book:diveeoi-scientific-research) and **"tl_probe_book"** (@book:tl-probe-book) — both `failed`, error text in UI literally `null`. Screenshot 51-library-state.png.
- DELETE OLD BOOK: clicked Delete on "DiveeOI_Scientific_Research" → JS confirm `"Delete "DiveeOI_Scientific_Research" and its index?"` → accepted → `DELETE /targeted-learning/books/bk_c6da187cdd4241ea → 200`, list refreshed to only tl_probe_book. Screenshot 52-deleted.png.
- PROBE TXT UPLOAD (18:03:41): created /tmp/probe_book.txt (121 bytes, discriminant text) and uploaded via `agent-browser upload "input[type=file]" /tmp/probe_book.txt` — worked first try, label flipped "Add book" → "Uploading…". Screenshot 53-probe-uploading.png.
- PROBE RESULT (18:04:08, i.e. ≤27 s after upload): entry appeared — **probe_book / @book:probe-book, status `failed` already** (toast "Indexing started. This can take a few minutes." still showing). API: id bk_19a01843f02c431b, job job_99db5f81e5ae, jobStatus failed, **progress 0, chunkCount (passages) 0, pages null, indexedAt null, error `"null"`** (literal string again). Instant-fail pattern (dur≈0 s), same as the 16:33–16:35 txt failures. Hover/click on row reveals NO extra detail (no tooltip). Screenshot 54-probe-result.png.
- PDF UPLOAD (18:04:37): `agent-browser upload "input[type=file]" /home/z/my-project/work/isef_v5/DiveeOI_Scientific_Research.pdf` → OK, "Indexing started…" toast. Screenshot 55-pdf-uploading.png.
- PDF RESULT (failed by 18:04:40 — ≤3 s, even faster than the 69–87 s embedder-init failures of Phase A): new book bk_43d887f7d0cf461e, job job_345658d66d91 — **status `failed`, error `"null"`, progress 0, chunkCount 0**. Polls every 20 s ×6 (18:05:27→18:07:08) confirmed state stable: `failed:0:0` for both probe and PDF. Screenshot 56-pdf-result.png.
- CONSOLE/ERRORS (STEP 5): `agent-browser errors` → EMPTY. Console (last 30): only the known `[global-sdk] event stream error … SSE failed: 401`. **No ingest-related console errors, no SSE 502, no TypeError: network error this session.**
- VERDICT: **Ingest STILL FAILS identically** after the server restart with debug logging: txt AND pdf both die with `error:"null"`, status failed, stage/progress 0, chunks 0. The UI gives no failure reason (error field shows literal `null`). Same signature as Phase A + VDS diagnosis (raw null defect in ingest catch block); debug restart did not change UI-visible behavior. Whether TL debug logs (DIVEEOI_TL_DEBUG) were written on the VDS needs a separate check by the server agent.
- Screenshots added: 50-relogin.png, 51-library-state.png, 52-deleted.png, 53-probe-uploading.png, 54-probe-result.png, 55-pdf-uploading.png, 56-pdf-result.png.
- NOTE (screenshots): agent-browser screenshot returned a cached/stale PNG for 54/55/56 (identical md5) — retaken after forced scroll/repaint. 54 shows the 2-book state (probe failed, PDF not yet uploaded); 55/56 retakes show the final 3-book all-failed state (identical by design; original "Uploading…" moment for 55 was text-verified via innerText at 18:04:40: label had already flipped back to "Add book" and entry was already failed). Truth chain for statuses is the recorded API JSON above.

## Phase C1 — gold question
- Timestamp: 2026-11-09T20:56:45Z
- Session used: NONE — could not reach app. https://diveeoi.celestialb.cv returned **502 Bad gateway (Cloudflare, origin down)** on every load for ~8 min (~12 retries via browser open/reload + curl). No login page, no composer, no question sent.
- Question (NOT sent): @book:"Mathematics (English) - Part 1" What is the discriminant of a quadratic equation and how is it used to determine the nature of its solutions? Explain with the book's worked example.
- Answer captured: none (site unreachable).
- Book citation: N/A — could not test.
- Verdict vs expected facts (D=b²-4ac; D>0 two distinct real; D=0 double; D<0 complex; example 3x²+4x+7 → D=16-84=-68<0 → two imaginary solutions): **FAIL** — infrastructure outage (502) prevented the gold question from being asked; no answer or citation could be evaluated.
- Screenshots: 70-qa-setup.png (502 error page, full).

## Phase C1 — grounding Q&A
- Timestamp: 2026-11-09, 21:25–21:40 UTC. Site reachable again (no 502 on load). Cookie still valid — NO login needed; Home rendered in ~25–35 s (slow render pattern persists).

### Setup / navigation anomalies (NEW bugs)
- Home page: "New session" banner button is DEAD — click (a11y ref, real mouse coords, JS .click()) produces no dialog, no nav, no network call; Ctrl+T and Ctrl+O (catalog keybinds tab.new/project.open) also no-op; sidebar Projects list EMPTY ("Add project" only, though GET /project returns many projects). Home says "Nothing here yet".
- WORKAROUND: created session via POST /session?directory=/home/celestial-dev/DiveeOI → ses_e3dca2bd6ffef2Mnf6f89DAVdC, then full-page nav to /DiveeOI/session/<id> → SPA redirects to /server/aHR0cHM6…(b64 of origin)/session/<id> and renders composer. Screenshot 70-qa-setup.png (composer confirmed, 21:28).
- Mention popup regression: typing @ shows 5 agents ONLY (no books, no files); "@DiveeOI" → 10 file matches only; "@book:diveeoi" → file paths only. BOOK items NEVER appear in popup (Phase A showed `@book:diveeoi-scientific-research — DiveeOI_Scientific_Research`). Screenshot 71-mention-popup.png.

### Q1 (grounding) — asked 21:29:02Z, retried with slug mention 21:32:23Z
- Question (title form): @book:"DiveeOI Scientific Research" How many parameters does the student query encoder have, and what is its architecture (hidden size, layers, attention heads, FFN)?
- Full assistant answer (verbatim, both attempts): "This isn't covered in the selected book(s)." — 0.0–0.6 s, tokens 0/0, cost 0, finish stop.
- VERDICT Q1: **FAIL** — no 16,801,792, no 384/4/6/1536 architecture; no citation. Canned refusal identical for both mention syntaxes (raw-text mention DOES attach the book: session metadata targetedLearning={mode:"targeted",bookIds:["bk_1054259ed5844b74"],books:[…slug diveeoi-scientific-research…],missing:[]}).
- KEY DIAGNOSTIC: direct retrieval API works — POST /targeted-learning/search {query,bookId} → decision **"pass"**, dense 0.565 (thr minDense 0.5), top chunk bk_…-s0-p0-c5 (Arabic text about the query encoder). Book healthy: GET /targeted-learning/books → status ready, pages 10, chunkCount 50, progress 100.
- Control: fresh session (no TL), "What is" → REAL answer "What would you like to know about?" (4 s) → base LLM fine; TL-targeted session refuses EVERY message instantly, even plain "What" with no mention.

### Q2 (grounding) — asked 21:37:03Z
- Question: @book:"DiveeOI Scientific Research" According to the same book, what is the int8 ONNX file size of the student model and how many times smaller is it than the teacher model?
- Full assistant answer (verbatim): "This isn't covered in the selected book(s)." — 0 s, tokens 0/0, cost 0.
- VERDICT Q2: **FAIL** — no 18.9 MB, no ~120×/0.83%; no citation. Direct retrieval for this exact question: decision **"pass"**, dense 0.589 → index has relevant content; chat pipeline short-circuits before answering.

### Citation behavior
- NONE. UI shows a single-line canned text; no passage citations, no source/chunk chips, no book panel. The retrieval API does return chunkIds + Arabic snippets (so citable passages exist) but the chat path never reaches rendering.

### Console/errors (STEP 5 — NEW items)
- agent-browser errors (page errors): EMPTY.
- Console (new vs Phase B): "Failed to finish bootstrap instance … opencode server GET … → 503: (empty response body)" ×several; "Failed to load sessions … Unexpected server error. Check server logs for details." ×4. (Old known: SSE 401 not reobserved; notification store holds "Missing Authentication header" APIError for an old session.)

### Screenshots (evidence dir)
- 70-qa-setup.png — TL session with composer (21:28)
- 71-mention-popup.png — @DiveeOI popup: files only, NO books (21:30)
- 72-q1-answer.png (--full) — conversation incl. Q1 canned refusal
- 73-q2-answer.png (--full) — conversation incl. Q2 canned refusal

### Root-cause pointer for server agent
- TL chat (mode=targeted) short-circuits EVERY prompt → canned "This isn't covered in the selected book(s)." with 0 tokens; retrieval + embedder + index + LLM all verified healthy independently. Looks like the TL chat handler fails (likely at the answer/LLM step or a message-level book-selection lookup) and the catch block returns the canned refusal — same "swallowed error" family as the ingest null bug.

## Phase C2 — Q&A v3b (round 2)
- Timestamp: 2026-11-09, 21:42–21:55 UTC. Cookie still valid — NO login needed. Site fast; no 502s.
- Session: created via fetch POST /session {title:'qa-v3b'} → **ses_e3dbc8ef1ffe4ar6pD07xKPiOX** (slug calm-harbor); opened /DiveeOI/session/<id> → SPA redirect to /server/<b64>/session/<id>, composer rendered. "New session" banner button still dead (workaround used).
- SEND MECHANICS: clicking the Send button (a11y ref) does NOT dispatch — composer kept text, no POST. **Focus composer + Enter works** (POST /session/<id>/prompt_async → 204). Composer is contenteditable; `fill` + End + Enter used for all 4 questions.

### Q1 — 21:45:0xZ, answered in 19s
- Asked: @book:"DiveeOI Scientific Research" How many parameters does the student query encoder have, and what is its architecture (hidden size, layers, attention heads, FFN)?
- Answer (verbatim): "The student query encoder has 16,801,792 parameters. Architecture: Hidden size: 384 / Transformer layers: 4 / Attention heads: 6 / FFN size: 1,536 [bk_1054259ed5844b74-s0-p2-c17]"
- VERDICT Q1: **PASS** — all 5 facts exact (16,801,792 / 384 / 4 / 6 / 1536). Inline chunk citation present.

### Q2 — 21:47:14Z, answered in 5s
- Asked: According to the same book, what is the int8 ONNX file size of the student model and how many times smaller is it than the teacher model? (no new mention; session bookIds persisted)
- Answer (verbatim): "The int8 ONNX student model is 18.9 MB, approximately 120× smaller than the teacher model. [bk_1054259ed5844b74-s0-p2-c16]"
- VERDICT Q2: **PASS** — 18.9 MB ✓ and ~120× ✓ (0.83% variant not stated; acceptable). Citation present.

### Q3 (refusal probe, NO book mention) — 21:49:01Z, answered in 0s
- Asked: What is the capital of Japan?
- Answer (verbatim): "This isn't covered in the selected book(s)."
- VERDICT Q3: **PASS** — honest grounded behavior: refuses instead of answering from world knowledge. (Same canned line as C1's blanket refusal, but now ONLY for off-book content; book questions answer normally.)

### Q4 (Arabic) — 21:50:45Z, answered in 20s
- Asked: @book:"DiveeOI Scientific Research" كم مثال تدريبي استُخدم لتدريب مشفّر الاستعلام الطالب؟ وكم مثالاً عربياً منها؟
- Answer (verbatim): "استُخدم 12,253 مثالًا تدريبيًا، منها 1,417 مثالًا عربيًا. [bk_1054259ed5844b74-s0-p2-c14] [bk_1054259ed5844b74-s0-p3-c20]" + UI warning: "⚠ تعذّر التحقق من 2 مرجع: …(لم يُعرض هذا الدور)" ×2
- VERDICT Q4: **FAIL** — says 12,253 total / 1,417 Arabic vs expected 8,000 total / 3,923 Arabic (Fact 3: 3,923 ar / 2,552 en / 1,448 fr / 77 ar-ling). Wrong on both numbers.
- NOTES Q4: agent visibly called `book_read_section` ×2 (pages 2–3) and its reasoning trace leaked into the UI ("…I could mention that '12,253 training examples were used, including 1,417 in Arabic'…") → the numbers appear to come from the retrieved chunks themselves, i.e. **book/index content or chunk-mapping mismatch**, not pure hallucination. NEW UI: citation-verification warning chips (Arabic) flag citations not shown in the rendered context; direct search API for the same Arabic query → decision "pass", dense 0.3105 (v3b gate 0.35 calibrated; fused used), candidates p5-c35/p6-c37/p2-c15/p5-c36 (no text in API response).

### Citation behavior (overall)
- Inline `[bookId-s0-pN-cM]` chunk-id citations after factual claims (Q1, Q2, Q4). No page-number chips, no passage cards/chips UI beyond the verification warning on Q4. Q3: no citations.

### Console/errors (STEP 5)
- agent-browser errors (page errors): EMPTY.
- Console: same known family as Phase C1, logged around page load — "Failed to load sessions … Unexpected server error" ×several, "Failed to finish bootstrap instance … opencode server GET … → 503: (empty response body)" ×several. Nothing new during the 4 Q&A turns; no SSE 401 this session.

### Screenshots (evidence dir)
- 80-q1.png (--full) — Q1 answer with architecture + citation
- 81-q2.png (--full) — Q2 answer 18.9 MB / 120× + citation
- 82-refusal.png (--full) — Q3 grounded refusal
- 83-arabic.png (--full) — Q4 Arabic answer + tool calls + citation-verify warnings

### Summary for server agent
- v3b fixed the C1 short-circuit: targeted-session book questions now answer with real content + chunk citations; off-book question refuses honestly. Remaining issue: Q4 numbers contradict ground truth — check what chunks s0-p2-c14 / s0-p3-c20 actually contain (12,253/1,417?) vs Fact 3 (8,000/3,923): suspect ingest chunking mapped wrong source text, or the PDF contains those figures and Fact 3 refers to a different table. Also: Send-button click dead (Enter-only), reasoning-trace leakage into chat UI, citation-verify warning when tool-fetched sections cited.

## Phase C3 — deeper diagnostics + math-book state (2026-11-09, 22:00–22:20 UTC)
- Library state via GET /targeted-learning/books: **only 1 book remains** — "DiveeOI Scientific Research" (bk_1054259ed5844b74, ready, 10 pages, 50 chunks, jobId job_a05e2d814330 complete). **"Mathematics (English) - Part 1" is GONE from the library** (was 204 pages/552 passages at session 1). VDS hunt (mathbook_hunt.md): books row + chunks purged, no orphaned FTS text; original source survives at `/home/celestial-dev/diveeoi-artifacts/eb-pdf/Mathematics-En-EB-Part1.pdf` (+ 30-p sample 1,248,223 B; 67 MB corpus/books.db backup). vds.py has NO file-pull (gateway truncates ~6.5 KB/call) → recovery = manual pull or re-push not possible from sandbox today. NEW BUG #12: math book lost during fix rounds; golden math test BLOCKED pending re-upload.
- Q4 root-cause refinement (Bug 4): session timeline shows the agent's `book_search` tool call QUERY itself contained the tokens `12253 1417` — i.e. the figures **pre-date retrieval**. Verified absent from: v5 PDF (0 matches), v4 PDF, render3 PDF, live 50 chunks (prior scan), local eval/train JSONs (1417 hit is float `0.7411417…` coincidence) → **pre-retrieval context/parametric leak, not index corruption, not chunk-mapping**. Grounding enforcement must block answering before passages confirm figures (report §6.2 already proposed; mechanism now proven).
- Q&A battery round 2 (same session ses_e3dbc8ef1ffe4ar6pD07xKPiOX, book bk_1054259ed5844b74):
  - Q5 (pronoun follow-up, NO mention): "And how many attention heads does it have, and what is its BPE vocabulary size…?" → **canned refusal 0s** ❌ — but direct search API for the same query → decision **"pass"** (dense 0.370 ≥ 0.35, fused 0.0318 ≥ 0.03; candidates incl. p2-c15 architecture chunk) → chat-side gate refuses follow-ups the index can answer. Screenshot 85.
  - Q6 (explicit re-mention): "…How many transformer layers…?" → **"The student query encoder has 4 Transformer layers. [bk…-s0-p2-c15]"** ✅ 7s. Screenshot 86.
  - Q7 (no-mention follow-up, explicit noun): "What is the FFN size of the student query encoder?" → **"FFN size is 1,536. [bk…-s0-p2-c15]"** ✅ 15s + NEW: **English verify-warning** "⚠ 1 citation could not be verified: [bk…-s0-p2-c15] (not shown to the model this turn)" → mechanism of the warning chips: model cites chunks from EARLIER turns (chat memory), verifier checks only this turn's context. Screenshot 87.
  - Q8 (off-book after book answers, no mention): "What is the capital of France?" → canned refusal 0s ✅ no context pollution. Screenshot 88.
  - Q9 (Arabic re-probe of Bug-4 facts, WITH mention): → tool trace shows `book_search` (query itself leaked "3923 2552 1448 77" — same pre-retrieval leak as Q4!) but then **`book_find_term("8,000")` + `book_find_term("3,923")` verification** → answer **"دُرِّب DiveeQuery على 8,000 مثال تدريبي [p2-c15]… العربية: 3,923 / الإنجليزية: 2,552 / الفرنسية: 1,448 / أمثلة عابرة للغات: 77 [p2-c16]"** ✅ **ALL FACTS CORRECT, 22s, no warnings**. Screenshot 89.
- VERDICT Bug 4 UPGRADE: Arabic numeric QA is **intermittent, model-behavior-dependent**: failure (Q4) = trusted leaked numbers in its own search query; success (Q9) = verified via book_find_term before answering. Grounding enforcement should REQUIRE term-verification for numeric claims.
- VERDICT follow-up behavior: un-mentioned follow-ups are flaky (Q5 refused though retrieval passes; Q7 passed) — gate in chat path scores raw message differently than the search API. Re-mentioning the book is the reliable path (matches user manual §4.2 advice).
- New-coverage test (.md ingest): TL Settings UI **GONE in new layout** — Settings modal now "OpenCode Desktop v1.19.5" with tabs General/Shortcuts/Servers/Providers/Models only; "Targeted" appears NOWHERE in DOM (routes /DiveeOI/settings?tab=targeted-learning, /DiveeOI/targeted-learning, /DiveeOI/learning all render 86-char empty shells). Screenshots 90/91. → library management is currently **API-only** (see Ops Manual §3).
- .md upload via API (base64 JSON per Ops Manual §3): POST /targeted-learning/books {filename:'md_probe.md', contentBase64, title:'Mini Probe Book'} → 200 bk_e53c7af988f24cce slug mini-probe-book; **ready, 1 chunk, error empty** within ≤12 s (first successful txt/md ingest ever — previously always error:"null").
- Multipart upload to the same route → **415 Unsupported content-type** (API is JSON-only; documented in Ops Manual).
- md Q&A BLOCKED by an infrastructure incident: first prompt in fresh session ses_e3d97d96 (created via POST /session default dir=packages/server) never executed (session time.updated==created, tokens 0). Retry in ses_e3d94a4a (dir=/home/celestial-dev/DiveeOI): prompt registered (updated>created) but **tokens stayed 0, no answer, no tool chips**; control prompt "Reply with the single word OK" also hung; **even the proven qa-v3b session hung on "OK2"** (time.updated stuck at Q9's 22:17Z value). → **prompt-execution stall starting ~22:20 UTC across ALL sessions** (LLM dispatch/bootstrap down; console: repeated "Failed to load sessions — Unexpected server error" + "Failed to finish bootstrap instance → 503 (empty body)"). Screenshot 93. TL retrieval path itself was healthy until the stall (Q5–Q9).
- Cleanup: Mini Probe Book deleted via DELETE /targeted-learning/books/bk_e53c7af988f24cce → 200; library back to 1 book. Console sweep: errors() empty; console shows only the two known error families above.
