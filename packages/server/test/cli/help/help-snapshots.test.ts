// Help-text snapshots for the CLI's real surface. Catches accidental command
// removals, renames, and reordering in a single sweep — any change to the
// user-visible CLI surface shows up here as a diff.
//
// Scope: this fork replaced upstream's yargs CLI with a hand-rolled dispatcher
// (src/cli/index.ts). Its entire surface is `version`, `help`, and the three
// groups `mcp`, `config`, `db`. Upstream had ~30 top-level commands (acp, run,
// serve, attach, providers, agent, upgrade, github, session, plugin, export,
// import, debug, web, stats, models, …); none of those exist here, and their
// `--help` now exits 1 with "Unknown command". Snapshotting them would pin
// help text the binary cannot produce, so the list below is derived from the
// commands src/cli/index.ts actually dispatches — see GROUPS there.
//
// Every command and group answers `--help` on stdout with exit 0. That is
// asserted per command below rather than once up front, so a command that
// starts rejecting `--help` fails on its own line.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { EOL } from "os"
import { cliIt } from "../../lib/cli-process"
import { normalizeForSnapshot } from "../../lib/snapshot"

// Top-level commands. `version` and the help flags are all routed to the same
// `printHelp`/version output, so they share one snapshot each.
const TOP_LEVEL = ["help", "version"] as const

// Command groups. `--help` on a group lists that group's subcommands, so this
// is where the subcommand surface (and its ordering) is actually pinned.
const GROUPS = ["mcp", "config", "db"] as const

describe("diveeoi CLI help-text snapshots", () => {
  // One test, parallel spawns — wall-clock stays a few seconds because this
  // surface is 5 entries, not upstream's ~35.
  cliIt.live(
    "every documented command emits stable help text",
    ({ opencode }) =>
      Effect.gen(function* () {
        const argvs: Array<readonly string[]> = [
          ...TOP_LEVEL.map((c) => [c] as const),
          ...GROUPS.map((g) => [g] as const),
        ]

        // Spawn in parallel, then assert in argv order so snapshot output is
        // deterministic and per-command failures don't abort the rest of
        // the sweep. `Effect.partition` is the canonical "run all, separate
        // failures from successes" primitive — no mutable accumulator needed.
        const [failures, results] = yield* Effect.partition(
          argvs,
          (argv) =>
            Effect.gen(function* () {
              const result = yield* opencode.spawn([...argv, "--help"])
              if (result.exitCode !== 0) {
                return yield* Effect.fail(
                  `diveeoi ${argv.join(" ")} --help: exit ${result.exitCode}\n${result.stderr.trim()}`,
                )
              }
              return { argv, result }
            }),
          { concurrency: 8 },
        )

        for (const { argv, result } of results) {
          // Help goes to stdout (src/cli/index.ts uses console.log throughout);
          // stderr stays empty for these commands.
          expect(result.stdout.endsWith(EOL)).toBe(true)
          expect(result.stderr).toBe("")
          expect(normalizeForSnapshot(result.stdout)).toMatchSnapshot(`diveeoi ${argv.join(" ")} --help`)
        }
        if (failures.length > 0) {
          throw new Error(`Help text failed for:\n  ${failures.join("\n  ")}`)
        }
      }),
    180_000,
  )
})
