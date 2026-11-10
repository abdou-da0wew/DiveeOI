# DiveeOI Ingest Failure — Fix Round 4 (CWD theory test + live capture)

Date started: (UTC clock recorded per step)
Hypothesis: systemd unit ran server with `WorkingDirectory=/home/celestial-dev/DiveeOI/packages/server`, but the manual relaunch at 17:59:54 had CWD=/home/celestial-dev. Suspect TL ingest worker spawns relative to CWD and dies instantly → jobs fail with error:"null".

Budget: 10 vds.py calls max. Browser commands unlimited.

Credentials note: login uses prefilled username DIVEEOI + password "pair A" (not printed here).

---

## STEP 1 — Confirm CWD suspicion
Command (vds call #1):
`readlink /proc/3802683/cwd; echo ---SYSTEMD_WD---; systemctl cat diveeoi.service | grep -E "WorkingDirectory|Environment"`

Result: CONFIRMED MISMATCH
- `readlink /proc/3802683/cwd` → `/home/celestial-dev`  (manual launch, wrong CWD)
- systemd: `WorkingDirectory=/home/celestial-dev/DiveeOI/packages/server` + `Environment=PORT=6050`

So the live server (pid 3802683) runs from `/home/celestial-dev`, NOT the systemd working dir. This matches the hypothesis that the TL ingest worker is spawned relative to CWD and dies instantly (2 failed jobs 18:03/18:04 with error:"null").

---

## STEP 2 — Relaunch server with correct CWD
Command (vds call #2): kill 3802683; cd packages/server; PORT=6050 DIVEEOI_TL_DEBUG=all setsid nohup dist/@diveeoi/server-linux-x64-baseline/bin/diveeoi → /tmp/diveeoi-debug2.log; then verify new pid CWD + :6050 health.

Result: SUCCESS
- New server CWD: `/home/celestial-dev/DiveeOI/packages/server` (matches systemd WorkingDirectory)
- `curl http://127.0.0.1:6050/` → `6050:200` (healthy)
- New pid: recorded in STEP 3 output (listener on :6050)
- Log file: /tmp/diveeoi-debug2.log

---

## STEP 3 — Start log capture window (150s tail -f into /tmp/upload_window.log)
Result: PENDING

## Round 4b (19:20-19:26 UTC) — via agent-20f2a732
- Browser daemon restarted; login OK (pair A); 300s capture armed 19:21:20.
- Probe txt uploaded via UI at ~19:23 → status `failed` within ~5s, passages null, NEVER entered processing. 6 polls stable failed. Screenshot 61-probe-cwdtest.png.
- PDF upload NOT attempted (gated on probe).
- Capture log NOT read yet (VDS 500 + sandbox outage). It should contain server output during 19:21:20-19:26:20 window including the upload.
- VERDICT: STILL BROKEN even with correct CWD. Near-instant fail = worker spawn/parsing issue, not model pacing.
- PENDING: read /tmp/upload_window.log + /tmp/diveeoi-debug2.log tail + ingest_jobs error column; then inspect ingest runner source for the null-throw mechanism.
