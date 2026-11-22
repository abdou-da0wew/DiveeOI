# skills/

This directory holds **vendored agent-skill packs**, not product code.

## Contents

- **10 vendored skills, 276 files:** nine `hyperframes-*` skill packs (`hyperframes` entry point,
  `-animation`, `-audio`, `-cli`, `-core`, `-creative`, `-keyframes`, `-registry`, `-studio`) plus
  `research/`. They teach a coding agent how to author and render videos with the external
  [HyperFrames](https://hyperframes) HTML-video framework via `npx hyperframes …`.
- **Zero product wiring (verified 2026-11-22):** `rg -i "hyperframes" packages/ package.json bunfig.toml bun.lock .github` (excluding `node_modules`) returns **no matches**. Nothing in the product imports, executes, bundles, or depends on these skills; they are read by coding agents only.
- **Decision — KEEP as vendored content.** The suite is maintained as-is for the external
  `npx hyperframes` ecosystem (same relationship class as other upstream-vendored material in this
  repo). It is not exercised by the repo's test suites.

Removal or relocation of the `hyperframes-*` suite is an **owner decision**, to be revisited only if
the external `npx hyperframes` dependency disappears from the workflows that use it.

See also: `docs/PROJECT_MAP.md` (skills/ row) and `docs/plans/INDEX.md` for the plans/drafts index.
