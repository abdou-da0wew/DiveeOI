# DiveeOI Targeted Learning — Deployment Guide

This document covers deploying DiveeOI with the Targeted Learning feature,
including the Docker recipe, model pre-seeding, and offline machines.

## Quick start (Docker)

```bash
# Build the image
docker build -t diveeoi:latest .

# Run with a persistent volume
docker run -d \
  --name diveeoi \
  -p 4097:4097 \
  -v diveeoi-data:/data \
  -e DIVEEOI_SERVER_PASSWORD=your-password \
  diveeoi:latest

# Check health
curl http://localhost:4097/targeted-learning/health
```

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
   manifest's sha256 hashes.

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
    "grounding": { "verify": "flag", "requireCitations": true }
  }
}
```

Environment variables override config (with `DIVEEOI_TL_*` prefix,
falling back to `OPENCODE_TL_*`):

- `DIVEEOI_TL_DATA_DIR` — where books.db + model live
- `DIVEEOI_DISABLE_FEATURES=learning` — disable the feature entirely

## Resource requirements

- **Minimum**: 2 cores, 4 GB RAM, 2 GB free disk (int8 model + small library)
- **Recommended**: 4 cores, 8 GB RAM, 10 GB free disk
- **Profile `low`**: 1 worker, 256-dim maxLength, 64 MB vector cache
- **Profile `balanced`**: 2 workers, 512-dim maxLength, 256 MB vector cache
- **Profile `high`**: 4 workers, fp32 dtype, 512 MB vector cache

The Setup probe auto-detects your hardware and recommends a profile.

## Backups

- `books.db` — the library (books, sections, chunks, vectors, notes)
- `setup.json` — setup state (which steps completed)
- `books/` — source files (PDFs/DOCX/TXTs) for re-indexing
- `models/` — the downloaded embedding model

The "Back up library" button in the UI uses `VACUUM INTO` to create a
consistent snapshot of books.db.

## Troubleshooting

### "books.db corrupt" message
The store auto-recovers: it moves the corrupt file aside as
`books.db.corrupt-<timestamp>` and creates a fresh DB. Re-index your
books from the Library tab.

### "model not loaded" in self-test
The Setup self-test fails if the golden vectors haven't been frozen yet.
Run `bun run tl:selftest:freeze` in `packages/learning/` after the runtime
spike passes.

### Slow inference on CPU
Switch to `int8` dtype (default) or the `low` profile. The WASM backend
is the automatic fallback when native ONNX can't load — it's slower but
always works.

### Arabic text not extracting from PDF
Phase 2 uses pdfjs-dist which handles Arabic script. If extraction is
poor, check `textDensity` in the book's summary — pages below 0.1 need
OCR. Enable the OCR pack in Settings → Targeted Learning → Advanced.
