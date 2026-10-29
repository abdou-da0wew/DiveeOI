# DiveeOI Targeted Learning — Deployment Guide

This document covers deploying DiveeOI with the Targeted Learning feature,
including the Docker recipe, model pre-seeding, and offline machines. For general
server authentication and production hardening, see [`security-auth.md`](security-auth.md).

## Quick start (Docker)

```bash
# Build the image
docker build -t diveeoi:latest .

# Run with a persistent volume
docker run -d \
  --name diveeoi \
  -p 4097:4097 \
  -v diveeoi-data:/data \
  -e DIVEEOI_AUTH_MODE=both \
  -e DIVEEOI_SERVER_USERNAME=DIVEEOI \
  -e DIVEEOI_SERVER_PASSWORD='replace-with-a-strong-unique-secret' \
  diveeoi:latest

# Check health with the configured Basic credentials
curl -u 'DIVEEOI:replace-with-a-strong-unique-secret' \
  http://localhost:4097/targeted-learning/health
```

Production has no default Basic password; set a strong unique password as above, or use JWT account login with `DIVEEOI_AUTH_MODE=jwt`. `DIVEEOI_DATA_DIR=/data` and the Targeted Learning data directory are persisted on the `/data` volume. The image healthcheck treats an authenticated `401` as live; use the Basic credentials in the example when manually querying the protected health route.

The first run will have `setupStatus: "not-started"`. Open the web UI,
go to Settings → Targeted Learning, and click **Start Setup** to download
the bge-m3 model (~568 MB for int8).

## Pre-seeding the model (offline / air-gapped)

For offline machines, build the image with the model pre-seeded:

```bash
# Build with the int8 model baked in (default)
docker build -t diveeoi:with-model --build-arg SEED_MODEL=1 .

# Or with fp32 (higher quality, 2.27 GB)
docker build -t diveeoi:with-model-fp32 \
  --build-arg SEED_MODEL=1 \
  --build-arg MODEL_DTYPE=fp32 \
  .
```

When the container starts with a pre-seeded model, the Setup step will
skip the download and jump straight to verification + self-test.

## Offline import (no Docker)

If you're running DiveeOI outside Docker on an offline machine:

1. On a machine with internet, run `bun run tl:manifest` in `packages/learning/`
   to generate `manifest.json`.
2. Download the model files listed in `manifest.json` to a folder.
3. Copy the folder to the offline machine.
4. In the web UI, go to Settings → Targeted Learning → **Use a local folder**
   and point at the folder. The downloader verifies every file against the
   manifest's sha256 hashes and rejects path traversal or symlinks that escape
   the selected source/destination roots.

## Configuration

All settings live under `targetedLearning` in the config file
(`~/.config/diveeoi/diveeoi.jsonc`). The full parameter catalog is in
`packages/learning/src/settings/schema.ts`. Key settings:

```jsonc
{
  "targetedLearning": {
    "enabled": true,
    "embedding": { "dtype": "int8", "device": "auto" },
    "indexing": { "workersPerBook": 2, "pauseWhileChatting": true },
    "retrieval": { "finalTopK": 8, "queryRewrite": "heuristic" },
    "gate": { "enabled": true, "allowSmallTalk": true },
    "grounding": { "verify": "retry", "requireCitations": true }
  }
}
```

With `grounding.verify: "retry"`, an answer that fails citation/grounding verification is removed and retried once with a repair instruction; if the retry is still unverified, the final answer is marked with a warning. Retrieved passages are not retained as trusted context after verification.

Environment variables override config (with `DIVEEOI_TL_*` prefix,
falling back to `OPENCODE_TL_*`):

- `DIVEEOI_TL_DATA_DIR` — where books.db + model live
- `DIVEEOI_DISABLE_FEATURES=learning` — disable the feature entirely

## Ingest jobs and recovery

Book indexing jobs are persisted in `books.db` and can be listed and controlled in the Library UI or through these authenticated routes:

- `GET /targeted-learning/jobs`
- `POST /targeted-learning/jobs/:jobID/pause`
- `POST /targeted-learning/jobs/:jobID/resume`
- `POST /targeted-learning/jobs/:jobID/cancel`
- `POST /targeted-learning/jobs/:jobID/retry`

Queued/running jobs are recovered when the server restarts. Recovery validates that the stored source remains inside the library, checks its SHA-256, then rebuilds the index from the beginning; it does not continue from the exact recorded batch. Paused jobs remain paused after restart. Keep source files enabled (`keepSourceFiles: true`, the default) if automatic recovery/re-indexing is required. Setup itself can be cancelled with `POST /targeted-learning/setup/cancel` or the UI control.

## Resource requirements

- **Minimum**: 2 cores, 4 GB RAM, 2 GB free disk (int8 model + small library)
- **Recommended**: 4 cores, 8 GB RAM, 10 GB free disk
The Setup probe auto-detects the machine and recommends an embedding/indexing preset:

- **`low`**: int8, 256-token max length, batch size 8, 1 worker per book, 64 MB vector cache
- **`balanced`**: default int8, 512-token max length, batch size 16, 2 workers per book, 256 MB vector cache
- **`high`**: fp32, 512-token max length, batch size 32, 2 workers per book (global cap 4), 512 MB vector cache

These are Targeted Learning presets. The server's separate adaptive runtime profiles (`comfortable` through `critical`) adjust concurrency, queues, and SQLite cache based on host/container pressure; see [`optimization.md`](optimization.md).

## Backups

- `books.db` — library, vectors, notes, and persisted ingest-job checkpoints
- `student.db` — student profile and learning memory
- `setup.json` — setup state (which steps completed)
- `books/` — source files (PDFs/DOCX/TXTs) needed for replay/re-indexing
- `models/` — the downloaded embedding model

The "Back up library" button in the UI uses `VACUUM INTO` to create a
consistent snapshot of books.db.

## Troubleshooting

### "books.db corrupt" message
The store auto-recovers: it moves the corrupt file aside as
`books.db.corrupt-<timestamp>` and creates a fresh DB. Re-index your
books from the Library tab.

### "Golden vectors are not yet frozen" in the optional regression self-test
This message comes from `runSelfTest()` in `packages/learning/src/self-test`; its fixture currently has empty reference vectors. It is separate from the setup pipeline: the setup step named `golden-self-test` currently runs `steps.semanticSelfTest` (normalization and cross-lingual sanity checks) and does not require frozen vectors. On a host with the pinned int8 model installed and verified, run `bun run tl:selftest:freeze` in `packages/learning/`, then run the learning tests and review the fixture diff. Freezing vectors is useful for reproducible model regression checks, but is not a setup prerequisite or a substitute for a live retrieval evaluation.

### Slow inference on CPU
Switch to `int8` dtype (default) or the `low` profile. The WASM backend
is the automatic fallback when native ONNX can't load — it's slower but
always works.

### Arabic text not extracting from PDF
Phase 2 uses pdfjs-dist which handles Arabic script. If extraction is
poor, check `textDensity` in the book's summary — pages below 0.1 need
OCR. Enable the OCR pack in Settings → Targeted Learning → Advanced.
