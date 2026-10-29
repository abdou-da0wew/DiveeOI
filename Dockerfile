# Dockerfile for DiveeOI with Targeted Learning
#
# Builds a production image with the bge-m3 model pre-seeded (optional).
# The image uses Debian/glibc because onnxruntime-node (used by
# Transformers.js v3 for native inference) commonly fails on Alpine/musl.
# When the native runtime can't load, Transformers.js falls back to WASM
# automatically — slower, but it always works.
#
# Build:
#   docker build -t diveeoi:latest .
#
# Build with pre-seeded model (skip the in-app Setup download):
#   docker build -t diveeoi:with-model --build-arg SEED_MODEL=1 .
#
# Run:
#   docker run -p 4097:4097 -v diveeoi-data:/data diveeoi:latest
#
# The /data volume persists the generated JWT signing key, books.db, the
# model, uploaded books, and setup.json across container restarts.

FROM debian:bookworm-slim AS base

# Install runtime deps: ca-certificates for HTTPS, fontconfig for pdfjs,
# libglib2.0 for onnxruntime native bindings.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fontconfig \
    libglib2.0-0 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Copy workspace files
COPY package.json bun.lock bunfig.toml turbo.json tsconfig.json ./
COPY packages/ packages/
COPY patches/ patches/
COPY scripts/ scripts/

# Install deps (production only)
RUN bun install --frozen-lockfile --production

# Build the server
RUN bun run build:current

# ---- Optional: pre-seed the model ----
FROM base AS model-seed
ARG SEED_MODEL=0
ARG MODEL_DTYPE=int8
# When SEED_MODEL=1, download the model into the image so the in-app
# Setup step is skipped on first run.
RUN if [ "$SEED_MODEL" = "1" ]; then \
      mkdir -p /data/targeted-learning/models/Xenova/bge-m3 && \
      cd /data/targeted-learning/models/Xenova/bge-m3 && \
      for f in tokenizer.json tokenizer_config.json config.json special_tokens_map.json; do \
        curl -fsSL "https://huggingface.co/Xenova/bge-m3/resolve/main/$f" -o "$f"; \
      done && \
      curl -fsSL "https://huggingface.co/Xenova/bge-m3/resolve/main/onnx/model_${MODEL_DTYPE}.onnx" -o "onnx/model_${MODEL_DTYPE}.onnx"; \
    fi

# ---- Final image ----
FROM model-seed

# Create the data directory
RUN mkdir -p /data

# Environment
ENV DIVEEOI_DATA_DIR=/data
ENV DIVEEOI_TL_DATA_DIR=/data/targeted-learning
ENV HOST=0.0.0.0
ENV PORT=4097
ENV NODE_ENV=production

# Expose the server port
EXPOSE 4097

# Healthcheck: hit the Targeted Learning health endpoint
# A 401 is healthy here: production requires auth by default, and this check
# measures liveness rather than whether a particular credential is configured.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD bun -e "fetch('http://127.0.0.1:4097/targeted-learning/health').then(r => (r.ok || r.status === 401) ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Volume for persistent data (books.db, model, uploads, setup.json)
VOLUME ["/data"]

# Start the server
CMD ["bun", "run", "--cwd", "packages/server", "dev"]
