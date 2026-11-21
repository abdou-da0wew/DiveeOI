# Changelog

Notable changes to DiveeOI are recorded here. Unreleased work remains under **Unreleased** until it is included in a release.

## Unreleased

### Added

- Added the `@diveeoi/coenx-video` package foundation for shared composition authoring, keyframe animation, interactive state/event logic, Canvas/DOM playback, 2D and basic mesh rendering, SVG/FFmpeg MP4 export, audio tracks, and batched Rust physics.
- Added project-discoverable coenx-video agent skills for standard/interactive output selection, 17 visual styles, three explainer formats, transcript-led motion inserts, optional object separation and sound design.
- Archived the Awesome Claude motion-graphics page, its complete 17 style prompts, downloadable skill and page assets; cloned Barty-Bart/motion-graphics at a pinned MIT-licensed revision with source-specific asset notices intact.
- Added Rich UI Learning blocks and an interactive platformer component, including dedicated parser/schema modules, shared renderers, composition handling, and engine tests.
- Added exam-content validation that rejects embedded self-grading quizzes, and aligned exam tool schemas and review/export metadata with the Rich UI contract.
- Added server-managed outbound SSH Remote Sessions: OpenSSH host/profile discovery, Ed25519 key generation, saved-profile probing, encrypted password/passphrase storage, and per-session attach/disconnect with remote working-directory selection.
- Added strict SSH host-key verification against the server account's OpenSSH `known_hosts`, including hashed host entries, non-default ports, wildcard exclusions, and revoked-key handling.
- Added remote SFTP recursive globbing, upward discovery (`findUp`, `up`, `groupUp`, `globUp`), recursive parent creation, recursive copy destination creation, chmod, rename, and directory-aware removal.
- Added a separately configurable inbound SSH REPL listener with an explicit host-key file and optional username enforcement.
- Added focused SFTP and SSH host-verification tests, a reusable live SSH smoke script, and browser regressions for Settings and session attachment.

- Added Coenx Video's CML/CSS/CoenxScript source authoring pipeline for safe declarative video and interactive lessons.
- Bundled a 16-family offline typography library with Arabic/Latin WOFF2 subsets and per-family SIL OFL notices, used consistently in MP4 and interactive outputs.
- Added the Coenx video guidance skill suite, including examples, style prompts, capability maps and authoring references in DiveeOI's skill registry.
- Added a Rust/Cairo/Pango native frame renderer and an opt-in TypeScript-to-FFmpeg native MP4 pipeline with animation evaluation and audio muxing.
- Added an SVG DOM renderer option to the interactive player alongside the Canvas renderer.
- Expanded CPU 3D composition support with configurable lights/material shading, morph targets, keyframed 3D transforms, deterministic 3D physics, additional scene transitions and projected-mesh support in the opt-in Cairo native MP4 renderer.

### Improved

- Tightened adaptive memory, concurrency, queue, stream, and cache budgets; SQLite cache sizing now respects an HDD-aware ceiling, and the server begins its low-memory cleanup path earlier.
- Made workspace fallback indexing lazy and bounded, built directory indexes incrementally, and revalidated cached project paths through a single workspace root.
- Improved Arabic and English grounding instructions and the Targeted Learning embedding/query-encoding path.
- Made server packaging more resilient by allowing reuse of an existing Web UI distribution and serving a file-backed UI asset directory when the embedded module is unavailable.
- Added Oxlint and Biome as root development tools, a focused remote test configuration, and explicit Playwright port/backend configuration.

### Fixed

- Shell execution now quotes remote working directories and environment values as POSIX shell arguments instead of using JSON string quoting.
- Remote connection cache identities include the selected profile/authentication identity, preventing stale connection reuse after profile edits.
- Playwright's app proxy configuration now uses the backend's actual default port (`4097`) and the `VITE_DIVEEOI_SERVER_*` variables.
- Unsupported lower-level SFTP operations fail explicitly rather than silently claiming to succeed with incomplete behavior.
