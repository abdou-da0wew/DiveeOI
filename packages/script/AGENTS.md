# Script Package (@diveeoi/script)

Build and utility scripts used by other packages (primarily `@diveeoi/server` as a dev dependency).

- **Single file** — `src/index.ts` exports the `Script` object with version/channel/release metadata derived from git and npm.
- **Version resolution** (`Script.version`) — for `latest` channel: increments the patch of the npm registry version. For preview channels: generates `0.0.0-{CHANNEL}-{timestamp}`.
- **Env vars** control behavior: `OPENCODE_CHANNEL`, `OPENCODE_BUMP`, `OPENCODE_VERSION`, `OPENCODE_RELEASE`.
- **`Script.channel`** — derived from env, fallback to `git branch --show-current`. `"latest"` vs preview determines version scheme.
- **`Script.team`** — reads from `.github/TEAM_MEMBERS` file, falls back to known bot users.
- **No Effect dependency** — plain TypeScript with `bun` runtime. Only dependency is `semver`.
- **`Script.release`** — boolean flag from `OPENCODE_RELEASE` env var (used by CI to gate publish steps).
- This is NOT an npm-published package — it's a monorepo-internal tool used via workspace reference.
