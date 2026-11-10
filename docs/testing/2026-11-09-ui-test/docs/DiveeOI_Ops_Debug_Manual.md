# DiveeOI — Operations & Debug Manual (VDS instance)

Companion to `DiveeOI_User_Manual.md` and `DiveeOI_ManualTest_Report_2026-11-09.md`. Everything here was executed and verified live on 2026-11-09.

---

## 1. Topology

```
Browser → https://diveeoi.celestialb.cv (Cloudflare)
        → cloudflared tunnel (systemd: cloudflared-diveeoi.service, on VDS)
        → 127.0.0.1:6050  DiveeOI server
                     ├─ targeted-learning: books.db (SQLite+vec), models dir
                     └─ (Rust sidecar divee-retrieval for native retrieval paths)
```

- **Server binary (compiled):** `/home/celestial-dev/DiveeOI/packages/server/dist/@diveeoi/server-linux-x64-baseline/bin/diveeoi` (built Nov 5, 183 MB)
- **Source:** `/home/celestial-dev/DiveeOI/` (bun monorepo, bun 1.4.4)
- **systemd unit:** `diveeoi.service` — `Environment=PORT=6050`, `WorkingDirectory=/home/celestial-dev/DiveeOI/packages/server` (⚠️ currently NOT used — see §2)
- **User for all commands:** `celestial-dev` (no sudo; systemd start requires human-authorized sudo)
- **Working directory matters:** the ingest worker resolves paths relative to CWD — always launch from `packages/server`.

## 2. Running the server

### Current production mode — FROM SOURCE (required until binary rebuild, see §5)
```bash
# stop anything on 6050 first
kill $(ss -tlnp | grep :6050 | grep -oP 'pid=\K[0-9]+' | head -1) 2>/dev/null

cd /home/celestial-dev/DiveeOI/packages/server
(setsid env PORT=6050 DIVEEOI_TL_DEBUG=all \
  nohup bun run --conditions=browser ./src/main.ts \
  < /dev/null > /tmp/diveeoi-src.log 2>&1 &)

# verify
sleep 15; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6050/   # expect 200
```
- Log: `/tmp/diveeoi-src.log` (DevMonitor heartbeats + TL diagnostics)
- `DIVEEOI_TL_DEBUG=all` enables TL diagnostics on stdout.

### Watchdog (optional, survives session exit)
```bash
cat > /tmp/diveeoi_watchdog.sh << 'EOF'
#!/bin/bash
cd /home/celestial-dev/DiveeOI/packages/server
BIN=dist/@diveeoi/server-linux-x64-baseline/bin/diveeoi
while true; do
  if ! ss -tln | grep -q ':6050'; then
    echo "[$(date -u +%H:%M:%S)] relaunching" >> /tmp/diveeoi-watchdog.log
    (setsid env PORT=6050 DIVEEOI_TL_DEBUG=all nohup bun run --conditions=browser ./src/main.ts \
      < /dev/null >> /tmp/diveeoi-src.log 2>&1 &)
    sleep 15
  fi
  sleep 30
done
EOF
chmod +x /tmp/diveeoi_watchdog.sh
(setsid bash /tmp/diveeoi_watchdog.sh < /dev/null > /dev/null 2>&1 &)
```
⚠️ Verify it stays alive after the launcher session closes (`pgrep -af diveeoi_watchdog`); the first installed copy died with its parent shell.

## 3. API quick reference (basic auth `DIVEEOI:<password>`, JSON)

```bash
# library
curl -u DIVEEOI:<pw> http://127.0.0.1:6050/targeted-learning/books

# add a book from a file ALREADY ON THE SERVER (fast path, no base64)
curl -u DIVEEOI:<pw> -X POST http://127.0.0.1:6050/targeted-learning/books/import \
  -H 'Content-Type: application/json' \
  -d '{"path":"/home/celestial-dev/books/DiveeOI_Scientific_Research.pdf","title":"DiveeOI Scientific Research"}'

# add a book from your machine (base64 JSON — multipart is rejected with 415)
curl -u DIVEEOI:<pw> -X POST http://127.0.0.1:6050/targeted-learning/books \
  -H 'Content-Type: application/json' \
  -d "{\"filename\":\"book.pdf\",\"contentBase64\":\"$(base64 -w0 book.pdf)\",\"title\":\"Book\"}"

# delete a book
curl -u DIVEEOI:<pw> -X DELETE http://127.0.0.1:6050/targeted-learning/books/<bookId>

# jobs: retry / cancel
curl -u DIVEEOI:<pw> -X POST http://127.0.0.1:6050/targeted-learning/jobs/<jobId>/retry
```
Notes: `POST /auth/sign-in` is NOT the web login (401 with UI creds); the API takes HTTP basic auth. Sessions for chat: `POST /session` then `POST /session/<id>/message` (see `final_live_test.py` pattern).

## 4. Key data locations

| Item | Path |
|---|---|
| books.db (SQLite, chunks + chunk_vecs + ingest_jobs) | `~/.local/share/diveeoi/targeted-learning/books.db` |
| Teacher embedder (bge-m3 int8, 545 MB, complete) | `~/.local/share/diveeoi/targeted-learning/models/Xenova/bge-m3/` |
| Active query-encoder student | `~/.local/share/diveeoi/targeted-learning/models/divee-query-student/` |
| Runtime backups | `…/models/divee-query-student.v2-tmp` (v2), model store `~/diveeoi-artifacts/models/student-v3a-runtime`, `student-v3b-runtime`, `student-v2-runtime` … |
| Source server log | `/tmp/diveeoi-src.log` |
| TL debug logs | stdout of the server process (DIVEEOI_TL_DEBUG=all) |

**Active student = v3b** (`divee-student.json`: `promoted: true`, gate `{minDenseScore:0.35, minFusedScore:0.03}`, int8 34 MB). Do NOT roll back to v2 — its manifest has no calibrated gate and its encoder under-scores borderline queries (caused blanket chat refusals on 2026-11-09).

## 5. The ingest "null" bug — full story & permanent fix

**Cause (verified 2026-11-09):** inside the compiled binary, `import("@huggingface/transformers")` fails at runtime; `pipeline.ts:102-104` maps that failure to raw `null`; `run.ts:765` catch stores `String(null)` = `"null"`. From source the import resolves (`packages/learning/node_modules/@huggingface/transformers@3.8.1`, bun isolated layout under `node_modules/.bun/`).

**Permanent fix checklist:**
1. `pipeline.ts` — replace the null-mapped catch:
   ```ts
   catch: (err) => new EmbedError({ message: `transformers import failed: ${String(err).slice(0,300)}` }),
   ```
2. `run.ts:766` — replace `String(err)` with `util.inspect(err)` so non-Error defects never collapse.
3. Audit ALL `catch: () => null` mappers: `embed/pipeline.ts`, `parsers/index.ts` (×5), `retrieve/hybrid.ts` (×2), `sqlite-vec/index.ts`, `store/index.ts` (×2).
4. Rebuild the binary with deps present: `cd /home/celestial-dev/DiveeOI && bun install --frozen-lockfile && bun build --compile` (server package build script), then swap `dist/…/bin/diveeoi` and re-enable systemd (`sudo systemctl restart diveeoi` — needs authorized sudo).
5. Re-test ingest: probe txt import → expect `ready` with chunks > 0.

## 6. Debug toolkit (what worked during the 2026-11-09 investigation)

- **Read jobs truth:** `sqlite3` file-URI read-only on books.db → `select id,status,error,stage,progress from ingest_jobs order by rowid desc limit 5` (the UI shows only `null`).
- **Watch a live ingest:** `timeout 300 tail -f -n 0 /tmp/diveeoi-src.log > /tmp/upload_window.log` in background, trigger upload, read the window (DevMonitor RSS lines expose memory explosions).
- **Isolated pipeline repro** (bypasses the server): a bun script importing `@diveeoi/learning` embed pipeline from source — worked even when the server didn't, proving model files were fine.
- **books.db health:** `pragma quick_check` → ok. 13 `books.db.corrupt-*` backups from Oct 29–Nov 1 still in the TL dir (cleanup candidate).
- **Cloudflared is rarely the problem:** check `systemctl is-active cloudflared-diveeoi` + `curl 127.0.0.1:6050` locally; 502 from CF = origin process down.
- **zsh landmines on the VDS:** unquoted `===word===` triggers nomatch glob aborts; `pkill`-style compound commands sometimes return unparseable gateway responses (retry, split commands).

## 7. Related systems on the same VDS (don't touch)

PM2 apps (celestial-api/bot, lavalink, deepseek-proxy, movie-me, remotedesk), `diveeoi-ci-platform` (port 8083), colab tunnel (colabtun sshd), nginx sites. DiveeOI is NOT under PM2 — it's systemd/manual.

## 8. Health snapshot (end of 2026-11-09 test)

- Server: source mode, port 6050, HTTP 200, RSS ~2.3 GB after teacher load
- Library: *DiveeOI Scientific Research* ready (10 pages / 50 chunks)
- Ingest: ✅ working (source mode) · Retrieval: ✅ (dense gate passing) · Refusals: ✅ honest
- Open items: binary rebuild (§5), systemd restore, watchdog persistence, UI bugs #5–#9 (see Test Report §5), Arabic numeric grounding (Test Report Bug 4)

## 9. Round C3 addendum (2026-11-09 evening) — new operational knowledge

### 9.1 Prompt-execution stall (incident, ~22:20–22:45 UTC)
**Symptoms:** prompts in ALL sessions (new and previously-working) queue with 0 tokens; `GET /session/<id>` shows `time.updated` frozen; UI renders the optimistic "Build · GPT 5.6 Sol" header but no text, no tool chips; console floods `Failed to load sessions — Unexpected server error` and `Failed to finish bootstrap instance … → 503: (empty response body)`; `agent-browser errors` stays empty.
**Isolation:** TL retrieval (`POST /targeted-learning/search`) returned `decision:"pass"` minutes earlier → not TL. Sessions created via `POST /session` in directory `…/packages/server` never even registered the prompt (`time.updated == time.created`) → prefer `{"directory":"/home/celestial-dev/DiveeOI"}` when creating sessions via API.
**Recovery:** restart the server (§2) once the LLM provider is reachable again; re-send queued prompts.

### 9.2 TL settings UI removed in the new frontend layout
The Settings modal is now "OpenCode Desktop v1.19.5" with General/Shortcuts/Servers/Providers/Models — the Targeted Learning tab is gone from the DOM entirely, and `?tab=targeted-learning` / `/DiveeOI/targeted-learning` routes render empty shells. **Library management is API-only until the tab returns** — use §3 (add/import/delete/retry all verified live; multipart upload is rejected with 415, use the base64 JSON form).

### 9.3 Lost book recovery — "Mathematics (English) - Part 1"
The 204-page math book's row + chunks were purged from books.db during the fix rounds (Trash empty, no orphaned FTS text). Surviving copies on the VDS:
1. `/home/celestial-dev/diveeoi-artifacts/eb-pdf/Mathematics-En-EB-Part1.pdf` — exact title match, in a 39-file curriculum stash (size unverified)
2. `/home/celestial-dev/diveeoi-artifacts/Mathematics-EN-Part1.pdf` — 1,248,223 B, 30 pages (likely partial)
3. `/home/celestial-dev/diveeoi-artifacts/corpus/books.db` — 67,215,360 B Nov-5 backup (13× live DB; contains old rows/passages as text)
4. `/home/celestial-dev/diveeoi-artifacts/corpus/eb-passages.jsonl` — 4,021,157 B extracted passages

To re-index: pull the PDF to a machine with browser access and add it via the §3 API (or `books/import` since the file is already on the server: `{"path":"/home/celestial-dev/diveeoi-artifacts/eb-pdf/Mathematics-En-EB-Part1.pdf","title":"Mathematics (English) - Part 1"}`). NOTE: the sandbox gateway (`vds.py`) truncates command output ~6.5 KB and has no file-pull — file transfer needs operator SSH/SCP.

### 9.4 Health snapshot after Round C3 (~22:45 UTC)
- Ingest ✅ (incl. first-ever `.md`: 1 chunk, ready ≤12 s) · Retrieval ✅ · Refusals ✅ · Arabic grounding ⚠️ intermittent (needs `book_find_term` verification enforcement) · Prompt execution ❌ stalled at test end
- Library: 1 book (*DiveeOI Scientific Research*, 50 chunks) — math book lost (§9.3), md probe deleted after test
- Open items: binary rebuild (§5), systemd restore, watchdog persistence, UI bugs #5–#9 + #12–#15 (Test Report §5/§8), golden math question re-test after book recovery
