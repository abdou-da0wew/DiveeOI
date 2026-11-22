#!/usr/bin/env bash
# check-favicons.sh — favicon drift checker (manual tool, NOT wired into CI).
#
# Canonical single-source rule (see brand/README.md):
#   packages/ui/src/assets/favicon/  = canonical app favicon set (consumed by
#     packages/ui/src/components/favicon.tsx, packages/app/index.html +
#     packages/app/public/, packages/server/src/server/shared/public-ui.ts).
#   brand/generated/                 = brand-pipeline outputs only; must NOT
#     contain byte-identical copies of the canonical set (they drift).
#
# What this script does:
#   FAIL (exit 1) — any file in brand/generated/ byte-identical (sha256) to a
#     file in the canonical dir. Exact duplicates were removed on 2026-11-22
#     (task 6-d); their re-appearance means the brand pipeline was pointed at
#     the wrong output dir again.
#   WARN — same-named files in both dirs with different content (currently
#     favicon-light.svg: an intentional, differently-serialized brand variant).
#
# Usage (from anywhere):  DiveeOI/scripts/check-favicons.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANONICAL="$REPO_ROOT/packages/ui/src/assets/favicon"
BRAND="$REPO_ROOT/brand/generated"

fail=0
warn=0

if [ ! -d "$CANONICAL" ]; then
  echo "FATAL: canonical dir missing: $CANONICAL" >&2
  exit 2
fi
if [ ! -d "$BRAND" ]; then
  echo "FATAL: brand dir missing: $BRAND" >&2
  exit 2
fi

# Map of canonical content hashes -> canonical file names.
canonical_hashes="$(sha256sum "$CANONICAL"/* 2>/dev/null | awk '{h=$1; $1=""; sub(/^ /,"",$0); print h "\t" $0}')"

for f in "$BRAND"/*; do
  name="$(basename "$f")"
  h="$(sha256sum "$f" | awk '{print $1}')"

  # 1. exact duplicate of any canonical file => drift
  match="$(printf '%s\n' "$canonical_hashes" | awk -F'\t' -v h="$h" '$1==h{print $2; exit}')"
  if [ -n "$match" ]; then
    echo "FAIL: brand/generated/$name is byte-identical to canonical $match"
    echo "      -> delete brand/generated/$name (canonical set lives in packages/ui/src/assets/favicon/)"
    fail=$((fail + 1))
    continue
  fi

  # 2. same name in both dirs but different content => warn (verify intent)
  if [ -e "$CANONICAL/$name" ]; then
    echo "WARN: $name exists in both dirs with DIFFERENT content (intentional variant?)"
    warn=$((warn + 1))
  fi
done

echo
echo "brand/generated files: $(ls -1 "$BRAND" | wc -l) | canonical files: $(ls -1 "$CANONICAL" | wc -l)"
if [ "$fail" -gt 0 ]; then
  echo "RESULT: FAIL — $fail exact duplicate(s) of the canonical favicon set found in brand/generated/"
  exit 1
fi
echo "RESULT: OK — no byte-identical favicon duplicates in brand/generated/ ($warn intentional same-name difference(s))"
