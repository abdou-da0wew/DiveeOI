# Targeted Learning diagnostics and live validation

Targeted Learning runtime diagnostics are opt-in and are designed for both production builds and development. The diagnostic path has focused tests and source/type checks, but the full server bundle still needs a dependency-complete build. The executable reads configuration at runtime; restart the server after changing deployment environment variables (no application rebuild is needed).

## Enable diagnostics

Set `DIVEEOI_TL_DEBUG` to `1`/`all` for every Targeted Learning category, or to a comma-separated allowlist:

```bash
# Full trace for one production run
DIVEEOI_TL_DEBUG=all

# Smaller trace, with HTTP interactions and the full learning pipeline
DIVEEOI_TL_DEBUG=http,service,setup,download,ingest,retrieval,session,grounding,settings
DIVEEOI_TL_DEBUG_LEVEL=trace
DIVEEOI_TL_DEBUG_HANG_MS=60000
```

Categories are `http`, `service`, `setup`, `download`, `ingest`, `retrieval`, `session`, `grounding`, and `settings`. `DIVEEOI_TL_DEBUG_LEVEL` accepts `error`, `warn`, `info`, or `trace` (default: `trace`). The file is JSON Lines at `<DIVEEOI_TL_DATA_DIR>/logs/targeted-learning-debug.jsonl`; if `DIVEEOI_TL_DATA_DIR` is unset, the learning service selects its normal application data directory. To choose another path, set `DIVEEOI_TL_DEBUG_FILE` to an absolute path or a path relative to the Targeted Learning data directory.

The logger rotates the current log at 20 MB by default and retains three numbered backups. Set `DIVEEOI_TL_DEBUG_MAX_LOG_MB` to change the size limit. New log directories are created with restrictive permissions and the log file is written as owner-only (`0600` where supported). `DIVEEOI_TL_DEBUG_CONSOLE=1` additionally mirrors diagnostic events to stderr; leave this off unless console output is specifically needed.

### Privacy defaults

- Diagnostics are off unless `DIVEEOI_TL_DEBUG` is set.
- Authorization headers, cookies, passwords, tokens, API keys, and credential-like fields are redacted.
- Query, prompt, answer, passage, free-form messages, and error-message text are recorded as length-only summaries by default. Error type and stack frames remain available. HTTP middleware deliberately records only method and path, never headers, query parameters, or request bodies.
- `DIVEEOI_TL_DEBUG_CONTENT=1` opts into capped text previews (up to 2,000 characters per field). Treat these logs as sensitive user data; do not enable content logging on a shared or externally accessible production machine unless necessary, and delete the logs after the investigation.

## Inspect live state and logs

The status endpoint is behind the same authentication middleware as the rest of Targeted Learning:

```bash
curl -u "$DIVEEOI_SERVER_USERNAME:$DIVEEOI_SERVER_PASSWORD" \
  http://localhost:4097/targeted-learning/debug/status

# If the data directory is unset or DEBUG_FILE is customized, use `logFile` from the status response.
tail -F "$DIVEEOI_TL_DATA_DIR/logs/targeted-learning-debug.jsonl"
```

The endpoint reports whether diagnostics are enabled, selected categories and level, active operation spans, the latest errors, event counts, write failures, and the log path. It does not return the full log. An operation includes an ID, component, current stage, start/last-progress times, elapsed/idle time, and a `stalled` indicator. Correlate that ID with JSONL records. A `operation.stalled` warning means no progress checkpoint arrived for `DIVEEOI_TL_DEBUG_HANG_MS`; it does not by itself prove a deadlock (for example, a long CPU-bound batch can be quiet between progress checkpoints). Paused ingest work is marked paused and excluded from stall warnings. The Targeted Learning session watchdog also logs stalls while a model stream is active.

## What is traced

- `http`: authenticated Targeted Learning API requests and response status, without credentials or bodies.
- `service`: runtime/library initialization and persisted-job recovery.
- `setup`: each persisted setup step's running/completed/failed/cancelled state and errors.
- `download`: per-file attempts, byte progress, verification, retries, and stalls.
- `ingest`: queued jobs, parse/OCR/chunk/embed/summarize stage changes, progress, pause/resume/cancel, completion, and failures. Book contents are not logged by default.
- `retrieval`: query rewriting, BM25/dense counts, top candidate IDs/scores (text previews are redacted by default), thresholds, and the final gate decision.
- `session`: book attachment, targeted-turn decision, model-response duration and throttled stream progress, plus the existing session watchdog's targeted-session stalls.
- `grounding`: extracted citation count, verification outcome, failure count, and whether the one retry path was used.
- `settings`: records successful Targeted Learning settings updates using changed-field names only; setting values are never included.

Useful event names include `operation.start`, `operation.progress`, `operation.complete`, `operation.error`, `operation.cancelled`, `operation.stalled`, `step.state`, `candidates.scored`, `gate.decision`, and `citations.verified`.

## Validation procedure

Run the code-only diagnostics test first, then the package suite and typechecks once workspace dependencies are installed:

```bash
cd packages/learning
bun test test/diagnostics.test.ts
bun test
bun run typecheck

cd ../server
bun run typecheck
```

For a real model-backed service check, start the production build (or the normal local server) with the debug environment above and valid authentication. The pinned embedding model must be available locally or downloadable by the server.

1. Query `/targeted-learning/health` and `/targeted-learning/debug/status`; confirm the library/manifest state and that the selected categories appear.
2. In Settings → Targeted Learning, run **Start Setup**. Follow `setup.step.*` spans and `step.state` records through probe, preflight, download, verification, runtime check, semantic self-test, benchmark, and profile recommendation. If it waits, inspect the active span's `stage`/`idleMs` and download progress before calling it a hang.
3. Run the end-to-end retrieval/gate calibration script, keeping its temporary books for the manual session check:

   ```bash
   export AUTH="Basic $(printf '%s:%s' "$DIVEEOI_SERVER_USERNAME" "$DIVEEOI_SERVER_PASSWORD" | base64 | tr -d '\n')"
   BASE=http://localhost:4097 bun scripts/tl-live-check.ts --dtype int8 --keep
   ```

   The script exercises setup (unless `--skip-setup`), uploads English and Arabic fixtures, indexes them, and tests in-book, off-topic, and small-talk queries through the real retrieval and gate. Use `--apply` only if you intentionally want its suggested threshold written to settings. It makes no LLM calls.
4. From the Library UI/API, verify the two books reach `ready`; inspect `ingest` spans for `parse`, `chunk`, `embed`, and `summary` completion. Exercise pause/resume/cancel on a disposable upload if those controls are part of the release test.
5. In a chat with an available LLM provider, attach a retained fixture using `@book:<slug>`. Ask one question answered in the source, a clearly off-topic question, and a brief greeting. Confirm the relevant question enters `model-response`, the off-topic question is refused before the model call, and small talk follows the configured bypass. Check citation verification and the single repair retry with `grounding.verify: "retry"` if a deliberately ungrounded draft can be reproduced.
6. Restart the server with the same persistent data directory. Confirm setup remains ready, completed books remain indexed, and any queued/running ingest jobs are reported through `ingest.recovery.*` and resume safely.
7. After testing, remove the fixture books (or rerun the live script without `--keep`), turn off `DIVEEOI_TL_DEBUG`, and securely delete diagnostic files. Avoid uploading private learning material during a debug run.

The model-backed script and manual chat steps are necessary for confidence in the real embedder/LLM path. Unit tests, source parsing, or a successful production compilation alone do not establish live retrieval quality or citation behavior. Record which of these steps were actually run; do not mark skipped model-backed validation as passed.
