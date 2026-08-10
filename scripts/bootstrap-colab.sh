#!/usr/bin/env bash
# bootstrap-colab.sh
# All-in-one setup for a fresh Colab VM: installs bun, wires up PATH,
# clones DiveeOI on the dev branch, installs dependencies, and verifies.
# Idempotent: safe to re-run on a partially-set-up VM.
#
# Usage:
#   bash bootstrap-colab.sh            # setup only
#   bash bootstrap-colab.sh --build    # setup + build the server package
#
# Exit codes: 0 = ready, 1 = failed setup, 2 = failed build.

set -euo pipefail

REPO_URL="https://github.com/abdou-da0wew/DiveeOI.git"
BRANCH="dev"
PROJECT_DIR="${PROJECT_DIR:-/content/DiveeOI}"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

say "bootstrap start (host=$(hostname) user=$(whoami) arch=$(uname -m))"

# ---------------------------------------------------------------- bun
if command -v bun >/dev/null 2>&1; then
  say "bun present: v$(bun --version 2>/dev/null || echo unknown)"
else
  say "installing bun"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 || die "bun not on PATH after install"

# persist PATH for later login shells
if [ ! -f /etc/profile.d/bun.sh ]; then
  echo 'export PATH="$HOME/.bun/bin:$PATH"' > /etc/profile.d/bun.sh
  say "wrote /etc/profile.d/bun.sh"
fi

# ------------------------------------------------------------- repo
if [ -d "$PROJECT_DIR/.git" ]; then
  say "repo exists at $PROJECT_DIR; syncing $BRANCH"
  git -C "$PROJECT_DIR" fetch origin "$BRANCH" --depth 50
  git -C "$PROJECT_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$PROJECT_DIR" pull --ff-only origin "$BRANCH" || true
else
  say "cloning DiveeOI ($BRANCH) into $PROJECT_DIR"
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$PROJECT_DIR"
fi

BRANCH_NOW="$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD)"
COMMIT_NOW="$(git -C "$PROJECT_DIR" rev-parse --short HEAD)"
[ "$BRANCH_NOW" = "$BRANCH" ] || die "expected branch $BRANCH, got $BRANCH_NOW"
say "repo: $BRANCH_NOW @ $COMMIT_NOW"

# ---------------------------------------------------------- deps
say "installing dependencies"
bun install --cwd "$PROJECT_DIR" --frozen-lockfile || bun install --cwd "$PROJECT_DIR"

# ------------------------------------------------------- verify
say "verification"
echo "  bun:     $(bun --version)"
echo "  node:    $(node --version 2>/dev/null || echo missing)"
echo "  branch:  $BRANCH_NOW @ $COMMIT_NOW"
echo "  pkgs:    $(ls "$PROJECT_DIR/packages" | tr '\n' ' ')"
echo "  disk:    $(df -h /content 2>/dev/null | tail -1 | awk '{print $4" free of "$2}')"

# ------------------------------------------------------ optional build
if [ "${1:-}" = "--build" ]; then
  say "building @diveeoi/server"
  ( cd "$PROJECT_DIR" && bun run build --filter=@diveeoi/server ) || exit 2
  say "build done"
fi

say "ready: bootstrap complete"
