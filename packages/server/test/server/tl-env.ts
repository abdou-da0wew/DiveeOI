// Isolated environment for the Targeted Learning HTTP route tests.
//
// IMPORTANT: this module must be the FIRST import of the test file that uses
// it. It sets the XDG / DB env vars BEFORE any repo module is loaded, so
// `Global.Path` (@diveeoi/db/global.ts reads xdg-basedir at module load) and
// every database handle land inside a throw-away temp root. This is the same
// isolation pattern as test/server/httpapi-exercise/environment.ts.
//
// Without this redirect, booting the route tree would touch the developer's
// real ~/.local/share/diveeoi data dir and PATCHing settings would write the
// user's real global config file.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// Multi-file runs that share one process keep this root alive until process
// end (see the exit-handler note below), and `bun test` never fires process
// exit listeners (verified on bun 1.3.14 in shared, per-file and --isolate
// modes: neither "exit" nor "beforeExit" runs), so a root would otherwise
// outlive its run forever. Self-heal: each run stamps its OS pid into the
// root; the next run on this machine removes every root whose owner pid is
// gone (or whose pid file is missing/older than 6 h — roots created before
// this stamping existed). A concurrently running owner keeps its root, so
// parallel terminals never steal each other's temp dirs.
function sweepStaleRoots() {
  const legacyCutoff = Date.now() - 6 * 60 * 60 * 1000
  try {
    for (const entry of readdirSync(tmpdir())) {
      if (!entry.startsWith("tl-routes-test-")) continue
      const candidate = path.join(tmpdir(), entry)
      // Decides removal by age for roots without a usable stamp (pre-stamping
      // leftovers or a failed stamp write): nothing alive owns those beyond a
      // few minutes, 6 h is the conservative margin.
      const removeIfStale = () => {
        try {
          if (statSync(candidate).mtimeMs < legacyCutoff) rmSync(candidate, { recursive: true, force: true })
        } catch {
          // Raced with another sweeper/owner — ignore.
        }
      }
      try {
        const owner = Number.parseInt(readFileSync(path.join(candidate, "owner.pid"), "utf8").trim(), 10)
        if (!Number.isInteger(owner) || owner <= 0) {
          removeIfStale()
          continue
        }
        let ownerAlive = false
        try {
          process.kill(owner, 0)
          ownerAlive = true
        } catch (err) {
          // Standard existence-check semantics: EPERM means the process EXISTS
          // but cannot be signalled (container/init pids) — alive. Only a
          // "no such process" class error means the owner is gone.
          ownerAlive = err instanceof Error && (err as NodeJS.ErrnoException).code === "EPERM"
        }
        // Owner pid gone → the run is over → remove immediately. (A recycled
        // pid would merely delay removal to the OS /tmp janitor — harmless.)
        if (!ownerAlive) rmSync(candidate, { recursive: true, force: true })
      } catch (err) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") removeIfStale()
        // Anything else (stat raced with a concurrent sweeper) — ignore.
      }
    }
  } catch {
    // Best effort — never mask the test result with a cleanup failure.
  }
}
sweepStaleRoots()

const root = mkdtempSync(path.join(tmpdir(), "tl-routes-test-"))
try {
  writeFileSync(path.join(root, "owner.pid"), String(process.pid))
} catch {
  // Root still works without the stamp; it just falls back to the age-based sweep.
}

// Snapshot of the pre-test environment. `bun test` runs every file of one
// invocation in a SINGLE process by default (only `bun test --isolate` gives
// each file a fresh global + module registry), so these redirected paths
// would leak into any test file that runs after this one. cleanupTestRoot()
// restores them.
const originalEnv: Array<[string, string | undefined]> = [
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "OPENCODE_DISABLE_SHARE",
  "OPENCODE_DB",
  "DIVEEOI_DISABLE_MIGRATION",
  "OPENCODE_CONFIG_DIR",
].map((key) => [key, process.env[key]])

process.env.XDG_DATA_HOME = path.join(root, "data")
process.env.XDG_CONFIG_HOME = path.join(root, "config")
process.env.XDG_STATE_HOME = path.join(root, "state")
process.env.XDG_CACHE_HOME = path.join(root, "cache")
// No share/cloud calls in tests.
process.env.OPENCODE_DISABLE_SHARE = "true"
// Own SQLite database file for this test run.
process.env.OPENCODE_DB = path.join(root, "tl-routes-test.db")
// Do not migrate a legacy opencode home into the temp root.
process.env.DIVEEOI_DISABLE_MIGRATION = "1"
// Tests run the settings PATCH through a jsonc config file (the default
// candidate name); pin the dir explicitly so the on-disk assertions below are
// stable even if the developer has OPENCODE_CONFIG_DIR exported.
process.env.OPENCODE_CONFIG_DIR = path.join(root, "config", "diveeoi")

// The throw-away root is removed on PROCESS EXIT, not in afterAll: by the
// time afterAll runs, this process's module cache has already resolved every
// xdg/db path from `root` (Global.Path reads xdg-basedir once at import).
// Deleting the root in afterAll would leave those cached paths dangling — the
// observed inter-file contamination when httpapi-instance.test.ts runs after
// this file in one `bun test` process (NotFound on .../log/opencode.log).
// With exit-time removal the shared-process combined run stays green; per-file
// and `--isolate` runs are unaffected, and a second exit-handler rmSync on an
// already-removed path is a no-op (force: true).
//
// Known residual: a shared-process `bun test` run fires NEITHER of these
// listeners on termination (verified empirically on bun 1.3.14), so such a
// run leaves its root behind; the stale sweep at module load removes it on
// the next run on this machine (or the OS /tmp janitor). Per-file and
// `--isolate` runs DO clean up via these handlers.
function removeRoot() {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // Best effort.
  }
}
process.on("exit", removeRoot)
process.on("beforeExit", removeRoot)

export const testRoot = root
/** The instance directory the tests route requests to (x-opencode-directory / ?directory=). */
export const testDirectory = path.join(root, "instance")
/** Path of the global config file the settings PATCH writes. */
export const globalConfigFile = path.join(process.env.OPENCODE_CONFIG_DIR!, "diveeoi.jsonc")

/** Restores the pre-test environment (the root itself is removed at process exit — see above). */
export function cleanupTestRoot() {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
