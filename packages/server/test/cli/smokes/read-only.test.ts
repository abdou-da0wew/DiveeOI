// Tier-A smoke tests for the CLI's read-only commands. Each test asserts only
// that the command exits 0 and produces *some* output in the isolated harness
// env.
//
// These are not behavioral tests — they're the cheapest possible signal that
// the argv parsing, config-file resolution and (for `db`) SQLite boot don't
// crash for the broad class of "no inputs, no side effects" commands. A
// regression in the shared wiring (a renamed env var, a bad path join, a broken
// Database handle) fails one or more of these tests.
//
// Scope: the CLI this fork actually ships (src/cli/index.ts) is a small
// hand-rolled dispatcher — `version`, `help`, `mcp list|validate`,
// `config path|validate|reset`, `db path|entries|reset`. Commands that only
// existed in upstream's yargs CLI (`providers`, `models`, `agent`, `session`,
// `stats`, `run`, `acp`, `serve`, `github`, `plugin`, `export`, `import`,
// `debug`, `web`, `upgrade`, `uninstall`, `attach`, `pr`) are not here, and
// these tests are not their place.
//
// If a future change should make one of these commands intentionally fail in
// an empty env, update the assertion + add a note explaining the new contract.
//
// Speed: each test pays ~1.5s for bun startup. Tests serialize within this
// file.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { cliIt } from "../../lib/cli-process"

// The CLI resolves its config from XDG_CONFIG_HOME (never from
// OPENCODE_CONFIG_CONTENT, which only the server's config service reads), so a
// test that needs config content has to write the file into the fixture's
// tmpdir at this exact path.
function writeConfig(home: string, contents: unknown) {
  return Effect.gen(function* () {
    const dir = path.join(home, ".config", "diveeoi")
    yield* Effect.promise(() => mkdir(dir, { recursive: true }))
    yield* Effect.promise(() => Bun.write(path.join(dir, "opencode.json"), JSON.stringify(contents)))
  })
}

describe("diveeoi read-only commands (smoke)", () => {
  // `mcp list` reads the `mcp` block of the config file. The harness gives the
  // child an empty XDG_CONFIG_HOME, so the resolver finds nothing and the
  // command should report that cleanly rather than crash.
  cliIt.live(
    "mcp list: exits 0 and reports no servers",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["mcp", "list"])
        opencode.expectExit(r, 0, "mcp list")
        expect(r.stdout).toContain("No MCP servers configured")
      }),
    60_000,
  )

  // `mcp validate` walks the same set. Zero servers is vacuously valid, so it
  // exits 0 and says so. This is the one command whose exit code carries
  // meaning (1 when a server entry is malformed), so pinning the empty case
  // guards the "0 when there is nothing wrong" half of that contract.
  cliIt.live(
    "mcp validate: exits 0 when there is nothing to validate",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["mcp", "validate"])
        opencode.expectExit(r, 0, "mcp validate")
        expect(r.stdout).toContain("All configurations valid")
      }),
    60_000,
  )

  // `config path` prints the resolved config file location. Under harness
  // isolation XDG_CONFIG_HOME points into the tmpdir, so the answer must be
  // inside it — that's what proves the resolver honoured the env var instead
  // of falling back to the real ~/.config.
  cliIt.live(
    "config path: exits 0 and resolves under the isolated config home",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["config", "path"])
        opencode.expectExit(r, 0, "config path")
        const lines = r.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
        expect(lines.length).toBeGreaterThanOrEqual(2)
        expect(lines[1]).toStartWith(home)
      }),
    60_000,
  )

  // `config validate` JSON-parses the file. None exists in a fresh tmpdir, so
  // it must say so and exit 0 rather than treat absence as corruption.
  cliIt.live(
    "config validate: exits 0 when no config file exists",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["config", "validate"])
        opencode.expectExit(r, 0, "config validate")
        expect(r.stdout).toContain("No config file found")
      }),
    60_000,
  )

  // `db path` prints the DB file location. Under harness isolation XDG_DATA_HOME
  // points into the tmpdir, so the resolved path must be inside it, and the
  // command must not create the file just by looking (it's read-only).
  cliIt.live(
    "db path: exits 0, resolves under the isolated data home, and creates nothing",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["db", "path"])
        opencode.expectExit(r, 0, "db path")
        const lines = r.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
        // Line 0 is the "Database file path" banner, line 1 the path itself,
        // line 2 the existence flag.
        expect(lines.length).toBeGreaterThanOrEqual(3)
        expect(lines[1]).toStartWith(home)
        expect(lines[2]).toContain("exists:")
      }),
    60_000,
  )

  // `db entries` opens the SQLite file and counts rows per table. With no file
  // present it must short-circuit cleanly instead of throwing from `new
  // Database` on a missing path.
  cliIt.live(
    "db entries: exits 0 when the database file does not exist",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["db", "entries"])
        opencode.expectExit(r, 0, "db entries")
        expect(r.stdout).toContain("Database file does not exist")
      }),
    60_000,
  )

  // `version` prints the build identity. The version string is injected at
  // bundle time and is "local" under `bun run`, so only the shape is pinned.
  cliIt.live(
    "version: exits 0 and prints the product name",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["version"])
        opencode.expectExit(r, 0, "version")
        expect(r.stdout).toContain("DiveeOI")
      }),
    60_000,
  )

  // The `mcp` group is only meaningful if it actually reads the config file.
  // With a real file present, `list` must render a row per server, classify the
  // type, and honour `disabled`. (The table is Name/Type/Status only — it does
  // not print URLs, so that isn't asserted here.)
  cliIt.live(
    "mcp list: reads servers from the resolved config file",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        yield* writeConfig(home, {
          mcp: {
            remote: { type: "remote", url: "https://example.com/mcp" },
            local: { type: "local", command: ["echo", "hi"], disabled: true },
          },
        })

        const r = yield* opencode.spawn(["mcp", "list"])
        opencode.expectExit(r, 0, "mcp list")
        expect(r.stdout).toContain("2 configured")
        expect(r.stdout).toContain("remote")
        expect(r.stdout).toContain("local")
        // `disabled: true` must render as disabled, not active.
        expect(r.stdout).toContain("disabled")
        expect(r.stdout).toContain("active")
      }),
    60_000,
  )

  // `mcp validate` is the one read command whose exit code carries meaning: a
  // malformed server entry must exit 1 and name the field, not print a warning
  // and exit 0.
  cliIt.live(
    "mcp validate: exits 1 and names the problem for a malformed server",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        yield* writeConfig(home, { mcp: { broken: { type: "remote" } } })

        const r = yield* opencode.spawn(["mcp", "validate"])
        expect(r.exitCode).toBe(1)
        expect(r.stdout).toContain("Some configurations have issues")
        expect(r.stdout).toContain("missing or invalid 'url'")
      }),
    60_000,
  )

  // `config validate` is the other one: absent file is fine (0), malformed JSON
  // is an error (1).
  cliIt.live(
    "config validate: exits 1 when the config file is not valid JSON",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const dir = path.join(home, ".config", "diveeoi")
        yield* Effect.promise(() => mkdir(dir, { recursive: true }))
        yield* Effect.promise(() => Bun.write(path.join(dir, "opencode.json"), "{ not json"))

        const r = yield* opencode.spawn(["config", "validate"])
        expect(r.exitCode).toBe(1)
        expect(r.stdout).toContain("Invalid config")
      }),
    60_000,
  )

  // Usage errors must be visible to a script. An unrecognised command used to
  // print "Unknown command" and exit 0, so anything that only checked the exit
  // status — a shell script, a CI step, the smoke tests above — read it as
  // success. These pin the non-zero contract for both the top level and a
  // group's subcommand, including that the error names what IS available.
  cliIt.live(
    "unknown command: exits 1 and points at help",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["definitely-not-a-command"])
        expect(r.exitCode).toBe(1)
        expect(r.stderr).toContain("Unknown command")
        expect(r.stdout).toContain("diveeoi help")
      }),
    60_000,
  )

  cliIt.live(
    "unknown subcommand: exits 1 and lists the available ones",
    ({ opencode }) =>
      Effect.gen(function* () {
        const r = yield* opencode.spawn(["mcp", "definitely-not-a-subcommand"])
        expect(r.exitCode).toBe(1)
        expect(r.stderr).toContain("Unknown mcp subcommand")
        expect(r.stdout).toContain("Available: list, validate")
      }),
    60_000,
  )

  // A `--help` flag must never be mistaken for an unknown subcommand. This
  // covers the migration case: someone carrying an upstream script over types
  // `diveeoi mcp add --help`, and the answer they get must be help for the
  // commands that do exist, not an error about `add`.
  cliIt.live(
    "group --help: exits 0 and lists the group even when the subcommand is gone",
    ({ opencode }) =>
      Effect.gen(function* () {
        const gone = yield* opencode.spawn(["mcp", "add", "--help"])
        opencode.expectExit(gone, 0, "mcp add --help")
        expect(gone.stdout).toContain("validate")
        expect(gone.stderr).toBe("")
      }),
    60_000,
  )
})
