# @diveeoi/script

Internal build/package helpers. Not published — listed as `devDependency` only in `packages/server`. Do not depend on this package from runtime code.

## What it provides

Typical entries (see `src/*.ts`):

- `src/build.ts` — turbo-aware wrapper for the server binary (esbuild/bundler steps, app asset collection, optional `--all` multi-arch emit). Also the layer that `sst` hooks via `sst-env.d.ts`.
- `src/migration.ts` — Drizzle `push` / `generate` helper calling `drizzle-kit` with `Global.Path.data` resolution.
- `src/httpapi-exercise.ts` — live exercise cover for `packages/server` HttpApi groups (`--mode coverage|auth|effect`).
- Misc scripts for `prepublish`, version stamping (`InstallationVersion` perturbation), wasm asset wrangling (`web-tree-sitter.*`, `tree-sitter-{bash,powershell}`).

## Run

```bash
bun --cwd packages/script run build
bun run build           # root alias: bun scripts/build.ts
bun run build:nobin
bun run build:all
```

## Conventions

- No runtime imports from `server`/`db`/`api` — only file-system helpers and `Path/FSUtil`. Introducing an Effect `Service` here would invert the layer graph.
- Any `wasm` path that ends up shipped must be `fileURLToPath(resolveWasm(import.meta.url, wasmImport))` style (see `packages/server/src/tool/shell.ts:resolveWasm`) so it works both under `bun run` and in a bundled `dist/`.
- Keep `.gitignore` fresh (the build writes outside `src/`).
