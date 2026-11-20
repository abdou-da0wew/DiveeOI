# Changelog

Notable changes to DiveeOI are recorded here. Unreleased work remains under **Unreleased** until it is included in a release.

## Unreleased

### Added
- Added Rich UI Learning blocks and an interactive platformer component, including dedicated parser/schema modules, shared renderers, composition handling, and engine tests.
- Added exam-content validation that rejects embedded self-grading quizzes, and aligned exam tool schemas and review/export metadata with the Rich UI contract.
- Added server-managed outbound SSH Remote Sessions: OpenSSH host/profile discovery, Ed25519 key generation, saved-profile probing, encrypted password/passphrase storage, and per-session attach/disconnect with remote working-directory selection.
- Added strict SSH host-key verification against the server account's OpenSSH `known_hosts`, including hashed host entries, non-default ports, wildcard exclusions, and revoked-key handling.
- Added remote SFTP recursive globbing, upward discovery (`findUp`, `up`, `groupUp`, `globUp`), recursive parent creation, recursive copy destination creation, chmod, rename, and directory-aware removal.
- Added a separately configurable inbound SSH REPL listener with an explicit host-key file and optional username enforcement.
- Added focused SFTP and SSH host-verification tests, a reusable live SSH smoke script, and browser regressions for Settings and session attachment.

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
