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
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const root = mkdtempSync(path.join(tmpdir(), "tl-routes-test-"))

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

export const testRoot = root
/** The instance directory the tests route requests to (x-opencode-directory / ?directory=). */
export const testDirectory = path.join(root, "instance")
/** Path of the global config file the settings PATCH writes. */
export const globalConfigFile = path.join(process.env.OPENCODE_CONFIG_DIR!, "diveeoi.jsonc")

export function cleanupTestRoot() {
  rmSync(root, { recursive: true, force: true })
}
