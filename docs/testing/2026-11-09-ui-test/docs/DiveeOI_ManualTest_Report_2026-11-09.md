# DiveeOI — Live UI Manual Test Report

**Date:** 2026-11-09 (12:59–22:00 UTC) · **Tester:** automated agent under orchestrator supervision
**Target:** `https://diveeoi.celestialb.cv` (DiveeOI Desktop v1.17.8, DEV badge) → cloudflared → VDS port 6050
**Login:** in-app form, username `DIVEEOI` (pre-filled), legacy password (pair A) — works.
**Evidence:** `download/ui_test/` — 40+ numbered screenshots (`01-…`→`83-…`), `NOTES.md` (running log), `expected_facts.md`, `ingest_diagnosis.md`, `fix_round2..5.md`, this report.

---

## 1. Executive summary

| Area | Result |
|---|---|
| Login / workspace load | ✅ PASS (first load ~25–35 s, cookie persists) |
| Settings → Targeted Learning panel | ✅ PASS — setup steps all green (Probe/Preflight/Download/Verify/Runtime check/Golden self-test/Benchmark) |
| Book library (list / delete) | ✅ PASS via UI |
| **Book ingest (upload → index)** | ✅ PASS **after fix** — was ❌ broken since Nov 9 (see §3) |
| Retrieval quality (search API) | ✅ PASS — dense scores above gate, Arabic candidates returned |
| **Grounded Q&A (English)** | ✅ PASS — exact facts + chunk citations (`[bk…-s0-p2-c17]`) |
| **Grounded refusal (out-of-book)** | ✅ PASS — honest refusal, no world-knowledge leak; re-verified after book answers (Q8) |
| **Grounded Q&A (Arabic, numbers)** | ⚠️ **INTERMITTENT** — Q4 failed, but C3 re-probe (Q9) returned **every figure correctly** (8,000 / 3,923 / 2,552 / 1,448 / 77) when the model used `book_find_term` verification; failure mode = model trusting its own pre-retrieval numbers (see §5 Bug 4 upgrade) |
| **Follow-up turns without re-mention** | ⚠️ FLAKY — Q5 refused though the search API passed the same query; Q7 (single fact) passed; re-mentioning `@book:` is reliable (Q6) |
| **.md / .txt book ingest** | ✅ PASS (API path) — first-ever txt/md success: 1 chunk, `ready` ≤12 s |
| **TL settings UI (new layout)** | ❌ **MISSING** — Settings modal (OpenCode Desktop v1.19.5 layout) has no Targeted Learning tab; library management is API-only (Bug 13) |
| **Prompt execution (end of test)** | ❌ STALL — from ~22:20 UTC all prompts in ALL sessions queue with 0 tokens (Bug 14) |
| New-book ingest via UI upload | ✅ PASS (mechanism), server-side pipeline fixed |

**Bottom line:** after the ingest fix, the full targeted-learning loop works live: index a book → ask → Divee explains with passage citations → refuses what the books don't cover. Grounding is strong on re-mentioned questions (9/9 exact facts across Q1/Q2/Q6/Q7/Q9) but has two soft spots: numeric answers can be injected pre-retrieval (Q4) and un-mentioned follow-ups are flaky (Q5). At the very end of the session an infrastructure stall (Bug 14) froze all prompt execution.

---

## 2. Test flow (as executed)

1. **Login + explore** — screenshots `01`–`20`: workspace, projects sidebar, sessions, Settings (General / Targeted Learning / Providers / LLM / Models), @-mention popup, model picker, working memory, agent picker.
2. **Library + upload** (`21`–`46`, `50`–`56`, `61`): "Add book" accepts `.pdf/.docx/.txt/.md`; hidden `<input type=file>` responds to `agent-browser upload "input[type=file]" <path>`; delete works with JS confirm.
3. **Q&A battery** (`70`–`83`): 4 questions in one session (`ses_e3dbc8ef1ffe4ar6pD07xKPiOX`).

### Q&A results (book: *DiveeOI Scientific Research*, 10 pages, 50 chunks)

| # | Question | Expected (from PDF text) | Got | Verdict |
|---|---|---|---|---|
| Q1 | Student encoder params + architecture | 16,801,792; 384 hidden; 4 layers; 6 heads; FFN 1536 | **Exact match**, citation `…-p2-c17` | ✅ PASS |
| Q2 | int8 size vs teacher | 18.9 MB; ~120× smaller (0.83%) | "18.9 MB, ~120× smaller", citation `…-p2-c16` | ✅ PASS |
| Q3 | Out-of-book: "capital of Japan?" | honest refusal | "This isn't covered in the selected book(s)." — no leak | ✅ PASS |
| Q4 (AR) | Training examples count | 8,000 total / 3,923 Arabic | **"12,253 / 1,417"** — numbers absent from book (0 matches in PDF + 50 chunks) | ❌ FAIL (hallucination; UI verify-chip flagged "تعذّر التحقق من 2 مرجع") |

---

## 3. The big bug: silent ingest failure (`error:"null"`) — root cause + fix

**Symptom:** every book ingest (txt & PDF) failed in 3 ms–87 s with literal string `error:"null"`, progress 0, 0 chunks. One attempt also blew RSS 1.5 GB → 15.8 GB in ~60 s and killed the server process.

**Root cause chain (all evidence-verified):**
1. `packages/learning/src/embed/pipeline.ts:102-104` — dynamic import with a null-mapped catch:
   ```ts
   const transformers = yield* Effect.tryPromise({
     try: () => import("@huggingface/transformers"),
     catch: () => null,   // ← failure value is literally NULL
   })
   ```
2. Inside the **compiled binary** (`dist/@diveeoi/server-linux-x64-baseline/bin/diveeoi`, built Nov 5), that dynamic import fails at runtime → Effect fails with raw `null` → propagates through `ensureEmbedder` → `runIngest` catch (`run.ts:765`) → `String(null)` = `"null"` stored in `ingest_jobs.error`.
3. Source-mode resolution works because `packages/learning/node_modules/@huggingface/transformers@3.8.1` exists (bun isolated layout: `node_modules/.bun/…`).
4. Error hardening gap: `run.ts` catch stores `err instanceof Error ? err.message : String(err)` — a raw null defect collapses to `"null"`.

**Fix applied (unblocks everything):** run the server **from source**:
```bash
cd /home/celestial-dev/DiveeOI/packages/server
(setsid env PORT=6050 DIVEEOI_TL_DEBUG=all nohup bun run --conditions=browser ./src/main.ts < /dev/null > /tmp/diveeoi-src.log 2>&1 &)
```
Result: probe txt → `ready` (1 chunk); research PDF → **`ready`, 10 pages, 50 chunks**; RSS 2.3 GB (normal teacher load).

**Proper fix (pending, for production):**
- Patch `pipeline.ts` catch → `new EmbedError({ message: "transformers import failed: " + String(err) })`
- Patch `run.ts:766` → use `util.inspect(err)` (never collapses to `"null"`)
- Rebuild the binary (`bun build --compile`) with node_modules present, then restore systemd.

## 4. Student-runtime finding

The TL query encoder runtime (`targeted-learning/models/divee-query-student/`) was **v3b, promoted 2026-11-09** (`promoted: true`, gate `{minDenseScore: 0.35, minFusedScore: 0.03}`). A rollback test to v2 showed: v2's manifest ships **no gate thresholds** (fallback 0.45) and its encoder scored the Arabic test query below gate → chat refusals on borderline queries. **v3b is restored as active** — it is also the better model (R@10 0.668 vs v2 0.287/0.578 era metrics). Do not roll back to v2.

## 5. Bugs & issues found (numbered)

| # | Severity | Issue | Evidence |
|---|---|---|---|
| 1 | 🔴 Critical | Ingest fails silently (`error:"null"`) in compiled binary | §3; screenshots 44/54/56 |
| 2 | 🔴 Critical | Server crashes under ingest memory spike (RSS → 15.8 GB, process death, 502s) | `diveeoi-debug2.log` DevMonitor; cloudflared resets 16:52:43 |
| 3 | 🟠 Major | TL chat refused **every** message (even non-book) — blanket canned refusal | Phase C1 (pre-v3b-restore); fixed after v3b restore |
| 4 | 🟠 Major | Q4 Arabic numeric answer hallucinated figures not in the book — **C3 upgrade: numbers pre-date retrieval** (the agent's `book_search` query itself contained `12253 1417`); figures absent from v5/v4/v3 PDFs, live chunks and local eval JSONs → pre-retrieval context/parametric leak. Q9 re-probe shows the same leak can self-correct when the model runs `book_find_term("8,000")`/`("3,923")` verification before answering → grounding enforcement should **require term-verification for numeric claims** | §2 table; NOTES Phase C3; screenshots 83, 89 |
| 5 | 🟠 Major | "New session" banner button dead (no network call) | C1/C2 agents; workaround: `POST /session` via fetch |
| 6 | 🟡 Medium | Composer **Send button** dead — Enter works | C2 |
| 7 | 🟡 Medium | @ mention popup lists agents/files but **not books** (regression vs Phase A) | 71-mention-popup.png |
| 8 | 🟡 Medium | Sessions list "No sessions found" + console `SSE failed: 401`, 503 bootstrap errors | Phase 0 notes |
| 9 | 🟡 Medium | Citation-verify warnings (AR): "تعذّر التحقق من 2 مرجع" — verifier flags chunk-id citations | 83-arabic.png |
| 10 | ⚪ Low | Sessions page loads slow (~25–35 s first paint) | all phases |
| 11 | ⚪ Low | Arabic chunk text extraction garbles word order (RTL) — hurts numeric QA | chunk dump p2-c15 |
| 12 | 🟠 Major | **"Mathematics (English) - Part 1" book lost from library** (row + chunks purged during fix rounds; Trash empty; no orphaned FTS text). Original source survives on VDS: `diveeoi-artifacts/eb-pdf/Mathematics-En-EB-Part1.pdf` (+30-p sample 1,248,223 B; 67 MB `corpus/books.db` backup with 13× data). Golden math question **BLOCKED** until re-upload. `vds.py` has no file-pull (gateway truncates ~6.5 KB/response) — recovery needs operator SSH or UI re-upload of the pulled file | mathbook_hunt.md; NOTES Phase C3 |
| 13 | 🔴 Critical | **Targeted Learning settings UI gone in new layout** — Settings modal now "OpenCode Desktop v1.19.5" (General/Shortcuts/Servers/Providers/Models only); "Targeted" absent from entire DOM incl. hidden elements; routes `?tab=targeted-learning`, `/DiveeOI/targeted-learning`, `/DiveeOI/learning` render empty 86-char shells. Library add/delete + all TL tuning now **API-only** (Ops Manual §3) | 90/91-*.png; NOTES Phase C3 |
| 14 | 🔴 Critical | **Prompt-execution stall from ~22:20 UTC**: prompts in ALL sessions (new + proven) queue with 0 tokens, `time.updated` frozen; no answer, no tool chips, no page errors; console floods "Failed to load sessions — Unexpected server error" + "Failed to finish bootstrap instance → 503 (empty body)". TL retrieval path verified healthy minutes earlier (Q5–Q9) → LLM dispatch/bootstrap layer, not TL. Recovery: server restart / provider recovery | 93-prompt-stall-ok2-queued.png; NOTES Phase C3 |
| 15 | ⚪ Low | Citation-verify warning now also fires in ENGLISH with self-explaining mechanism: "1 citation could not be verified: [bk…-p2-c15] (not shown to the model this turn)" — follow-up turns cite chunks from earlier turns' context (chat memory), verifier checks only the current turn | 87-q7-ffn-cite-warning.png |

## 6. Discoveries / improvements to do next

1. **Harden all `catch: () => null` mappers** in `packages/learning/src` (6+ sites: pipeline.ts, parsers/index.ts ×5, hybrid.ts, sqlite-vec, store) — every one can repeat the "null" bug class.
2. **Grounding enforcement for tool-using turns:** Q4's model ignored retrieved chunks; enforce "cite only figures present in returned passages" in the grounding prompt + post-answer verify (the verifier already flags — consider blocking an answer whose citations all fail verification).
3. **Arabic parsing:** check the PDF text-extraction layer for RTL word-order handling (Bug 11 feeds Bug 4).
4. Restore systemd service + watchdog (needs sudo); current server runs manually (see Ops Manual §2).
5. UX: fix dead buttons (5,6), book mentions in popup (7), sessions list (8); add an ingest error tooltip (UI currently shows only `null`).
6. Docs pipeline: ISEF v5 terminology pass still queued.

## 7. Server state at end of test (2026-11-09 ~22:00 UTC)

- Server: **source mode**, pid on port 6050, HTTP 200, `DIVEEOI_TL_DEBUG=all`, log `/tmp/diveeoi-src.log`
- Library: *DiveeOI Scientific Research* — ready, 50 chunks (probe books deleted)
- Active student runtime: **v3b** (34 MB int8, gate 0.35/0.03); v2 copy kept at `divee-query-student.v2-tmp`
- Teacher: bge-m3 int8 545 MB at `models/Xenova/bge-m3/` (complete)
- books.db: healthy (`quick_check` ok), stale corrupt-backups from Oct still present

## 8. Round C3 addendum (2026-11-09, 22:00–22:45 UTC) — deeper Q&A + new coverage

Second Q&A battery on the proven session (`ses_e3dbc8ef1ffe4ar6pD07xKPiOX`, book bk_1054259ed5844b74):

| # | Probe | Expected | Got | Verdict |
|---|---|---|---|---|
| Q5 | Pronoun follow-up, **no re-mention**: "And how many attention heads does **it** have, and what is its BPE vocabulary…?" | 6 heads; 24,112 tokens / 96.6 % | canned refusal, 0 s — **but** direct `POST /targeted-learning/search` with the same query → `decision:"pass"` (dense 0.370 ≥ 0.35, fused 0.0318 ≥ 0.03, architecture chunk p2-c15 among candidates) | ❌ chat-side gate refuses follow-ups the index answers |
| Q6 | Explicit re-mention: "…How many transformer layers does the student query encoder have?" | 4 layers | "The student query encoder has 4 Transformer layers. [bk…-s0-p2-c15]" — 7 s | ✅ PASS |
| Q7 | No-mention follow-up, explicit noun: "What is the FFN size of the student query encoder?" | 1,536 | "FFN size is 1,536. [bk…-s0-p2-c15]" — 15 s + EN verify-warning "(not shown to the model this turn)" (Bug 15) | ✅ PASS |
| Q8 | Off-book after book answers: "What is the capital of France?" | honest refusal | canned refusal, 0 s — no context pollution | ✅ PASS |
| Q9 | Arabic re-probe of the Bug-4 facts, WITH mention | 8,000 / 3,923 ar / 2,552 en / 1,448 fr / 77 | **ALL CORRECT** — `book_find_term("8,000")` + `("3,923")` verification visible in tool trace; 22 s, no warnings | ✅ PASS (Bug 4 = intermittent, tool-verification-dependent) |

New coverage executed:

- **.md ingest via API** (TL UI unreachable, Bug 13): base64-JSON `POST /targeted-learning/books` → `bk_e53c7af988f24cce` "Mini Probe Book" → **`ready`, 1 chunk, ≤12 s** — first-ever txt/md ingest success (all prior txt/md attempts died with `error:"null"`). Multipart POST on the same route → `415 Unsupported content-type` (API is JSON-only). Book deleted afterwards (library restored to 1 book).
- **.md Q&A blocked** by the Bug-14 prompt stall (both a fresh session and the proven session queued with 0 tokens). Golden-ratio/ZANZIBAR-7741 answers remain to be verified after recovery.
- **Math golden question remains BLOCKED** (Bug 12): the 204-page Mathematics book was lost from the library during fix rounds; source survives on VDS (`diveeoi-artifacts/eb-pdf/Mathematics-En-EB-Part1.pdf`, 30-p sample, 67 MB corpus backup). Recovery requires operator file transfer (sandbox→VDS gateway cannot pull files).

Screenshots added: 85, 86, 87, 88, 89, 90, 91, 92, 93 (evidence dir `ui_test/`).

## 9. Server state at end of test (2026-11-09 ~22:45 UTC)

- Server: **source mode**, port 6050, `DIVEEOI_TL_DEBUG=all`, log `/tmp/diveeoi-src.log`; HTTP layer healthy but **prompt execution stalled since ~22:20 UTC** (Bug 14)
- Library: *DiveeOI Scientific Research* — ready, 50 chunks (md probe deleted; math book lost, Bug 12)
- Active student runtime: **v3b** (34 MB int8, gate 0.35/0.03); teacher bge-m3 int8 complete
- Frontend: **new layout live** (OpenCode Desktop v1.19.5 modal) — TL management UI removed (Bug 13)
