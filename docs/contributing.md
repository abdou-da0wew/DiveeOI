# Contributing

## Workflow

1. Fork + branch from `main` (or `dev` if the team is on a dev cycle — check `PROJECT_LESSONS.md` for the current convention).
2. `bun install` from the workspace root.
3. Implement with Effect strict mode (`packages/server`, `packages/db`, `packages/memory`), SolidJS idioms (`packages/app`, `packages/ui`), or the package's own conventions.
4. Commit with a **plain message**:

```
Short summary (<=50 chars)

What changed and why. Mention the key technical decisions and what they unblock.
```

Do not use `feat:`, `fix:`, `chore:` prefixes, emojis, or AI boilerplate. See `PROJECT_LESSONS.md#Write proper commit messages`.

5. `bun run typecheck` and `bun test` locally for the touched packages.
6. Open a PR with context, linked issues, and `git diff --stat`.

## PR Checklist

- [ ] `bun run lint` green
- [ ] `bun run typecheck` green in affected packages (wrap `db/api/server` in `systemd-run --user --scope -p MemoryMax=1.8G` if on memory-constrained desktop)
- [ ] Tests added or updated for new behavior (recorded cassettes regenerated only if their provider body changed; prefer `RECORD` targeting a single cassette)
- [ ] No secrets, patches forgotten, or absolute paths committed
- [ ] `PROJECT_LESSONS.md` / docs updated for non-obvious decisions
- [ ] `bun run build` still works (the turbo order is `sdk -> app -> server`; do not break it)

## Code Style

- Prefer `Effect.gen` / `Effect.fn("Domain.method")` over manual `.pipe` chains. Use `Effect.fnUntraced` for collectors, log-only helpers, `addFinalizer` bodies.
- In `packages/server`: consume `HttpClient.HttpClient` rather than `fetch`; `FileSystem.FileSystem` over `fs/promises` inside effectified code; `ChildProcessSpawner` from `effect/unstable/process`.
- In `packages/app`: favor `createStore` over multiple `createSignal`, `createSimpleContext` over ad-hoc `createContext`, Solid primitives from `@diveeoi/ui/context` over raw contexts.

## Before Opening a Large PR

For features touching 3+ packages, a plan is short but real:

- what changes and why,
- per-file breakdown,
- ordering constraints (layer deps, build order),
- migration/rollback (SQLite `PRAGMA` changes, data migration files, config migration),
- what could go wrong and how you'd notice.

`PROJECT_GUIDE.md` is the map to sanity-check against; `plans/diveeOI-typeerror-campaign/` is an example of a per-file plan directory.

## Reviews

Maintainers run like `Mimo`:

- assume nothing is proven until it streams,
- check for doom loops (`permission ask` missing for a wildcard `*` pattern),
- verify the `LayerNode` wiring (a missing `node` dep fails silently at boot — the `provideMerge` seam must be patched),
- prefer `Scope.close` finalizers over external cleanup timers,
- ask: "does the new endpoint have an explicit `SessionLocationMiddleware` if it is per-directory?"

## Issue Reports

Useful template:

- expected behavior,
- repro (command, config snippet, `curl` or cassette diff if relevant),
- actual behavior (including `Effect log` excerpt or browser console from `Sentry` if available),
- environment (`bun --version`, `node --version`, `Effect` beta, `OPENCODE_*` envs).

## License

By contributing you agree your changes are MIT-licensed like the repo.
