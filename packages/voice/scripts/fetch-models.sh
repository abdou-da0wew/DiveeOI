#!/usr/bin/env bash
# Downloads Vosk STT models into packages/voice/models/ (gitignored).
# Usage: scripts/fetch-models.sh [model-name ...]
# Default: EN small + MSA Arabic big + Arabic small fallback.
# Resumable: partial downloads continue where they left off (-C -).
set -euo pipefail
MODELS_DIR="$(cd "$(dirname "$0")/.." && pwd)/models"
mkdir -p "$MODELS_DIR"
MODELS=("$@")
if [ ${#MODELS[@]} -eq 0 ]; then
  MODELS=(vosk-model-small-en-us-0.15 vosk-model-ar-0.22 vosk-model-small-ar-tn-0.1-linto)
fi
for name in "${MODELS[@]}"; do
  if [ -d "$MODELS_DIR/$name" ]; then echo "SKIP $name (exists)"; continue; fi
  echo "FETCH $name"
  zip="$MODELS_DIR/$name.zip"
  curl -sL --retry 3 -C - -o "$zip" "https://alphacephei.com/vosk/models/$name.zip" || true
  if ! unzip -q -o "$zip" -d "$MODELS_DIR"; then
    echo "UNZIP FAILED $name — full redownload"
    rm -f "$zip"
    curl -sL --retry 3 -o "$zip" "https://alphacephei.com/vosk/models/$name.zip"
    unzip -q -o "$zip" -d "$MODELS_DIR"
  fi
  rm -f "$zip"
  echo "DONE $name"
done
echo "MODELS-READY"
