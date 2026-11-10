# VDS Round 3 — DiveeOI TL debug-env relaunch + manifest

Goal: locate manifest/tokenizer/onnx runtime files, relaunch manual server (pid 3795974, port 6050) with DIVEEOI_TL_DEBUG=all + persistent log, find where debug logs land. Budget: 4 vds.py calls.

---

## CALL 1 — Manifest + runtime files (read-only)
Command executed: find manifest / *.json / TL dirs / tokenizer+onnx under ~/.local/share/diveeoi and ~/diveeoi-artifacts/models

### Findings
- **NO file matching `*manifest*` exists** anywhere under `/home/celestial-dev/.local/share/diveeoi` (maxdepth 4). Manifest is created at ingest time or stored in DB (`diveeoi.db`), not on disk.
- JSON files (maxdepth 2): `~/.local/share/diveeoi/targeted-learning/setup.json`, `~/.local/share/diveeoi/auth.json` (NOT read — sensitive).
- TL dir listing: `auth.json diveeoi.db log opencode-*.db(+shm/wal) repos snapshot storage targeted-learning tool-output`. There IS a `log/` dir under `.local/share/diveeoi`.
- Runtime models (live, used by server): `~/.local/share/diveeoi/targeted-learning/models/Xenova/bge-m3/{tokenizer.json,config.json}` (embedder) and `~/.local/share/diveeoi/targeted-learning/models/divee-query-student/{config.json,tokenizer.json,onnx/model.onnx,onnx/model_int8.onnx}` (student reranker).
- Artifact store (source of models): `~/diveeoi-artifacts/models/{student-v1-runtime, student-v3a-runtime, student-v5-runtime, student-runtime}` each with `tokenizer.json, tokenizer_config.json, config.json, onnx/model.onnx, onnx/model_int8.onnx, divee-student.json`; plus non-runtime `student-v3/v4/v5` with config.json+eval-report.json. NOTE: no `student-v2`; `student-runtime` likely symlink → active version (v5?).
- Conclusion: server model dir = targeted-learning/models; "divee-query-student" is the deployed student. Model files present, untouched (do not delete).

## CALL 2 — Relaunch with debug env
Command: kill 3795974; relaunch `PORT=6050 DIVEEOI_TL_DEBUG=all DIVEEOI_TL_DATA_DIR=.../targeted-learning setsid nohup bin/diveeoi > /tmp/diveeoi-debug.log 2>&1` (fallback branch prepared but NOT needed).

### Result: SUCCESS on attempt 1
- Old pid 3795974 killed; new server pid **3802683** (user celesti+), listening `127.0.0.1:6050` (`ss` shows users:(("diveeoi",pid=3802683,fd=9))).
- `ATTEMPT1:200` — HTTP 200 on `http://127.0.0.1:6050/` with debug env active. Fallback (retry without DIVEEOI_TL_DATA_DIR) NOT triggered → **DIVEEOI_TL_DATA_DIR did not break startup** (harmless even if unsupported).
- Process cmdline unchanged (env vars don't show in ps cmdline — must inspect /proc/3802683/environ or logs to confirm env took effect).
- stdout+stderr persistently captured to `/tmp/diveeoi-debug.log`.
- setup.json head (safe): `{"schemaVersion":1,"status":"ready","steps":[{"name":"probe","status":"complete",...platform linux/x64/glibc, cpuCores 8...}}` — TL setup ready.
- CALL 4 (plain-restore) NOT required.

## CALL 3 — Verify + debug log target
Command: tail /tmp/diveeoi-debug.log; find recent *.log under targeted-learning + /tmp; env check via /proc/3802683/environ.

### Findings
- **Env vars confirmed active on new pid 3802683** (via /proc environ): `PORT=6050`, `DIVEEOI_TL_DEBUG=all`, `DIVEEOI_TL_DATA_DIR=/home/celestial-dev/.local/share/diveeoi/targeted-learning`.
- Startup log is clean: `DiveeOI server listening on http://127.0.0.1:6050`; DevMonitor heartbeats OK (RSS ~836MB, heap ~355MB, profile "balanced"). Only WARN: `ssh.start.skipped reason:"no password configured"` (pre-existing, harmless, unrelated to TL).
- **Debug log target = `/tmp/diveeoi-debug.log`** (persistent, survives UI retry; contains stdout+stderr). No new *.log created inside `~/.local/share/diveeoi/targeted-learning/` → TL debug output goes to stdout, i.e. the /tmp file.
- Note: `/tmp/diveeoi-6050-r2.log` (previous round's log) still present — do not confuse the two.
- TL setup status "ready" (setup.json), models present → server ready for UI retry upload of book ingest.

## CALL 4 — SKIPPED (server UP, HTTP 200; budget spent: 3/4)

---

## FINAL STATUS
- **Server UP**: pid **3802683**, port 6050, HTTP 200, launched via `setsid nohup` as celestial-dev, env `DIVEEOI_TL_DEBUG=all` + `DIVEEOI_TL_DATA_DIR` confirmed in /proc environ.
- **Manifest**: no `*manifest*` file on disk — manifests live in `diveeoi.db` / created per-ingest.
- **Models**: runtime = `~/.local/share/diveeoi/targeted-learning/models/` (Xenova/bge-m3 embedder + divee-query-student onnx/int8); artifacts = `~/diveeoi-artifacts/models/student-v{1,3a,5}-runtime` + `student-runtime` (all preserved).
- **Debug log**: `/tmp/diveeoi-debug.log` — tail this after the UI retry upload to capture the real TL ingest exception (previously swallowed null).
- **Next action**: retry the book ingest upload via UI; then `tail -100 /tmp/diveeoi-debug.log` (grep for ERROR/TL) to extract the real stack trace.
