#!/usr/bin/env bash
# Downloads everything the divee-voice sidecar needs (all gitignored):
#   models/vosk-*            Vosk STT models (EN small, MSA Arabic big, AR small fallback)
#   lib/libvosk.so           vosk C library from the alphacep release (link target)
#   models/supertonic3/      supertonic-3 ONNX graphs + voice styles (HF, ~400 MB)
# Resumable: curl -C -.
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$BASE/models"
LIB_DIR="$BASE/lib"
mkdir -p "$MODELS_DIR" "$LIB_DIR"

fetch() { # fetch <url> <dest> — --fail so HTTP errors never save response bodies
  local url="$1" dest="$2"
  if [ -f "$dest" ] && ! head -c 60 "$dest" | grep -q "Entry not found"; then echo "SKIP $(basename "$dest")"; return 0; fi
  rm -f "$dest"
  echo "FETCH $(basename "$dest")"
  curl -fsSL --retry 3 -C - -o "$dest" "$url" || { rm -f "$dest"; echo "FETCH FAILED $(basename "$dest")"; return 1; }
}

# --- vosk models -------------------------------------------------------------
for name in vosk-model-small-en-us-0.15 vosk-model-ar-0.22-linto-1.1.0 vosk-model-small-ar-tn-0.1-linto; do
  if [ -d "$MODELS_DIR/$name" ]; then echo "SKIP $name"; continue; fi
  zip="$MODELS_DIR/$name.zip"
  curl -sL --retry 3 -C - -o "$zip" "https://alphacephei.com/vosk/models/$name.zip" || true
  if ! unzip -q -o "$zip" -d "$MODELS_DIR"; then
    echo "UNZIP FAILED $name — full redownload"
    rm -f "$zip"
    curl -sL --retry 3 -o "$zip" "https://alphacephei.com/vosk/models/$name.zip" || true
    unzip -q -o "$zip" -d "$MODELS_DIR" || echo "FAILED-AGAIN $name (continuing)"
  fi
  rm -f "$zip"
  echo "DONE $name"
done

# --- libvosk.so --------------------------------------------------------------
if [ ! -f "$LIB_DIR/libvosk.so" ]; then
  tmp="$LIB_DIR/vosk-c-lib.zip"
  fetch "https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-linux-x86_64-0.3.45.zip" "$tmp"
  unzip -q -o "$tmp" -d "$LIB_DIR/vosk-c-lib"
  find "$LIB_DIR/vosk-c-lib" -name "libvosk.so*" -exec cp {} "$LIB_DIR/" \;
  rm -rf "$LIB_DIR/vosk-c-lib" "$tmp"
  echo "DONE libvosk.so"
fi

# --- supertonic-3 (HF: Supertone/supertonic-3) --------------------------------
ST_DIR="$MODELS_DIR/supertonic3"
mkdir -p "$ST_DIR/onnx" "$ST_DIR/voice_styles"
HF="https://huggingface.co/Supertone/supertonic-3/resolve/main"
for f in duration_predictor.onnx text_encoder.onnx vector_estimator.onnx vocoder.onnx tts.json unicode_indexer.json; do
  fetch "$HF/onnx/$f" "$ST_DIR/onnx/$f"
  # guard against stub/pointer bodies masquerading as weights
  if [ -f "$ST_DIR/onnx/$f" ] && [ "${f##*.}" = "onnx" ] && [ "$(stat -c%s "$ST_DIR/onnx/$f")" -lt 1000000 ]; then
    echo "SUSPICIOUS SIZE $(basename "$f") ($(stat -c%s "$ST_DIR/onnx/$f") bytes) — deleting"
    rm -f "$ST_DIR/onnx/$f"
  fi
done
for v in M1 M2 M3 M4 M5 F1 F2 F3 F4 F5; do
  fetch "$HF/voice_styles/$v.json" "$ST_DIR/voice_styles/$v.json"
done

echo "VOICE-MODELS-READY"
