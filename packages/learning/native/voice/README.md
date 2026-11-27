# divee-voice — voice sidecar (Rust)

The DiveeOI voice-mode sidecar, following the same contract as `divee-retrieval`
(one long-lived NDJSON child per server, best-effort client, typed fallback):
**STT** (vosk on-device + any OpenAI-compatible cloud endpoint + mock) and
**TTS** (supertonic-3 via ONNX Runtime, Arabic + English + 31 languages).
Protocol and architecture: `docs/voice-mode/PLAN.md`.

## Build

```bash
export CARGO_HOME=/home/z/my-project/toolchain/cargo   # existing toolchain layout
export RUSTUP_HOME=/home/z/my-project/toolchain/rustup
export PATH="$CARGO_HOME/bin:$PATH"
scripts/fetch-models.sh          # vosk models + libvosk.so + supertonic-3 (~2.2 GB, resumable)
cargo build --release            # links lib/libvosk.so via build.rs
```

Runtime deps: `libonnxruntime` (pip `onnxruntime` or system; `ORT_DYLIB_PATH`
overrides — identical to divee-retrieval). `libvosk.so` is vendored in `lib/`.

## Run

```bash
./target/release/divee-voice --serve \
  [--models-dir models] [--supertonic-onnx models/supertonic3/onnx] \
  [--supertonic-styles models/supertonic3/voice_styles]
```

NDJSON over stdin/stdout: requests carry `id`+`op`; async events carry
`event`. Full op/event table in `src/main.rs` header docs.

## Provenance / licenses

- supertonic-3 inference vendored from `supertone-inc/supertonic`
  `rust/src/helper.rs` (Apache-2.0), adapted to ort 2.0.0-rc.15
  (`DIVEEOI-PATCH` markers). Model weights: OpenRAIL-M
  (`Supertone/supertonic-3` on HF) — no voice cloning of real people,
  attribution kept here; disclosure note ships in the UI.
- vosk: Apache-2.0 (libvosk.so from the alphacep vosk-api release).
- vosk models: Apache-2.0 (`vosk-model-small-en-us-0.15`,
  `vosk-model-ar-0.22`, `vosk-model-small-ar-tn-0.1-linto` fallback).
