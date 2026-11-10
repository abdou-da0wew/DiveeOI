# DiveeOI ingest failure — VDS diagnosis (2026-11-09, read-only investigation)

Symptom: book ingest jobs fail (job `job_e732c30985d1` among them); API returns `error:"null"`.
Host: VDS-6099. App: DiveeOI server (Bun single-file binary), TL (Targeted Learning) data at
`/home/celestial-dev/.local/share/diveeoi/targeted-learning/`.

---

## 1. Process state (two server instances, both alive)

```
celesti+ 184774  Oct31  diveeoi-ci-platform --config ~/.config/diveeoi-ci-platform/config.json   (CI helper, unrelated)
celesti+ 3643818  Nov03  2.4 GB RSS  pts/6  /home/celestial-dev/DiveeOI/packages/server/dist/@diveeoi/server-linux-x64/bin/diveeoi   ← STRAY, port 4097
celesti+ 3717321  16:52  1.0 GB RSS  systemd  .../server-linux-x64-baseline/bin/diveeoi                ← systemd diveeoi.service, port 6050
```

- Ports confirmed: `ss -tlnp`: pid=3643818 → 0.0.0.0:4097, pid=3717321 → 0.0.0.0:6050.
- **Stray 4097 (3643818)**: started **Nov 3 23:09** as a child of an interactive `zsh -i` (pid 691016, pts/6, SSH
  session from Nov 2). Not managed by systemd. `readlink /proc/3643818/exe` →
  `.../server-linux-x64/bin/diveeoi (deleted)` — it runs a **deleted inode** of the pre-Nov-5 build
  (dist was rebuilt Nov 5 12:34). cwd `/home/celestial-dev/DiveeOI`.
- **Systemd 6050 (3717321)**: `ExecStart=.../server-linux-x64-baseline/bin/diveeoi`, `PORT=6050`,
  `Restart=on-failure`, `RestartSec=5s`, started 16:52:48.
- **`systemctl show diveeoi.service` → `NRestarts=632`** — the unit has crash-looped chronically
  (632 automatic restarts). Journal shows 4 more restarts today: 16:23:20, 16:28:05, 16:50:03, 16:52:50.
- Public traffic (`diveeoi.celestialb.cv` via cloudflared) reaches **6050 only**; cloudflared logged the
  crash of the previous 6050 instance:
  `16:52:43 ... read tcp 127.0.0.1:35118->127.0.0.1:6050: read: connection reset by peer` then
  `dial tcp 127.0.0.1:6050: connect: connection refused`, then `16:52:50 diveeoi[3717321]: DiveeOI server listening`.
  → **The 6050 process crashed ~9 s after the 16:52:34 ingest job started and auto-restarted.**

## 2. What the ingest job actually recorded (books.db, read-only query)

`sqlite3 file:.../targeted-learning/books.db?mode=ro`:

```
ingest_jobs: job_e732c30985d1  book=bk_c6da187cdd4241ea (DiveeOI_Scientific_Research, PDF 927 KB)
             stage=parse  status=failed  progress=0
             started 2026-11-09 16:52:34   finished 16:54:02 (87 s)
             error = 'null'   ← literal string "null" in the DB (SQL NULL/'' would render blank; verified
                                  with `sqlite3 :memory: -line "SELECT NULL,NULL"` → blank)
books:       bk_c6da187cdd4241ea status=failed error='null' chunk_count=0
```

All 5 jobs of today failed the same way — `stage=parse, status=failed, progress=0, error='null'`
(3 of them instant, dur=0 s: 16:33:45, 16:34:56, 16:35:38 — even a 131-byte plain-text probe book
`tl_probe_book`; the 2 longer ones were jobs interrupted by process crashes and re-run after restart,
69–72 s ≈ embedder init time, then failed with the same 'null').
**Last successful ingest: Nov 8 23:19 (`job_7e63815f07a9`, 702 s, complete, stage=summary).**
No code/binary/config changed since (dist mtime Nov 5 12:34, git tree unchanged since commit 05751dd
of Nov 8 23:52 which is *newer* than the running binary, unit file Oct 20).

### Why `error:"null"` (mechanism)
`packages/learning/src/ingest/run.ts` (catch block, ~line 765-778):
```ts
} catch (err) {
  const message = cancelled ? "Ingest cancelled" : err instanceof Error ? err.message : String(err)
  ...
  .run("UPDATE books SET status = ?, error = ? WHERE id = ?", ..., message.slice(0, 500), ...)
```
The DB contains the **string `"null"`** ⇒ the caught value was literally `null`
(`String(null) === "null"`). All typed failure paths (`ParseError`, `EmbedError`,
`failUnresumableJob("Stored source file …")`) would store a real message — so the pipeline
died with a raw `null` rejection/defect during the parse-stage setup (embedder `ensure()` runs
*before* `setStage("parsing","parse",2)`, which is why `stage` stays `parse`, `progress` stays 0).
The embedder stack (transformers.js v3.8.1 + WASM onnx backend, bge-m3 int8, model files present:
`models/Xenova/bge-m3/onnx/model_int8.onnx` 568 MB Oct 30) was verified healthy **in isolation**:
a throwaway `bun` process (no state touched) ran pipeline init + inference successfully
(`PIPELINE OK / EMBED OK dims 1024`). So the failure is specific to the in-server (compiled-binary,
long-lived-process) runtime, not to the model files. Note `EmbedError`/`ParseError` are Effect
v4-beta (`effect 4.0.0-beta.74`) tagged errors; a raw defect (thrown/rejected `null`) is not wrapped
anywhere and reaches the catch as `null` → `"null"`.

Also: TL diagnostics are **disabled** (`DIVEEOI_TL_DEBUG` unset in both processes' env — verified
via /proc/*/environ), so `logDiagnostic(...)`/`diagnostic.fail(...)` wrote nothing to disk —
no TL log files exist (only `~/.local/share/diveeoi/log/opencode.log`, which contains no ingest
errors). That's why the real exception is invisible in logs.

## 3. Shared books.db — YES

```
fuser/lsof /home/celestial-dev/.local/share/diveeoi/targeted-learning/books.db:
  diveeoi 3643818 (stray 4097)   fd 17u  read-write
  diveeoi 3717321 (systemd 6050) fd 18u  read-write
```
Both instances opened the **same** books.db (same inode 8470560) and use the same TL data dir
(`DIVEEOI_TL_DATA_DIR` unset → default `~/.local/share/diveeoi/targeted-learning`).
SQLite `PRAGMA quick_check` → `ok`; WAL mode (`books.db-wal` 708 KB, touched 16:54).
There are also **13 `books.db.corrupt-<ts>`** backups (Oct 29 → Nov 1) from an earlier
corruption era. A pre-Nov-5 binary and the current binary writing the same DB concurrently is
untested territory and a plausible contributor to instability.

## 4. Memory / disk / OOM

- `free -m`: 32 GB cgroup limit, **19.5 GB used, 13.2 GB available**, **no swap**. Stray holds 2.4 GB RSS.
- **No OOM-kill events** in `dmesg`/`journalctl -k`.
- But the previous 6050 instance logged **"Emergency GC" three times at 16:22:36–16:22:50** right before it
  died/restarted (heap pressure inside the server process; its DevMonitor target is 7209 MB heap).
- Disk: 768 GB volume, 253 GB used, 516 GB free — fine.
- Crash summary today (journal + Restart=on-failure): instance 3668029 died ~16:28:00 (24 s into job
  `job_0d6ec01eb07f`); instance 3711082 died 16:52:43 (9 s into `job_e732c30985d1`). Both crashes
  occurred **while an ingest job was running**.
- Unrelated but noted: `16:38:48 ERROR (#121880): failed` — `Error: Path is not a directory` from the
  file-browser HTTP API (not ingest).
- `diveeoi-ci-platform` (pid 184774, since Oct 31) and a root headless Chrome (puppeteer) also run on the box.

## 5. Root-cause hypothesis (ranked)

1. **PRIMARY — ingest dies inside the 6050 server with a raw `null` rejection swallowed as `error:"null"`**,
   during embedder init/parse setup (`stage=parse, progress=0`); since Nov 9 ~13:00 the same binary that
   succeeded on Nov 8 23:19 now fails deterministically (txt AND pdf, 0–90 s), and two attempts also
   **crashed the whole process** (cloudflared `connection reset by peer` 16:52:43; restart #s today:
   16:23, 16:28, 16:50, 16:52; `NRestarts=632` historically). Exact error line proving the mechanism:
   `ingest_jobs.error = 'null'` (string) + `books.error = 'null'` + `status=failed, stage=parse, progress=0`.
   The true exception text is unobtainable because TL diagnostics are disabled (`DIVEEOI_TL_DEBUG` unset)
   and stdout only carries DevMonitor/Adaptive noise.
2. **CONTRIBUTING — dual server instances on one books.db / one TL dir.** The stray 4097 (old deleted-inode
   binary, started manually Nov 3, 2.4 GB RSS, fd 17u read-write) co-writes the DB the systemd service
   ingests into; it is not managed, not restarted with the code, and runs pre-Nov-5 TL code.
3. **CONTRIBUTING — crash-looping service + interrupted jobs.** `Restart=on-failure` masks the crashes;
   orphaned `running` jobs are re-run at boot (`resumePersistedIngestJobs`) and fail again, hiding the
   first-failure stack.
4. Ruled out: OOM-kills (none in kernel log), disk (516 GB free), missing model files (verified),
   broken books.db (quick_check ok), recent code/binary/config changes (none since the Nov 8 success).

## 6. Recommended minimal fix

1. **Kill the stray 4097 instance** (pid 3643818) and close/detach its parent SSH session — it's an
   unmanaged duplicate writing the same books.db: `kill 3643818` (its binary inode is already deleted;
   a restart of it would fail anyway).
2. **`systemctl restart diveeoi.service`** to get a clean single-writer process.
3. **Retry one probe ingest with diagnostics on**: add `Environment=DIVEEOI_TL_DEBUG=ingest,embed`
   (and optionally `=all`) to the unit before restarting — this makes `diagnostic.fail()` write the real
   exception to a TL log file, which will expose the exact `null`-rejection source on the next attempt.
4. Code hardening (next deploy): in `run.ts` catch, log `err` via a formatter that handles
   null/defects (e.g. `Effect.runPromise` rejections / defects → `Cause.pretty`), so `error:"null"`
   can never happen again; and consider gating `Restart=on-failure` crash-storms (start-limit).
5. Only if (3) shows the crash inside onnxruntime/transformers under the compiled binary: rebuild the
   dist binary from current source (the running one predates commit 05751dd) and re-test; the standalone
   bun+node_modules stack already works, so a rebuild is the likely final fix.

— Diagnostics agent, 2026-11-09 17:30 UTC. All steps were read-only (sqlite `mode=ro`, no restarts,
  no kills; throwaway repro process deleted its own /tmp script).
